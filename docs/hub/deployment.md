# Campaign Hub portable deployment

> **Status:** OCI/Compose reference implemented; Oracle adaptation deployed
> **Last verified:** 2026-09-01
> **Owner:** Campaign Hub maintainers

For personal username/password login without an OAuth application, see
[local login](local-login.md) and the `compose.hub.local.yml` override.
For the full Hub behind Cloudflare Tunnel, see [the tunnel guide](cloudflare-tunnel.md)
and add `compose.hub.tunnel.yml` last. That overlay replaces the edge's published
ports with a connector-only HTTP origin; it does not alter the default local stack.
For Portainer Docker Standalone, [the one-file stack](portainer.md) uses
`compose.hub.portainer.yml`, prepared app images and managed configuration/data volumes.
Its initializer removes the need for host paths or `HUB_PROJECT_DIR` at runtime.

## Purpose

The reference stack proves the provider-independent runtime contract. It supports local verification and the
deployed private Oracle staging topology. Oracle uses self-managed PostgreSQL and encrypted portable backups
rather than managed PITR while preserving the same service boundaries.

## Topology

```mermaid
flowchart LR
  Browser -->|https://localhost:8443| Edge[Caddy TLS edge]
  Edge -->|static paths| Static[Lightweight static image]
  Edge -->|/api /auth /ws| BFF[Non-root Node 24 BFF]
  BFF -->|runtime role| DB[(PostgreSQL 17)]
  Migrator[One-shot migrator] -->|schema owner| DB
  Grants[One-shot role grants] -->|schema owner| DB
```

Startup order:

1. PostgreSQL initializes UTF-8 data and creates `hub_runtime`/`hub_backup` login roles.
2. Database health passes.
3. Migrator applies immutable migrations through required version 0013 under the owner credential.
4. Role grant job idempotently creates any newly introduced login role when supplied its password, then
   assigns runtime DML, backup read-only, and operations-evidence privileges/defaults. The migration-0011 usage
   marker is the exception to broad runtime DML: runtime receives only `SELECT, INSERT`, while backup receives
   `SELECT`.
5. BFF starts under `hub_runtime`, passes `/api/live` and `/api/ready`.
6. Edge starts and publishes one host port.

## Images

### BFF

`server/Dockerfile`:

- digest-pinned Node `24.20.0-bookworm-slim`;
- install the current Debian security revision of `libpcre2-8-0` with a fail-closed
  `10.42-1+deb12u1` minimum check, rather than pinning an apt version that disappears when
  Debian supersedes it; CI independently verifies the runtime version;
- upgrade `perl-base` from the pinned base image to at least `5.36.0-7+deb12u4`, which
  fixes the HIGH/CRITICAL findings in the image scan; the build and CI independently
  reject older installed revisions without pinning the exact apt candidate;
- multi-stage deterministic production-only `npm ci`;
- configurable `NPM_REGISTRY` build argument, public registry by default;
- retry policy for transient registry failures;
- only package metadata, `server/`, and shared `hub-json-patch.js`;
- UID/GID 10001;
- OCI source/revision/version labels;
- `/api/live` health check;
- compatible with read-only root filesystem and bounded `/tmp`.

Locally verified size: approximately 85 MB.

### Static site

The existing root `Dockerfile` remains the upstream/static release image and is not changed in purpose. The
portable reference uses `deploy/hub/static.Dockerfile`, a small Caddy file-server image over the existing
static `.dockerignore` context. This avoids inheriting the multi-gigabyte upstream image solely for staging.

Locally verified reference size: approximately 70 MB.

## Local reference stack

```bash
cp server/.env.compose.example .env.hub
# Replace every placeholder. .env.hub is gitignored.

docker compose --env-file .env.hub -f compose.hub.yml config --quiet
docker compose --env-file .env.hub -f compose.hub.yml up --build -d

curl --fail --insecure https://localhost:8443/api/live
curl --fail --insecure https://localhost:8443/api/ready
curl --fail --insecure https://localhost:8443/api/session
open https://localhost:8443/hub.html
```

If the environment cannot reach `registry.npmjs.org`, set `HUB_NPM_REGISTRY` to the approved package proxy.
Do not edit the Dockerfile or lockfile to embed a company/private registry.

Stop and remove local data:

```bash
docker compose --env-file .env.hub -f compose.hub.yml down -v --remove-orphans
```

`-v` destroys the local reference database. Never use that command against a production-managed database.

## Services

| Service | Credential | Filesystem/network | Health/restart |
|---|---|---|---|
| `db` | local owner/runtime/backup role passwords | persistent volume; private network only | `pg_isready`, unless-stopped |
| `migrate` | schema owner | private network; one-shot | must exit 0 before grants |
| `grant-roles` | schema owner | private network; one-shot | must exit 0 before BFF |
| `bff` | runtime role + OAuth/cookie/CSRF secrets | read-only root, tmpfs, private DB network + egress bridge; no published port | image liveness + app readiness, unless-stopped |
| `static` | none | static build context, private network | unless-stopped |
| `edge` | local Caddy CA/certificate | fixed private address + public bridge, Caddyfile read-only, persistent CA data | published `8443`, unless-stopped |

Database and static services remain only on `hub-private` (`internal: true`). BFF joins a dedicated
`hub-egress` bridge for outbound registered-provider OAuth API calls (GitHub in layer 1) but publishes no port. Edge joins `hub-public` for its
host port. Edge and BFF share only `hub-private`, forcing Caddy's `bff` DNS/upstream traffic through the edge's
fixed private address `172.30.0.10`; BFF trusts exactly that address for forwarded-client IP/rate-limit
resolution.

## Environment contract

| Variable | Service | Sensitive | Meaning |
|---|---|---:|---|
| `HUB_APP_ORIGIN` | BFF | No | Exact browser origin; production HTTPS, no path |
| `HUB_HOST` / `HUB_PORT` | BFF | No | Container bind address/port |
| `DATABASE_URL` | migrator/grants/BFF | Yes | Owner for jobs; runtime for BFF |
| `HUB_DATABASE_SSL` | all DB clients | No | False only inside local private Compose |
| `HUB_COOKIE_SECRET` | BFF | Yes | Cookie signing; independent 32+ chars |
| `HUB_CSRF_SECRET` | BFF | Yes | CSRF derivation only |
| `HUB_METRICS_TOKEN` | BFF/monitor | Yes | Independent bearer for `/api/metrics` |
| `HUB_LOG_LEVEL` | BFF | No | Structured log threshold |
| `HUB_AUTH_PROVIDERS` | BFF | No | Supported slugs `github,discord,google`; Discord and Google normal enablement must be paired; deployment does not enable them |
| `HUB_AUTH_EMERGENCY_DISABLED_PROVIDERS` | BFF | No | Emergency provider-specific kill switch; startup fails if no provider remains |
| `HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS` | BFF | No | Non-empty subset of configured providers which every active account must retain; defaults to `github` |
| `HUB_ACCOUNT_IDENTITY_LINKING_ENABLED` | BFF | No | Default `false`; advertises `account.identity_linking.v1` and enables own identity list/link/unlink APIs and UI only after layer-3 preflight |
| `HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS` | BFF | Operationally sensitive | Comma-separated exact campaign UUID rollout allowlist for protocol-4 peer source costs; blank disables it, and production rejects `*`, malformed IDs, duplicates, and more than 100 IDs |
| `HUB_MULTI_TARGET_OPERATIONS_CAMPAIGN_IDS` | BFF | Operationally sensitive | Default blank/off. Comma-separated exact campaign UUID enrollment for protocol-6 multi-target server authority; production rejects `*`, malformed IDs, duplicates, and more than 100 IDs, then requires migrations 0011-0013, normalized tables/index/validator, and active campaign rules preflight before startup |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | BFF | Secret (client secret) | OAuth application |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | BFF | Secret (client secret) | Discord confidential OAuth application |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | BFF | Secret (client secret) | Google confidential web/OIDC application |
| `HUB_INVITE_ACCOUNT_ADMISSION_ENABLED` | BFF | No | Default `false`; enable only after the stacked r9 creator-entitlement/backfill/admin and rollback gate lands |
| `HUB_INVITE_TOKEN_SECRET` | BFF | Yes | Independent >=32-character secret for deterministic, receipt-free raw invite recovery |
| `HUB_INVITE_TOKEN_PREVIOUS_SECRETS` | BFF | Sensitive | Optional comma-separated prior invite-token secrets, newest first; retain for at least 24 hours and cap the total key ring at four |
| `HUB_ALLOWED_OAUTH_SUBJECTS` | rollback preflight only | Operationally sensitive | Exact legacy target-image provider subjects; not a BFF admission setting in r9 |
| `HUB_TRUST_PROXY` | BFF | No | Exact trusted proxy IP/CIDR; local reference uses `172.30.0.10` |
| `HUB_CLIENT_IP_HEADER` | BFF | No | Optional provider-set client address; only `do-connecting-ip` is accepted and it is mutually exclusive with `HUB_TRUST_PROXY` |
| `HUB_POSTGRES_PASSWORD` | Compose DB/jobs | Yes | Local schema owner |
| `HUB_RUNTIME_DB_PASSWORD` | Compose DB/BFF | Yes | Local runtime role |
| `HUB_BACKUP_DB_PASSWORD` | Compose DB | Yes | Local read-only backup role |
| `HUB_OPERATIONS_DB_PASSWORD` | Compose DB/backup | Yes | Can select/insert only operational evidence |
| `HUB_BACKUP_ENCRYPTION_KEY` | Backup/restore | Yes | Base64 for exactly 32 random bytes |
| `HUB_IMAGE_VERSION` / `HUB_VCS_REF` | build | No | OCI provenance |
| `HUB_NPM_REGISTRY` | build | No | Approved package registry/proxy |

Release automation rejects ambient values for both peer-source-cost and multi-target campaign allowlists; these
default-off rollout settings must come only from the reviewed mode-0600 `.env.hub`.

The runtime role has CRUD on `oauth_transactions`. PostgreSQL requires the read-only backup role to retain table
`SELECT` so `pg_dump` can lock and describe the relation, but both backup commands use
`--exclude-table-data=hub.oauth_transactions`; short-lived state/PKCE/nonce rows cannot become retained archives.

Reference passwords must be URL-safe because Compose interpolates them into local PostgreSQL URLs. Managed
deployment should inject provider-generated, correctly encoded connection URLs directly.

Peer source-cost enrollment is a release configuration change, not a campaign database mutation. Follow the
[peer source-cost rollout runbook](runbooks/peer-source-cost-rollout.md): create the campaign, activate an
immutable rules version, configure only approved exact UUIDs, and let the candidate image run the read-only
readiness check before traffic changes. Newly created campaigns do not inherit this capability.

## Edge contract

The edge must:

- serve static/API/auth/WebSocket through one public origin;
- preserve WebSocket upgrades and long-lived connections;
- forward `/api/*`, `/auth/*`, and `/ws/*` to the BFF;
- forward all other paths to the static service;
- replace, not append untrusted, forwarded headers;
- use exact trusted proxy CIDRs in BFF configuration;
- preserve BFF no-store/security headers;
- support at least the BFF's 2 MB body cap and appropriate WebSocket idle timeout.

The portable Caddy stack uses `HUB_TRUST_PROXY`. The proposed DigitalOcean deployment leaves that value
empty and uses `HUB_CLIENT_IP_HEADER=do-connecting-ip`. The authority rejects enabling both mechanisms. The
provider header is parsed as one IP address and used consistently for structured logs, HTTP rate-limit keys,
and WebSocket connection context; missing, malformed, array, or comma-separated values fall back to the
socket peer.

The local Caddy reference uses `tls internal` and persists its local CA under `hub-caddy-data`. Trust that CA
on a development machine before browser/OAuth testing; `curl --insecure` is acceptable only for local probes.
The secure origin is required because browsers reject `__Host-` cookies without `Secure`. Production uses a
publicly trusted certificate. Provider consoles must allow only these exact callbacks, without wildcards:
`<HUB_APP_ORIGIN>/auth/github/callback`, `<HUB_APP_ORIGIN>/auth/discord/callback`, and
`<HUB_APP_ORIGIN>/auth/google/callback`.

The database health check explicitly probes TCP (`127.0.0.1`) with a 30-second start period. A Unix-socket
probe can report the temporary initialization server healthy before init-role scripts finish.

Role creation is not dependent on `initdb`: the owner-run grant job creates a missing validated role
transactionally when its password is supplied. This is required when upgrading an existing volume to a phase
that introduces a new role.

## Health and shutdown

- `/api/live`: process/event-loop liveness; does not query auth/database.
- `/api/ready` and compatibility `/api/health`: database connectivity + migration ledger/version readiness.
- Cookie-bearing health probes bypass authentication and still report readiness failure as 503.
- SIGTERM closes Fastify, WebSockets/outbox dispatcher, and PostgreSQL pool before exit.

Verified locally:

- one-shot migration/grant jobs;
- BFF runtime role readiness;
- edge static/API/auth/WebSocket routing;
- BFF outbound GitHub reachability without publishing the BFF port;
- secure `__Host-` cookie-compatible local origin and fixed trusted proxy;
- unauthenticated WebSocket upgrade reaches BFF and returns `AUTH_REQUIRED`;
- read-only BFF filesystem;
- graceful container restart and post-restart readiness.

## Public deployment overlay

The base `compose.hub.yml` is deliberately local-only: the edge publishes `8443` and Caddy issues a
self-signed certificate through `tls internal`. Two files extend it for a real hostname without editing the
base stack:

| File | Purpose |
|---|---|
| `deploy/hub/Caddyfile.public` | Serves `{$HUB_PUBLIC_DOMAIN}` with Caddy-managed public HTTPS, keeping the same `/api`, `/auth`, `/ws` → `bff:5052` routing and static fallback |
| `compose.hub.public.yml` | Overlay replacing the edge service's published ports with `80`/`443` and swapping in the public Caddyfile |

On the current Oracle host, do not start this overlay with raw Compose. Inspect it with
`docker compose ... config`, then promote an immutable annotated `hub-*` tag through
[deploy/promote](runbooks/deploy-promote.md), which owns backup, migration compatibility, exact image
selection, cutover, rollback, and evidence. Raw `up --build` is limited to the disposable local reference
stack above or a separately reviewed first-bootstrap procedure.

Both `HUB_PUBLIC_DOMAIN` and `HUB_ACME_EMAIL` are required and fail fast if unset.

The overlay relies on the `!override` YAML tag (Compose v2.24+). This is load-bearing rather than
stylistic: Compose **merges** `ports` and `volumes` by default, so without it the edge would publish
`8443` *and* `443`, and would mount two files at `/etc/caddy/Caddyfile`. Verify any change with:

```bash
docker compose -f compose.hub.yml -f compose.hub.public.yml config | grep -A6 'edge:'
```

Keep port 80 open even though application traffic redirects to HTTPS. It provides the redirect and Caddy's
HTTP certificate-challenge path; port 443 also permits the TLS-ALPN challenge. Caddy selects an available
challenge and renews certificates automatically.

For current Oracle operations see [deploy/promote](runbooks/deploy-promote.md) and
[Oracle host operations](runbooks/oracle-operations.md). The
[Phase 6G provisioning record](runbooks/oracle-provisioning.md) is retained for historical context only.

## Oracle deployment requirements

Do not lift the local Compose database into production unchanged.

The Phase 6G Oracle topology provides or is configured to provide:

- PostgreSQL 17 on private networking with TLS at the edge, and PITR **where the host offers it** — under
  [ADR 0010](adr/0010-oracle-always-free-hosting.md) the database is self-managed, so recovery is from
  nightly encrypted backups with an RPO of up to 24 hours;
- separate migration/runtime/backup credentials in a secret manager;
- immutable image promotion — by registry digest where architecture permits, otherwise a build on the host
  from a verified git tag (see the ADR 0008 note on the ARM/x86 divergence);
- provider-native HTTPS/custom domain;
- exact proxy trust;
- scheduled maintenance and nightly encrypted backup export;
- logs/metrics/alerts and isolated restore drill;
- provider scheduler invokes maintenance and encrypted backup profiles;
- no host-published database/BFF/static ports.
- exactly one active BFF replica; shared realtime fanout is not implemented for horizontal scale.

## CI artifact promotion

Phase 6F exports the already-scanned x86 production image as `hub-bff-image.tar` and records its SHA-256,
source/lockfile SHAs, versions, and SBOMs in `hub-ci-provenance.json`. The ARM Oracle path instead builds from
the verified release tag as recorded by ADR 0008/0010; annotated release `hub-staging-2026-09-10-r7` at
`77d955c053dcdfe949235620db93f7eba477af34` is the deployed baseline. The archive SHA-256 is not labeled as an
OCI digest. CI loads the x86 archive, derives the test-auth layer from it, and separately requires the
unmodified image's production entry point to become healthy. See [CI and provenance](ci-and-provenance.md).
