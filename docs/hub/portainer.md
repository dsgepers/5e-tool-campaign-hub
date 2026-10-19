# One-file personal Hub stack for Portainer

Use `compose.hub.portainer.yml` by itself for PostgreSQL, the Hub backend, website,
password login, Caddy and Cloudflare Tunnel. It also includes the existing opt-in
maintenance and encrypted-backup services. It contains no Compose overlays, includes
or custom merge tags. Target a **Docker Standalone** environment in Portainer.

The earlier CLI command merges three files in order: `compose.hub.yml` supplies the
base services, `compose.hub.local.yml` selects file-based password login, and
`compose.hub.tunnel.yml` adds the tunnel and replaces the edge configuration. They
produce one running stack, not three. See [Docker's merge rules](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/).

This checkout retains host-customized comments on the local overlay's four provider
settings, so the unedited three-file command keeps OAuth. The standalone Portainer
file explicitly enables password login. Equivalence checks for the original
personal topology assume those four overlay settings are enabled.

## Prepare the Docker host

The app images must be built or loaded on the **same Docker endpoint that Portainer
will deploy to**. From this checkout on that host:

```sh
docker build -f server/Dockerfile -t thelemartools-hub-bff:latest .
docker build -f deploy/hub/static.Dockerfile -t thelemartools-hub-static:latest .
```

Existing images with those tags can be reused if they were built from the desired
source. On a remote endpoint, build there or transfer the images using `docker save`
and `docker load`. The standalone file intentionally uses image references and
`pull_policy: never` for these local images: pasting YAML into a web editor does
not upload this source tree. Keep Portainer's **Re-pull image** option off for local
image tags. Optional `HUB_BFF_IMAGE`, `HUB_STATIC_IMAGE` and `HUB_OPS_IMAGE` variables
select other already-loaded image tags.

Keep this checkout (or the three required mounted files) at a fixed absolute path
on that Docker host. The stack mounts:

- `deploy/hub/init-roles.sh` into PostgreSQL;
- `deploy/hub/Caddyfile.tunnel` into Caddy;
- `.hub/users.json` into the backend, read-only.

Create users with `npm run hub:user -- --username dennis` as described in
[local login](local-login.md). Do not commit or paste the credentials JSON into
the stack. Missing host files fail deployment rather than becoming empty directories.

## Deploy through Portainer

1. Choose the Docker Standalone endpoint, then **Stacks → Add stack**. Use the name
   `thelemartools-hub` for an existing default installation.
2. Paste or upload `compose.hub.portainer.yml` as the only Compose file.
3. Under **Environment variables**, use **Load variables from .env file** to upload
   your existing `.env.hub`, retaining all database/cookie/CSRF/invite/metrics secrets.
4. Add `HUB_PROJECT_DIR` with the absolute checkout path **on the Docker host**, for
   example `/home/dennis/development/ThelemarTools`. This is not the path inside
   Portainer's container or on the computer running your browser.
5. Set `HUB_PUBLIC_DOMAIN` to the public hostname without `https://` or a path, and
   set `CLOUDFLARED_TOKEN` to the connector token. Use the
   [Cloudflare route](cloudflare-tunnel.md#configure) pointing to `http://edge:8080`.
6. Deploy the stack after completing the handover below if a CLI stack already runs.

Portainer's [stack documentation](https://docs.portainer.io/user/docker/stacks/add)
describes web-editor/upload deployments and importing environment variables.
No relative-path volume feature or Git deployment is needed for this file.
The checkout and image preparation are host prerequisites, not additional Compose
files. Do not deploy this as a Swarm stack: it relies on Compose's one-shot migration
and health-based startup dependencies.

## Hand over an existing CLI installation

The standalone file names its volumes explicitly, defaulting to the original
`thelemartools-hub_hub-postgres`, `thelemartools-hub_hub-caddy-data`,
`thelemartools-hub_hub-caddy-config` and `thelemartools-hub_hub-backups` volumes.
`HUB_VOLUME_PREFIX` changes that prefix if the previous stack used another project
name. Verify the existing volume names before deploying; a different prefix creates
a separate empty database. Keep the existing database passwords and user UUIDs.

Stop and remove the original CLI containers/networks while preserving volumes:

```sh
docker compose --env-file .env.hub \
  -f compose.hub.yml -f compose.hub.local.yml -f compose.hub.tunnel.yml down
```

Do **not** add `-v`. Then deploy in Portainer. Do not run both installations against
the same PostgreSQL volume at once. This is a deployment handover, with a brief
outage; it needs no new database migration or identity conversion beyond the
existing startup migrator. The tunnel hostname and client-IP restrictions stay the
same. Subnet overlap settings are described in [the tunnel guide](cloudflare-tunnel.md).

To return to the CLI, remove/stop the Portainer stack while retaining its volumes
and start the original three-file command. Keep the same volume prefix and files.

## Updates and optional jobs

After rebuilding/loading an app image, redeploy through Portainer with image
re-pulling off and force container recreation. Saving a changed user file also
requires backend recreation, as in [local login](local-login.md#users-and-password-changes).
There is no public deployment or automatic upgrade implied by adding this file.

For the backup profile, also prepare the operations image first:

```sh
docker build -f server/ops.Dockerfile -t thelemartools-hub-ops:latest .
```

The same standalone file works with the CLI (add `HUB_PROJECT_DIR` to `.env.hub`):

```sh
docker compose --env-file .env.hub -f compose.hub.portainer.yml up -d
docker compose --env-file .env.hub -f compose.hub.portainer.yml --profile maintenance run --rm maintenance
docker compose --env-file .env.hub -f compose.hub.portainer.yml --profile backup run --rm backup
```

The ordinary startup does not run backup/maintenance profiles. The backup still
needs its existing encryption key; retain the existing backup/restore procedures.

## Validation boundary

The standalone configuration is compared against the merged three-file stack,
allowing only image/build selection, absolute fail-closed file mounts, explicit
volume names and local-image pull policies to differ. No application, session,
tenant, lease, revision, command-receipt or event behavior changes. Portainer UI
deployment and a live Cloudflare connection require the target endpoint and credentials.
