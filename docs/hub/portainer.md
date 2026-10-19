# One-file OAuth Hub stack for Portainer

Use `compose.hub.portainer.yml` by itself for PostgreSQL, the Hub backend, website,
OAuth login, Caddy and Cloudflare Tunnel. Target a **Docker Standalone** environment.
There are no bind mounts or `HUB_PROJECT_DIR` requirements. App code is in the
images built automatically from Git; Docker manages configuration and database storage
as named volumes.

## Configuration volume

The one-shot `config-init` service writes the embedded Caddyfile and PostgreSQL
role-initialization script into `hub-project`. Its default Docker volume name is
`thelemartools-hub_hub-project`. It runs without network access and does not receive
OAuth credentials or database passwords. Dollar escaping and quoted here-documents
preserve variables for the consumer containers to expand at runtime.

PostgreSQL mounts this volume read-only at `/docker-entrypoint-initdb.d`; Caddy
mounts it read-only at `/etc/caddy`. Both wait for successful initialization.
`nocopy` prevents image defaults from populating the managed directory. The
initializer replaces only its two managed files, using temporary files and renames.
It never mounts the PostgreSQL data volume or changes stored accounts/passwords.
PostgreSQL runs its role script only for an empty database; the existing role-grant
job handles permissions after migrations as before.

This volume holds deployment configuration, not a checkout of the repository.
Edits belong in the Compose initializer, since its next run replaces the managed
files. Redeploy/recreate the edge after changing the Caddy configuration so it loads
the new contents. The embedded files track `deploy/hub/Caddyfile.tunnel` and
`deploy/hub/init-roles.sh`; keep those copies in sync when changing routing or roles.

## Automatic app-image builds

The Git build workflow is defined in [ADR 0023](adr/0023-portainer-git-builds.md).
It was verified through a real local Portainer deployment starting with absent app
image tags; see [evidence and limits](testing.md#automatic-portainer-git-build-validation).

The Compose file includes `build` definitions for the website, backend and optional
operations image. Their default context is the public repository:

```text
https://github.com/dsgepers/5e-tool-campaign-hub.git#multiplayer-hub
```

Compose downloads that source and uses `server/Dockerfile`,
`deploy/hub/static.Dockerfile` and (for backups) `server/ops.Dockerfile`.
`pull_policy: build` builds the app images before starting their containers instead
of looking for unpublished tags on Docker Hub. Migration, role-grant and maintenance
services share the backend build definition. No manual `docker build`, image
transfer, source checkout or registry publication is required.

The Docker build environment needs outbound access to GitHub, the base-image
registries, npm and the Debian package repositories. First deployment takes longer
while downloading source/dependencies. Later builds reuse the builder cache.
Runtime database passwords, OAuth credentials and tunnel tokens are environment
variables for containers; they are not passed as build arguments.

Optional `HUB_BUILD_CONTEXT` selects another public Git context, such as the same
repository URL with a specific commit after `#`. The Git context must already contain
the desired application code; local uncommitted files are not included. For CLI
work on a local checkout only, set `HUB_BUILD_CONTEXT=.`. Optional `HUB_BFF_IMAGE`,
`HUB_STATIC_IMAGE` and `HUB_OPS_IMAGE` change the resulting local image tags.
`HUB_NPM_REGISTRY` controls npm during builds. You do not need any of these overrides
for the default deployment.

See Docker's [build-context reference](https://docs.docker.com/reference/compose-file/build/#context)
and [pull-policy reference](https://docs.docker.com/reference/compose-file/services/#pull_policy).
Use Docker Standalone; Swarm stack deployment does not build these images.

## Deploy through Portainer

Replace any older image-only copy of `compose.hub.portainer.yml` in Portainer with
the updated file containing the `build` definitions. Keeping the old copy will
continue to produce `No such image` errors. A new stack does not need a Re-pull
image setting: `pull_policy: build` in the YAML controls application builds.
If configuring GitOps updates later, leave its optional Re-pull image setting off.

1. Choose the Docker Standalone endpoint, then **Stacks → Add stack**. Use
   `thelemartools-hub` for an existing default installation.
2. Paste/upload the updated `compose.hub.portainer.yml` as the only Compose file.
3. Under **Environment variables**, load your private `.env.hub`, preserving the
   existing database/cookie/CSRF/invite/metrics secrets. Use the exact key
   `HUB_COOKIE_SECRET`; suffixes or misspelled keys are not recognized.
4. Set `HUB_PUBLIC_DOMAIN` to a hostname such as `5etools.schepe.rs`, without
   `https://`, port or path. Set `CLOUDFLARED_TOKEN`. No `HUB_PROJECT_DIR` is needed;
   remove it from old Portainer settings if desired.
5. Configure the [Cloudflare route](cloudflare-tunnel.md#configure) to use
   `http://edge:8080`, preserving the public Host and visitor-IP header.
6. Complete the handover below if a previous stack is running, then deploy.

Portainer's [stack documentation](https://docs.portainer.io/user/docker/stacks/add)
explains uploading a Compose file and importing environment variables. No repository
checkout, relative-path volume feature or local credential JSON is needed at runtime.

### Deploy directly from the Git repository

Choose **Git Repository** when adding the stack, with these values:

| Field | Value |
|---|---|
| Repository URL/source | `https://github.com/dsgepers/5e-tool-campaign-hub.git` |
| Repository reference | `refs/heads/multiplayer-hub` |
| Compose path | `compose.hub.portainer.yml` |
| Additional Compose files | None |

Load `.env.hub` through **Environment variables** on that deployment page, then
deploy. GitOps automatic updates are optional. The Re-pull image toggle belongs
to update settings in versions that expose it; it is not a prerequisite for
creating this stack.

Portainer reads the committed Compose file from the chosen remote ref. Local edits,
including staged but uncommitted changes, are not available until committed and
pushed. If repository deployment still reports a missing local app image, inspect
that branch's Compose file for `x-hub-bff`, `build` and `pull_policy: build`; the
old image-only file cannot build the missing image regardless of environment values.
Do not select the default `docker-compose.yml` or `compose.hub.yml` for this topology.

### Missing environment-variable errors

If Portainer reports `required variable HUB_COOKIE_SECRET is missing`, open the
stack's **Environment variables** section and choose **Load variables from .env file**
to import the current `.env.hub`. Confirm the exact `HUB_COOKIE_SECRET` key appears
with a nonempty value; remove a misspelled key such as
`HUB_COOKIE_SECRETthelemartools-hub-bff`. Do not paste secret values into tickets.

Uploading the YAML alone, editing `.env.hub` on the Docker host, or putting that file
in a project volume does not populate Portainer's interpolation variables. Import
the file again after changing it. A service-level `env_file` cannot repair a missing
Compose `${...}` interpolation value. Keep the required-variable checks enabled.

Before importing, validate the same pair locally without rendering secret values:

```sh
docker compose --env-file .env.hub -f compose.hub.portainer.yml config --quiet
```

The environment must also supply the tunnel token and a bare `HUB_PUBLIC_DOMAIN`
hostname. The backend's public HTTPS origin is derived from that hostname.

## Login

This Portainer file selects OAuth and enables identity linking by default. It
honors `HUB_ACCOUNT_IDENTITY_LINKING_ENABLED` and
`HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS` (default `github`). Configure enabled
providers and their callbacks for the public HTTPS hostname. The exact backend
origin is derived from `HUB_PUBLIC_DOMAIN`.

An existing bootstrapped OAuth identity can sign in and link Google/Discord from
**Account & devices → Sign-in methods** after reauthentication. A completely new
OAuth database still needs its first host-provisioned identity; configuration
volume initialization does not create accounts, sessions or public registration.
Invite admission remains disabled by default and campaign permissions are unchanged.
For file-based password login instead, use the separate [local-login setup](local-login.md).

## Preserve existing data

The original named volumes keep their names, including
`thelemartools-hub_hub-postgres`. `HUB_VOLUME_PREFIX` selects another existing
project prefix if necessary. Verify existing names/passwords before handover: a
different prefix selects a different database. The additional `hub-project` volume
contains only regenerated configuration; it is separate from campaign/account data.

Stop the old CLI stack while retaining its volumes:

```sh
docker compose --env-file .env.hub \
  -f compose.hub.yml -f compose.hub.local.yml -f compose.hub.tunnel.yml down
```

Do **not** add `-v`, and do not run two PostgreSQL containers against the same data
volume. Then deploy in Portainer. Stored accounts, campaigns and sessions remain in
PostgreSQL. For rollback, stop/remove the Portainer stack while retaining volumes,
then start the old CLI stack with its original configuration files and volume prefix.

## Updates and optional jobs

Redeploy with re-pulling off after pushing application changes to the configured
Git ref; Compose rebuilds the app images. The original opt-in backup and maintenance
profiles remain available, and the backup job builds its operations image when used.

The same standalone file also works through the CLI without a project directory:

```sh
docker compose --env-file .env.hub -f compose.hub.portainer.yml up -d
docker compose --env-file .env.hub -f compose.hub.portainer.yml --profile maintenance run --rm maintenance
docker compose --env-file .env.hub -f compose.hub.portainer.yml --profile backup run --rm backup
```

Normal startup does not run these optional jobs. Keep the existing encrypted backup
key and backup/restore procedures. Local volume/config validation is not evidence
of deployment through Portainer or a live Cloudflare connection.
