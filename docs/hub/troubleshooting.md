# Campaign Hub troubleshooting

> **Status:** Current first-response guide; provider commands are added after selection
> **Last verified:** 2026-09-14
> **Owner:** Campaign Hub maintainers

Do not begin by editing database rows. Preserve request ids, timestamps, app/protocol/migration versions, and
the affected aggregate ids. Never paste cookies, OAuth codes, invite tokens, database URLs, or character
documents into tickets/logs.

| Symptom | First checks | Likely areas | Safe next action |
|---|---|---|---|
| Portainer cannot start the one-file Hub stack or campaigns appear missing | prepared image tags, `config-init` completion, public hostname, existing volume names and `HUB_VOLUME_PREFIX` | missing images, initializer failure or different data-volume selection | follow [Portainer preparation and handover](portainer.md); use the updated managed-volume Compose file (no `HUB_PROJECT_DIR`), retain data volumes and existing passwords |
| Cloudflare tunnel is healthy but Hub fails | route service URL, hostname, edge/backend status and connector IP | tunnel origin routing or public-origin mismatch | follow [tunnel troubleshooting](cloudflare-tunnel.md#troubleshoot-and-return-to-local-access); route the whole hostname to `http://edge:8080`, preserving Host and `CF-Connecting-IP` |
| Local-login bind mount is missing or the BFF cannot read its users file | `.hub/users.json` exists, private parent permissions and file readability; do not print file contents | personal credential setup/mount | run `npm run hub:user -- --username YOUR_NAME`, then use both Hub Compose files as shown in [local login](local-login.md) |
| Local password changes have no effect | BFF container recreation after the edit | credentials are loaded at startup and the CLI atomically replaces the file | recreate the BFF with both Compose files; a simple process restart may retain the previous file bind mount |
| Local user signs in but existing OAuth campaigns are missing | original account identity and selected authentication mode | local and OAuth identities are separate accounts | return to OAuth to access that account; do not replace file UUIDs or assume matching names merge ownership |
| BFF refuses startup | Required env, DB reachability, `hub.accounts` | `server/src/index.js`, migration | Run health/migration status; do not bypass readiness |
| `/api/health` returns 503 | DB connectivity/schema | pool TLS/role/schema | Inspect DB/provider health and migration status |
| OAuth loops/fails | callback URL, app origin, OAuth cookie, subject allowlist | proxy origin/cookie/PKCE | Verify exact origin/callback and numeric subject |
| Invite redemption repeats/fails | URL fragment then `sessionStorage["hub-pending-invite"]`, invite expiry/use/revoke | OAuth round-trip or invalid invite | Current page clears the pending key after one success/failure; inspect without copying the token into logs |
| Mutation returns `INVALID_ORIGIN` | browser Origin and proxy scheme/host | edge forwarded headers, `HUB_APP_ORIGIN` | Fix proxy replacement/trust; never broaden to wildcard |
| `INVALID_CSRF` | session bootstrap/rotation | stale page/session | Refresh `/api/session`; verify secrets are consistent |
| `PROTOCOL_UPDATE_REQUIRED` | page/service-worker build | stale cached client | activate new worker/reload; do not accept old writes |
| `LEASE_HELD`/`LEASE_FENCED` | active device and epoch | takeover/tab coordination | use explicit takeover or recover local draft |
| `REVISION_CONFLICT` | server revision and local recovery | repository queued base/rebase | use conflict UI; export recovery before destructive choice |
| Offline Character Sheet still shows a local value after reconnect | character revision in reconnect cursor, canonical HTTP revision, local recovery draft/conflict | Character Sheet projection-invalidation consumer and accepted-base rebase | keep writes frozen; use the explicit local/server dialog, never infer success from the displayed local draft; verify `Use Local` preserves the draft and `Use Server` adopts canonical truth |
| Character save rejected as too large | serialized byte count | notes/features/inventory growth | export, reduce content, retry; do not raise quota casually |
| `CHARACTER_RECOVERY_LIMIT` / `CHARACTER_RECOVERY_STORAGE_UNAVAILABLE` | pending command count, recovery payload bytes, browser `sessionStorage` availability/quota, owner id, create/patch intent, temporary-to-canonical identity migration | ordered character recovery queue | wait for the current save, retry, or export; never bypass recovery durability, treat patch recovery as a new create, discard the pending activity, or remove the temporary recovery key unless the owner-scoped canonical replacement was stored |
| `CHARACTER_RECOVERY_EXACT_REQUEST_UNAVAILABLE` | recovery format, whether the original PATCH body and rules-version pin were stored, whether the command contains one-shot activity | legacy browser recovery created before format 3 | export the complete queue, then choose server state; a recovery-only create may instead be exported and discarded after an owner-scoped listing confirms it never committed. Dismissing exports and preserves the block so the next save reopens the choice. Never reconstruct the activity request under its old key or rotate the key and risk duplicating the event |
| Older local recovery is hidden pending account claim | predecessor recovery has no `ownerAccountId`; check whether an authoritative owner row exists and whether the blob is create or patch intent | recovery written before account-bound format | established patches bind only after current-account ownership is verified. Claim an ownerless create only through the explicit Character Sheet prompt; declining leaves its contents hidden and storage untouched |
| Character recovery repeatedly returns `RULES_VERSION_STALE` | stored rules pin, server `activeRulesVersionId`, replacement command key and durable queue | active campaign content policy changed after a request was prepared | a stale-policy rejection is definitive non-commit evidence. Verify the repository rotated the affected key, persisted the authoritative rules pin and replacement request, then retried; do not reuse the old key with a changed pin |
| Brew rejected | error code, size/depth/dependencies/HTML | `campaign-content.js` | correct source bundle; never disable validation |
| Hub page loads error state | `/api/session`, console, service worker | API unavailable, boot order, bound fetch | confirm same-origin route and no cached API response |
| WebSocket disconnects immediately | Origin, cookie, protocol, membership | edge upgrade/timeout/auth | inspect close code and HTTP membership |
| Realtime stale after reconnect | last sequence/resync response/outbox lag, authorization-scoped HTTP projection revision | client buffer, dispatcher, or projection consumer | trigger resync, inspect oldest pending event, and verify management/DM views replaced their projection from HTTP |
| Outbox rows fail/retry | earliest failed campaign event | dispatcher/store/network | fix first event cause; preserve campaign order |
| Party Tracker rows disappear or regress after refresh | campaign snapshot/membership and projection request sequence | linked projection is intentionally unsaved or an old HTTP response escaped its generation | restore connectivity/context; verify the newest scoped response won; do not duplicate locally |
| Transfer is stuck reserved | source/target status, membership, escrow | transfer lifecycle | resolve/cancel through authoritative command/runbook |
| Item award is missing, duplicated, has type `Other`, lost metadata, or has the wrong stash count | request/idempotency key, resolved `sourceKind` in the `item.award_batch` audit and ordered `item.granted` events, authoritative character/stash revision, exact `name\|source`; remember the event item is intentionally summary-only; for duplicate stacks compare deterministic Character Sheet aliases separately from custom/composition data | trusted award resolver/catalog freshness, site/campaign UID collision or ambiguous legacy Recent row, canonical stack equivalence after sheet save, award receipt, target locks, stash transaction, immutable site repair-projection capture order, mutable-brew exclusion and cache filtering, outbox/reconciliation | stop further inventory mutations for the campaign; compare only safe aggregate evidence until authorized to inspect the canonical document, and follow the incident runbook rather than compensating manually |
| Backup command fails | libpq env, target existence, role | `backup.mjs`, provider access | choose a new encrypted target; never overwrite evidence |
| Restore fails | empty drill DB, archive integrity, role/version | `restore.mjs`, provider tools | keep source backup immutable; capture full tool error |

## Escalation data

Collect only:

- UTC timestamp and request/correlation id;
- app image digest, app version, protocol version, migration version;
- route and stable error code;
- account/campaign/aggregate UUIDs where access permits;
- database/outbox counts and ages, not JSON bodies;
- WebSocket close code/reason;
- backup identifier and restore tool versions.

If confidentiality, authorization, inventory duplication/loss, or restore integrity is uncertain, stop
mutations for the affected campaign/environment and follow the [incident runbook](runbooks/incident.md).
