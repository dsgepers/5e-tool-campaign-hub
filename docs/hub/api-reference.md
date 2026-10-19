# Campaign Hub HTTP API

> **Status:** Current private-V1 contract
> **Wire protocol:** `6`
> **Last verified:** 2026-09-21
> **Owner:** Campaign Hub maintainers

The browser uses relative same-origin paths through `HubApiClient`. This is an application BFF contract, not
a public third-party API. Schemas in `server/src/app.js` are authoritative if this document and code differ.

## Common behavior

### Authentication

- Session cookie: signed `__Host-hub_session`; httpOnly, SameSite=Lax, Secure in production.
- OAuth correlation cookies: one short-lived signed `__Host-hub_oauth-<transaction-id>` cookie per transaction.
  The opaque state carries the transaction id plus independent entropy, selecting the exact
  provider/operation/redirect-bound row without a singleton-cookie last-writer race. Invite-gated starts also
  bind exactly one five-minute server-side invite context to that transaction.
- Account authority is only `(provider, immutable subject)`; email and mutable profile fields never select or
  link an account.
- `GET /api/session` is the bootstrap call. Signed-in responses include the CSRF token.
- Signed-in session responses include the available provider slugs already linked to that account for
  reauthentication. When `account.entitlements.v1` is enabled, they also include active account entitlements.
  When `account.identity_linking.v1` is enabled, the separate own-identity routes are available. Provider
  identity metadata is never entitlement authority.
- Private reads require an active session. Campaign reads additionally require active membership.

### Mutation headers

Every mutation requires:

```http
Origin: https://the-exact-app-origin.example
X-CSRF-Token: <session HMAC>
X-Hub-Protocol-Version: 6
Idempotency-Key: <non-empty value, at most 200 characters>
```

Protocol 3 remains a restricted compatibility lane for legacy cost-free one-target flows, protocol 4 adds
source-cost operation legs, and protocol 5 adds campaign-scoped metadata-only projection invalidation. Protocol
6 is current and is the only version accepted by multi-target routes/events/replay and other current-only
surfaces.

The server hashes method, route, params, query, and body (excluding `baseRevision` and `leaseEpoch`) and stores
the hash with the per-account receipt. Reusing one key for a different logical request returns
`IDEMPOTENCY_KEY_REUSED`. Excluding revision/epoch lets the same logical mutation retry after safe rebase or
lease refresh without becoming a different command.
Multi-target exact replay keeps the stored command/event/receipt/leg identities, reauthorizes current
operation participation or DM/co-DM authority, and returns the stored command outcome with current
audience/privacy shaping. Later responses, selection, finalization, cancellation, or expiry do not replace that
historical outcome. Withdrawn authority receives not-found, matching detail. Replay neither mutates the receipt
nor creates a new command.

### Responses

- JSON unless redirect/download/204 semantics state otherwise.
- `/api/*` and `/auth/*` set `Cache-Control: no-store`.
- Stable errors:

```json
{
  "error": "STABLE_CODE",
  "details": {}
}
```

`details` is omitted when absent. Internal exception messages are not returned.

### Identifier validation

Path/query keys ending in `Id` must be UUID-shaped. Invalid values fail as `INVALID_ID` before route logic.

## Public and session routes

| Method/path | Access | Input | Result/behavior |
|---|---|---|---|
| `GET /api/health` | Public | none | `{ok:true}` or 503 `{ok:false,error:"DATABASE_UNAVAILABLE"}`; verifies DB, migration ledger, and required migration |
| `GET /api/meta` | Public | none | protocol/package version, additive capabilities, and bounded provider availability; `campaign.rules_policy.v1` is present only when the new management surface is enabled |
| `POST /api/auth/invite-contexts` | Public, exact Origin, current protocol, 10/min | `{token,provider,returnTo}` | Validates a campaign invite and atomically creates one server-side context plus its bound OAuth transaction; returns `{authorizationUrl,retryToken}` and sets that transaction's signed correlation cookie |
| `POST /api/auth/invite-contexts/retry` | Public, exact Origin, current protocol, 10/min | `{retryToken,provider,returnTo}` | After a consumed callback which did not commit admission, replaces the old context/transaction with a fresh same-provider pair and rotated opaque retry token |
| `GET /auth/:provider/start` | Public, 10/min | concrete `github`, `discord`, or `google` route; query `returnTo?` | Creates a one-time durable transaction, sets signed correlation cookie, and redirects using the adapter's declared PKCE/nonce capabilities |
| `GET /auth/:provider/callback` | OAuth correlation cookie, 20/min | concrete route; query `code`, `state` | Atomically consumes exact provider/operation/redirect-bound state and validates immutable subject. Existing identities sign in normally; reauthentication rotates the initiating session; link attaches only to the initiating account. A bound invite context atomically signs in and joins the campaign; an unknown sign-in identity additionally requires the default-off `auth.invite_admission.v1` rollout capability |
| `GET /api/session` | Public | session cookie optional | `{signedIn:false}` or account + CSRF token |
| `POST /api/logout` | Mutation security | none | Revokes current session, closes its sockets, clears cookie |
| `GET /api/account/export` | Authenticated | none | Download containing owned account/external-identity/session-provenance/membership/campaign/character/audit data; never provider tokens/OAuth transactions |
| `GET /api/account/sessions` | Authenticated active account | none | Own sessions with current/revoked/activity metadata |
| `POST /api/account/sessions/:sessionId/revoke` | Authenticated mutation | own session UUID | Revokes session/leases and closes matching sockets |
| `POST /api/account/sessions/revoke-others` | Authenticated mutation | none | Revokes all other own sessions/leases/sockets |
| `GET /api/account/deletion` | Authenticated, including deletion grace | none | Current deletion status/timestamps |
| `POST /api/account/deletion/request` | Freshly reauthenticated mutation | `{confirmation:"DELETE"}` | Blocks active campaign owners and the last platform operator; schedules seven-day purge, revokes sessions/cookie |
| `POST /api/account/deletion/cancel` | Reauthenticated deletion-grace mutation | none | Restores active account before purge begins |
| `POST /api/account/reauthentication/:provider` | Authenticated account mutation, including deletion grace | `{returnTo}` | Creates a provider/account/session-bound `reauthenticate` OAuth transaction and returns its authorization URL |
| `GET /api/account/identities` | Authenticated active account; `account.identity_linking.v1` | none | Returns only the caller's identity id, provider, bounded handle/display name, linked/last-authenticated timestamps, current-session marker, provider status, and explanatory unlink policy |
| `POST /api/account/identities/:provider/link-intents` | Authenticated active-account mutation; exact Origin, CSRF, current protocol, idempotency, fresh reauthentication; `account.identity_linking.v1` | `{returnTo}` | Creates a provider-bound `link` transaction expiring within five minutes and returns its authorization URL |
| `DELETE /api/account/identities/:identityId` | Authenticated active-account mutation; exact Origin, CSRF, current protocol, idempotency, fresh reauthentication through a different identity; `account.identity_linking.v1` | none | Unlinks one caller-owned identity, rotates the current session, revokes every old account session/lease/socket, and returns a fresh CSRF token |
| `GET /api/operator/accounts` | Freshly reauthenticated platform operator | none | Hidden account list with active entitlements; non-operators receive route-equivalent 404 |
| `POST /api/operator/accounts/:accountId/entitlements/:entitlement/grant` | Freshly reauthenticated platform operator mutation | no body; idempotency required | Grants `campaign:create` or `platform:operate`; already-active is a no-audit success |
| `POST /api/operator/accounts/:accountId/entitlements/:entitlement/revoke` | Freshly reauthenticated platform operator mutation | no body; idempotency required | Revokes an active entitlement; already-revoked is a no-audit success; last operator is protected |

The concrete routes are `/auth/github/*`, `/auth/discord/*`, and `/auth/google/*`; disabled or
configuration-error providers have no routes. Google validates RS256 signature, fixed issuer/audience/`azp`,
expiry/issued-at bounds, nonce, and `sub`. Discord validates the `/api/v10/users/@me` decimal user id. Provider
tokens and response bodies never cross the callback adapter boundary.

A reauthentication callback accepts only the provider identity already linked to the initiating account and
the exact initiating session. Success rotates that session, closes its socket, updates the cookie/CSRF state,
records the identity used, and starts a five-minute freshness window. A provider mismatch, another account's
identity, stale initiating session, or expired transaction cannot freshen authority.
The account page exposes this flow to ordinary users as well as operators. Ordinary reauthentication controls
are collapsed until the user opens them or a sensitive command reports `REAUTHENTICATION_REQUIRED`. A manual
success returns through `/hub.html?accountAction=reauthenticated`; normal session bootstrap adopts the
replacement cookie and CSRF token, then the page shows the five-minute success notice while keeping the controls
collapsed. A rejected provider-link click may leave a short-lived same-origin `sessionStorage` retry hint; after
reauthentication the page revalidates that provider against current metadata and focuses its Link button. The
query marker alone never starts a provider-link transaction. A deletion attempt without fresh proof exposes the
same provider choice and returns to an explicit confirmation step. A successful deletion request clears the
session and returns the browser to sign-in; signing in again is the deletion-grace reauthentication path for
export or cancellation.

A link callback never enters invite admission or creates an account. An unknown subject attaches only to the
initiating account; a subject owned elsewhere returns bounded `IDENTITY_ALREADY_LINKED`. Unlink returns bounded
`IDENTITY_NOT_FOUND`, `REAUTHENTICATION_IDENTITY_CONFLICT`, `LAST_IDENTITY_PROTECTED`, or
`IDENTITY_RETENTION_REQUIRED` without exposing another account or provider subject.
Link and unlink rotation credentials are deterministically recoverable only from server secrets plus the exact
OAuth transaction or idempotency command. A lost success response can therefore reissue the already-committed
replacement cookie/CSRF without repeating the mutation; unrelated revoked sessions remain unauthenticated.

The raw invite token is accepted only in the JSON body of `POST /api/auth/invite-contexts`. It is never accepted
in `returnTo`, OAuth state, cookies, query strings, or callback parameters. The server permits only `/hub.html`
or `/campaign.html` with an optional UUID `id` as `returnTo`; fragments, unknown query keys, and
invite/context-shaped fields fall back to `/hub.html`.

Unknown identity without a bound invite returns `INVITE_ADMISSION_REQUIRED`. Invalid, expired, revoked,
exhausted, replayed, raced, or mismatched invite contexts return `INVITE_ADMISSION_INVALID`. A rollout-disabled
new-account completion returns `INVITE_ADMISSION_UNAVAILABLE`. Provider failure after OAuth-state consumption
does not consume invite use or create any account/session/membership; the bound context is not reusable and the
browser may restart through the one-time opaque retry handle, whether the old state was consumed or navigation
was abandoned. Reusing or changing that handle/provider/browser transaction cookie returns
the same bounded invalid-admission result.

## Campaign routes

| Method/path | Authorization | Input | Result |
|---|---|---|---|
| `POST /api/campaigns` | Authenticated mutation, 10/min; active `campaign:create` when entitlement enforcement is enabled | `{name}` 1-120 chars | 201 campaign + owner DM membership, or `CAMPAIGN_CREATE_NOT_ENTITLED` with zero writes |
| `GET /api/campaigns` | Authenticated | none | Active memberships' non-deleting campaigns |
| `GET /api/campaigns/:campaignId` | Active member | none | Campaign with caller membership role/id |
| `GET /api/campaigns/:campaignId/members` | Active member | none | Active member summaries |
| `PATCH /api/campaigns/:campaignId/members/:membershipId` | Campaign owner mutation | role co_dm/player/spectator | Changes a non-owner role |
| `DELETE /api/campaigns/:campaignId/members/:membershipId` | Owner or co-DM mutation | none | Removes allowed non-owner, resolves pending state, detaches characters |
| `POST /api/campaigns/:campaignId/leave` | Non-owner mutation | none | Leaves and performs the same lifecycle cleanup |
| `GET /api/campaigns/:campaignId/context` | Active member | none | Current membership role plus active immutable brew/rules versions and capability payloads |
| `GET /api/campaigns/:campaignId/snapshot` | Active member; protocol-versioned | none | Campaign, membership, authorization-scoped character envelopes, roster metadata, last sequence |
| `GET /api/campaigns/:campaignId/character-projections` | Active member; protocol-versioned | none | `{projections, roster}` — the batch scoped projector every consumer refetches through |
| `GET /api/campaigns/:campaignId/events` | Active member | exactly one optional cursor: forward `afterSequence>=0` or backward `beforeSequence>=1`; `limit` 1-500 (default 200) | Forward: `{events, replay: {scannedThroughSequence, hasMore}}`. Backward: `{events, history: {scannedBackThroughSequence, hasMore}}`. Events are always returned in ascending sequence order |
| `POST /api/campaigns/:campaignId/archive` | Campaign owner mutation | none | Cancels actions/releases leases/detaches characters, or `CAMPAIGN_BUSY` |
| `POST /api/campaigns/:campaignId/transfer-ownership` | Campaign owner mutation | `{targetAccountId}` | Changes owner and owner/target roles atomically |

The archive/ownership routes rely on store-level owner authorization in addition to session security.

Event replay pages can contain fewer than `limit` events, including zero, after character-projection privacy
redaction. A client continues while `replay.hasMore` is true and passes `replay.scannedThroughSequence` as the
next `afterSequence`; returned event count is never evidence that the scanned range is exhausted. The marker is
the highest raw event sequence in that page's bounded scan window, excluding its one-row lookahead, not the last
event disclosed to the viewer.

Backward history is a separate presentation/read mode and never changes realtime replay semantics. It scans
newest-to-oldest before the exclusive cursor, returns up to `limit` authorized events in ascending order, and
reports the oldest raw sequence examined as `history.scannedBackThroughSequence`. The bounded raw scan is
`max(200, 25 * limit)`, capped at 2,000 rows. A short or empty page with `history.hasMore: true` means only that
the scanned window contained no additional visible events; clients may continue from the returned history cursor.

### Authorization envelopes

Every character read returns exactly one outcome, discriminated by `kind`
([ADR 0011](adr/0011-authorization-scoped-character-projections.md)):

| Requester | `kind` | Contents |
|---|---|---|
| Character owner | `owner_truth` | canonical document, `policy`, `projectionRevision`, opaque `targetRef`, `operationWatermark` |
| DM or co-DM who is not the owner | `dm_truth` | canonical document, opaque `targetRef`, `operationWatermark`, plus the exact `peerPreview`; never the raw policy |
| Any other active member | `peer_profile` | `{id, campaignId, revision, projectionRevision, data}` |

Reads whose response is an envelope require `X-Hub-Protocol-Version`; a mismatch returns
`426 PROTOCOL_UPDATE_REQUIRED` so an older client is told to update rather than silently misreading a shape it
does not understand.

## Invite routes

| Method/path | Authorization | Input | Result |
|---|---|---|---|
| `POST /api/campaigns/:campaignId/invites` | DM/co-DM mutation, 20/min | role co_dm/player/spectator, expiry 1-720h (default 168), max uses 1-20 | 201 invite metadata plus raw token |
| `GET /api/campaigns/:campaignId/invites` | DM/co-DM | none | Invite metadata without token hashes/raw tokens |
| `POST /api/campaigns/:campaignId/invites/:inviteId/revoke` | DM/co-DM mutation | none | Idempotently sets revoke time |
| `POST /api/invites/redeem` | Authenticated mutation, 20/min | raw token 32-500 chars | Active membership; invalid/expired/revoked/exhausted is `INVITE_INVALID` |

Only the token hash is persisted. The raw token is returned only from creation.
Tokens are derived with the current independent `HUB_INVITE_TOKEN_SECRET` from actor, campaign, idempotency key,
and normalized request hash. On rotation, up to three prior keys in
`HUB_INVITE_TOKEN_PREVIOUS_SECRETS` remain available for at least the 24-hour receipt lifetime. The invite table
and command receipt persist no raw token; replay selects the derived candidate whose hash matches the stored
invite hash. No match fails as `INVITE_TOKEN_RECOVERY_UNAVAILABLE` rather than returning an unusable token.
List/event/log/export/backup surfaces never expose it.

## Character routes

| Method/path | Authorization | Input | Result |
|---|---|---|---|
| `GET /api/characters?campaignId?` | Authenticated; protocol-versioned | optional campaign UUID | Owner's active characters; DMs see campaign characters; other members see only owned rows. No response ever carries `projectionPolicy` — sharing settings are read only from the owner-only management endpoint |
| `POST /api/characters` | Authenticated mutation; non-spectator membership if campaign scoped | `clientImportId`, `campaignId?`, `schemaVersion`, `data` | 201 created/reactivated/idempotently existing canonical character |
| `GET /api/characters/:characterId` | Any active campaign member; protocol-versioned | none | `{projection}` — one ADR 0011 envelope: `owner_truth`, `dm_truth`, or `peer_profile` |
| `GET /api/characters/:characterId/projection-policy` | Owner only; protocol-versioned | none | `{policy, projectionRevision, preview}`; `preview` is the server-computed peer profile, and `error` reports `PROJECTION_POLICY_INVALID`. A character owned by somebody else and one that does not exist both return `404 PROJECTION_POLICY_NOT_AVAILABLE`, so the endpoint cannot confirm an id |
| `PUT /api/characters/:characterId/projection-policy` | Owner mutation | `{policy, expectedProjectionRevision}` + `Idempotency-Key` | Updated policy/preview, `409 PROJECTION_POLICY_CONFLICT` with the current safe state, or `422 PROJECTION_POLICY_INVALID` |
| `POST /api/characters/:characterId/lease` | Owner mutation | `{takeover?}` | Lease session, monotonic epoch, expiry |
| `POST /api/characters/:characterId/lease/release` | Owner mutation; current protocol 6 required | Exact `{leaseEpoch, expiresAt}` returned by acquisition/renewal | `{released}`; protocol 3/4/5 clients receive `426 PROTOCOL_UPDATE_REQUIRED` before body validation |
| `PATCH /api/characters/:characterId` | Owner mutation + held lease | `baseRevision`, `leaseEpoch`, up to 500 add/remove/replace patches; optional closed `spell.used` activity descriptor | Canonical character or revision/lease conflict |
| `DELETE /api/characters/:characterId` | Owner mutation | none | Soft archive; blocks outgoing reserved transfer |
| `POST /api/characters/:characterId/clone` | Owner + target non-spectator membership | `{campaignId, rulesVersionId}` + `Idempotency-Key` | Independent character with new id |
| `POST /api/characters/:characterId/move` | Owner + target non-spectator membership | `{campaignId}` | Same character moved; active lease/outgoing escrow blocks |

Character data is sanitized/validated and capped at 1.5 MB after the resulting mutation.
Before submitting a cloud clone, the Character Sheet persists the exact destination campaign, rules pin, and
idempotency key, a 23-hour replay deadline, and the destination's existing clone IDs for that source character.
An outcome-uncertain retry before the deadline replays that frozen request even if campaign rules changed while
the response was missing. After the deadline, the client never resubmits the expired key: it lists authoritative
destination characters and compares them with the saved baseline. Exactly one new matching clone is adopted,
authoritative absence clears the old command but requires a new explicit copy attempt, and multiple matches keep
the command locked for manual resolution. Older recovery records without a deadline and baseline fail closed.
A definite non-committing rejection discards the frozen request so the next attempt reads current compatibility
and uses a new key; an idempotency-key collision remains blocked rather than risking a duplicate clone.

`dm_truth` authorizes inspection, not document editing. The Character Sheet preserves that discriminator,
renders the sheet read-only before accepting input, and does not initialize owner-only leases, sharing policy,
pending-action approval, peer-targeting, or party-inventory controls. DMs change player characters through the
explicit semantic action and grant routes below; they never acquire the owner's document lease.

The optional spell activity descriptor contains only `type:"spell.used"`, bounded `spellName`/`spellSource`,
integer `spellLevel`/`slotLevel` (0-9), and mode `cantrip|ritual|spell_slot|pact_slot|resource|free`. It is never
derived from arbitrary patches. The event, audit row, outbox row, character mutation, and idempotency receipt
commit together. A cantrip or ritual may submit an empty patch array; in that case the semantic event/audit are
committed without incrementing the character revision or emitting a projection invalidation.

Browser recovery persists the exact character request envelope before submission. Commands carrying spell
activity receive an absolute 23-hour replay deadline so a browser retry cannot outlive the 24-hour receipt.
The deadline is rechecked after awaited request preflight, immediately before every submission and before
rejection-driven key rotation/resend. Expired activity-bearing commands are not sent: the Character Sheet blocks
later saves and offers a complete recovery export plus explicit use-server/discard resolution. Activity-free
character commands remain replayable.
For a transactionally rejected `POLICY_VERSION_STALE`, recovery refetches canonical truth, removes stale derived
`data.carry` authority, rotates the request identity, persists that replacement, and then retries. A revision
conflict has no matching successful receipt, so recovery retains activity on the rotated request even when the
rebased document patch is empty. `IDEMPOTENCY_RESULT_GONE` instead proves the receipt committed but its character
was later removed; create recovery blocks for explicit export/discard and never recreates the character. For a
definitive PATCH `CHARACTER_NOT_FOUND` or `IDEMPOTENCY_RESULT_GONE`, an authoritative not-found response permits
only export-then-remove-local resolution: the browser clears the inaccessible local character and blocked exact
request without loading server state, matching `clientImportId`, or issuing a replacement CREATE. Recovery
persists the failed CREATE/PATCH leg separately from original command intent, so this remains true when CREATE
succeeded and the command's following activity PATCH failed. Owner-scoped reload routing exposes that canonical
recovery-only draft to the Character Sheet before attempting a doomed character GET, while other accounts cannot
list or route through it.

## Rolls, actions, and grants

| Method/path | Authorization | Input | Result |
|---|---|---|---|
| `POST /api/campaigns/:campaignId/rolls` | Active-member mutation; character owner or DM when character supplied | characterId?, formula <=200, numeric total, context <=100, visibility, detail | Durable `roll.logged` event; activity uses a bounded semantic `detail.title` and selected detail fields |
| `GET /api/campaigns/:campaignId/characters/:characterId/roll-history` | Current protocol 6, active account/member, current character owner only; DM inspection denied | `limit` 1-200 (default 200), exclusive `beforeSequence` positive safe integer, optional UUID `commandId`; unknown queries rejected | Contract v1, stable `highWaterSequence`, ascending authorized own roll events, backward history cursor and `hasMore`; no character write or lease |
| `GET /api/campaigns/:campaignId/actions` | Active member | none | Proposed semantic operations visible to DM/co-DM, proposer, or target owner; protocol 3 omits cost-bearing rows |
| `GET /api/campaigns/:campaignId/characters/:characterId/pending-actions` | Active owner of that character | none | Privacy-safe approval cards; protocol-4 cost-bearing cards include `contractVersion:1`, while protocol 3 preserves only legacy cost-free cards |
| `GET /api/campaigns/:campaignId/characters/:characterId/outgoing-actions` | Active source owner; protocol 4 | none | Bounded source-side status/cancel/recovery summaries for cost-bearing requests |
| `POST /api/campaigns/:campaignId/actions` | DM/co-DM/player mutation; spectator denied | Direct DM/co-DM command or source-derived peer proposal, below | 201 stable operation/lifecycle metadata; direct authority is already `applied`, peer authority is `proposed` |
| `POST /api/campaigns/:campaignId/actions/:operationId/resolve` | Target owner, proposer, or DM/co-DM according to decision | `{contractVersion?,commandId,decision}` where decision is `accept`, `reject`, or `cancel` | Stable operation/lifecycle metadata; acceptance returns the applied target event identity, revision, and authorized watermarks |
| `POST /api/campaigns/:campaignId/characters/:characterId/xp-grants` | DM/co-DM mutation | integer amount 1-1,000,000; reason <=500 | Updated character |
| `POST /api/campaigns/:campaignId/characters/:characterId/item-grants` | DM/co-DM mutation | bounded safe item summary; quantity 1-100,000 | Compatibility route: updated character + stable entry |
| `POST /api/campaigns/:campaignId/item-awards` | DM/co-DM mutation | source union; 1-50 ordered unique character UUIDs; quantity 1-100,000 each; note <=500 | One atomic award response in request target order |

Every semantic command uses a UUID `commandId` equal to `Idempotency-Key`. Exact retries return the stored
operation and event ids; any actor/body reuse returns `IDEMPOTENCY_KEY_REUSED`.

### Owner Roll History (source candidate, not deployed)

`character.roll_history.v1` is advertised in meta/session. This read selects from existing domain events,
not a second roll ledger: campaign, current owned character, actor, event type, and historical audience
are filtered **before** the latest-200 limit. DM-authored rolls about the character are not the owner's
personal rolls. Archive/move/detachment that removes the campaign binding makes the old scope unavailable.
The response is `{contractVersion:1,highWaterSequence,events,history:{scannedBackThroughSequence,hasMore}}`;
the oldest selected sequence is the exclusive cursor for older results. This is separate from forward
campaign replay's raw scanned cursor.

Projection keeps only formula (200), context (100), total, actor-only command correlation (200), and
detail title/breakdown/resultNote (200 each) plus resultClass (100). Arbitrary legacy detail is excluded.
The PostgreSQL read uses shared authority locks, a five-second statement and two-second lock budget;
budget exhaustion returns `ROLL_HISTORY_UNAVAILABLE` (503), never a successful empty history. This candidate
adds no migration/index: finite sparse-history tests do not establish unbounded campaign-growth performance.
These are per-statement/per-lock budgets, not an end-to-end HTTP or connection-pool wait deadline.

The Sheet persists each exact attempted request/key and 23-hour retry deadline in
account/campaign/character-scoped session storage before POST. Reload never resends automatically.
An uncertain send first queries its exact actor command ID; a matching payload confirms it, and only
a complete empty result while live and before the deadline permits the same key/body to be retried.
Expired, failed, mismatched, or incomplete reconciliation remains unconfirmed. Legacy events without a
command ID are displayable but cannot prove an uncertain command absent. Offline entries are device-only,
not queued cloud writes. Roll History does not PATCH the character, acquire its editor lease, or support
campaign Clear; changing the future-roll audience remains an ordinary owner setting write.

The Campaign Overview condition action uses the canonical site condition catalog plus the active campaign brew
catalog. The submitted operation always carries the selected `name` and `source`; there is no free-form source
fallback. Removal choices additionally include exact conditions already present on an authorized canonical
target, including legacy bare-string conditions normalized to their established `XPHB` identity, so retiring a
brew version cannot strand an applied condition. Remote `brew.activated` events refresh the catalog; a later
live refresh retries a transient catalog-load failure.

The item-award source is either `{kind:"party_inventory",entryId}` or
`{kind:"catalog"|"recent"|"campaign_item",item}`. A browser-supplied item is restricted to `name`, `source`,
`page`, `rarity`, `weight`, `value`, `typeCode`, and `edition`; unknown/rich/executable content is rejected and
the request summary is never stored as the canonical item. The BFF resolves catalog identities from a generated
repository-owned site catalog, campaign-item identities from the active validated brew bundle, and recent
identities from either trusted source. New `item.granted` events record the resolved `catalog` or
`campaign_item` authority so Recent reuses it exactly. A legacy `recent` identity must exist in exactly one
authority. Stash-derived events are omitted from Recent; the live party-stash picker retains their stack UUID.
Missing or source-kind-mismatched identities return `ITEM_AWARD_SOURCE_NOT_FOUND`; unresolved trusted
`_copy` inheritance, duplicate campaign identities, site/campaign `name|source` collisions, and ambiguous legacy
Recent identities return `ITEM_AWARD_SOURCE_INVALID`. The resolver supports direct campaign item metadata and
simple `name`/`source` inheritance, but rejects `_mod`, templates, and other runtime transformations rather than
executing campaign-supplied instructions in the BFF. Client-supplied metadata cannot override the resolved object. A
stash award derives content from the locked authoritative stack and debits
`quantity * targetCharacterIds.length` once. All targets, the optional stash debit, one batch audit, the ordered
per-target grant/projection events, the optional stash invalidation, and the receipt commit together or not at
all. Exact retries replay the same ordered response without another debit or grant. Award responses and events
contain only the bounded summary even though authoritative inventory retains the complete trusted item.
Those returned/event/audit summaries are derived from the resolved authoritative item, so browser-supplied
display metadata cannot disagree with the persisted object. Event and audit `sourceKind` identify the resolved
authority; the response source continues to describe the normalized submitted command for retry identity.
Before submission, the browser persists the exact award body, idempotency key, fingerprint, and 23-hour replay
deadline in account/campaign-scoped session storage. After an outcome-uncertain failure or reload, it locks the
item and recipient controls to that command and labels the only available submission action `Retry previous
award`. Before the deadline it replays the exact command. Each committed `item.granted` event records the actor's
command ID; that field is redacted from every other viewer. After the deadline, the browser never resubmits the
expired key: it scans authoritative campaign history for that actor-only correlation. A match proves the atomic
award committed and refreshes inventories; a complete scan with no match clears the old command but requires a
new explicit submission; an incomplete or failed scan remains locked. The composer otherwise unlocks only after
a definitive failure or confirmed success, so it never presents editable award B while submission would replay
retained award A.

Direct DM/co-DM body:

```json
{
  "commandId": "uuid",
  "targetCharacterId": "uuid",
  "operation": {"kind": "hp.heal", "version": 1, "arguments": {"amount": 5}}
}
```

Source-derived peer body:

```json
{
  "contractVersion": 1,
  "commandId": "uuid",
  "sourceCharacterId": "uuid",
  "sourceEntity": {"type": "spell", "uid": "cure wounds|phb", "version": "phb-2014-v1"},
  "effectTemplateId": "spell.cure-wounds.heal",
  "choice": {"castLevel": 1},
  "targetRef": "opaque-uuid",
  "rulesVersionId": "uuid"
}
```

The version-1 catalog is `hp.damage`, `hp.heal`, `condition.add`, `condition.remove`, `spell_slot.spend`, and
`spell_slot.restore`. Players cannot submit generic `kind`/`arguments`. Peer proposals rederive from the pinned
server template at creation and approval, always require a later explicit target-owner acceptance (including
self-target), and expire after at most 24 hours. DMs/co-DMs may reject/cancel but may accept only when they own
the target. Protocol 4 and the exact advertised `peerSourceCosts` capability enable PHB/XPHB Cure Wounds and the
held A5 Healing Word templates with one
standard slot at the selected cast level. The private deterministic seed, source-cost descriptor, source resource
identity/value, and target truth never appear in peer projections. Proposal neither consumes a source cost nor
tests the effect against hidden target state; acceptance commits source and target mutations in one transaction
or records a privacy-shaped unavailable outcome without spending. Healing Word uses
`effectTemplateId: "spell.healing-word.heal"` and exact `healing word|phb` / `healing word|xphb` UIDs with the
corresponding `phb-2014-v1` / `xphb-2024-v1` version. Its only choice is `castLevel` from 1 through 9.
Pact slots, item/innate spell grants, metamagic and variant components remain unsupported. Singular Cure Wounds
and Healing Word always require manual owner approval, including self.

### Held A5 healing-spell rules boundary

All four HW/MHW definitions require exact source/edition and a usable class-owned known/prepared spell record.
An explicit stored spell `uid` must agree with that exact identity; absent UIDs remain supported only with
the existing exact name/source/class acquisition evidence. Any non-null `brewBundleVersionId` or
`brewContentHash`, including malformed empty provenance, is unsupported for these production definitions.
Both proposal and current final rederivation enforce this; consent cannot authorize a changed source record.
This additional A5 validation does not change Cure Wounds.
They consume exactly one standard slot of the chosen level, only when the effect atomically applies.

| Spell | Source | Minimum slot | Healing dice at slot level L | Candidate cap |
|---|---|---|---|---|
| Healing Word | PHB | 1 | Ld4 + casting modifier | 1 |
| Healing Word | XPHB | 1 | 2Ld4 + casting modifier | 1 |
| Mass Healing Word | PHB | 3 | (L-2)d4 + casting modifier | 6 |
| Mass Healing Word | XPHB | 3 | (L-1)d4 + casting modifier | 6 |

Checked-in spell data supplies these definitions; runtime prose is never parsed. The separately authorized
A5-only convention floors healing **after the casting modifier** at the minimum of the selected dice
expression: 2d4 cannot heal below 2 HP and 4d4 cannot heal below 4 HP. This is not an authored RAW minimum,
a global spell rule, or a change to Cure Wounds or the positive-only typed healing contract.
**Table adjudication is required** for current 60-foot range/distance, caster sight, bonus-action/verbal casting
eligibility and PHB undead/construct applicability. No positions, sight or creature types are invented. The
server-enforced identity, sharing, consent and resources do not prove those game-rule predicates. Optional
bounded `presentation.tableRules` copy explains this on source and target workflows without exposing target
HP, applicability, source resources or private seed. The user-authorized boundary changes no capability default,
campaign enrollment, deployment or authority schema.

### Held A5 XPHB Lay on Hands

The heal-only production template uses `lay on hands|xphb`, version `xphb-2024-v1`,
`effectTemplateId: "ability.lay-on-hands.heal"` and exactly `{amount}`: a positive safe integer within the
remaining pool (at most 100). The server selects the actual persisted `feature_use` resource identity; the
caller cannot supply a resource ID. One exact XPHB Paladin feature and one ordinary resource must link
reciprocally, with unique canonical IDs, matching current/max mirrors, long-rest recovery and a maximum of
five times the actual XPHB Paladin level. Duplicate, ambiguous, innate, brew, stale or contradictory bindings
fail closed. Ordinary acquisition, load/save, level-up/down/respec, rest and parser recalculation preserve IDs
and spent points. Safe legacy repair requires exact feature-ID ownership or an exact source-qualified
resource `featureRef`, not a shared display name. A separately tracked explicit PHB pool retains its ID and
bytes while new XPHB acquisition creates a distinct qualified pool; anonymous or contradictory legacy ownership
is diagnosed and left unsupported. Even reciprocal XPHB links cannot override contradictory resource
`source`, `classSource`, `className`, `uid` or brew provenance at the server. Load-time acquisition
repairs are persisted through the normal Sheet save, not an authority bypass.

The existing singular HTTP `choice.amount` schema accepts integers 1 through 100. The production template
still restricts the selected amount to the current canonical pool: overbound input is `400 INVALID_REQUEST`,
while a valid-shaped unaffordable amount is `409 SOURCE_COST_UNAVAILABLE`. Other templates retain their
own closed choices and source checks; this changes no input shape, protocol or cost kind.

Touch range and bonus-action eligibility are table-adjudicated and disclosed before amount confirmation and
target consent. Poison, disease and condition removal are unsupported. Proposal reserves/spends nothing.
Acceptance rechecks the source pool and current target authority and commits exact healing and both cost
mirrors atomically. Singular HW and LoH preserve ADR 0016's private failed/unspent behavior when target data
would not change: source/target JSON and revisions remain unchanged, including exact/concurrent retries.
Only explicitly opted-in multi-target MHW retains applied/revisionless target no-ops with one normal source
cost. Source status never identifies full HP or another hidden applicability reason. No new cost kind,
API, migration, capability default or live enrollment is introduced.

For direct DM/co-DM operations, a valid heal at maximum, duplicate condition add, absent condition remove, or
full-slot restore succeeds with `operation.changed: false`. The command is still an exactly-once terminal
operation and advances the character revision/watermark under the migration-0005 ordering contract, but the
character JSON is byte-equivalent and no projection invalidation is emitted. Exact retries return the stored
response; reuse of the command/idempotency key with another body remains `IDEMPOTENCY_KEY_REUSED`. Insufficient
`spell_slot.spend` remains `RESOURCE_INSUFFICIENT` with no canonical, audit, event, outbox, or receipt write.
An otherwise-authorized resolution command received after the deadline performs the single `expired` transition
and returns its stable terminal metadata; retries replay that response. The authority does not interpret
arbitrary spell prose.

### Protocol-6 multi-target operation API

[ADR 0020](adr/0020-consented-multi-target-operations.md) defines the implemented server/store contract. The
capability remains default-off. The held A4 shared Sheet workflow and A5 PHB/XPHB Mass Healing Word mappings
consume that contract without enabling campaigns; `/actions` retains one-target protocol-4 behavior and rejects
multi-target-only MHW templates.

| Path | Authorization | Closed input | Result |
|---|---|---|---|
| `POST /api/campaigns/:campaignId/multi-target-operations` | Active player and source owner | contract/command id, source character/entity/template/choice, active rules id, 1-8 ordered unique opaque target refs | Fixed candidate operation in `collecting_responses`; no cost/resource/revision mutation |
| `POST /api/campaigns/:campaignId/multi-target-operations/:operationId/invitations/:invitationId/respond` | Current pinned target owner for that invitation; DM/co-DM reject only | command id and `approve` or `reject` | One immutable terminal leg response; exact replay returns the same response/event ids |
| `POST /api/campaigns/:campaignId/multi-target-operations/:operationId/finalize` | Current source owner | command id and exact ordered unique selected invitation ids; empty list means cancel | Empty list cancels with no character mutation; non-empty approved/current subset commits one source cost and all selected legs atomically |
| `POST /api/campaigns/:campaignId/multi-target-operations/:operationId/cancel` | Current source owner or DM/co-DM | contract/command id | Cancels from either live collection state, terminalizes each live leg in proposal order, consumes no cost, and writes no character |
| `GET /api/campaigns/:campaignId/multi-target-operations/inbox` | Current target participant or DM/co-DM | optional cursor, limit <=100, and `mode=pending|recovery` | Default `pending` preserves oldest-pending fairness. `recovery` returns pending first, then only the viewer's responded live/recent retained legs; the current pinned owner receives that own leg's opaque `targetRef`; target owners never receive co-target identity/count/decision |
| `GET /api/campaigns/:campaignId/multi-target-operations/outgoing` | Current source participant or DM/co-DM | optional bounded cursor and limit <=100 | Source sees authorized labels, aggregate coarse status, and no per-target applicability result |
| `GET /api/campaigns/:campaignId/multi-target-operations/:operationId` | Current participant or DM/co-DM | operation id | Viewer-shaped detail; unrelated users receive `ACTION_NOT_FOUND` |

The infrastructure ceiling remains `maxTargets: 8`; a template may impose a smaller ceiling. A5 MHW strictly
enforces six in both picker and registry, with minimum slot 3 and one standard slot for the whole selected subset.
It uses `effectTemplateId: "spell.mass-healing-word.heal"` and exact `mass healing word|phb` /
`mass healing word|xphb` UIDs and edition versions above. The server rejects duplicate resolved characters, post-proposal additions,
non-candidates, unapproved/expired/revoked invitations, and currently invalid selected legs. It never silently
drops an invalid submitted invitation. A rejected finalization has no workflow/audit/event/outbox/character side
effect; source authority, cost, rules, or template invalidity terminally fails the whole operation without any
target mutation. A reviewed healing template with `allowTargetNoOp=true` may apply a selected full-HP leg with no
target revision/invalidation while consuming the single cost; source-visible output cannot identify it. Protocol
3/4/5 fails closed for create/respond/finalize/cancel, inbox/detail/outgoing reads, WebSocket delivery, resync,
and replay; protocol 6 is the first successful version. All successful responses are `Cache-Control: no-store`.
Without that reviewed flag, target inapplicability follows ADR 0016: finalization commits terminal `failed`,
consumes no cost, mutates no character, and leaves approved legs approved/unselected with no synthetic decline.
Applied source/DM detail carries the closed source cost, deterministic source/combined operation-leg key,
event identity/sequence/revision, and the
combined target operation only when the source is itself selected. Each target owner receives the normalized
operation plus their own leg/event sequence/revision/changed result needed for missed-event recovery; source views of
other target legs omit changed, revision, and canonical target character id.

Transactional capacity limits are 3 live collections/source character, 5/source account, 50/campaign,
and 20 pending invitations/target owner. Route limits are propose 10/minute/account and
30/minute/campaign, respond 30/120, and finalize/cancel 20/60; excess requests return privacy-safe
`429 RATE_LIMITED`. Inbox pages contain at most 100 rows and use an exclusive
`collectionClosesAt + operationId + targetCharacterId` cursor ordered oldest-pending-first so continuous new
traffic cannot starve an older invitation.
Recovery mode keeps that pending prefix, then orders the viewer's own non-pending live/recent legs by target-row
update time descending with operation/character tie-breakers. Migration 0012 adds the partial owner-recovery
index over existing migration-0011 columns; no new workflow data is stored.
Migration 0013 corrects only the database validator so lifecycle terminalization of one source-owned candidate
does not roll back while another eligible leg keeps the parent live; it adds no API or authority.
The cursor encodes database microsecond time exactly, avoiding skipped same-transaction legs. Inbox and outgoing
authorization are fenced in one repeatable-read membership snapshot. Display labels are recomputed from current
authorized projection/lifecycle state; hidden or unavailable targets use `Campaign character unavailable`
instead of the immutable proposal name.
Detail reads use membership-before-character locking and no campaign/parent write lock, so they wait behind an
in-flight privacy write and return the resulting coherent view rather than deadlocking or aborting either request.

The source-account and target-owner limits are global across campaigns. Proposal creation serializes them with a
dedicated seed-10 quota advisory lock for the source account and every distinct target-owner account, acquired
in ascending UUID order before the campaign lock. At the final available invitation slot, concurrent proposals
from different campaigns produce one committed winner and one `COLLECTION_LIMIT_REACHED` loser.

Campaign context advertises the exact default-off `multiTargetOperations` capability: contract/protocol
versions, `maxTargets:8`, 600-second collection and 86,400-second operation deadlines, source-owned finalization
consent, partial-selection-but-never-partial-commit flags, and `multi-target-effects-v1`. Exact campaign UUID
enrollment and migration-0011 readiness are required before advertisement.

## Party inventory and transfer routes

| Method/path | Authorization | Input | Result |
|---|---|---|---|
| `GET /api/campaigns/:campaignId/party-inventory` | Active member | none | Lazily created party inventory, entries, denomination currency |
| `GET /api/campaigns/:campaignId/transfers` | Active member | none | Transfers visible to DM, actor, source owner, or target owner; non-DM views omit unowned character/container IDs and foreign actor attribution |
| `POST /api/campaigns/:campaignId/transfers` | Active-member mutation; character source owner, DM/co-DM party source, or player requesting party inventory for their own character | source/target kind+UUID, <=100 item quantities, nonnegative denomination currency, and active `rulesVersionId` for a direct character destination under restrictive content policy | 201 viewer-scoped `committed` direct-authority transfer, `reserved` approval-bound escrow transfer, or non-escrowed `proposed` player stash request |
| `POST /api/campaigns/:campaignId/transfers/:transferId/resolve` | Reserved: target owner or DM/co-DM; proposed stash request: DM/co-DM; originating actor may reject/cancel either | accept/reject plus active `rulesVersionId` when accepting into a character under restrictive content policy | viewer-scoped committed or rejected transfer/request |

`sourceKind`/`targetKind` are `character` or `party_inventory`. Empty/insufficient transfers fail before a
row is committed. Item quantities must be positive finite safe integers within the route schema limit.
The server, not the browser, determines direct authority. A DM/co-DM transfer or a player's character-to-character
transfer between two characters they own validates both containers and commits source debit, destination credit,
terminal `committed` transfer, audit, event, outbox, and receipt atomically. No intermediate recipient-resolvable
reservation exists. Other character-source commands remove the requested value into escrow before returning
`reserved`; acceptance writes that escrow to the destination, while rejection or lifecycle cancellation restores
the source exactly once. A player party-source command is allowed only when the destination is that player's own
character. It stores a server-derived metadata preview and normalized request as `proposed` but does not debit or
reserve the stash. DM/co-DM acceptance rechecks the live stack and atomically removes its current canonical
metadata and writes it to the character. The r11f GD-FIND-009 correction makes any same-stash
`proposed` requests made definitively insufficient by that debit become terminal `cancelled` with bounded
`payload.cancellationReason: "source_insufficient"` in the same transaction, with a targeted event and audit
per loser. The same check follows direct DM stash moves and stash-backed awards; still-affordable requests
remain proposed. No escrow exists for a proposed loser, so nothing is restored; a later attempt to approve
one returns `TRANSFER_NOT_FOUND`. A newly requested unfunded transfer still fails with
`TRANSFER_INSUFFICIENT` without committing a row. This correction is deployed in r11f.
Reusing an idempotency key with the same command replays its stored result rather than repeating either mutation.
Transfer mutation responses and their replay receipts use the same viewer projection as the transfer collection:
DM/co-DM viewers receive the full authority record, while non-DM viewers receive only owned character endpoint
IDs and their own actor attribution; party-inventory IDs and foreign actor attribution remain concealed. A
transfer's originating actor also receives `actorCommandId`, the opaque proposal idempotency key, on proposal
responses, receipt replays, and transfer-list reads. Other participants, including DM/co-DM viewers who did not
originate the command, never receive that correlation value. Transfer-list reads may also include
`sourceDisplaySnapshot` and `targetDisplaySnapshot` for character endpoints whose identity is visible to that
viewer under the current projection policy. Peer viewers receive the current projected identity name, including
an explicit replacement alias rather than the canonical name. Owners and DM/co-DM viewers may receive the
canonical name, but only while the endpoint is still active in the transfer's campaign. These labels are derived
at read time, are omitted when identity is hidden or the character has since detached or moved campaigns, and
never restore the concealed endpoint UUID.
Browser proposal and resolution retries freeze the original body, decision, rules pin, and idempotency key after
an outcome-uncertain network, invalid-response, or HTTP 5xx failure. That exact retry is allowed for at most 23
hours, staying inside PostgreSQL's 24-hour command-receipt lifetime. Once the browser window expires, it matches
the frozen command against an authorization-scoped transfer listing by `actorCommandId` before refreshing either
inventory. A matching pending transfer keeps the composer locked until it is explicitly cancelled or resolved;
only a confirmed missing or terminal command lets the composer close. If an acceptance
fails definitively because its rules pin is stale, the browser reconciles first and creates a complete new
decision request with a new key while preserving any already-created proposal under its original body and key.
If the proposal itself is rejected for a stale pin before creating a transfer, both the proposal body and key
rotate together. The browser never changes a pin beneath an existing key. Offline mutation queues and blind replay
across reloads remain out of scope. Any definitive proposal rejection also gates new Character Sheet transfer
drafts until both authoritative character and stash refreshes succeed; dismissing the failed draft does not clear
that gate or permit a direct method call to reuse cached eligibility. A stale-rules marker also survives draft
dismissal. Successful authority recovery must fetch and apply the active campaign context before clearing the
gate, so a dirty source-character save and the next proposal both use the same current rules pin.
An approval-bound acceptance or direct proposal into a character compares the resulting authoritative document
with its prior state and rejects a new disallowed/unknown item identity or stale rules pin before source,
destination, resolution, audit, event, outbox, or receipt changes. Approval-bound reserved escrow remains
available for an exact reject/cancel restoration. If the remaining same-ID source stack was edited after a
partial reservation, restoration merges only when the complete transferable metadata is still stack-equivalent.
Otherwise the escrowed original returns as a collision-free stack near its original index, preserving both
metadata identities and the conserved total quantity. Each reserved transfer also records the source container
revision at reservation time as private authority metadata. Lifecycle cancellation restores reservations from
the newest source revision to the oldest, so independently reserved whole stacks undo in deterministic LIFO
order and recover their original relative positions in both stores without exposing that revision to viewers.

The server derives item eligibility and stack compatibility from canonical data. A whole stack is refused
while equipped, attuned, container-linked, spell/component-linked (including a real `itemGrantedSpells[].itemId`
record), or otherwise referenced by Character Sheet state. Concentration records do not carry source-item
identity and are not treated as item links. A partial move is allowed only when every reference remains valid
against the source copy and the transferred wrapper carries no child/container linkage that would be duplicated. Such refusals
return `TRANSFER_ITEM_LINKED`. Destination stacks merge only when their complete transferable metadata matches;
custom names, source/edition, charges, durability, notes, material/variant/component state, and other mutable
fields therefore remain distinct when they differ.

An owned campaign-backed Character Sheet uses these routes directly: it fetches the party stash on open and
after reconnect or relevant transfer events, proposes character-to-stash and character-to-character moves,
lets a player request a stash item for the open character, and lets a DM/co-DM move stash items directly.
DM/co-DM moves and same-owner character moves receive a terminal server-committed proposal; player deposits,
peer transfers, and stash requests explain whose approval is pending. The Campaign Overview follows the same
direct-authority wording and treats `committed` proposal responses as complete. The browser never grants direct
authority or applies an inventory mutation to either document. Character updates are adopted through the HTTP
character repository's authoritative reconciliation queue. Local, signed-out, detached, and non-owner sheets do
not activate this integration.

The local B1 workspace reuses these reads and commands; it adds no route, capability, policy or event
audience. Searchable shared stacks, denomination balances and informational shared item weight are
read-only presentation. DM/co-DM entry points focus existing move/award/approval controls; player entry
points open owned Sheets. The incumbent workbench transfer composer remains available for compatibility.
Recent inventory activity includes only already-authorized transfer/item-grant events from the loaded
history window, not a new campaign-wide withdrawal log.

The local B2 Sheet composer keeps Deposit/Request/Pass intent explicit and supports items plus
CP/SP/EP/GP/PP or currency alone. Changing editable intent resets its contents; ordinary refresh retains
raw quantities and focus rather than silently choosing another recipient or clamping unavailable stock.
Confirmed outcomes and failed balance refresh are separate claims. These UI changes do not implement
[ADR 0021](adr/0021-opted-in-self-service-stash-withdrawals.md), change approval custody, or imply deployment.

## Campaign content routes

| Method/path | Authorization | Input | Result |
|---|---|---|---|
| `POST /api/campaigns/:campaignId/brew-versions` | DM/co-DM mutation | 1-100 brew documents | 201 immutable content-addressed version |
| `POST /api/campaigns/:campaignId/brew-versions/:versionId/activate` | DM/co-DM mutation | none | Campaign pointer + activation event |
| `POST /api/campaigns/:campaignId/rules-versions` | DM/co-DM mutation | typed rules object | 201 immutable rules version |
| `POST /api/campaigns/:campaignId/rules-versions/:versionId/activate` | DM/co-DM mutation | none | Campaign pointer + activation event |
| `GET /api/campaigns/:campaignId/rules-policy` | DM/co-DM; capability-gated | none | Closed catalog plus active immutable version and newest-first history |
| `POST /api/campaigns/:campaignId/rules-policy` | DM/co-DM mutation; capability-gated | `{policy, expectedActiveRulesVersionId}` | Atomically validates, creates, and activates one immutable schema-v2 version; 201 |
| `POST /api/campaigns/:campaignId/rules-policy/activate` | DM/co-DM mutation; capability-gated | `{rulesVersionId, expectedActiveRulesVersionId}` | Activates an existing immutable version as a rollback without rewriting it |

Schema-v2 policy publication rejects unknown/duplicate/unavailable rule ids, unsupported catalog/rule schema
versions or modes, malformed parameters/notes, invalid dependencies, and stale active-version bases. The command
is idempotent and commits the version, pointer, private audit, ordered metadata-only event/outbox row, and receipt
in one transaction. The campaign context keeps the legacy flat `rules` projection for old clients and adds only a
bounded `policySummary`; the full policy and authored notes are returned only on the DM/co-DM management path.

The new routes and management UI are off by default. Existing schema-v1 routes and versions remain readable
regardless of the capability. The catalog labels source/species/edition rules **Enforced**: Character Sheet
candidate surfaces filter them and authoritative campaign admissions/deltas recheck them under the active
rules-version pin. Other selected controls remain **Advisory** until their independent rules-enforcement slice
lands; DM Screen receives the projection but this content slice adds no DM Screen choice surface.

## DM workspace routes

| Method/path | Authorization | Input | Result |
|---|---|---|---|
| `GET /api/campaigns/:campaignId/dm-workspace` | DM/co-DM | none | Caller membership's private workspace, created lazily |
| `POST /api/campaigns/:campaignId/dm-workspace/:workspaceId/lease` | Owning DM/co-DM mutation | `{takeover?}` | Workspace lease |
| `PUT /api/campaigns/:campaignId/dm-workspace/:workspaceId` | Owning DM/co-DM mutation + held lease | baseRevision, leaseEpoch, state object | Updated private workspace |

Campaign role alone does not permit reading another DM's workspace.

## Error catalog

| Class | Stable codes |
|---|---|
| Authentication/security | `AUTH_REQUIRED`, `INVALID_ORIGIN`, `INVALID_CSRF`, `PROTOCOL_UPDATE_REQUIRED`, `ACCOUNT_UNAVAILABLE`, `ACCOUNT_DELETION_PENDING`, `FORBIDDEN` |
| Request/idempotency | `INVALID_REQUEST`, `INVALID_ID`, `INVALID_CAMPAIGN_NAME`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_RESULT_GONE`, `INVITE_TOKEN_RECOVERY_UNAVAILABLE`, `PAYLOAD_TOO_LARGE`, `REQUEST_REJECTED` |
| OAuth | `INVALID_OAUTH_STATE`, `INVITE_ADMISSION_REQUIRED`, `INVITE_ADMISSION_INVALID`, `INVITE_ADMISSION_UNAVAILABLE`, `AUTH_PROVIDER_UNAVAILABLE` |
| Not found/lifecycle | `ACCOUNT_NOT_FOUND`, `SESSION_NOT_FOUND`, `CAMPAIGN_NOT_FOUND`, `MEMBERSHIP_NOT_FOUND`, `CHARACTER_NOT_FOUND`, `WORKSPACE_NOT_FOUND`, `ACTION_NOT_FOUND`, `TRANSFER_NOT_FOUND`, `BREW_NOT_FOUND`, `RULES_NOT_FOUND`, `INVITE_INVALID`, `INVITE_NOT_FOUND`, `ACCOUNT_DELETION_NOT_PENDING` |
| Concurrency/lifecycle conflicts | `REVISION_CONFLICT`, `LEASE_HELD`, `LEASE_EXPIRED`, `LEASE_FENCED`, `CHARACTER_BUSY`, `CAMPAIGN_BUSY`, `MEMBERSHIP_OWNER_PROTECTED`, `ACCOUNT_OWNS_CAMPAIGN` |
| Character/cloud content | `CHARACTER_INVALID`, `CHARACTER_TOO_LARGE`, `CLOUD_DATA_INVALID`, `CLOUD_DATA_TOO_LARGE`, `CLOUD_DATA_TOO_DEEP`, `CLOUD_HTML_FORBIDDEN`, `CLOUD_URL_FORBIDDEN`, `CLOUD_KEY_FORBIDDEN` |
| Campaign content | `BREW_INVALID`, `BREW_TOO_LARGE`, `BREW_TOO_DEEP`, `BREW_BLOCKLIST_FORBIDDEN`, `BREW_RAW_HTML_FORBIDDEN`, `BREW_URL_FORBIDDEN`, `BREW_KEY_FORBIDDEN`, `BREW_DEPENDENCY_MISSING`, `RULES_INVALID`; generic `CLOUD_DATA_INVALID`, `CLOUD_DATA_TOO_LARGE`, or `CLOUD_DATA_TOO_DEEP` may surface from the shared JSON-safety pass |
| Campaign rule authority | `RULES_VERSION_STALE`, `POLICY_VERSION_STALE`, `RULES_SCHEMA_UNSUPPORTED`, `RULES_CATALOG_UNSUPPORTED`, `RULES_PROTOCOL_UNSUPPORTED`, `RULES_UNAVAILABLE` |
| Actions/transfers/awards | `ACTION_INVALID`, `OPERATION_FORBIDDEN`, `SOURCE_OR_TARGET_UNAVAILABLE`, `SOURCE_COST_UNSUPPORTED`, `PROPOSAL_STALE`, `RESOURCE_INSUFFICIENT`, `NUMERIC_INVALID`, `ITEM_AWARD_INVALID`, `ITEM_AWARD_SOURCE_NOT_FOUND`, `ITEM_AWARD_SOURCE_INVALID`, `TRANSFER_EMPTY`, `TRANSFER_INSUFFICIENT`, `TRANSFER_ITEM_LINKED`, `TRANSFER_TARGET_INVALID` |
| Availability | `DATABASE_UNAVAILABLE`, `INTERNAL_ERROR` |

Most validation/domain errors default to 400. Authorization uses 401/403, hidden/unavailable resources use
404, conflicts use 409, gone idempotency results use 410, size uses 413, protocol skew uses 426, readiness
uses 503.

## Rate limits

The rate-limit plugin is not global. Explicit route limits currently apply to OAuth start (10/min), OAuth
callback (20/min), campaign creation (10/min), invite creation (20/min), and invite redemption (20/min).
WebSockets enforce 20 inbound messages/second/connection separately. Phase 6 observability/load work must
validate whether additional per-route limits are needed before broader onboarding.

## Optional personal login routes

With `HUB_AUTH_MODE=local`, provider metadata advertises only `local`.
`GET /auth/local/start?returnTo=...` creates the existing browser-bound login
transaction and redirects to `GET /auth/local/login?state=...`, which renders a
no-store username/password form. `POST /auth/local/callback` accepts URL-encoded
`username`, `password`, and `state` (8 KiB body cap; password max 256 characters),
requires the exact app Origin and signed transaction cookie, and returns a 303
redirect with the normal secure session cookie on success. Invalid credentials
return the same 401 form for unknown, disabled, and incorrect-password users.
The form never reflects a submitted password.

`POST /api/account/reauthentication/local` uses the existing authenticated
Origin/CSRF/protocol checks and returns the password-form URL. Completion rotates
the same-account session through the existing transactional authority. The local
provider has no GET callback accepting credential-like query parameters and makes
no external OAuth requests. All normal `/api/session`, logout, membership and
campaign routes keep their contracts.
