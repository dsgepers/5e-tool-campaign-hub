# Campaign Hub risk register

> **Status:** Active
> **Last reviewed:** 2026-09-13
> **Owner:** Campaign Hub maintainers

| ID | Risk | Trigger/evidence | Impact | Current mitigation | Detection | Next action |
|---|---|---|---|---|---|---|
| R-01 | Uncheckpointed large working tree | Phase 0-5 began uncommitted | Review/recovery ambiguity | Closed by reviewed checkpoint commits and 30-suite Hub validation; the checkpoint's then-current no-push/no-PR state is preserved in `checkpoint.md` | `git log`, clean-tree check | Closed; reopen only if later work accumulates without commits |
| R-02 | Schema could not evolve safely after first deployment | Phase 0-5 migrator applied one file without a ledger | Failed/repeated migration or unknown schema version | Closed by checksummed/advisory-locked ledger, baseline detection, migration-aware readiness, roles, and migration 0002 | Migration tests/status and PostgreSQL drills | Closed; every future schema change gets a new immutable version |
| R-03 | Administrative lifecycle was incomplete | Phase 0-5 lacked invite revoke, member removal, session management, and deletion | Operators would require direct DB access | Closed by Phase 6B APIs/UI, transactional cleanup, seven-day deletion, purge reporting, and tests | Lifecycle tests and purge output | Closed; monitor blocked purge ids in Phase 6E |
| R-04 | Portable BFF deployment was missing | Root image is static-only | Provider-specific drift and unsafe proxy setup | Closed by non-root BFF image, lightweight static image, one-shot migrations/grants, private/public networks, same-origin edge, and Oracle deployment | Deployment contracts, local Compose probes, Oracle smoke | Closed; reopen on topology/provider change |
| R-05 | Recovery objectives remain unproven on Oracle | Closed by the 2026-09-12 encrypted off-machine/isolated authenticated restore and exact-release rollback drill | Data loss or recovery outside RTO | RPO 3,865s and continuous RTO 6,772s; exact-r7 restore/workflows, exact-r6 compatibility, r7 return, immutable archive, and exact cleanup recorded | Backup/restore metrics, production operational rows, and redacted recovery evidence | Closed; repeat within 35 days and after material recovery-path changes |
| R-06 | Outbox/maintenance failures lacked signals | Closed by genuine scheduled maintenance and backup executions on 2026-09-13 plus the scheduled five-minute monitor | Delayed realtime, table growth | Singleton maintenance, DB evidence, outbox/dispatcher metrics, SLOs/runbook, installed Oracle units, and Healthchecks.io heartbeat/failure signals | Protected Prometheus endpoint, journals, timer state, operational rows, and external check | Closed for V1; continue daily monitoring and reopen on missed/failed evidence |
| R-07 | Browser/API behavior lacks real-stack E2E | Prior browser checks used mocked API; domain tests injected Fastify | Boot/proxy/service-worker regressions can escape | Closed portably by exact-image production smoke, derived-auth real HTTPS/PostgreSQL journeys, restart/readiness probes, and Oracle smoke | Required JSON Playwright CI artifact and deployment evidence | Complete the physical OAuth/device game day |
| R-08 | Provider proxy/header behavior can invalidate security assumptions | Managed providers can inject forwarded client identity | Incorrect logs/rate limits or spoofable client identity | Oracle uses Caddy as sole ingress with exact private-address trust; provider-gated single-IP adapter remains available for the paid path | Unit/integration coverage plus Oracle smoke | Reopen and prove live authenticity before any provider change |
| R-09 | Character/Board upstream churn | Active WIP files are large integration hotspots | Rebase regressions and duplicated persistence paths | Narrow repository/context seams and tests | Character Sheet/DM Screen suites | Maintain hotspot list and rebase checklist |
| R-10 | Private assumptions expand into public service | Enabling open registration without moderation/legal/quotas | Abuse, privacy, cost, tenant-security exposure | Invite-gated first access, invite-only campaigns, and default-off r9 account admission | Configuration/release review | Keep admission disabled until creator entitlement and public-service gates are complete |
| R-11 | Sensitive content could leak through logs | OAuth callback query and private bodies/tokens exist | Privacy/security incident | Query-stripping request serializer, redaction paths, bounded metrics/evidence, empirical secret scan | Log fixture/unit and stack probe | Keep closed; repeat for every release train |
| R-12 | Account deletion conflicts with audit/ownership/backups | User requests deletion while owning campaigns or appearing in history | Referential failure or incomplete deletion | Seven-day state machine, ownership block, lifecycle cleanup, FK anonymization, purge/block reporting implemented; manual and genuine scheduled Oracle maintenance produced bounded evidence | Lifecycle tests, purge output, backup aging docs | Closed for V1; continue scheduled maintenance and monitor blocked purge IDs |
| R-13 | Realtime scale exceeds V1 assumptions | More sockets/events than private table target | Latency, replay pressure, reconnect storms | Six-member/500-event real-stack budget test plus dispatcher/replay metrics | CI test and protected metrics | Observe Oracle behavior during the physical game day |
| R-14 | Supply-chain drift | Existing workflows use mutable action refs and broad `npm i` | Non-reproducible or compromised builds | Closed for Hub by locked install, pinned actions, expanded Hub-credential scan, exact-image export/reuse, SBOMs, archive provenance, image scan, and annotated r7 Oracle release | `HubCiContract`, attempt-keyed workflow artifacts, release r7 evidence and exact image identities | Closed for r7; repeat the same evidence chain for every promotion |
| R-15 | Realtime fanout is process-local | More than one active BFF replica or overlapping rolling deployment | Some live sockets miss an event until reconnect/replay; one replica also lacks provider HA | Private V1 fixed at one BFF instance; replay on reconnect; ADR 0009 adds heartbeat/rolling-deploy drills | Instance count, outbox/socket metrics, replay evidence | Accept private-V1 downtime; design shared fanout before HA/scale-out |
| R-16 | Free-tier host reclaims the instance | Oracle deems an Always Free instance idle when CPU, network *and* memory all stay below 20% for 7 days; the current pre-Hub host reports only 13% memory use | Instance terminated; hub offline until rebuilt, and free capacity is not guaranteed on re-creation | Conditions are conjunctive, but no metric is assumed safe. Measure all three after seven full days with the Hub running. Pay As You Go lifts the policy while preserving free allowances when usage stays inside them | OCI CPU/memory/network metrics after the first full week, plus budget alert | If all three remain below 20%, convert to Pay As You Go after reviewing billing safeguards, or explicitly accept the risk |
| R-17 | Shared subnet widens exposure | Ingress 80/443 added to a VCN security list applies to every instance in that subnet, not just the hub | Neighbouring instances unintentionally exposed to the internet | Runbook prefers a per-VNIC network security group when the subnet is shared; application ports stay internal to the Docker network | Provisioning evidence records which mechanism was used and what shares the subnet | Move the hub to a dedicated subnet |
| R-18 | Free ARM capacity exhausted in the home region | 317 consecutive launch failures over 24 h in `il-jerusalem-1` (2026-08-27/28); single-AD region, Always Free cannot leave the home region | No new instance can be created; provisioning blocked indefinitely | Repurpose an already-running instance (runbook Part C-ALT) — capacity is checked only at launch/start, never while running | `oci-retry-launch.sh` classifies capacity vs quota errors and logs every attempt | Upgrade to Pay As You Go for launch priority, or migrate to the ADR 0009 paid path |
| R-19 | Reused instance is stopped and cannot be restarted | A stop releases the host allocation; the subsequent start is a fresh capacity request against an exhausted pool | Permanent loss of the only usable host; hub offline with no rebuild path | Never stop — reboot only. No shape resize and no boot-volume detach/attach. Test an out-of-band serial-console login, retain off-VM data backups, and defer changes that require a restorable boot-volume rollback | Runbook states the rule at the top of Part C-ALT and tags each operation with whether it requires a stop | Restore onto a new instance once capacity returns, or use the paid path |

| R-20 | Release upgrade bricks the irreplaceable instance | Existing host is Ubuntu 22.04.4. No replacement/helper capacity exists; a restored boot volume cannot be used without a new instance or stopping this one. Serial console recovers many network/SSH failures but is not a rollback for every boot, filesystem, or package failure | Staging host lost with no same-day recovery; V1 pilot unavailable | **24.04 release upgrade deferred.** Fully patch supported 22.04, enable free Ubuntu Pro `esm-apps`, and install Docker from its supported Jammy repository. Test serial-console recovery independently. Prefer a fresh 24.04 rebuild when capacity exists | Ubuntu Pro status, package updates, reboot verification, serial-console drill, off-VM backup evidence | Re-evaluate before 22.04 standard maintenance ends in May 2027, and only when replacement/helper capacity exists or permanent host loss is explicitly accepted |
## Personal file login

ADR 0022 permits a host-managed credential file for explicitly selected personal installations.
Password hashes remain sensitive: `.hub/` is private, gitignored, excluded from both build contexts,
and only its user file is mounted read-only into the backend. There is no browser/static credential
endpoint or public signup. The host must retain the file and stable user UUIDs alongside database
recovery material to preserve account access after a restore.

The backend loads credentials at startup. Recreate it after file edits; removing/disabling an identity
then rejects existing sessions. Changing an enabled user's password alone leaves existing sessions
valid; use session revocation when needed. This is an accepted personal-use tradeoff, documented in
[local login](local-login.md), with rate-limit, generic-error, cross-account reauthentication and
PostgreSQL session-rotation regression coverage. OAuth remains the default.

## Review rule

The standalone Portainer file embeds managed Caddy/PostgreSQL templates; maintainers
must keep them synchronized with their source files and verify Compose/shell dollar
escaping. Its network-isolated initializer writes no credentials and never mounts
database data; consumers mount configuration read-only. Recreate the edge after
managed Caddy configuration changes. Explicit volume names prevent a stack-name change from selecting
an empty database, but the host must confirm any custom existing volume prefix and
stop the old installation before handover. Two PostgreSQL containers must never
share a data volume concurrently. [Portainer setup](portainer.md) covers prepared
images, managed configuration, retained data and rollback; no running stack is changed
by configuration validation.

The personal Cloudflare overlay addresses R-08 by restricting Caddy's origin
listener to the connector's exact IP, preserving `CF-Connecting-IP` only from
that peer and replacing forwarded-client headers before the existing BFF trust
boundary. Host ports are removed. Local proxy checks do not qualify a real
Cloudflare route, account policy or connector token; verify these as described in
[the tunnel guide](cloudflare-tunnel.md) before using the public hostname.

Review this register at every phase boundary, after any incident/security finding, and before go/no-go.
Closing a risk requires evidence in `traceability.md`; renaming or moving it is not closure.
