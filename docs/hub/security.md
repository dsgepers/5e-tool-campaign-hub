# Campaign Hub security model

> **Status:** Implemented private-V1 controls; managed deployment review pending
> **Last updated:** 2026-10-12
> **Owner:** Campaign Hub maintainers

## Trust boundaries

- Browsers and all client-supplied JSON are untrusted.
- The same-origin BFF authenticates the httpOnly session cookie and authorizes every HTTP/WebSocket action.
- PostgreSQL is canonical; client snapshots never overwrite state without revision and fencing checks.
- Campaign homebrew is DM-authored but still untrusted content.

The optional [personal Cloudflare Tunnel](cloudflare-tunnel.md) keeps these boundaries:
only the fixed connector IP can reach the tunnel origin's proxy handlers, and only
that peer's `CF-Connecting-IP` is trusted. Caddy replaces `X-Forwarded-For` before
the BFF's existing exact-Caddy-address trust check. The overlay publishes no host
ports and derives the exact HTTPS application origin from its public hostname.
The tunnel token stays in the connector environment; no backend/browser credential
or campaign authority change is introduced.

### Owner Roll History

The protocol-5 `character.roll_history.v1` read requires current active membership/account and ownership
of the campaign-bound character. Peer visibility and DM inspection do not grant access. Existing event
audiences still apply, and DM-authored rolls about another owner's character are excluded. Filtering happens
before the bounded latest-200 selection; the query never scans forward campaign replay to infer absence.
Only the actor sees new-event command correlation, and selected detail fields are bounded in the
PostgreSQL projection before transmission to the application. Recovery is scoped to account, campaign,
and character; access loss conceals history, clears scoped recovery, and fences delayed responses.
No history read writes a document, lease, receipt, audit, event, or outbox row. Statement/lock budget
exhaustion is an explicit 503, not hidden missing history. This capability is deployed in r11f at
`4578c8671a7b05066fb9a19411cb8a31cdd753ef`; publication/deployment evidence is recorded in
[the testing guide](testing.md#r11f-publication-and-deployment-evidence), separately from physical acceptance.

## Controls implemented

- OAuth authorization uses a validated concrete-route provider registry, PKCE according to adapter capability,
  signed browser correlation, hash-only expiring state, atomic one-time transaction consumption, exact redirect
  binding, invite-gated first-account admission, and same-origin return paths.
- Existing identities sign in by immutable `(provider, subject)`. Unknown identities are not admitted by provider
  subject: they require ADR 0018's valid five-minute campaign-invite context and the default-off new-account
  admission switch.
- The raw invite is sent once in a same-origin POST body. A random server-side context is bound to one provider,
  OAuth transaction, transaction-specific signed correlation cookie, redirect, and state. It never enters `returnTo`, OAuth
  state, cookies, referrers, logs, or browser history.
- Each concurrent start has its own cookie name and state-selected transaction, so two empty-jar starts survive
  the browser's final merged cookie jar. Failed, cancelled, or abandoned navigation may rotate a separate
  hash-only opaque retry handle into a new same-provider context only when the old transaction cookie is present;
  the original context is never rebound.
- Authentication authority is `(provider, immutable subject)`. Email and mutable profile fields are discarded
  before store lookup and cannot link, admit, merge, or select an account.
- Authorization codes and provider access/refresh tokens are never persisted. The callback-local access token is
  discarded after identity lookup; consumed state, PKCE verifier, and nonce values are cleared immediately.
- Provider HTTP uses fixed HTTPS endpoints, rejects redirects, times out after five seconds, and caps decoded
  token/profile JSON at 32 KiB and Google JWKS at 64 KiB. Google accepts only RS256 tokens with either official
  issuer, `accounts.google.com` or `https://accounts.google.com`, for the configured audience, with bounded
  `exp`/`iat`, exact nonce, and opaque `sub`; Discord retains its decimal snowflake as text.
- A failed or misconfigured adapter exposes only bounded provider status/error codes and cannot disable a healthy
  sibling. No upstream body, token, profile, subject, or credential is logged or returned.
- Sessions use random tokens stored only as SHA-256 hashes; successful reauthentication revokes the prior
  browser session. New sessions record same-account external-identity provenance without changing campaign
  authorization.
- Reauthentication starts only as an authenticated exact-Origin/CSRF/current-protocol mutation. Its OAuth
  transaction is bound to the current account, current session, operation, and concrete provider. The callback
  accepts only an identity already linked to that account, rotates the session, closes the old socket, records
  the exact identity provenance, and timestamps freshness at commit.
- The browser's reauthentication success marker is presentation-only. A provider-link retry hint is accepted
  only from short-lived same-origin `sessionStorage`, then revalidated against current available provider
  metadata and the caller's current linked identities; a crafted callback query cannot initiate linking.
- Memory and PostgreSQL revalidate transaction expiry, initiating session, account status, provider, and
  identity/account binding after awaited work and immediately before rotation. Account deletion/cancellation
  uses the same commit-time freshness rule even while creator-entitlement enforcement is disabled.
- Deletion-pending sessions may start only the reauthentication flow needed for export/cancellation. Successful
  deletion request revokes the current session, so the browser returns to sign-in rather than leaving unusable
  account controls visible.
- Account identity linking is default-off behind `account.identity_linking.v1`. Link intent creation requires
  exact Origin, CSRF, current protocol, idempotency, an active account, and commit-time fresh reauthentication.
  A link callback cannot call invite admission or create an account; cross-account ownership returns only
  `IDENTITY_ALREADY_LINKED`.
- Unlinking requires commit-time fresh reauthentication through a different linked identity, preserves at least
  one identity and one configured retention-provider identity, rotates the current session, revokes every prior
  account session and lease in the same transaction, and closes their sockets after commit. Identity audits
  contain only provider slug plus opaque Hub identity id.
- The replacement credential for link/unlink is deterministic under the server cookie secret and exact command
  identity, but is never stored or returned outside the secure session cookie. A bounded consumed-link receipt
  or exact revoked-session/idempotency/CSRF proof can recover a lost success response without rerunning the
  mutation; ordinary revoked sessions cannot use this path.
- `campaign:create` and `platform:operate` are internal-account entitlements. Provider subject, email, handle,
  login, display name, and campaign membership role are never creator/operator authority. Sensitive store
  transactions recheck the <=5 minute freshness window and last-operator invariant under locks.
- Invite tokens are cryptographically pseudorandom under an independent versioned key ring. Derivation is bound
  to actor, campaign, idempotency key, and normalized request hash. The invite table and command receipt store no
  raw token. Exact replay tries the current key then at most three retained prior keys and returns a token only
  when its hash matches the stored invite hash; otherwise it fails closed. Invite-context and OAuth transaction
  row data are excluded from backups.
- First access commits account, identity, session, membership, invite use, account/invite audit, membership event,
  and outbox atomically. Provider failure, cancellation, expiry, revocation, exhaustion, replay, a lost max-use
  race, or session-write failure commits none of them.
- Mutations require exact Origin, CSRF HMAC, protocol version, payload schema, role permission, and
  idempotency key. Reads whose response is an authorization envelope also require the protocol version, so an
  older client is told to update rather than silently misreading a newer shape.
- Operator routes are hidden from non-operators with route-equivalent 404 responses. Entitlement changes are
  account-audit-only and never emit campaign domain events or outbox rows. Exact idempotent replays and already
  active/revoked no-ops do not duplicate audit.
- Character reads cross the trust boundary through one server-owned projector
  ([ADR 0011](adr/0011-authorization-scoped-character-projections.md)). Peer values are derived into a typed,
  closed catalog rather than copied from the document, so a new document field cannot become shared by
  accident. A policy that fails validation fails closed and is indistinguishable from `private`; the server
  never falls back to a more permissive preset.
- Projection invalidation events are metadata-only. The durable event, outbox, live fanout, replay and resync
  paths carry no character field, patch, path, amount, field name, display text or name snapshot; logging and
  metrics record projection kind, revisions and failure code only.
- No shared (`all_members`) event payload carries a canonical character name or an owner association. A durable
  event cannot be rewritten, so a name captured in one would survive an owner later choosing a narrower policy;
  shared activity derives its labels from the current peer-visible projection instead. Name snapshots remain on
  targeted events, whose audience is already authorized for that character.
- Spell-use activity is explicit, never inferred from character patches. Its closed payload contains only the
  bounded spell name/source, spell and slot levels, and a cast-mode enum; it excludes spell text, targets,
  component selections, slot totals, resource names/values, document paths, and arbitrary JSON.
- Character recovery never blindly replays that one-shot activity after the server's idempotency evidence may
  have expired. The browser persists an immutable 23-hour activity deadline with the exact command; expiry or
  missing deadline proof quarantines the complete queue behind export/use-server resolution. Canonical document
  equality never suppresses activity after revision conflict because the server checks receipts before revision.
- A poisoned PATCH for a character the server confirms no longer exists cannot silently retain or resurrect its
  private local live state. Resolution exports the complete queue first, then conceals the inaccessible character
  under a fresh local identity and clears recovery/reconciliation state; owner-scoped `clientImportId` matching
  and replacement CREATE remain create-only.
- Targeting is authorized on the server, not filtered in the browser. Semantic peers use random target
  references exposed only by an identity-visible profile. Hidden/missing/stale source, target, or eligibility
  fails as `SOURCE_OR_TARGET_UNAVAILABLE` at creation and `PROPOSAL_STALE` at apply, without identifying the
  failed predicate. Transfer targeting retains its non-enumerating not-found behavior.
- Generic semantic `kind`/`arguments` are privileged to DM/co-DM/internal authority. Player effects must resolve
  through a closed server template and explicit target-owner approval, including self-targeting. Protocol-4
  Cure Wounds binds one standard spell slot; the private seed, source-cost binding, resource ids/values, true
  target state, and failed eligibility predicate never enter target/peer projections. Source costs fail closed
  before persistence and are revalidated inside atomic acceptance. Version-1 item and feature adapters require
  one exact stable entry/resource id, canonical content identity plus campaign-brew provenance when applicable,
  and unambiguous persisted mirror linkage; display names alone never authorize a spend. Full quantity removal
  is refused when any wrapper or document linkage makes deletion unsafe.
- Semantic creation/resolution revalidates the authenticated session, active account/campaign/membership/role,
  source/target truth, template policy, and approval authority inside one transaction. Stable command ids are
  actor/body bound, and no unsupported/stale operation can partially mutate character/event/outbox state.
- [ADR 0020](adr/0020-consented-multi-target-operations.md) is the implemented default-off protocol-6 server
  boundary capped at eight fixed targets. It assigns each target leg a unique opaque invitation id,
  records one terminal response per leg,
  exposes each target owner only their request, gives the source only policy-authorized labels and coarse status,
  and gives unrelated users no private workflow data. Finalization accepts only an approved current subset and
  rechecks source, cost, policy, membership, target authorization, targetability, and applicability under one
  stable source-plus-N lock order. No cost is reserved while consent is collected; a selected batch commits one
  cost and every leg or none. A reviewed healing template may mark a full-HP selected leg applied/no-change while
  consuming the single cost; source-visible responses/events/timing cannot identify which target was full.
  DM/co-DM receive bounded workflow projections intentionally for support, abuse moderation, lifecycle diagnosis,
  and audit, but target-owner views never expose a co-target identity or decision. Migration 0010 is reserved for
  A2 source-cost binding identity; migration 0011 and protocol 6 are required before multi-target
  capability enablement, and every protocol 3/4/5 create/respond/finalize/cancel/read/
  WebSocket/resync/replay surface fails closed. Transactional source/account/campaign/target-owner caps plus
  route-level 429 throttles and oldest-pending cursor pagination bound abuse without revealing private target
  state. Wave A3 deliberately ships no production template or full Character Sheet multi-target UI.
  Source-visible target-applied projections also replace the character aggregate id/revision envelope with the
  semantic operation id and null revision, so a null no-op revision cannot be distinguished from a changed
  target or used to recover canonical target identity.
- Multi-target recovery exposes an existing opaque target ref only to the currently authorized pinned owner of
  that exact leg, for equality against fresh owner truth. Source, DM-only, co-target, and unrelated projections
  do not receive it. Current sharing/lifecycle truth re-shapes proposal labels and replay; immutable snapshots
  never restore a hidden canonical name. Inbox/outgoing membership reads are transactionally fenced against
  concurrent access loss.
- Exact command replay is reauthorized against current operation participation or current DM/co-DM authority and
  reprojects the stored historical command outcome through the current audience/privacy mask without changing
  the receipt, command, event, or leg identities. Later workflow commands never replace the original outcome.
  Withdrawn authority receives not-found rather than a stale privileged response.
- PostgreSQL participant reads and replay projection acquire the seed-6 campaign advisory lock in shared mode
  before current membership and ascending character shares. Workflow/lifecycle writers use the exclusive form;
  privacy writes do not need it to append their campaign event. Readers hold no campaign row lock. This both
  linearizes parent/targets/finalization detail and breaks the character-policy/detail/member-removal lock cycle
  without catching or retrying deadlocks as success.
- Multi-target retries use the seed-9 command advisory without taking the semantic-command row lock before
  campaign authority. Account purge and bounded terminal-history cleanup take the seed-6 campaign advisory
  exclusively before deleting command or aggregate rows. This prevents command-row/campaign-advisory inversion
  and makes detail versus retention deletion linearize to a complete aggregate or not-found.
- Multi-target proposal caps which cross campaign tenants for the same account use a dedicated seed-10 quota
  advisory-lock namespace. Proposal creation locks the source account and all distinct target-owner accounts in
  ascending UUID order before campaign authority, so two campaigns cannot race past the global
  5-live/source-account or 20-pending/target-owner caps and opposite owner discovery cannot deadlock.
- WebSocket upgrades require same origin, session, active membership, and protocol version.
- Event visibility is enforced server-side (`all_members`, `dm_only`, `actor_and_dm`,
  `explicit_accounts`) before replay or broadcast.
- Campaign-owned semantic event linkage uses campaign-scoped foreign keys; historical operation references
  tolerate later character movement while creation/apply revalidate same-campaign truth.
- Character Sheet realtime subscribes only after signed-session campaign activation and canonical character
  load, then filters again by campaign and target character. It strips actor/visibility envelope fields from
  semantic callback values and never logs, persists, or caches lifecycle payloads.
- Socket and subscription generations are both fenced. Access-loss code 1008, character/campaign changes,
  detach, logout, remote archive/move, and non-persisted page hide invalidate queued callbacks before
  they can reach a reopened sheet. BFCache suspension resumes only the same in-memory client generation.
- XP/item recipient notices are derived only after server-side event authorization, deduplicated by event id,
  and reduced again to bounded display fields. Toasts receive text-only DOM content. XP reconciliation refetches
  owner truth; item reconciliation remains on the established inventory path.
- Projection invalidation remains metadata-only on the owner sheet: this layer performs no projection fetch,
  document replacement, operation application, save, render, or generic conflict fallback.
- Character and DM-workspace writes require aggregate revision plus a monotonic lease epoch.
- Inventory transfers reserve source value into escrow and lock source/target in deterministic order.
- Campaign archive refuses unresolved escrow and detaches characters without deleting player ownership.
- API/auth responses are `no-store` and include nosniff, frame denial, same-origin referrer, and restrictive
  permissions-policy headers.
- Database connections and queries have bounded timeouts; idle pool errors are handled.
- Structured request logs strip query strings and redact auth/cookie/CSRF/idempotency fields.
- Structured redaction also covers invite token/context field names. Auth request bodies are never logged.
- Metrics require an independent bearer token and expose aggregate bounded labels only.
- Backup archives are authenticated AES-256-GCM ciphertext; keys are separate from archives.
- Provider client identity is fail-closed: only `do-connecting-ip` can be enabled, it cannot be combined with
  `HUB_TRUST_PROXY`, and only one syntactically valid IP is accepted. The same resolved address keys logs,
  HTTP rate limits, and WebSocket context; IPv6 rate-limit keys retain the plugin's `/64` normalization. Under
  ADR 0010 this adapter stays **disabled**: Caddy is the only ingress, so `HUB_TRUST_PROXY` names its fixed
  private address and `X-Forwarded-For` is trusted from that hop alone. It is re-enabled only if a managed
  provider that injects its own header is adopted.

## Content restrictions

Campaign brew is limited to 1 MB and 100 documents. Uploads reject persistent blocklists, unresolved
dependencies, excessive nesting, `wrappedHtml`, dangerous element strings, and event-handler attributes.
The bundle is canonicalized and content-addressed before persistence.

Character documents are limited to 1.5 MB. Existing Character Sheet feature descriptions may contain
renderer-generated HTML, so the authority sanitizes every character mutation with a fixed tag/attribute
allowlist. Scripts, images, inline styles, event handlers, unsafe URL schemes, and unknown elements are
removed or escaped before the canonical document is stored.

This is deliberately stricter than personal/local homebrew. Relaxing it requires a centralized sanitizer or
sandboxed renderer, malicious fixture corpus, and another security review.

## Accepted V1 limitations

- Client-declared rolls are cooperative evidence, not cryptographically authoritative.
- Private V1 has no public moderation/reporting/billing system.
- Direct database access is restricted to the BFF role; browser database SDKs are not used.
- A formal public-service privacy/ToS review remains a gate before semi-public onboarding.
- Core renderer behavior prevents a strict no-inline-script CSP from being the primary content boundary.
- Oracle uses portable encrypted backups rather than provider-native PITR. Scheduled operations, off-machine
  backup, isolated restore, and exact-release rollback evidence remain the V1 host-operations gate.
- Exactly one BFF replica is supported; private V1 accepts application restart/deploy downtime until shared
  realtime fanout exists.

## Explicit personal file-backed authentication

[ADR 0022](adr/0022-personal-file-login.md) permits an opt-in personal deployment
using `HUB_AUTH_MODE=local`. Its private file allowlist supplies pre-provisioned
`local` identities rather than opening public registration. Passwords use bounded
scrypt with random salts; only hashes are stored in the server-only file. Login
requires exact Origin and a signed-cookie-bound one-use login transaction, applies
per-IP rate limits, and uses the same PostgreSQL session completion/rotation and
campaign authorization as OAuth. The POST body must not be logged. The password
file is excluded from images and mounted read-only into the BFF. Recreate the BFF
after changes; removed/disabled identities cannot continue using saved sessions.
OAuth identity linking is unavailable in this mode. See [setup](local-login.md).
