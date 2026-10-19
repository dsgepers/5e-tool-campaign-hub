# Personal Campaign Hub through Cloudflare Tunnel

`compose.hub.tunnel.yml` adds `cloudflared` to the full Hub stack. One public hostname
serves the website, password login, API and WebSockets through Caddy. This is an
optional personal deployment overlay, not a change to the deployed Oracle service.

For one complete Compose file suitable for Portainer's web editor/upload, use
`compose.hub.portainer.yml` with [the Portainer guide](portainer.md) instead of
combining the three files below.

## Configure

Create a remotely managed tunnel in Cloudflare and copy its connector token into
the existing, gitignored `.env.hub`. Also set its public hostname (no scheme, port,
path or trailing slash):

```dotenv
HUB_PUBLIC_DOMAIN=tools.example.com
CLOUDFLARED_TOKEN=your-tunnel-token
```

The overlay sets the backend's `HUB_APP_ORIGIN` to `https://${HUB_PUBLIC_DOMAIN}`.
Its exact HTTPS origin is required for secure cookies and login/mutation checks;
the base file's localhost default is overridden automatically. Keep the database,
cookie and other existing secrets in `.env.hub`.

In the Cloudflare tunnel's published application route, configure:

| Setting | Value |
|---|---|
| Public hostname | The same hostname as `HUB_PUBLIC_DOMAIN` |
| Path | Leave empty to route the whole site |
| Service type | HTTP |
| Service URL | `http://edge:8080` (or `edge:8080` if type is selected separately) |
| HTTP Host Header | Leave unset; preserve the public hostname |

Leave `CF-Connecting-IP` intact and enable WebSockets for the zone. Use normal
cache behavior; custom cache rules must bypass `/api/*`, `/auth/*` and `/ws/*`.
The internal HTTP origin needs no certificate override or disabled TLS verification.
Public browsers use HTTPS provided by Cloudflare.

See Cloudflare's [tunnel setup](https://developers.cloudflare.com/tunnel/get-started/)
and [token environment variable](https://developers.cloudflare.com/tunnel/reference/run-parameters/#token)
references. `CLOUDFLARED_TOKEN` is passed as the supported `TUNNEL_TOKEN` environment
variable, keeping it out of the container command arguments. Do not paste rendered
Compose configuration or container environment output into logs/tickets.

## Start with password login

Use Docker Compose v2.24 or newer. Create file-listed users as described in
[local login](local-login.md), then run:

For password login, enable the four currently commented provider settings in
`compose.hub.local.yml` first. Keeping them commented preserves the base OAuth
selection. The standalone Portainer file selects password login itself.

```sh
docker compose --env-file .env.hub \
  -f compose.hub.yml -f compose.hub.local.yml -f compose.hub.tunnel.yml \
  config --quiet

docker compose --env-file .env.hub \
  -f compose.hub.yml -f compose.hub.local.yml -f compose.hub.tunnel.yml \
  up --build -d
```

Open `https://tools.example.com/hub.html`, substituting your hostname. Continue
including all three files for updates, BFF recreation after user-file changes,
and other Compose operations. For OAuth instead, omit `compose.hub.local.yml`
and configure provider callbacks for the public origin. Do not combine this overlay
with `compose.hub.public.yml`, whose direct-public TLS edge serves a different purpose.

## Network and authority

The tunnel overlay removes published edge ports, including localhost:8443. No
router port forwarding is needed. `cloudflared` has outbound internet access on
`tunnel-net`; it shares that network only with Caddy, not the backend or database.
Caddy accepts origin requests only from the connector's fixed IP and serves only
the configured hostname. It forwards static paths to `static:80`, and `/api`, `/auth`
and `/ws` paths to `bff:5052`, preserving the original route prefixes.

Caddy trusts `CF-Connecting-IP` only from that connector address and replaces
`X-Forwarded-For` with its parsed visitor IP before forwarding to the backend. The
backend still trusts exactly Caddy's existing private-network address. No application
auth, campaign membership, lease, revision, command receipt or event changes are
needed; this overlay changes ingress only. No migration or PostgreSQL data change
is required. Keep one BFF replica as before.

The default tunnel subnet is `172.31.0.0/24`, with connector IP `172.31.0.10`. If it
overlaps a LAN/VPN/Docker network, set both `HUB_TUNNEL_SUBNET` and
`HUB_TUNNEL_CONNECTOR_IP` to an unused subnet and an address inside it.

## Troubleshoot and return to local access

- Tunnel unhealthy: inspect `cloudflared` logs using the same three Compose files;
  check the token and outbound connectivity. Do not enable debug logging with real users.
- Tunnel healthy but 502: the route must point to `http://edge:8080`; confirm the
  edge and backend are running, and do not use `localhost`, `web:80` or `static:80`.
- Empty page or failed login: verify the public hostname/Host header and open the
  HTTPS hostname, not localhost. Verify `/api/session` has a normal Hub response.
- 403 from the origin: ensure connector IP configuration matches its fixed network
  address; do not weaken Caddy's source restriction.
- Public rate limits group all visitors: check that Cloudflare is forwarding
  `CF-Connecting-IP` and no transform removes it.

To return to the original local HTTPS stack without removing campaign data:

```sh
docker compose --env-file .env.hub \
  -f compose.hub.yml -f compose.hub.local.yml -f compose.hub.tunnel.yml stop cloudflared
docker compose --env-file .env.hub \
  -f compose.hub.yml -f compose.hub.local.yml up -d --remove-orphans
```

The base stack then uses `.env.hub`'s `HUB_APP_ORIGIN` again (normally
`https://localhost:8443`). The database volume and local user identities are retained.
Cloudflare token rotation and route changes are operator actions in the Cloudflare
dashboard. Live tunnel connectivity still requires the host's real token and route;
local validation cannot qualify those external settings.
