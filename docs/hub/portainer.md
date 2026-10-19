# One-file OAuth Hub stack for Portainer

Use `compose.hub.portainer.yml` by itself for PostgreSQL, the Hub backend, website,
OAuth login, Caddy and Cloudflare Tunnel. Target a **Docker Standalone** environment.
There are no bind mounts or `HUB_PROJECT_DIR` requirements. App code is in the
prepared images; Docker manages configuration and database storage as named volumes.

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

## Prepare app images

Build or load the app images on the **same Docker endpoint that Portainer will
deploy to**. From a source checkout on a build host:

```sh
docker build -f server/Dockerfile -t thelemartools-hub-bff:latest .
docker build -f deploy/hub/static.Dockerfile -t thelemartools-hub-static:latest .
```

On a different target host, transfer these with `docker save`/`docker load`, or
build there. The checkout is needed for building, not for running the stack.
Existing images with those tags can be reused if built from the desired source.
The app services use `pull_policy: never`; keep Portainer's **Re-pull image** option
off for local image tags. Optional `HUB_BFF_IMAGE`, `HUB_STATIC_IMAGE` and
`HUB_OPS_IMAGE` select other already-loaded tags. The PostgreSQL, Caddy and
cloudflared images can be pulled normally.

## Deploy through Portainer

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

After rebuilding/loading an app image, redeploy with re-pulling off and container
recreation. The original opt-in backup and maintenance profiles remain available.
For backups, prepare the operations image first:

```sh
docker build -f server/ops.Dockerfile -t thelemartools-hub-ops:latest .
```

The same standalone file also works through the CLI without a project directory:

```sh
docker compose --env-file .env.hub -f compose.hub.portainer.yml up -d
docker compose --env-file .env.hub -f compose.hub.portainer.yml --profile maintenance run --rm maintenance
docker compose --env-file .env.hub -f compose.hub.portainer.yml --profile backup run --rm backup
```

Normal startup does not run these optional jobs. Keep the existing encrypted backup
key and backup/restore procedures. Local volume/config validation is not evidence
of deployment through Portainer or a live Cloudflare connection.
