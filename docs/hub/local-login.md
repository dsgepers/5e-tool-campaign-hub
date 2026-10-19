# Personal username/password login

Local login replaces OAuth for a personal Hub installation. The server reads a
private JSON user list at startup. Only listed, enabled users can sign in. Campaigns,
characters, permissions and sessions still use PostgreSQL; no database migration is
needed and there is no public registration.

## Start locally

Keep the generated secrets in `.env.hub`. GitHub client credentials are unnecessary
with the local override. Leave account entitlement enforcement and identity linking
off for the simple personal setup.

Create your account (Node 24 or newer):

```sh
npm run hub:user -- --username dennis --name Dennis
```

The command asks for a password without echoing it and writes a salted scrypt hash
to `.hub/users.json`. It creates a private host directory (0700); the file is readable
through the BFF's read-only file mount by its non-root container user. The directory
is gitignored and excluded from both website and backend image build contexts.

Start the existing Hub stack with the local-login override:

In this checkout, the four provider settings in `compose.hub.local.yml` are
commented out by host preference. Uncomment them to enable password login with
this overlay. The standalone `compose.hub.portainer.yml` now selects OAuth and
managed configuration volumes; use this separate local-login stack for passwords.

```sh
docker compose --env-file .env.hub -f compose.hub.yml -f compose.hub.local.yml up --build -d
```

Open `https://localhost:8443/hub.html`, choose **Sign in with username and password**,
and enter the credentials you just created. HTTPS and the existing local Caddy
certificate setup still apply. File-listed users are provisioned as ordinary Hub
accounts at backend startup, so a fresh personal database needs no OAuth/invite
bootstrap. With entitlement enforcement off they can create campaigns and invite
other file-listed users through the existing membership controls.

## Users and password changes

Run the same command with another username to add a player. Run it again with an
existing username to change that user's password while preserving their identity.
Then recreate the BFF so it reloads the file bind mount:

```sh
docker compose --env-file .env.hub -f compose.hub.yml -f compose.hub.local.yml up -d --force-recreate bff
```

For scripted setup use `--password-stdin` and pipe the password from a private input
source. Passwords are not accepted as command-line arguments.

The JSON has this shape (the hash below is a format description, not a usable password):

```json
{
  "version": 1,
  "users": [
    {
      "id": "a5d86788-663a-4a01-bcdf-422b8b7039f5",
      "username": "dennis",
      "displayName": "Dennis",
      "passwordHash": "scrypt$<32 hex salt characters>$<128 hex key characters>"
    }
  ]
}
```

Keep each `id` unchanged when editing names: it identifies the database account.
To disable someone, add `"disabled": true` or remove their row and recreate the
BFF. Their existing sessions are then rejected too. Keep at least one user enabled.
Password changes do not revoke existing sessions for an enabled account; use the
Hub's session controls or disable the account if revocation is needed.

Existing OAuth accounts and local accounts are separate identities. This option
does not merge ownership by matching usernames or display names. Stop using the
override to return to OAuth. Existing campaign data and the PostgreSQL volume remain
intact in either mode.

## Implementation

`HUB_AUTH_MODE=local` and `HUB_LOCAL_USERS_FILE` select the file-backed provider.
Login uses a same-origin password POST, bounded scrypt work, per-IP rate limits,
browser-bound one-use login transactions, and the existing secure session cookie.
The transaction storage is shared with OAuth, but local login makes no OAuth or
GitHub network request. Reauthentication reuses the same password form, checks the
current account and rotates the existing session. Passwords/hashes never appear in
provider metadata or session responses. OAuth identity linking is disabled in local
mode; campaign authorization remains the existing server-side contract.
