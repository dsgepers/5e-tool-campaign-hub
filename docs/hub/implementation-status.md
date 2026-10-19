# Campaign Hub implementation status

> **Last updated:** 2026-10-17
> **Owner:** Campaign Hub maintainers

## Status

The personal full-Hub tunnel topology also has a standalone Portainer Compose file
(`compose.hub.portainer.yml`). It builds app images from public Git and uses explicitly named
volumes, with a network-isolated initializer supplying Caddy/PostgreSQL configuration.
No host paths or project directory are required. It selects OAuth with provider linking.
Fresh PostgreSQL initialization, config rendering and retained data after recreation
are locally validated. The complete standalone stack was also started locally with
rebuilt images and the real environment on 2026-10-19; public HTTPS page/API checks
passed through Cloudflare after correcting its route. Browser OAuth completion
remains unverified. A separate real Portainer API deployment with absent
image tags and isolated synthetic resources verified automatic Git builds and healthy
page/API startup; see [build evidence](testing.md#automatic-portainer-git-build-validation).
See also [earlier live-ingress evidence](testing.md#managed-volume-portainer-validation)
and [setup](portainer.md). This does not promote the managed Oracle baseline.

The optional [Cloudflare Tunnel overlay](cloudflare-tunnel.md) is implemented for
personal full-Hub hosting. It adds a connector, an internal Caddy origin, exact
connector-IP trust and public-origin configuration, with no schema/application
changes. Standalone local startup and live Cloudflare ingress evidence is recorded
above; isolated overlay validation remains a separate check.

Personal installations can now opt into [file-based username/password login](local-login.md)
using the local Compose override. This working-tree change preserves PostgreSQL campaign/session
authority and the default OAuth setup, adds no migration, and has not been deployed. File-listed
accounts, password reauthentication, disabled-user session rejection and campaign isolation have
automated coverage; local PostgreSQL and browser checks are recorded in [testing](testing.md#personal-file-login-validation).

Wave A0-A6 implementation, independent review, chosen-branch integration and publication completed at
`4d9a722075e74a5f48ac1500f4f1cb756ad4bf21`. All four exact-source jobs passed in
[CI run 38420205764](https://github.com/TrueMichato/ThelemarTools/actions/runs/38420205764).
The historical browser report is 57 first-attempt passes and one Cure Wounds retry pass, not 58 clean
first attempts. A controlled local regression reproduces the same missing-picker failure when actual
campaign-context installation is held; the follow-up page object waits for the existing installed-context,
recovery and event-sequence barrier before casting. It changes no product authority fence.

The sharing follow-up composes draft #289's outer disclosure with r11f's nested controls,
preserving drafts, focus, both entry paths and saved peer projections. Combined independent review passed;
the follow-up was published as `339ddf24c39317312a6ae8eb91408ae7f942cf0d`. It is not deployed and does not
change #289's PR state. The commit also bounds completed hook Jest runs with `--forceExit`, preserving test
selection and failing exit statuses after an observed open-handle pre-commit hang.
Wave B's B0 shared transfer wording and truthful terminal-outcome/failed-refresh recovery are published.
B1/B2 is locally committed at `281b505b48a5405092cec26d823e31fad80c8de7` and adds a role-adaptive Hub workspace and one owned-Sheet composer over the existing
ledger and approval rules. Independent correctness review and complete local qualification are finished,
including controlled acknowledgement/revalidation recovery. It has not been
published or deployed. B3 atomic award/stash extensions, ADR 0021 self-service authority and broader
B4 completion remain pending. Wave D remains unstarted.
B0 was published as `32e876239`; its four-job CI passed with 57 first-attempt browser passes and one Lay on
Hands acquisition retry, not 58 clean first attempts. The retained failure led to a separately reproduced
focused-name draft-loss bug: a late render erased the edit before blur could save. Source fix `54cc1fa37`
preserves that exact character/load-scoped draft; its real acquisition regression and complete local stack
pass without retry. Exact-published-head verification remains separate from this local evidence.
New gameplay is not deployed or enabled: A7 must separately qualify
migrations 0010-0014, the index-build window, rollback, exact release and campaign enrollment.

B1/B2 qualification was against the uncommitted delta on
`25df6289ce2d08d090bfa5f664755202af6dd636`, not a new release SHA. The independently reviewed 15-file
code/test/style manifest is `b44e22fa0a206fbf7ac9625b020c8a855e231464718e3b962cd95d02dad96be6`.
The final canonical stack passed its 372-check runtime-role phase and all 75 browser tests without retries;
full Hub and affected Sheet seam evidence is recorded in [testing](testing.md#b1b2-local-qualification--2026-10-15).
Earlier failed samples remain separate, and this is not remote CI or physical acceptance.
The subsequent normal local commit preserves all 26 candidate files byte-for-byte and excludes the
16 unrelated modified/untracked files. Its normal hooks passed; publication remains separately gated.

### M14 first-delivery source and qualification — 2026-10-17

The decision owner selected the protocol-6/schema-0014 application plus A7/E release-engine work as the
first delivery. The local chain is D `4578c8671a7b05066fb9a19411cb8a31cdd753ef` -> E base
`4172b926e66764542e9017b96c7a292e0f94b59e` -> E test follow-up
`055a285ea9cc576dab8ff4b0aac4a3a5d3736d41` -> E test-only correction
`aef1090ea871eb46cdf550db3944ca5305c07fce` (parent `055a285`, one release-automation test);
A7 component `035e838ad28455d5d70b8ee06989edc65709913b` -> M merge
`b9fea164a75952c6b4d196a142f312c9b2f519ca` (ordered parents A7, E base) -> test repair
`a35af555a1d1cd25e2ba9d2d98b11677ca5917c3` -> records commit
`b835e9c8cbc4a5c5439bb44a35afdfa105561467` -> integrated M
`fbc91bbe33d00b9af48644cac9eb3e5e2bd663d4` -> docs commit
`6d8c71070f4fb16a9955d3013a7fa8471029920c` -> selected B source
`2c03c17a26fcecf5f1f53abbefef471741b938b0` (ordered parents `6d8c710`, `aef1090`). M remains
protocol 6 with required migration 0014; the approved docs refresh will be a separate M descendant.

E's exact-source CI run `39053045735`, at published E `055a285`, failed source scanning on the synthetic
`HUB_COOKIE_SECRET` canary alias in the release-automation test, not a live credential. Affected
regressions and migration/roles passed; the dependent stack job was skipped, with missing-files artifact
upload secondary. A separate later local M scan flagged an environment-derived missing-database URL
and two password-free fake-`psql` URL fixtures in M-only tests; the fake `psql` does not connect.
Those local M findings were not the E CI failure. Both failed samples remain recorded separately.
The E test-only correction `aef1090` passed local ESLint, full-source secret scan (3,435 text and 101
binary inputs), four suites/83 tests, and its normal one-suite/64-test hook. Earlier E full-Hub and
affected-selector runs were on E base plus four follow-up working changes later committed as `055a285`;
they were not rerun after that commit or `aef1090`.

The selected M source `2c03c17a` adds only the Auto, recovery-compatibility PostgreSQL, and recovery-
evidence test files to its first parent. Its local three-file ESLint and full-source secret scan passed;
the eight-suite gate passed 116 tests with one PostgreSQL test skipped, including the pure URL fixture
regression. The normal commit hook passed three related suites/69 tests with one skipped. No real
PostgreSQL proof or fresh full-Hub run was obtained for `2c03c17a`; earlier M full-Hub and affected-
selector results belong to prior candidates. Corrected E publication and serial new CI are approved but
not yet executed. Earlier E `055a285` and M `6d8c710` sources are published; the corrected heads
`aef1090` and `2c03c17a` remain local, without qualified release images or deployment. See the
[testing guide](testing.md#m14-non-image-local-qualification--2026-10-17).

The decision owner superseded the earlier B selection `a35af555a1d1cd25e2ba9d2d98b11677ca5917c3`
and selected `2c03c17a26fcecf5f1f53abbefef471741b938b0` as B source. It represents the intended M
gameplay, not a gameplay-regression hedge; the source remains unqualified and is not a binary, release
candidate, or rollback fallback. Static labels, exact-B authorization, Linux entry path, complete
recovery matrix, SQL/ACK, scheduled-job compatibility, and next-release path remain open. Separate
Q source-only work covers seven paths and remains under review; Q has no accepted implementation,
executable qualification, evidence export, or accepted full configuration mapping. An isolated-fixture
profile cannot qualify a different intended deployment's exact five-field configuration merely through
an identifier mapping. No Q, E or B production change is implied.

Local evidence does not refresh the last recorded r11f/protocol-5/schema-9 live observation, dated
2026-10-15; no fresh host check was made and newer evidence may exist. As of 2026-10-17, prior
off-machine backup/RPO and restore evidence exceeded the 24-hour and 35-day freshness thresholds.
M images, exact-source remote CI, real PostgreSQL/roles/SQL-ACK, migration-0014 index window, complete
B-aware recovery/static-image-label driver, fresh backup/restore, provider, operator, immutable-tag,
publication and enablement gates remain open. Keep promotion preconditions separate from post-deployment
campaign enablement and hands-on provider/participant/device acceptance. The V1 private-launch verdict
and existing game-day findings/dependencies remain NO-GO/open; other approved later work is not cancelled.

The reviewed **A4 workflow** extends the existing shared Character Sheet source-targeting and incoming-effects
controllers with fixed-set multi-target collection, independent per-character consent, deselectable source-owned
candidates, and one atomic selected-subset finalization. It consumes reviewed A3 protocol-6 DTOs without authority,
migration, or protocol changes. Exact retries acknowledge original command receipts; fresh detail/outgoing/owner
recovery establishes current workflow state. Exact opaque owned identity gates consent and canonical current
character identity gates queued adoption. All-track reconciliation includes distinct target/combined legs and
durable bounded revisionless no-op coverage. Authorization/projection invalidation conceals controls and closes
pickers before queued work completes. The bounded A4 review remediation also advances a synchronous authority epoch:
old queued HTTP/realtime/resync/canonical work cannot adopt, commit coverage or publish a success notice. Unapplied
exact evidence and canonical projection demand wait for fresh authorized context; staged durable commands/no-op
coverage roll back together if authority changes during adoption. An interrupted canonical read keeps its
unfinished scheduling demand, coalesces newer invalidations, and automatically retries with fresh authority
tokens after context recovery. Terminal teardown or character/account/campaign/access-scope changes discard
that demand; suspended drains do not spin. A shared installed-context barrier also prevents fresh-generation reconnect retries,
HTTP/WebSocket/resync delivery and recovery-storage reads from proceeding while authorization is pending.
Ordinary transport loss retains exact recovery evidence; terminal teardown remains destructive to scoped
coverage and demand. A fenced receipt retained after context installation also schedules existing semantic
recovery automatically in the same recoverable scope; pending evidence and its save block must clear before
the next save. Canonical catch-up waits behind that recovery, and scheduled scopes coalesce without letting
an old task suppress new authorized work. The exact A4 boundary independently passed review at
`82984bcf1c4a12850cc5a5317446e4e5a6c43980`; its retained worktree is preserved. It is integrated and published,
not deployed or enabled product.

The reviewed **A5 workflow** adds PHB/XPHB Healing Word (one target, explicit singular consent) and Mass Healing
Word (one to six fixed candidates, independent consent and one selected-subset finalization). One selected
standard slot pays for one deterministic healing roll, shared by all selected MHW legs. Exact PHB/XPHB
base/upcast rules are static source-qualified definitions; neither browser nor server interprets arbitrary prose.
The user authorized a narrow table-adjudicated boundary: 60-foot range/distance, actual caster sight,
bonus-action/verbal eligibility, and PHB undead/construct applicability are **not server-enforced**. Source picker,
source status and target approval explain that sharing/consent do not establish game-rule eligibility. Identity,
source edition, known/prepared availability, one slot, target count, current membership/privacy/consent, retries
and atomic typed effects remain server-enforced. The separately authorized A5-only convention floors healing
after the casting modifier at the minimum of the selected dice expression (2d4: 2 HP; 4d4: 4 HP). It is not an
authored RAW minimum or a global spell rule; Cure Wounds and the positive-only `hp.heal` contract are unchanged.
The shared workflow discloses that convention. MHW retains revisionless full-HP no-op privacy.

The production multi-spell resolver now selects only these reviewed-data MHW shapes, behind the unchanged
default-off exact-campaign capability. Cure Wounds manual self-consent/local behavior and the reviewed A4
adoption/recovery seam are unchanged. Disposable A4 fixtures still extend, never replace, the production registry.
The third template is the authorized **XPHB Lay on Hands heal-only** singular `feature_use` flow. Ordinary
acquisition/lifecycle binds one exact source-qualified feature to one unique persisted resource, keeps current/max
mirrors and the canonical five-points-per-Paladin-level pool synchronized, and preserves spent points as the
maximum grows or shrinks. Ambiguous, malformed, innate or contradictory bindings remain unsupported with
diagnostics; no synthetic resource or display-name fallback is introduced.
Independent A5 review found spell UID/brew provenance, name-only legacy resource acquisition,
and the singular HTTP ten-point ceiling counterexamples. The bounded remediation enforces exact stored
spell identity/provenance at proposal and final rederivation, explicit resource ownership/provenance with
unrelated PHB-pool preservation, and the existing singular amount schema bound of 100 with strict affordability.
The retained reviewer closed these fixes at `afff1ef666f67e50279d5a5e1c4f696451cfed6f`; prior green gates alone
did not establish their authority.
Touch/bonus-action eligibility is table-adjudicated; poison/disease removal and other resource exceptions remain excluded. Singular HW/LoH no-effect
acceptance privately fails without spending or changing either canonical document/revision; only MHW opts into
applied/revisionless target no-ops. A5 and the A6 composition review are complete and published.
Deployment, enrollment, enablement and live migration approvals remain separate.

The last independently verified private invite-only release is `hub-staging-2026-10-12-r11f` at
`4578c8671a7b05066fb9a19411cb8a31cdd753ef` on the reused, Hub-only Oracle Always Free ARM
instance. Foundry was intentionally decommissioned and is not a release prerequisite. The same-origin HTTPS,
PostgreSQL, static site, BFF, API, WebSocket, and served service-worker checks passed r11f post-release
verification. Phase 6G deployment and V1-G1 host-operations evidence are complete. The 2026-09-28 r10
physical rerun returned **NO-GO** for a P1 Character Sheet context divergence and disabled player targeting;
r11b fixed the route identity but its physical return advanced the canonical revision without an edit. R11c
stopped safely on a false campaign-effect history save block on Open Local; no canonical write occurred.
R11d deployed the coverage correction, but its first physical Campaign -> Local leg acquired a lease and
persisted a derived-modifier repair, advancing the canonical revision from 23 to 24 without an edit.
R11e deployed late-modifier identity and JSON-wire normalization; physical Campaign -> Local -> Return and
Back/Forward reload had zero server-side writes/leases and stable revision. BFCache restoration remains
unobserved; a fresh-tab no-lease check exceeded its window, with the gap accepted to continue testing.
An approved same-tag r11e redeploy enabled only Campaign A's narrow Cure Wounds targeting canary;
independent rollout, health, and release-time off-machine backup checks passed. Separate real-profile
participant reports cover XPHB reject/cancel/accept, PHB accept, self-target accept, and picker privacy;
natural expiry was automated-only and no character/operation database payload was inspected.
The private-launch verdict is still NO-GO. See the
[prioritized backlog and re-entry plan](game-day-backlog.md). Semi-public onboarding remains disabled.

The **deployed r11f correction bundle** combines GD-FIND-003/006/007/009
with GD-FIND-013: owner-only latest-200 Roll History over existing events, live cross-device/reload
convergence, exact attempted-command recovery, and explicit offline/unconfirmed states. It adds
`character.roll_history.v1` without changing protocol 5 or migrations `0001`-`0009`. The migration-free
query has explicit 5s statement/2s lock budgets; sparse finite load evidence does not prove unbounded
growth. Exact-source review/CI, immutable tagging, approved dry run, human-confirmed promotion and
independent runtime/static/off-machine backup verification are complete; physical retest is waived.
Draft sharing #289 and held Wave A are excluded.
Independent correction review found and cleared a Roll History authorization fence: co-DM demotion
conceals formerly authorized DM-only rows before refetch and rejects delayed old-role reads while
preserving attempted commands. Verification also exposed a baseline Hub-index Delete-account startup
race. The subsequent local correction keeps account actions disabled until their handlers are ready,
settles account rendering before enabling them, and preserves deletion-callback focus. Permanent
slow-read and service-error browser probes cover the fix; see
[candidate validation evidence](testing.md#source-candidate-validation-residual).
The decision owner requested r11f and waived another physical game-day retest for that release.
The initial correction bundle was published as `661b138ea91c3ad4e99b73439a6bac7eaca554b8`;
the complete follow-up is `4578c8671a7b05066fb9a19411cb8a31cdd753ef`, with all four jobs green
in exact-source CI `38223244640`.
The r11f follow-up additionally corrects GD-FIND-004/005: explicit-local Create/Open/Import choices
separate from cloud copy, and nested basic/advanced/field/preview sharing disclosures retaining drafts,
open states and focus across parent rerender. Both Sheet entry paths preserve saved policy and peer
projection until explicit Save. R11f promotion completed at 2026-10-12T10:53:06Z; the annotated tag,
actual BFF revision and pinned images match the reviewed source, all 14 changed served browser assets
match Git/container/public hashes, and the prerelease encrypted archive matches the trusted second machine.
Existing configuration and Campaign A-only targeting remain unchanged;
design requests002/008/010/011, draft #289 and held Wave A remain outside the bundle.
This is not private-launch GO.

Phase 6A documentation/handoff, the reviewed checkpoint series, Phase 6B lifecycle administration, Phase 6C
migration management, Phase 6D portable deployment, Phase 6E operations, Phase 6F CI/real-stack integration,
and Phase 6G Oracle deployment are complete.

The original 59 planned implementation todos in the coordinating program are complete. That historical
closeout does not silently close the physical findings. R11f correction delivery is complete under the
physical-retest waiver; an explicit private-launch GO/NO-GO remains separate from continued engineering.

The first `t7-auth-providers` layer provides migration 0006, provider-neutral identity/session provenance,
durable one-time OAuth transactions, and the validated registry. Layer 2 adds production Discord OAuth and
Google OIDC adapters, bounded provider HTTP/JWKS validation, paired first-enable preflight, signed-out provider
guidance, and deterministic memory/PostgreSQL/real-stack coverage. Layer 3 adds capability-gated own-identity
listing, fresh-reauth provider linking, different-identity unlinking, required-provider retention, complete
session/lease/socket rotation, account-level security UI, linked-outcome preflight support, and Memory/PostgreSQL
parity. R10 public metadata now advertises GitHub, Discord, and Google as available and identity linking
as enabled; participant-by-participant linked-provider sign-in was not fully recorded.

The first r9 identity layer now adds ADR 0018 and migration 0008: signed-out invite links exchange the raw token
once for a five-minute server-side context bound to one durable OAuth transaction. Existing identities sign in
normally; a bound context signs an existing account in and joins the campaign atomically. When the default-off
`HUB_INVITE_ACCOUNT_ADMISSION_ENABLED` switch is enabled, an unknown identity creates account, identity,
session, and membership in that same transaction. Provider failure, replay, expiry, revoke, exhaustion, race,
or session-write failure consumes no invite and leaves no orphan authority. The provider-subject allowlist is no
longer first-account admission authority.
Transaction-specific signed OAuth cookies support multiple simultaneous starts from an empty shared cookie jar.
A failed, cancelled, or abandoned invite flow can rotate a separate five-minute opaque retry handle into a fresh
same-provider context when the old transaction cookie is present, without retaining the raw invite.

The stacked r9 entitlement layer adds migration 0009, provider-neutral `campaign:create` and
`platform:operate`, exact owner backfill, add-only designated-operator UUID reconciliation, real provider
reauthentication with session rotation, transaction-local freshness checks, hidden idempotent operator
administration, lifecycle/export protection, an ordinary-user account reauthentication/deletion flow, stable
UUID disambiguation for duplicate account names, and focused creator/operator browser states. Enforcement remains
default-off for a new installation until release preflight; r10 preflight confirmed the entitlement rollout
enabled on Oracle. The descendant account-linking layer reuses that ordinary-user account-level
reauthentication authority and adds no migration.

The Oracle deployment now has deliberate one-command release automation in `deploy/hub/release.sh`. It locks
out concurrent operators, verifies an immutable annotated tag and clean exact checkout, records rollback
identity, creates and reads an encrypted pre-release backup, enforces expand/deploy/contract migration
compatibility, applies the checked-in Compose overlays, performs complete public/runtime/static/backup checks,
and emits redacted machine/human evidence. It can automatically roll back only compatible application images;
it never reverses migrations, restores a database, changes filesystem ownership, performs destructive Compose
or volume teardown, or mutates services outside the Hub Compose project.

V2-T0 release-automation implementation is **shipped** by
[PR #219](https://github.com/TrueMichato/ThelemarTools/pull/219), and V2-T1 legible activity history is
**shipped** by [PR #218](https://github.com/TrueMichato/ThelemarTools/pull/218). The release script's live
Oracle dry run, deliberate r7 release, image preservation, and failure-path evidence are now proven external
host-operations evidence rather than unfinished T0 implementation.

V2-T2 projection/privacy is shipped: versioned authorization-scoped projections, metadata-only realtime
invalidations, owner/DM/peer views, sharing controls, and fail-closed privacy coverage are implemented.

V2-T5 whole-site campaign context is implemented: account-bound device selection, lightweight Hub/shared-nav
switchers, early temporary brew/rules activation, authorized bare Character Sheet and DM Screen defaults,
explicit local routes, pinned-resource behavior, access-loss concealment, BFCache/reconnect revalidation, and
server capability `campaign.active_context.v1`. Character Sheet routes additionally expose explicit Local or
Campaign authority, label selector scope, save/fence before cross-authority navigation, retain a validated exact
campaign-character return route through Local refresh/new-tab entry, and keep deliberate same-id local/campaign
documents isolated by repository. ADR 0015/V2-T6 now consumes its source/edition metadata and
teardown generation for content enforcement.

The focused `t2-effects-server-role` prerequisite slice established the ADR 0012 server contract without changing
the roadmap train status: protocol-v3 closed operations, immediate atomic DM/co-DM application, persistent
command/operation/event identity, owner/DM watermarks, opaque target refs, and the source-derived peer
proposal/terminal state machine. Production deliberately enables no successful `cost=none` peer template;
Cure Wounds was recognized and rejected as cost-bearing until the ADR 0016 slice below.

The held Wave A1 descendant completes that existing immediate DM/co-DM lane for all six version-1 typed
operations. Route/shared-catalog validation is parity-aligned, PostgreSQL direct-event audiences include every
active DM/co-DM, and valid heal-at-max/add-existing/remove-absent/restore-full operations return an exact
`changed:false` replay result. Under the existing migration-0005 uniqueness constraint they advance a
revision-only ordering point while leaving character JSON unchanged; they append terminal audit/applied event/
outbox/receipt evidence and deliberately omit projection invalidation. Character Sheet reconciliation advances
every tracked document in operation order, skips redundant adoption/render when a live track is unchanged, and
emits one accessible no-change notice. This does not add protocol 6, migration 0011, multi-target authority,
new templates, NPC/monster targets, offline writes, or prose-derived effects, and remains unmerged pending the
physical r10 game-day GO/NO-GO and PR #285.

The V2-T6 selection foundation and source/species/edition content-policy slice are implemented behind the default-off
`campaign.rules_policy.v1` capability. It adds a closed schema-v2 catalog, schema-v1 compatibility adapter,
atomic immutable DM/co-DM publish/rollback, privacy-safe member summaries, and an accessible searchable manager.
Source/species/edition controls are labeled **Enforced** and use content-policy version 1. The shared evaluator
additionally promotes carry-weight and encumbrance-tier calculation/projection and policy-fenced carry writes
to **Enforced** on their proven surfaces. Other selectable settings (`tgtt.enabled`, exhaustion, jumping,
linguistics, and critical rolls) remain **Advisory**. Shared browser/server evaluation filters relevant
Character Sheet choices, reports legacy violations without rewriting characters, and rejects newly disallowed
admissions/deltas, including import, move/clone, direct patch, grant/award, and transfer acceptance, across
both the content-identity and carry rule sets. Builder/level-up choice enforcement for non-carry settings
remains outside this slice.

The first V2-T7 product slice extends the ADR 0012 substrate with ADR 0016 protocol-4 source costs. A player can
cast PHB/XPHB Cure Wounds from an authenticated campaign Character Sheet, spend one selected standard spell slot,
and target one privacy-visible player-owned campaign character. The target owner explicitly accepts or rejects;
the proposer can cancel; expiry and lifecycle cancellation consume nothing. Acceptance rederives under current
locks and commits the slot decrement plus deterministic healing atomically exactly once. The spell must remain a
currently usable class spell (including preparation where required), and changing the bound slot permanently
invalidates that proposal even if the slot is later restored. Source, target, and combined self-target operation
legs reconcile through unsaved/in-flight local edits and reconnect/resync. V2-T7 remains active: NPC/monster,
player-facing party/multi-target UX/templates, generic effects, broader spell/ability/resource rollout, and
incremental partial commits are not implemented.
The capability remains default-off for every new campaign: an active immutable rules version and exact
operator-managed campaign UUID enrollment are both required. Production rejects wildcard or malformed rollout
configuration, release automation checks enrolled campaign readiness before traffic changes, and already-open
Character Sheets now clear and resynchronize targeting when authoritative campaign context changes.

Wave A2 hardens the shared source-cost version-1 authority without widening that rollout. The pure server/browser
contract keeps exactly four kinds (`spell_slot`, `item_charge`, `inventory_quantity`, and `feature_use`), resolves
all components before cloning or mutation, rejects duplicate stable ids and ambiguous feature/innate-spell
linkage, verifies campaign-brew item/feature provenance, preserves unrelated inventory metadata, and requires
resource/feature/innate-use mirrors to agree before decrementing them exactly once. Full-stack quantity removal
remains fail-closed for equipped, linked, container, ammunition, active, or custom wrapper shapes. These adapter
handlers and their Character Sheet reconciliation path are infrastructure support only: PHB/XPHB Cure Wounds with
one standard slot remains the only production template and real-stack resource fixture. Pact slots, item charges,
inventory quantities, feature uses, and mixed costs remain blocked from production template rollout until a
reviewed template supplies stable server-resolvable identities; no identity is fabricated from display text.
Wave A2 adds immutable migration 0010 only to align PostgreSQL ABA binding identity with the existing shared
version-1 resolver. It adds no protocol, capability, source-cost kind, multi-target migration 0011/state machine,
production template, or player-facing UX. Memory authority now snapshots and restores the complete source-cost
acceptance transaction on injected event, invalidation, audit, or receipt failure, preserving response/error/
event parity with PostgreSQL rollback rather than leaving a half-written deterministic test double.

Wave A0 adds [ADR 0020](adr/0020-consented-multi-target-operations.md) and an executable read-only query proof.
It accepts a future fixed 1-8 target set, opaque unique per-leg invitations, independent per-character owner
responses, source-finalization consent for source-owned legs, collection expiry, one exact ordered
source-selected subset, and one-cost/all-selected-leg atomic finalization. Reviewed multi-target healing
templates may privately record a full-HP selected leg as applied/no-change while consuming the single source
cost. Wave A3 implements migration 0011 after A2's source-cost binding migration 0010, additive migration 0012
for the bounded target-owner recovery index, and migration 0013 for source-owned lifecycle validation, protocol 6,
default-off exact-campaign capability, HTTP/event DTOs,
Memory/PostgreSQL state-machine authority, consent/finalization/cancel, lifecycle/expiry/retention, global quota
locks, permanent global/per-campaign usage markers, participant recovery, and marker-aware rollback preflight. **No multi-target
production capability is enabled:** full Character Sheet UX and production templates remain A4/A5, and the
draft remains held until the separate integration decision.

The accepted design now also fixes bounded abuse/fairness limits (3 live collections/source character,
5/source account, 50/campaign, 20 pending invitations/target owner, explicit mutation throttles, and
oldest-pending cursor pagination), intentional bounded DM/co-DM workflow observation, and protocol-3/4/5
fail-closed behavior across mutation/read/WebSocket/resync/replay. Schema is predecessor-readable before use,
with cross-campaign source-account/target-owner caps serialized by ascending seed-10 quota locks before campaign
authority. The first accepted proposal sets a permanent FK-independent usage marker; later normal rollback to a
true pre-0011 binary is forbidden even after workflow cleanup and requires an A3-aware bridge release unless a
separately reviewed destructive history/event/outbox/recovery export/purge is approved.

The post-integration cleanup repair adds migration 0014's twelve partial campaign/event indexes for the
existing semantic parent/target/finalization foreign keys. It changes no authority, data, retention,
protocol, enrollment or usage-marker behavior; application readiness requires 0014. Live transactional
index builds still require a separately approved write-blocking release/maintenance window. The original
published-head stress read passed, but its fixture DELETE timed out during FK verification before browsers ran;
that failed CI is not replaced by local diagnostic passes or treated as deployment/enablement evidence.

V2-T9 Campaign Overview is shipped by PR #243. The page is now a role-adaptive pinned session brief centered on
campaign identity, party readiness, attention, recent activity, and one role-specific next action. Existing effects,
transfers, XP, item awards, membership, homebrew, and rules capabilities remain available through progressive
disclosure. The same merge fences historical role replay against current authority, preserves archived read-only
bootstrap/event parity, closes archived mutation paths in both stores, and reads PostgreSQL cursor/snapshot authority
from one transactionally consistent view.

An unshipped GD-FIND-003 correction preserves an expanded peer shared-profile disclosure and keyboard focus
across ordinary realtime roster refetches. Authorization invalidation still clears the roster before a new
projection is shown. This local change is **not** part of the deployed r11e image or physical evidence.

A GD-FIND-006 Character Sheet improvement, deployed in r11f, makes inventory **Share...** reveal the next
Quantity/Destination step by focusing and scrolling to its composer. A live announcement explains that
nothing has moved until confirmation; Cancel restores focus to Share. This does not alter transfer authority
or other transfer authority.

A GD-FIND-007 correction, deployed in r11f, adds an owner-only incoming transfer notice and Accept/Reject controls
to the open Character Sheet, backed by the existing authorization-scoped transfer list and resolution API.
The notice refetches on realtime/reconnect, fails closed on incomplete transfer status, conceals stale
source details before projection/membership revalidation, and fences decisions when the sheet detaches.
The deployed r11f Sheet includes this recipient workflow; the later B0 wording/recovery follow-up is not deployed.

A GD-FIND-009 correction, deployed in r11f, cancels pending stash requests that become definitively unfundable
when another request, direct DM stash move, or stash-backed award consumes the source. Memory/PostgreSQL
authority records one bounded cancellation reason, audit and audience-scoped event per loser in the
winning transaction; affordable requests remain pending. Open losing-player Sheets announce the terminal
outcome instead of leaving an actionable stale draft. Later inventory workspace work does not change this authority.

- Lifecycle includes invite list/revoke, owner role changes, owner/co-DM member removal, voluntary leave,
  session/device revocation, immediate socket closure, workspace archive/restore, character detachment,
  escrow/action cleanup, and seven-day deletion request/cancel/purge with blocked-id reporting.
- Migration management includes immutable/checksummed files, advisory locking, baseline detection,
  status/plan/apply, migration-aware readiness, runtime/backup role grants, migration 0002, and
  fresh/baseline/concurrent/failure/checksum/restored-database drills.
- The merged PR handoffs record the targeted Hub, Character Sheet, mutation, PostgreSQL, browser, lint, build,
  security, and supply-chain evidence summarized under [Final verification](#final-verification). Historical
  milestone totals below remain historical rather than being relabeled as a current baseline.

Phase 6D portable deployment is implemented and locally verified: non-root/read-only BFF image, reproducible
static image with release-built service workers, PostgreSQL 17, one-shot migration/role grants,
least-privilege runtime, same-origin Caddy edge, WebSocket forwarding, liveness/readiness, and graceful
restart.

Phase 6E portable operations/observability is implemented and its Oracle recovery path is proven: migration 0003 operational evidence, singleton
bounded maintenance, protected Prometheus metrics, bounded route/request correlation, query/secret-safe JSON
logs, SLO/alert catalog, AES-256-GCM backup/restore, dedicated backup/evidence roles, and executable deploy/
rollback/outage/outbox/rotation/incident runbooks. Real cleanup, singleton lock, role boundaries, tamper
failure, encrypted backup/restore, evidence-age metrics, and OAuth log sanitization were drilled. On Oracle,
manual jobs, external heartbeat/failure signaling, off-machine copying, authenticated isolated restore,
continuous RPO/RTO, exact-r6 compatibility, exact-r7 return, and exact cleanup passed on 2026-09-12. Genuine
scheduled maintenance and backup executions passed on 2026-09-13, completing V1-G1; managed PITR is
intentionally not part of the Oracle free-tier design.

Phase 6F adds a pinned-action Hub pull-request workflow, deterministic install/lint/test/migration/supply-chain
gates, exact-image export with Node/image SBOMs and provenance, production-excluded synthetic authentication
derived from the exact release image, production-entry-point smoke, and an isolated disposable same-origin
HTTPS/PostgreSQL Playwright stack. Four multi-context journeys cover the private lifecycle, real Character
Sheet loading, character detachment/copy/move recovery, six-member load, 500-event replay, near-limit
character storage, contended transfer reservation, and BFF/database restart recovery.

Phase 6G is **complete**: [ADR 0010](adr/0010-oracle-always-free-hosting.md) selects Oracle
Cloud Always Free (single ARM VM, Israel Central) at $0/month, superseding the earlier DigitalOcean proposal
in ADR 0009, which is retained as the paid upgrade path. Two deployment artefacts are added and validated
locally and on Oracle: `compose.hub.public.yml` and `deploy/hub/Caddyfile.public`, which publish 80/443 and issue Let's
Encrypt certificates for a real hostname without altering the base local stack. A click-by-click
[provisioning runbook](runbooks/oracle-provisioning.md) covers quota, capacity, the VCN/host dual-firewall
trap, DNS, the OAuth app, and first boot.

Two decisions are consequently narrowed and recorded in place: no managed PITR, so recovery is from nightly
encrypted backups with an RPO of up to 24 hours (ADR 0006); and image promotion by verified git tag rather
than registry digest, because the free tier is ARM while CI runners are x86 (ADR 0008).

The guarded `do-connecting-ip` adapter and 25-second WebSocket heartbeat are implemented and pass the full
real-stack gate; the adapter stays disabled on Oracle, where Caddy is the sole ingress. Release
`hub-staging-2026-10-01-r11e` at `cf9b09f1a8df99e47167528aa37aa2cdfe766e9f` is the last verified
Oracle source identity. Genuine daily timer and recovery evidence remain recorded; the approved
Campaign A-only same-tag configuration redeploy passed independent rollout checks and its release-time
encrypted off-machine backup matched Oracle. A bounded later host check passed after the participant-reported
physical canary; the next scenario requires a fresh backup comparison. Tested physical paths do not
reverse the private-launch NO-GO. The [backlog](game-day-backlog.md) owns the re-entry work.

## Implemented

- Existing-identity OAuth sign-in, capability-gated invite first access (enabled on r10), server sessions,
  CSRF/origin checks,
  and protocol gating.
- Accounts, campaigns, roles, invites, membership, export, archive, and ownership transfer.
- Local/cloud Character Sheet repository switch, non-destructive claim, clone, move, archive, lease takeover.
- Character Sheet-native local copy, detached-character recovery, clone-by-default campaign reuse, and
  compatibility-gated explicit move with another-device lease refusal.
- Role-adaptive Campaign Overview: a pinned session brief with campaign identity, one role-specific continuation
  action, party readiness, attention, recent activity, explicit zero/one/many-character launch behavior, and
  progressive disclosure for the preserved campaign workbench and administration surfaces.
- Human-readable campaign interactions: source inventory stack selection, all five currency denominations,
  named action/transfer inbox entries, spell-slot proposals with spell/action context, and a lazy DM item
  catalog combining core and active campaign-brew items.
- Hub-owned surfaces provide a keyboard skip path, persistent semantic page heading, named main and campaign
  regions, labeled form controls, WCAG AA primary-button contrast in day/night themes, and 44 px entry targets.
- Immutable campaign brew/rules versions and early page context activation.
- Capability-gated, versioned campaign rules catalog/selection with before/after review, immutable rollback,
  schema-v1 compatibility, stale-base fencing, privacy-safe read-only member summaries, enforced
  source/species/edition content controls, and enforced carry calculation/policy-identity fencing. Other
  TGTT/exhaustion/jumping/linguistics/critical-rolls settings remain advisory.
- Campaign content policy filters Character Sheet build/level-up/respec/Quick Build and content candidates,
  blocks disallowed new admissions and authoritative deltas in memory/PostgreSQL, and shows bounded actionable
  grandfather warnings without changing existing character documents or local/personal-brew behavior.
- Whole-site active campaign selection with same-profile convergence and independent device choices; local
  Character Sheets, DM Screens, personal brew, and signed-out pages never inherit stale campaign state.
- Private per-DM workspaces using the existing Board blob and lease fencing.
- Authenticated WebSockets, presence, visibility-filtered event replay, snapshots, outbox dispatcher.
- Campaign pages consume both initial snapshots and visible events, coalesce projection invalidations into one
  authorization-scoped HTTP refetch that replaces rather than merges,
  debounce authoritative refreshes, sequence-fence stale refresh responses so newer roster state cannot
  regress, and run one bounded 10-second resync watchdog so a missed delivery cannot leave a live-looking
  roster stale indefinitely.
- DM full character reads plus the exact peer preview; owner-chosen peer profiles for other members with a
  sharing UI on the Character Sheet; live Party Tracker linked rows.
- Stale Character Sheet campaign URLs canonicalize before campaign rules/homebrew activation, and Hub-linked
  Party/Journey participants remain session-only rather than leaking into the private Board blob.
- Campaign DM Screen access is validated before private workspace data loads. Its persistent campaign banner
  reports live/reconnecting/stale party sync and loading/saving/saved/error/conflict workspace state, and
  closes the workspace when the session, membership, role, or campaign status no longer permits access.
- Campaign Party Trackers separate live read-only projections from private manual rows, retain the last good
  projection while reconnecting, show sync timestamps and empty states, and render linked details without
  disabled mutation controls.
- Durable roll log with semantic, bounded activity titles and selected authorized detail; character-related
  events carry privacy-safe versioned display-name snapshots so historical activity survives rename/detach/archive.
- Immediate DM/co-DM semantic character operations plus the fail-closed source-derived peer proposal/terminal
  server contract; XP/item grants, party inventory, and escrowed item/currency transfers remain domain-specific.
- Whole-item transfers preserve Character Sheet invariants, rollback identity, and metadata-safe stack merges.
- DM/co-DM item awards are one ordered atomic/idempotent batch across one to 50 active campaign characters, from
  the lazy catalog, authorized recent awards, campaign items, or one authoritative party-stash stack. Safe item
  metadata, a bounded note, advisory privacy-shaped carry previews, carry invalidation, deterministic audit/event
  ordering, stash conservation, and live Character Sheet reconciliation are implemented without changing local
  sheets.
- Owned cloud Character Sheets expose the server-authoritative party stash as a separate inventory section,
  including privacy-safe direct-pass destinations, escrow-backed partial transfers, reconnect/event refresh,
  repository-safe character reconciliation, accessible stateful controls, and reusable eligibility/weight
  summaries. Local and signed-out sheets remain unchanged.
- Character HTML is sanitized at the authority boundary; canonical documents are capped at 1.5 MB after
  every mutation.
- Idempotency receipts are compact, expire after 24 hours, and have bounded cleanup support.
- Backup/restore scripts and successful PostgreSQL 17 restore drills.
- Invite/member/session lifecycle administration and seven-day account deletion.
- Checksummed migration ledger, migration 0002, migration-aware readiness, and least-privilege role grants.
- Migration 0003 operational evidence, maintenance/metrics/redacted logs, and encrypted backup/restore.
- Pinned Hub CI, affected Character Sheet/DM Screen regressions, fresh PostgreSQL/role checks, SBOM/image
  evidence, secret/audit gates, and real-stack Playwright.
- Provider-gated client IPs shared by logs/rate limits/WebSocket context, plus server ping/pong heartbeat.
- Stable client-side failure classification for offline transport, unreadable responses, service/database
  outages, protocol skew, access loss, quotas, resources, transfers, leases, and revision conflicts.
- Campaign pages retain loaded data while offline, require a refresh after reconnecting, offer a direct reload
  for protocol skew, and become read-only immediately after session, membership, or permission loss.
- Archived campaigns bootstrap for authorized readers as read-only views, reject every mutation path in memory and
  PostgreSQL, preserve idempotent replay, and keep cursor/snapshot authority transactionally consistent.
- Oracle-ready systemd timers for maintenance, encrypted backup, and five-minute host checks; a host bind mount
  for encrypted archives; and a non-destructive off-machine pull script.
- Operator-triggered Oracle release automation with process locking, UID/GID 1001 backup mapping, immutable
  tag/SHA drift protection, verified pre-release backup, migration policy, compatible app-only rollback,
  protected endpoint/static asset checks, and redacted evidence.

## Final verification

The phase-specific counts below are preserved as the evidence recorded at those milestones; they are not silently
rewritten into a current whole-repository baseline. The latest merged handoffs add:

- PR #242: 93 Hub suites / 1,230 tests, 677 full Jest suites / 17,800 tests, 7/7 active-context, 6/6 rules-policy,
  and 11/11 content-policy mutants killed, plus 25 migrated runtime-role PostgreSQL tests and 24
  production-derived Chromium journeys.
- PR #243: complete Hub, mutation (7/7 active-context, 28/28 rules-policy, 12/12 content-policy), production-stack
  PostgreSQL/Chromium, JavaScript/style/build/security, and bounded desktop/mobile day/night review gates. Its
  pre-push full-Jest handoff recorded 678 passing suites plus two nested-Git fixture failures that then passed
  17/17 directly.
- PR #243 also recorded the existing `npm run test:data` LinkCheck discrepancy as 550 missing links in that
  checkout (534 from generated `data/crafting.json`, 16 elsewhere). This document does not present that
  environment-specific count as a newly verified current baseline.

- Blocker-only security/correctness review: no unresolved high-severity findings.
- Complete broad Jest gate: 601 suites and 17,495 tests passed. The Phase 6A Hub gate passes
  30 suites / 216 tests, including documentation, invite-recovery, and sanitizer regressions.
- Character Sheet: 528 suites and 16,833 tests passed.
- DM Screen targeted regression: 9 suites and 166 tests passed.
- Fresh PostgreSQL 17 migration, real grant/transfer/quota transactions, compact receipt inspection, backup,
  and single-transaction restore passed against a UTF-8 drill cluster.
- Repository JavaScript lint, Hub/DM Screen SCSS lint/build, service-worker build, and production dependency
  audit passed.
- Signed-out Hub, signed-in Hub, and DM Campaign views were checked at desktop and 390 px mobile widths with
  clean consoles, no horizontal overflow, and 44 px visible controls.
- Phase 6B/C PostgreSQL drills covered lifecycle escrow restoration/detachment/purge and fresh, baseline,
  concurrent, failed, checksum-mismatch, and restored migration paths.
- Phase 6F real-stack Playwright: 2 scenarios passed in 50.5 seconds; the harness then restarted BFF and
  PostgreSQL independently and recovered migration-aware readiness after each.
- Phase 6F cancellation drill: SIGTERM exited 143 and removed the unique test project's containers, volumes,
  and networks.
- Phase 6G preparation: 42 Hub suites / 273 tests and both real-stack journeys passed in 53.8 seconds with
  heartbeat and provider adapter included.
- Staging baseline repair: the production static image builds `sw.js` and `sw-injector.js` from the exact
  release source, serves both required ICO assets with correct content types, and omits build-only tooling.
  Real-stack Playwright renders a live campaign projection as a labeled read-only Party Tracker row; both
  lifecycle scenarios and the BFF/database restart smoke pass.
- Character-campaign readiness journey: a valid Fighter copied from local storage, detached-character Hub
  discovery and attachment, clone-by-default behavior, rules/homebrew move review, another-device lease
  refusal without an implicit takeover, direct retry, and idempotent move replay all pass.
- Role-aware campaign page: DM and player layouts were checked at desktop and 390 px mobile widths with clean
  consoles and no horizontal overflow. The real-stack journeys pass with the administration disclosures,
  explicit empty/loading/success/failure states, and permission-aware request controls.
- Campaign interaction usability: the real-stack lifecycle grants a core-catalog item, spends a spell slot
  through the structured-action form, and transfers that named item with CP/SP/EP/GP/PP through the stack
  picker. The pending inbox identifies the actor, item/source, currency, endpoints, and approval state.
- Campaign DM Screen hardening: focused contracts cover DM/co-DM admission, player/archive denial,
  realtime lifecycle and terminal policy closure, stale projection state, role-loss shutdown, observable
  workspace save/conflict recovery, and live-projection exclusion from the persisted Board blob.
- Accessibility/responsive hardening: signed-out Hub Lighthouse accessibility is 100 with zero failed audits
  in desktop/day and 390x844 mobile/night snapshots. Real-stack checks cover keyboard skip focus, semantic
  headings, accessible control names, 44 px entry targets, 390x844 portrait and 844x390 landscape reflow, and
  Character Sheet campaign-panel focus restoration.
- Final player-test readiness browser gate: four real PostgreSQL/HTTPS journeys pass in 3.0 minutes. The
  realtime scenario proves direct Character Sheet HP/initiative propagation, DM visibility, second-device
  takeover, and stale-writer fencing. The final saturation scenario covers six members, 500 rolls, large
  documents, transfer contention, accepted-transfer picker refresh, and complete transactional-outbox drainage
  before cleanup. Independent BFF and PostgreSQL restart recovery and production-entry-point smoke pass
  afterward.

## V1 limitations

- Monster/NPC structured actions are not automated.
- Multi-target semantic operations are design-only under ADR 0020; current live behavior remains the singular
  protocol-4 Cure Wounds flow.
- Campaign brew intentionally rejects raw HTML and persistent blocklists.
- Full simultaneous character/Board co-editing is not supported; one active editor holds the lease.
- Offline players can view a cached copy only; cloud mutation requires an authenticated online session.
- Semantic proposals expire after a bounded 24 hours when observed/processed. Legacy pending actions are
  terminalized by migration 0005. Transfers still remain explicit inbox work until resolved or lifecycle-cancelled.
- Semi-public moderation, self-service recovery, billing, and legal/privacy publication are not enabled.
- Private V1 supports one BFF replica and therefore no multi-replica application HA.

## V1 gates

1. **Host-operations proof — complete:** installation, manual drills, five-minute monitoring, encrypted
   off-machine backup, authenticated isolated restore, continuous RPO/RTO, exact-r6 rollback, exact-r7 return,
   exact cleanup, and the first genuine scheduled maintenance/backup executions passed by 2026-09-13.
2. **Physical game day — NO-GO on r10:** the 2026-09-28 rerun found the P1 context divergence and disabled
   targeting. Remediate the [prioritized backlog](game-day-backlog.md), then rerun the incomplete physical
   scenarios with actual providers/devices and make a new explicit go/no-go decision.

The [living roadmap](roadmap.md) owns scope, dependencies, and acceptance criteria for these gates and the
approved V2 program.
