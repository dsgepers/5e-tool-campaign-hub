# Campaign Hub testing guide

> **Status:** Current automated and real-stack coverage plus managed-staging gates
> **Last updated:** 2026-10-17
> **Owner:** Campaign Hub maintainers

## Automatic Portainer Git build validation

On 2026-10-19 the standalone file gained remote Git `build` definitions and
`pull_policy: build`; see [ADR 0023](adr/0023-portainer-git-builds.md).

- Compose built backend and website images from the public `multiplayer-hub` Git
  context, without using a local checkout as the source. The remote ref resolved to
  `cbcdd3c6c64ed7734b1b9671e045fec215284ebe`. New image tags were used so preloaded
  application images could not mask the original missing-image failure.
- A temporary localhost-only Portainer CE 2.45.2 instance registered the local
  Docker socket. Its real standalone/string stack API accepted the updated Compose
  file plus environment variables and built a second pair of initially absent tags.
- That deployment used a separate project/volume prefix, unused network subnets and
  synthetic database/OAuth credentials. Only the test copy's project/container names
  changed, and cloudflared was placed behind an inactive profile so this synthetic
  test could not use the real public tunnel. Application build contexts and the
  initialization/database/migration/backend/static/edge definitions were unchanged.
- PostgreSQL and backend became healthy; config initialization, migrations and role
  grants exited zero. Static and Caddy ran. From the configured connector IP on the
  test tunnel network, homepage, Hub, Character Sheet, liveness, database readiness,
  signed-out session and provider metadata returned nonempty HTTP 200 responses.
  GitHub OAuth start returned 302.
- The optional operations image was also built through the remote Git context.
  No live backup job or browser OAuth callback was executed.

The disposable test stack and temporary Portainer were removed after validation;
existing Hub data volumes were not mounted by the test. Earlier live Cloudflare
ingress qualification is recorded below. This does not establish compatibility with
every Portainer version or test the user's separate Portainer endpoint.

## Managed-volume Portainer validation

Before automatic Git builds were added, full local startup was verified on
2026-10-19 using the real private environment and the image-only standalone file:

```sh
docker build -f server/Dockerfile -t thelemartools-hub-bff:latest .
docker build -f deploy/hub/static.Dockerfile -t thelemartools-hub-static:latest .
docker compose --env-file .env.hub -f compose.hub.portainer.yml up -d
```

Both images built successfully. PostgreSQL and the BFF became healthy; static,
edge and cloudflared stayed running. The configuration, migration and role-grant
jobs exited successfully. Repeating deployment with the rebuilt images retained
the existing database and its account identities. The stack was left running.

Requests from the connector's actual network namespace verified nonempty homepage,
Hub and Character Sheet responses; liveness, database readiness, signed-out session
and provider metadata; and all three OAuth start redirects, callback origins and
Secure/HttpOnly correlation cookies. A request from a different origin-network peer
was denied with HTTP 403. Cloudflared readiness returned 200 and four live QUIC
connections were registered.

The initially configured Cloudflare route targeted the old static-only service.
After its owner corrected the published application route, public HTTPS returned
200 for the homepage, Hub, Character Sheet, `/api/live`, `/api/ready`, `/api/session`
and `/api/meta`. Public DNS resolvers returned the hostname's Cloudflare addresses;
these checks used `curl --resolve` to bypass the local resolver's stale negative
cache, with normal TLS certificate verification. This proves real tunnel ingress,
not browser OAuth completion, authenticated campaign operations, or deployment
through Portainer's UI. At that point app images had to be prepared on the target
endpoint; automatic builds above subsequently removed that prerequisite.

Local working-tree checks on 2026-10-19, using only synthetic credentials and isolated resources:

- Parsed the ten-service Portainer Compose model without `HUB_PROJECT_DIR`: every
  mount is a named volume, the initializer has no network, no host ports are published,
  and the backend selects OAuth with provider linking and GitHub identity retention.
- Started the actual `config-init` and PostgreSQL 17.6 services on an isolated project
  with new volumes. All three runtime/backup/operations roles were created and each
  authenticated over TCP with its supplied password.
- Read both generated files from the managed volume and compared them to their
  canonical templates (indentation normalized). This verifies literal runtime
  variable preservation through Compose interpolation and shell here-documents.
  Caddy 2.8.4 validated the resulting volume-mounted Caddyfile.
- Inserted a sentinel row, removed the test containers/networks without volumes,
  then recreated initialization and database services. The row and three roles
  survived, proving the configuration refresh did not reinitialize existing data.
- Test cleanup removed only the isolated project's resources. No live stack was
  redeployed and no real OAuth, tunnel or database credentials were used. The
  existing deployment/documentation contract suites remain the focused regression gate.

No application/store/schema change is involved. This does not qualify Portainer's UI,
real OAuth callbacks or Cloudflare connectivity. See [Portainer setup](portainer.md).

## Original host-path Portainer validation (historical)

Local checks on 2026-10-19 for the earlier host-path variant, before its replacement
by the managed-volume configuration above:

- Compared `docker compose --profile '*' config --format json` for
  `compose.hub.portainer.yml` with the merged Hub/local-login/tunnel files, using
  synthetic environment values and the same project name. All nine services,
  startup dependencies, environments, networks, route/config mounts and volume
  selections match after accounting for the intentional prepared-image/pull-policy
  changes, fail-closed absolute binds and equivalent empty-option syntax.
- A different Portainer project name retained the same explicitly named data volumes.
  Custom image tags, existing volume prefix and a host path containing spaces also
  validated; an omitted `HUB_PROJECT_DIR` failed before deployment. Neither topology
  publishes a host port. No secrets were rendered into the standalone file.
- Existing `HubDeploymentContract` and `HubDocumentationContract` passed: two suites,
  24 tests, with the same focused command documented under tunnel validation below.
- No running stack was stopped, images rebuilt, volume contents modified or Portainer
  deployment performed. No application/store/schema changes require new PostgreSQL,
  tenant, mutation, lease or event qualification for this configuration-only variant.

The [Portainer guide](portainer.md) documents endpoint image preparation, host mounts,
environment import, data-preserving handover and rollback. Portainer UI/live-provider
qualification remains a target-environment action.

## Personal Cloudflare Tunnel validation

Local working-tree checks on 2026-10-19, without a real connector token or public route:

- `docker compose --env-file .env.hub -f compose.hub.yml -f compose.hub.local.yml
  -f compose.hub.tunnel.yml config --format json`, with a synthetic hostname/token,
  passed assertions for the HTTPS backend origin, preserved password-login configuration,
  merged edge networks, connector-only network membership and absence of published service ports.
- Caddy `2.8.4-alpine` validated `deploy/hub/Caddyfile.tunnel` in a temporary container.
  A separate isolated Docker network with synthetic backend/static services verified original
  API/auth route prefixes, static fallback/cache header, public Host, HTTPS forwarding,
  visitor-IP preservation, spoofed-XFF replacement, missing-IP fallback and WebSocket upgrade.
  A peer at a different fixed address received 403 even with forged forwarded headers.
  The source restriction is inside a literal-order `route` so it runs before proxy handlers.
- Existing `HubDeploymentContract` and `HubDocumentationContract` passed: two suites,
  24 tests, using `npm run test:unit -- test/jest/hub/HubDeploymentContract.test.js
  test/jest/hub/HubDocumentationContract.test.js --runInBand --no-coverage --forceExit`.
- No application/store/schema changes were made for this overlay, so PostgreSQL migration,
  campaign mutation, lease and command-retry behavior were not changed or requalified.
  Temporary probe containers/networks were removed; the existing Hub was not restarted.

This proves local proxy wiring, not live Cloudflare connectivity, browser authentication
through that provider, production promotion or a physical acceptance result. Setup and rollback
are in [Cloudflare Tunnel](cloudflare-tunnel.md).

## Personal file login validation

Local working-tree validation on 2026-10-18 (no deployment or release qualification):

- Full Hub Jest gate: 127 suites, 2,062 tests passed; eight database-dependent suites and
  289 tests skipped without their external configuration. Jest reported a worker
  teardown warning; the gate completed with `--forceExit`.
- A separate isolated PostgreSQL 17 run applied all migrations, then passed nine tests across
  `HubLocalPasswordPostgres` and `HubMultiProviderIdentityPostgres`. This exercised real account
  provisioning, persistent campaign ownership and atomic password reauthentication/session rotation.
- A Chromium check over HTTPS used production Hub scripts and Fastify routes with a memory store:
  password form, rejected-password retry, successful sign-in, campaign creation and reload all
  passed without page errors. This check does not qualify the complete Docker deployment.
- The final focused local-login/documentation gate also covers restrictive host umask handling
  and rejects reauthentication with another configured user's valid credentials. Changed JavaScript
  passes ESLint, `git diff --check` passes, and the two-file Compose configuration validates.

No real passwords or user content were used. The setup command and operational file-reload procedure
are in [local login](local-login.md).

## Test layers

| Layer | Location | Purpose |
|---|---|---|
| Pure domain | `test/jest/hub/HubActions.test.js`, `HubCloudDataValidation.test.js`, `HubCampaignContent.test.js`, `HubEventPresentation.test.js` | Versioned semantic operations, escrow, quotas, sanitization, rules/brew validation, privacy-safe activity normalization |
| Repository proofs | `HubCharacterRepository.test.js`, `HubDmWorkspaceRepository.test.js` | Revision/lease/rebase/recovery semantics |
| HTTP repositories | `HubHttpCharacterRepository.test.js`, `HubHttpDmWorkspaceRepository.test.js` | API translation, retry, canonical ids, recovery |
| BFF/domain API | `HubServerApp.test.js`, `HubPhase1Domain.test.js` through `HubPhase4Domain.test.js`, `HubLifecycle.test.js`, `HubSemanticOperations.test.js` | Auth, campaigns, characters, content, semantic operation roles/replay/privacy/lifecycle, realtime actions |
| Authorization/security | `HubAuthorizationMatrix.test.js`, `HubXssContract.test.js`, `HubInviteRoleSafety.test.js`, `HubRouteContract.test.js` | Tenancy, roles, XSS, schemas, route policy |
| Realtime | `HubRealtime.test.js`, `HubWebSocket.test.js`, `HubBroadcastSync.test.js` | Visibility, replay, presence, observable connection state, stale-socket fencing, terminal policy closure, sockets, tabs |
| Owner Roll History | `HubRollHistory.test.js`, `HubRollLogAdapter.test.js`, `CharacterSheetHubRollHistory.test.js`, `owner-roll-history.spec.ts` | Owner-only pre-limit reads, actor-only correlation, 200-event retention, cursors, exact retry/reload recovery, lost responses, multi-device convergence, lifecycle fences, no character write/lease, phone layout |
| Game-day entry/sharing UX | `CharacterSheetLocalEntry.test.js`, `HubCharacterSheetAuthorityRoutes.test.js`, `game-day-ux.spec.ts`, existing projection-policy/privacy suites | Explicit-local Create/Open/Import guards, zero campaign writes, collapsed outer button plus nested native disclosures, draft/open-state/focus preservation through rerender on both entry paths, unchanged saved policy/full peer profile, phone/desktop day/night |
| Operation reconciliation | `HubCharacterOperationReconciler.test.js`, `HubCharacterOperationReconciliation.test.js`, `CharacterSheetRealtimeApply.test.js` | Pure per-source/target/combined-leg `B/L -> R/F` transition, coverage classification, prepare/adopt/commit atomicity, dirty/in-flight save rebasing, dedupe, and no-reload resync recovery |
| Integration seams | `CharacterSheetRealtime.test.js`, `CharacterSheetHubTeardown.test.js`, `CharacterSheetCampaign.test.js`, Character Sheet repository/rules/roll-history tests; `DmScreenHubController.test.js`; `HubPartyTrackerProjection.test.js` | Authenticated/canonical sheet subscription gates, target filtering, save-queue delivery, archive/move/demotion concealment, character-scoped sharing refresh, BFCache suspend/resume, fail-safe move recovery, existing page behavior, Campaign DM Screen access/recovery, live/manual Party Tracker separation, and local/Hub isolation |
| Static UI/PWA contracts | `HubPageContract.test.js`, `HubRoutePolicy.test.js`, `HubPerformanceBudget.test.js` | Required states, boot order, navigation, service-worker and fixed limits |
| B1/B2 inventory workspace/composer | `inventory-workspace-dom.spec.ts`, `inventory-workspace.spec.ts`, `CharacterSheetPartyInventory.test.js`, `CharacterSheetTransferCarryDelta.test.js`, existing inventory/recovery journeys | Role-adaptive entry points, safe stash text, raw draft/focus preservation, explicit denomination/intent validation, default approval custody, authoritative replacement, confirmed-vs-refresh-failed recovery, no hidden convenience reads and access-loss fences |
| Campaign Overview/authority | `HubPageContract.test.js`, `HubConditionCatalog.test.js`, `HubLifecycle*.test.js`, `HubRealtime.test.js`, `HubInventoryPostgres.test.js`, `campaign-overview.spec.ts` | Pinned session brief, role-specific launch, preserved workbench, canonical and current-condition pickers, brew refresh/retry, historical-role replay fencing, archived read-only parity/mutation closure, and transactional cursor consistency |
| Database contract | `HubMigrationContract.test.js`, `HubSemanticOperationsPostgres.test.js`, local PostgreSQL drills | Schema clauses, runtime-role grants, source/target lock ordering, atomic cost/effect, replay, expiry, and restore |
| Multi-target Wave A0/A3 contract | `HubMultiTargetOperationAdr.test.js`, `HubMultiTargetOperations*.test.js`, `test/fixtures/hub/adr-0020-multi-target-set-shaping.sql` | ADR completeness, normalized migration-0011 authority after A2's migration 0010, additive migration-0012 owner-recovery index, fixed-set/response/finalization/leg constraints, participant recovery, privacy, event sequence, hazards, fairness, and A1-A5 handoff |
| Held A4 shared Sheet consumer | `CharacterSheetMultiTarget.test.js`, `HubMultiTargetConsumer.test.js`, existing realtime/reconciler suites, `shared-sheet-multi-target.spec.ts` | Frozen lost-create/finalize commands, fresh authoritative readiness, exact duplicate-name owned consent, 1/8 candidates, source-owned deselection, all-track/durable no-op coverage, mixed-batch storage/adoption rollback, save/HTTP/event interleavings, immediate queued authority fencing, and real multi-owner consent/subset/expiry/access-loss |
| Held A5 production healing | `HubHealingWordTemplates.test.js`, `HubHealingWordAuthority.test.js`, shared Sheet targeting tests, `healing-word-production.spec.ts` | Exact checked-in PHB/XPHB scaling at every standard slot level, singular/multi route separation, six/seven cap, known/prepared/source identity, independent owners/subsets, one slot, no-op privacy, exact concurrent retries, and current target authority fencing in both stores |
| Invite admission | `HubInviteAdmission.test.js`, `HubMultiProviderIdentityPostgres.test.js`, `HubAuthServer.test.js` | Existing sign-in, unknown denial, opaque context binding, atomic first access, existing-account join, replay/expiry/revoke/race/status/privacy behavior, dedicated-secret token retry, lock ordering, and rollback |
| Account entitlements/reauthentication | entitlement and multi-provider suites | Provider/account/session binding, five-minute commit-time freshness, creator enforcement, operator hiding/idempotency/concurrency, last-operator lifecycle protection, migration backfill/reconciliation, export redaction, and memory/PostgreSQL parity |
| Account identity lifecycle | `HubMultiProviderIdentity`, `HubAuthServer`, `HubApiClient`, provider operations/config, PostgreSQL parity, `test-hub-account-identity-mutations.mjs`, real-stack provider journey | Bounded own-identity listing, no account creation during link, cross-account conflict, transaction replay, display-name stability, commit-time freshness, provider disable, different-identity unlink, last/retention protection, concurrent/idempotent unlink, session/lease/socket rotation, fresh CSRF, purge/export/deletion-grace behavior |
| Real-stack browser | `test/e2e/hub/`, `test/e2e/pages/HubCampaignPage.ts` | Multi-user lifecycle, Character Sheet copy/attach/clone/move, real Cure Wounds reject/cancel/accept/self-target effects, leases, reconnect, keyboard focus, phone reflow, labels/touch targets, and six-member/replay/quota/contention budgets |
| CI/supply chain | `.github/workflows/hub.yml`, `HubCiContract.test.js` | Pinned actions, deterministic gates, SBOM/image/provenance and test-auth isolation |
| Content policy | `HubCampaignContentGating.test.js`, `HubRulesPolicyPostgres.test.js`, Character Sheet content/teardown tests | Canonical aliases, campaign brew, editions/species variants, grandfathering, imports/direct writes/grants/awards/transfers, stale pins, rollback, privacy, and memory/PostgreSQL parity |

The Campaign/Local route journey in `active-campaign-context.spec.ts` uses separate owner, DM, and peer
browser profiles on the disposable HTTPS/PostgreSQL stack. After an applied campaign effect and an ordinary
owner edit, it records a positive PostgreSQL baseline for revision, lease epoch, PATCH receipts/events, and
projection invalidations. It then requires exact equality after Open Local, BFCache/Back, and Return, alongside
zero new lease/PATCH requests across all three profiles, matching owner/DM revisions, and an unchanged private
peer projection. It requires the runner's disposable loopback Hub and `HUB_TEST_POSTGRES_URL` endpoints and
fails closed if they are missing or remote. Never point the stack runner or synthetic-auth browser at Oracle.
This evidence does not replace the physical real-OAuth/device first-leg check against the actual deployed
service worker and loaded Character Sheet assets.

The Cure Wounds page object uses the same snapshot-sequence/installed-context/recovery readiness barrier as
production HW/MHW/LoH journeys before clicking Cast. A visible outgoing `applied` status or a present capability
does not establish that the next cast is ready: its effect can still be invalidating current authority.
The singular Cure Wounds journey deliberately holds the real campaign-context fetch during self-target setup.
Without the readiness wait it reproduces the missing-picker failure; with it, the original consent/cost/HP
assertions pass without retry. The product still refuses casting during revalidation; tests never auto-recast,
skip invalidation or weaken the authority fence. This controlled counterexample explains a reachable
first-attempt failure mode; the old CI attempt had no trace proving its exact timing.

`HubInventoryContract` checks common proposed/reserved/committed/rejected/cancelled/expired wording, explicit
unknown-status rejection and the separate balance-refresh claim. `CharacterSheetPartyInventory` proves a
confirmed commit remains visible when refresh fails, then recovers by reads without another proposal.
The existing real-stack inventory and refresh-recovery journeys assert known terminal feedback plus a failed
refresh notice, no false "up to date" claim, and one resolution command through the successful refresh retry.
The `HubPerformanceBudget` gate still enforces the original signed-out 16-module ceiling.

The local B1/B2 candidate uses real Chromium DOM tests for workspace role states, keyboard scrolling,
mobile/day-night reflow and draft/focus retention, plus independent DM/player/spectator contexts on
the disposable PostgreSQL stack. The new workspace stack journey retains complete item metadata and
repeated item/currency moves, checks approval-required owned-Sheet requests, holds an authorized stash
read through member removal and proves an initial read retry sends no mutation.

The first combined stack passed all 372 runtime-role PostgreSQL checks and 20 of 21 browser tests,
then failed the new ordinary-invalidation search-draft assertion. Nonterminal concealment cleared
the local search query even though only authoritative rows/activity needed concealing. The bounded
correction retains that local query during same-scope revalidation and still clears it on terminal
access loss; the original failing sample is retained. That first run is not reported as a PASS.
The initial full Hub run also exposed a VM fixture missing the new inventory-concealment binding;
the corrected fixture preserves its assertions and additionally checks the exact AUTH_REQUIRED call.
These initial results remain separate from the later independent closure and final qualification below.

Independent B1/B2 review subsequently found two Sheet counterexamples: expired retained proposal
evidence recursively delegated between submit/cancel for a known terminal transfer, and transport
loss during the awaited source save still allowed a fresh proposal. Four real-handler regressions
reproduced both failures. The fixes bound terminal status/balance recovery and recheck connection
readiness immediately before freezing a fresh request. Isolated copied-source controls pass; removing
either actual callsite guard restores its two failures without modifying the reviewed working tree.
The retained reviewer independently closed both fixes and the search-query correction.

The first complete canonical run then passed 372 PostgreSQL checks and 74 of 75 browser tests,
with no retries. The remaining lifecycle failure was a strict locator ambiguity: the global and
new inventory workspace both legitimately offer **Reload campaign**. The page object now scopes the
existing role/name visibility assertion and click to the global error surface; it does not select an
arbitrary first match, relax the assertion or increase a timeout. That failed sample is retained
separately from later lifecycle and complete-suite evidence.

The scoped reconnect-selector correction passed the complete private-V1 lifecycle. The next
canonical run passed 372 PostgreSQL checks and 74 of 75 browser tests, but exposed a different
cross-device Sheet failure: an active player's request existed on the DM view while the owner
composer remained open with a read-only-role message. The existing closed-composer assertion
was not relaxed and the sample is retained. A controlled real-stack red reproduced a compatible
interleaving: the request POST committed, a separate DM operation emitted a real projection invalidation,
the authorized snapshot GET was held, and the HTTP ACK arrived while the controller still had role
`player` but pending authority. This establishes the defect without claiming to reconstruct the
unrecorded original timing.

The bounded correction retains positive-ACK read/settlement demand until current authorized
transfer/stash reads and serialized owner catch-up succeed. It never resends the proposal or adds
an acceptance. Failed reads retain demand; actual role loss, missing exact status, unresolved decisions
and detach fence settlement. Five unit regressions and two isolated callsite mutants cover the ACK
barrier and later successful read drain; the existing three-journey Sheet inventory spec passes with
the controlled real invalidation/ACK ordering and original assertions/budgets. The retained reviewer
closed the four-file delta. Earlier 74/75 full runs remain failed evidence; the subsequent complete
qualification is recorded below.

### B1/B2 local qualification — 2026-10-15

Source is the **uncommitted** B1/B2 delta on `multiplayer-hub` at base
`25df6289ce2d08d090bfa5f664755202af6dd636`, not a newly committed release.
The independently closed 15-file code/test/style manifest has SHA-256
`b44e22fa0a206fbf7ac9625b020c8a855e231464718e3b962cd95d02dad96be6`.
Those bytes remained frozen through final gates. Documentation updates are separate from that runtime manifest.

| Gate | Newly executed final result |
|---|---|
| `npm run test:hub -- --runInBand --silent` | 122 suites / 2,021 passed; 7 suites / 285 optional PostgreSQL checks skipped, not credited as passes |
| Affected Sheet seams plus composer/carry, DM-effect and documentation suites (command below) | 13 suites / 476 passed |
| `npm run test:hub:e2e:stack` | 9 suites / 372 checks in the runtime-role PostgreSQL phase, including selected Memory/PostgreSQL authority coverage; all 75 browser tests passed in 8.8 minutes, with no retries, skips or flaky cases |
| Focused JavaScript/CSS lint | Changed Hub and Sheet JavaScript/Jest files, `scss/hub.scss` and `css/charactersheet-party-inventory.css` passed |
| Independent correctness closure | Original expiry/offline counterexamples, nonterminal query retention, scoped reconnect selector and the controlled positive-ACK settlement delta closed; review itself ran no tests |

The exact affected-seam command was:

```bash
npm run test:unit -- \
  test/jest/charactersheet/CharacterSheetPersistenceBackend.test.js \
  test/jest/charactersheet/CharacterSheetRepositorySeam.test.js \
  test/jest/charactersheet/CharacterSheetCampaignRules.test.js \
  test/jest/charactersheet/CharacterSheetHubTeardown.test.js \
  test/jest/charactersheet/CharacterSheetRollHistory.test.js \
  test/jest/charactersheet/CharacterSheetHubRollHistory.test.js \
  test/jest/charactersheet/CharacterSheetRealtime.test.js \
  test/jest/charactersheet/CharacterSheetMagicItemCategorization.test.js \
  test/jest/charactersheet/CharacterSheetItemRepairLoadOrder.test.js \
  test/jest/charactersheet/CharacterSheetPartyInventory.test.js \
  test/jest/charactersheet/CharacterSheetTransferCarryDelta.test.js \
  test/jest/hub/HubDmEffectSubmission.test.js \
  test/jest/hub/HubDocumentationContract.test.js \
  --runInBand --no-coverage --forceExit --silent
```

Final disposable run `97433-39438dd6` emitted its cleanup-complete notice. A separate resource check found
that this task's seven runs had each left an unused `hub-backups` volume; their exact project labels and
zero container references were verified, then only those seven named disposable volumes were removed.
No production/shared resource was touched, and the notices alone are not proof of complete volume cleanup.
The controlled red samples,
isolated callsite controls, raw logs and desktop/mobile day/night screenshots are retained privately.
Jest's configured force-exit warnings remain; this is not a universal open-handle cleanup claim.
Counts overlap between commands and are not an aggregate unique-test total. No remote CI, commit,
publication, deployment, campaign opt-in, private-launch GO or physical/OAuth/device acceptance is implied.

The separately approved normal local commit `281b505b48a5405092cec26d823e31fad80c8de7`
subsequently recorded exactly those 26 candidate files, with all file hashes unchanged after hooks.
Its parent is `25df6289ce2d08d090bfa5f664755202af6dd636`; all 16 unrelated modified/untracked files
remained unchanged and outside the commit. Normal lint-staged and related-Jest hooks passed
(19 suites/423 tests). That commit is not published and has no new remote-CI or release identity;
the preceding full-stack measurements remain exact-candidate local evidence.

The A4 journey uses the existing disposable real-PG harness, five synthetic account profiles (source, two target
owners, unrelated player, DM), and two identically named characters for one owner. It starts capability-disabled,
then enables only its exact synthetic campaign through a secret-protected test-only route. The A4 journey does not
use the A5 production mapping: the test server appends the existing reviewed A3 Shared Restoration fixture with `additionalTemplates`,
and the page object injects its closed descriptor into the existing source controller. The fixture uses the store's
existing 60-second collection-TTL injection; production advertises/retains the normal contract. Expiry readiness
is read from the authority, never inferred from a browser timer. Both Sheet entry paths use the same controllers.
The second owner's already-open Sheet must adopt the first finalization through realtime, and the twin owner's
already-open Sheet must adopt the expiry subset. API reads and reopening a Sheet are not substitutes for those
cross-user DOM assertions.
Run `npm run test:hub:e2e:stack -- shared-sheet-multi-target.spec.ts`; the runner owns uniquely named loopback
containers/ports and cleans up that stack. No fixture authorizes live enrollment or replaces physical acceptance.

The A5 journey uses the same five-profile HTTPS/runtime-role PostgreSQL stack, exact synthetic campaign
enrollment and page objects, but **never injects a resolver or substitutes a fixture template**. PHB and XPHB
each cast production singular HW followed by production MHW from both Sheet entry paths. Source-owned
deselection, independent duplicate-name owner decisions, the second owner's still-open realtime convergence,
one-slot counts, current source privacy, reconnect and table-boundary copy are asserted. Run
`npm run test:hub:e2e:stack -- healing-word-production.spec.ts shared-sheet-multi-target.spec.ts`.
The runner includes `HubHealingWordAuthority.test.js` and `HubMultiTargetOperationsPostgres.test.js` in its
least-privilege runtime-role parity phase. `HubHealingWordAuthority` deliberately executes Memory and PostgreSQL
through the same public-store fixtures. A local run without `HUB_TEST_POSTGRES_URL` skips PostgreSQL and is
**not parity evidence**. Counts from focused/full/stack gates overlap; never sum them into a unique total.

Its third journey starts with an unqualified XPHB Paladin document, then exercises ordinary checked-in
class-feature acquisition/load repair and a real UI name-edit/save before heal-only LoH use. The actual number
dialog's supported `elePre` copy must be visible **before OK**, explaining equal point cost and table-adjudicated
eligibility; HW/MHW pickers must likewise visibly disclose the selected-dice floor before sending. Consent,
cost mirrors, reconnect, still-open peer HP and private singular failed/unspent source/target byte/revision
preservation are asserted. After a character switch, await the new realtime attachment before measuring the
canonical baseline: an ordinary load-time repair save is not a semantic no-effect write.
The name edit deliberately survives a real Sheet render before blur, then must reach the canonical document.
This guards [CS-BUG-171](../charactersheet/known-bugs.md): a focused draft must not be overwritten before its
`change` handler runs. The scoped unit guards also require canonical replacement after load/character/read-only
boundaries and ensure renders do not save. No retry or timeout increase substitutes for that behavior.

The semantic-operation mutation runner retains the initial nine A5 actual-callsite controls: wrong MHW upcast
scaling, eight-target acceptance, preparation bypass, singular MHW routing, an incorrect minimum-one floor or omitted dice floor,
two-slot cost, an eight-target browser picker, and local fallback during a fenced MHW cast. It copies the two checked-in spell data files into its owned
temporary probe tree and requires a green baseline before each mutant. Six retained-reviewer remediation
controls additionally cover contradictory stored spell UID, unreviewed brew
provenance, illicit resource provenance behind reciprocal links, name-only pool acquisition, ambiguous legacy
ownership and the singular HTTP ten-point ceiling. The HTTP matcher includes singular `targetRef` so it cannot
silently mutate the neighboring multi-target `targetRefs` schema. Public-store regressions cover proposal and
leased source mutation before current finalization, concurrent/exact retries, unrelated PHB manual-pool
preservation through real acquisition/persistence/load/cost, and authenticated protocol-4 amounts 10/11/15/100,
overbound input and overspend in both stores. The full semantic gate has 35 controls including these 15 A5
controls; those counts are not a unique sum with other gates.
The current content/semantic matchers
require exact production occurrence/replacement reach and restore candidate bytes after every mutant; stale
or ambiguous reach is a failure, never a kill. The queued approval/access-loss probe calls through the actual
repository executor and requires zero invocations after the released callback fully drains, followed by the
unchanged HP/notice assertions. Removing its immediate scope guard genuinely invokes the repository once and
changes HP 30 to 34 even though the pending result resolves false. This exact harness therefore does **not**
prove redundant downstream byte protection; the intact guard prevents delivery. Separate inherited R4
actual-path proof is not this new mutant's evidence.

The populated Roll History stress read retains all 100,000 unrelated rows through its full query/privacy/byte
assertions. Its body/finally deletes only the exact synthetic rows by captured campaign, sequence interval,
actor, aggregate and payload before ordinary parent cleanup. Original 30s body/5s hook budgets and reach are
unchanged. Earlier >5s hook failures and the distinct ordinary 5s Roll History body timeout remain diagnostic
history, not disproved by a faster sample. Default parity/browser and complete mutation-chain outcomes must
be reported separately; diagnostic teardown allowances are never green default proof.

Fragile A4 guards are checked by temporary mutations at actual call sites: accepting `changed:true` as a
revisionless no-op, replacing exact fresh owner-character equality with mere reference existence, and replacing
synchronous targeting concealment with refresh-only delivery. Each must fail its behavioral assertions before
restoring the real code; comments and snapshot-string mutations are not substitutes.

The authority-fence regression uses the actual page handler, coordinator, repository and incoming/source controllers.
With a real save blocked, HTTP-first and event-first results wait in the repository queue while `campaign.archived`,
`rules.activated` or `character.projection.invalidated` arrives through the coordinator. It asserts zero stale
adoption, coverage, watermark, redraw, notice and focus without manually advancing a page generation. Queued resync
and canonical reads are also fenced; canonical/history awaits and mixed changed/no-op batches exercise two durable
commands at storage/journal/adoption boundaries. Fresh authorized context recovers retained exact evidence once;
terminal archive conceals instead. A separate continuation check preserves canonical projection demand and accepts
future current-authority deliveries. Actual-call-site mutations remove the synchronous fence or post-staging guards,
and must make those behavioral assertions fail before restoration.
The interrupted-canonical-demand regression holds a real canonical read, delivers rules activation through the
coordinator, and resumes authorized context without supplying another demand or advancing test-only generations.
The old read cannot adopt; a fresh read must automatically catch up exactly once. The executing request remains
retained until completion, and its completion cannot clear a newer coalesced request. Repeated rules/projection
interruptions, durable-stage/adoption rollback, a real switch away and back, scope loss, and persisted BFCache
resume cover the continuation. Authority-unavailable drains stop instead of spinning; account/campaign/access
changes and terminal teardown discard the old demand rather than revive it. Actual drain-site mutations that
clear demand before the await or erase a newer request must fail these behavioral checks.
Reconnect regressions exercise both orderings of the old canonical read versus transport `live` while the real
page context refresh remains held. Before authorized context installation there must be no adoption, accepted
revision/coverage advance, redraw, effect notice or focus; afterward there is one automatic catch-up. Fresh
HTTP/WebSocket/resync deliveries, repeated reconnect/newer demands, late or failed context responses, terminal
loss, and durable/journal/adoption rollback use the same real-page/controller/repository harness. Temporary
actual-call-site mutations remove the installed-context barrier, allow early recovery-storage reads, or clear
unfinished semantic recovery on reconnect; all must fail. `CharacterSheetRepositorySeam.test.js` captures the
real canonical request shape and binds the real scope/readiness helpers for its terminal-concealment regression.
Run both affected-regression selector lists in `.github/workflows/hub.yml`, not just the focused A4 subset.
Late fenced-evidence regressions install authorized context and overlays either before or after a queued HTTP
receipt drains behind a real save. Newly retained exact evidence hands off to the existing ordered semantic
resync automatically; a visually current canonical document is not proof that recovery completed. Assert one
authorized history read, cleared pending evidence/save block, and a successful subsequent real save without
double application or an extra effect PATCH. Repeated HTTP copies, WebSocket-first delivery, distinct changed
legs and revisionless no-ops exercise coalescing. Canonical catch-up waits behind pending semantic recovery so
it cannot preempt exact-leg reconciliation. Terminal/character/account/campaign/access/repository loss must
not hand off old work; a stale scheduled scope must not suppress a new authorized request. Remove the actual
fenced-status scheduling call to prove the liveness regression fails, then restore it.
The replay floor includes every existing ordinary/conflict/durable track. An unknown sequence cannot be silently
filtered out in favor of a newer live watermark: bounded authorized replay starts at zero so an older unseen changed
leg is not excluded. A separate exclusive-cursor regression and actual history-floor mutation cover this recovery
hazard without guessing an application or weakening the open-Sheet browser check.
Returning to a previously opened owner Sheet also distinguishes settled submit caches from durable drafts.
Teardown clears coverage; a settled cached submit must not survive a fresh canonical load as an unknown ghost
track and permanently block the next applied leg. Two failed durable commands instead restore their exact
snapshot coverage from persisted command evidence, retain both bases/snapshots and preserve the user's HP edits.
The teardown/load regressions exercise both cases without inventing coverage for an unknown legacy draft.

`character-sheet-party-inventory.spec.ts` also exercises the recipient's open-sheet transfer inbox:
server-scoped offer visibility, immediate concealment before a delayed projection refetch, anonymous source
fallback after sharing narrows, reject/accept without Hub navigation, reload recovery, a committed response
lost in transit followed by authoritative status confirmation without repeating the mutation, and absence of
campaign/character IDs from rendered notices. Focused Character Sheet tests pin uncertain-response
idempotency, invalid transfer responses, and character-access fencing. These tests use synthetic accounts
and a disposable stack; they do not authorize live inventory transfers.

The competing-stash browser journey and Memory/PostgreSQL tests require one conserved winner, immediately
terminal insufficient losers, no extra restoration for non-escrowed requests, one `source_insufficient`
event/audit per loser, stale-request disappearance from the DM inbox, and a losing-player Sheet notice.
They also cover concurrent approvals, direct DM stash debits, stash-backed awards, and preservation of
still-affordable requests. These source corrections are now delivered in r11f; the automated evidence
does not replace physical acceptance, which is explicitly waived for this bounded correction release.

The owner-history candidate's four-context journey uses two devices for one owner, a DM, and a peer.
It logs actual Sheet rolls, loses committed POST responses with and without live socket confirmation,
recovers across reload without another POST, and catches up after another device rolls while it is offline.
Device-only offline rolls never auto-submit. An uncommitted transport failure replays the exact request
through keyboard activation, preserving focus as the pending row becomes authoritative.
The journey excludes DM-authored rolls, rejects DM/peer history reads, and observes
character-write/lease traffic separately from roll POSTs. Its raw API fixture's ordinary missing-feature
repair is setup; after a positive database write/lease baseline, clean reopen and all history interactions
must leave revision, lease epoch, PATCH receipts/events and projection invalidations unchanged.
Desktop/mobile day/night captures and Escape/closed-panel keyboard checks cover the presentation seam.
Role-change coverage demotes an owner from co-DM to player and removes their own formerly visible
DM-only roll on both devices. Sheet regressions hold an old-role read across demotion, fail its
replacement, and require concealment with attempted commands preserved; overlapping socket arrivals
are refilled under current authority.
PostgreSQL tests place 100,000 newer unrelated
events ahead of 205 own rolls, require exact latest-200 IDs, less than five seconds and one megabyte,
and print both the measurement and the no-index/unbounded-growth caveat. Contention tests interleave
duplicate-key writes with reads and force explicit authority-lock timeout. These are disposable local
checks, not Oracle load evidence or physical acceptance.

The populated stress fixture deletes exactly its 100,000 synthetic rows only after the read assertions,
preserving the 10s PostgreSQL statement limit, 30s body and 5s hook limits. Migration 0014 supplies partial
campaign/event lookup indexes for all twelve semantic event foreign keys, without disabling retention
constraints or changing the Roll History read query. The actual runtime-role catalog regression checks
every existing semantic event foreign key has a valid, ready, eligible leading index. The original
published-head CI failure was the synthetic-row DELETE during FK verification, not the history read
(27.3ms/108131 bytes); browser tests were never reached. Local passes do not replace a new published-head gate.

### Source-candidate validation residual

The correction candidate's initial full stack passed 77 PostgreSQL checks and 49 of 50 browser
journeys; the ordinary-account deletion journey did not reveal reauthentication after its first click.
The unchanged focused provider suite then passed 8/8. A diagnostic against the unchanged Hub index
confirmed a baseline readiness defect: while account-session rendering is delayed, Delete account is
visible and enabled before its click handler is bound; an early click does nothing, and the same action
works once binding completes. This reproduces the failure shape, not the uncaptured timing of that run.
After the independent Roll History role-change remediation, the complete unrelaxed stack passed all
77 PostgreSQL checks and 50 browser journeys. That historical green run did not fix the baseline
readiness defect; no auth code, assertion timeout, retry, or skip was changed for those results.

The subsequent source correction disables Delete account and Sign out other devices synchronously
before Hub-index initialization awaits. Both controls enable only after their handlers are bound and
all account renderers settle, including failures; reauthentication callback focus is restored afterward.
The permanent provider-registry journey holds the real account-session read and requires disabled
controls before release, then working deletion reauthentication afterward. Its unavailable-service leg
also requires the explicit service error rather than a silently dead control. The delayed leg failed on
the old enabled button before the fix, and both legs now pass with the full provider lifecycle.
These probes add no automatic mutation retries, skips, or assertion-timeout increases.
The corrected full disposable stack passed 77 PostgreSQL checks and all 52 browser journeys;
the focused provider suite passed all 10, including both deterministic startup cases.

The subsequent GD-FIND-004/005 follow-up passed the full disposable stack: 77 PostgreSQL checks and
54 browser journeys. An earlier accelerated 13-case subset exhausted the unchanged shared-IP
campaign-creation quota (10 POSTs/minute), producing a 429 in the existing overview journey.
The unchanged overview passed in a fresh four-case stack, then the full suite passed without changing
limits, retries, skips or timeouts. The new sharing probe initially compared a raw API seed with a
post-load profile; normal missing-feature repair changed the document during setup. It now measures
after load repairs settle and explicitly selects the character from the ordinary entry's roster.
The full saved-policy and peer-profile equality assertions remain intact.

Desktop/mobile day/night inspection then found native markers suppressed by Bootstrap's global summary
display reset. The real-browser affordance assertion failed with `display: block`; scoped sharing CSS
restores `display: list-item` and closed/open native marker styles. The focused four-journey stack then
passed all 77 PostgreSQL checks and all four browser journeys; the final desktop/mobile day/night captures
show the native markers. These follow-up checks are source
verification, not a repeated physical game day or an r11f deployment.

### R11f publication and deployment evidence

The final correction source `4578c8671a7b05066fb9a19411cb8a31cdd753ef` passed all four jobs in
[exact-source CI 38223244640](https://github.com/TrueMichato/ThelemarTools/actions/runs/38223244640).
Its canonical browser artifact records 54 expected journeys, zero flaky, unexpected or skipped cases.
Annotated `hub-staging-2026-10-12-r11f` has tag object
`33a9a3722c16aa5230b2f3b332304014b3b58cce` and peels to that exact source.

The separately approved shared-host dry run restored r11e source and all five old mutable image tags.
The first promotion stopped at an incorrect human confirmation, before traffic/schema mutation;
independent checks proved the old healthy source/images remained intact. A separately approved retry
received the human's full confirmation and completed at 2026-10-12T10:53:06Z.
Independent post-release checks verified exact source/BFF revision/pinned images, one BFF, unchanged
configuration, protocol 5/Roll History capability, migrations `0001`-`0009`, runtime `hub_runtime` without
`hub_owner` membership, readiness, metrics authorization/age bounds, WebSocket rejection and TLS.
All 14 changed browser JS/CSS/HTML files match reviewed Git, container and public hashes; generated
worker/injector hashes match container/public responses. The static image has no OCI revision label,
and served-asset equality is not a survey of preexisting browser caches.
The newest encrypted prerelease archive matches the trusted off-machine copy by filename, size and SHA-256.
Detailed redacted evidence remains private, mode 0600.

Another physical game day is waived for r11f, not reported as a measured PASS or private-launch GO.
The held Wave A stack, draft #289, remaining design decisions and campaign-enrollment limits are unchanged.

### M14 non-image local qualification — 2026-10-17

This is local source/test evidence for the selected protocol-6/schema-0014 first delivery, not release,
image, database, or operational qualification. The source lineage is D
`4578c8671a7b05066fb9a19411cb8a31cdd753ef` -> E base
`4172b926e66764542e9017b96c7a292e0f94b59e` -> E test follow-up
`055a285ea9cc576dab8ff4b0aac4a3a5d3736d41` -> E test-only correction
`aef1090ea871eb46cdf550db3944ca5305c07fce` (parent `055a285`, one Auto test);
A7 component `035e838ad28455d5d70b8ee06989edc65709913b` -> M merge
`b9fea164a75952c6b4d196a142f312c9b2f519ca` (ordered parents A7 then E base) -> test-only repair
`a35af555a1d1cd25e2ba9d2d98b11677ca5917c3` -> records commit
`b835e9c8cbc4a5c5439bb44a35afdfa105561467` -> integrated M
`fbc91bbe33d00b9af48644cac9eb3e5e2bd663d4` -> docs commit
`6d8c71070f4fb16a9955d3013a7fa8471029920c` -> selected B/M source
`2c03c17a26fcecf5f1f53abbefef471741b938b0` (ordered parents `6d8c710`, `aef1090`).
The integrated M tree remains protocol 6 and required migration 0014. The approved docs-only refresh
will create a separate M descendant of selected B.

The later E gate batch ran on E base plus the exact four follow-up changes subsequently committed
unchanged at `055a285`; its full suite was not rerun after that commit.

| Source and gate | Result |
|---|---|
| Initial M candidate: read-only ESLint on two repaired tests | Passed, exit 0 |
| Initial M candidate: deployment-contract and first-release tests | 2 suites / 28 tests passed |
| Initial M candidate: full Hub suite | 125 suites / 2,049 tests passed; 8 optional PostgreSQL suites / 287 tests skipped |
| Initial M candidate: complete affected-selector set | 17 suites / 481 tests passed |
| Normal a35 test-repair hook | lint-staged ESLint and related Jest passed; 2 suites / 28 tests; no source drift |
| E `055a285` follow-up batch (E base plus four exact working changes; not rerun after commit) | Full Hub: 1,683 passed / 71 skipped; affected selectors: 17 suites / 471 passed; focused target set: 28 passed |
| Normal E `055a285` follow-up hook | 3 suites / 92 tests passed; no source drift |
| E correction `aef1090` | ESLint: 1 test file; full-source secret scan: 3,435 text + 101 binary inputs; 4 suites / 83 tests passed; normal hook: 1 suite / 64 tests |
| First exact-source E publication CI `39053045735` at E `055a285` | Failed source secret scan on the synthetic `HUB_COOKIE_SECRET` canary alias; affected regressions and migration/roles passed, dependent stack job skipped; missing-files artifact upload was secondary |
| Later local M scan (pending `6d8c710` + E `aef1090`, Auto correction only) | Failed on an environment-derived missing-database URL and two password-free fake-`psql` URL fixtures in M-only tests; distinct from the E CI failure |
| Integrated M pending-tree targeted gate | 5 suites / 106 tests passed |
| Normal `fbc91b` merge hook | lint-staged ESLint and related Jest passed; 1 suite / 64 tests; frozen tree unchanged |
| Selected M/B `2c03c17a`: local gates | Three-file ESLint passed; full-source secret scan passed; 8 suites / 116 tests passed, 1 skipped; pure URL fixture regression ran |
| Normal `2c03c17a` merge hook | lint-staged ESLint and related Jest passed; 3 suites / 69 tests passed, 1 skipped |

The initial M full-Hub and affected-selector results apply to the earlier M-plus-two-test-repair candidate,
not the integrated `fbc91b` tree; a full Hub run was not repeated on `fbc91b`. PostgreSQL skips are not
real-PostgreSQL, role, or SQL/ACK proof. The first full-Hub sample with three failures remains a separate
failed run: it contained an obsolete unlocked `ExecStartPre` expectation and two first-release fixtures
without `CONTROL_SHA`. The authorized test-only repair updated the locked recovery-job contract and set
fixture `CONTROL_SHA`; it did not change the release engine/helper. Do not combine failed and passing
sample counts. The b9 empty-merge hook ran no substantive checks.

The E 14-path D-to-E gates ran on E base plus four exact follow-up working changes later committed
unchanged as `055a285`; they were not rerun after `055a285` or the one-test correction `aef1090`.
Batch source-preservation fences were before and after execution, not per-command. Per-command times are
recoverable only at whole-second UTC precision. The earlier E 12-path standalone 71-test result remains
a narrow historical sample.

The initial exact-source E publication CI failure was not an actual credential leak: source scanning
flagged the synthetic `HUB_COOKIE_SECRET` canary alias in the release-automation test. A separate later
local M scan flagged an environment-derived unavailable-database URL and two password-free fake-`psql`
fixture URLs in M-only tests; the fake `psql` does not connect. Run `39053045735` passed affected
regressions and migration/roles but failed the canary source scan; its dependent stack job was skipped
and missing-files artifact upload was secondary. Preserve the E CI and local M failures as separate
samples without converting either to a pass or credential-leak incident.
Corrected E `aef1090` and M `2c03c17a` local scans/gates passed; corrected publication and serial new CI
are approved but not yet executed. Earlier sources E `055a285` and M `6d8c710` were published;
the corrected heads remain local. M CI has not been dispatched.

The decision owner superseded B selection `a35af555a1d1cd25e2ba9d2d98b11677ca5917c3` and selected
`2c03c17a26fcecf5f1f53abbefef471741b938b0` as B source. It is intended M gameplay, not a
gameplay-regression hedge; no B image, tag, drill or fallback qualification exists. Static labels,
exact-B authorization, Linux entry path, complete recovery matrix, SQL/ACK, scheduled-job compatibility
and next-release path remain open. The approved docs-only refresh will be a distinct M descendant of B.
Q source-only work covers seven paths and remains under review; Q has no accepted implementation,
executable qualification or evidence export, and no full configuration mapping is accepted.
An isolated-fixture profile cannot qualify a different intended deployment's exact five-field
configuration merely through an identifier mapping.

The latest recorded live observation remains r11f/protocol 5/schema 9, dated 2026-10-15. No fresh host
inspection was made for this update; newer host evidence may exist. As of 2026-10-17, previously recorded
off-machine backup/RPO and restore evidence had exceeded the 24-hour and 35-day freshness thresholds.
M images, exact-source remote CI, real PostgreSQL/roles/SQL-ACK, migration-0014 transactional index
window, complete B-aware recovery/static-image-label driver, fresh backup/restore, provider, operator,
immutable tag, publication, campaign enablement and hands-on provider/participant/device acceptance
remain separate open gates. Keep promotion preconditions separate from post-deployment enrollment and
hands-on acceptance; neither is evidence before deployment. Private launch remains NO-GO, and the
selected first delivery does not cancel later Brew, privacy-15, named-modifier-16, B3/B4, Wave D,
physical-game-day or decision-owner work.

## Current commands

```bash
# Complete Hub suite
npm run test:hub

# Complete Character Sheet suite
NODE_OPTIONS='--experimental-vm-modules' \
  npx jest test/jest/charactersheet/ --no-coverage --forceExit

# Targeted DM Screen regression used for the checkpoint
NODE_OPTIONS='--experimental-vm-modules' \
  npx jest \
    test/jest/DmScreenNpcTracker.test.js \
    test/jest/DmScreenJourneyTracker.test.js \
    test/jest/DmScreenInitiativeTrackerNpcAppend.test.js \
    test/jest/DmScreenLairMarkers.test.js \
    test/jest/dmscreen/DmScreenNpcTrackerUx.test.js \
    test/jest/hub/DmScreenHubController.test.js \
    test/jest/hub/HubHttpDmWorkspaceRepository.test.js \
    test/jest/hub/HubPartyTrackerProjection.test.js \
    test/jest/hub/HubRealtime.test.js \
    --no-coverage --forceExit

# Entire Jest/unit corpus
npm run test:unit -- --no-coverage --forceExit

# Code/style/PWA
npm run test:js
npx stylelint scss/hub.scss scss/includes/dmscreen-party-tracker.scss
npx sass --style=compressed scss/hub.scss css/hub.css
npx sass --style=compressed scss/dmscreen.scss css/dmscreen.css
npm run build:sw

# Production dependency audit
npm audit --omit=dev --audit-level=high

# Tracked-file secret scan, rollout/provider probes, and disposable HTTPS/PostgreSQL E2E
npm run hub:check-secrets
npm run hub:check-account-entitlements
# Against a protected environment with exact campaign IDs configured:
# npm run hub:check-peer-source-cost-rollout
# Against isolated staging with both providers configured:
# npm run hub:check-auth-first-enable
npm run test:hub:e2e:stack
```

The disposable stack exposes PostgreSQL only on a random loopback port for the duration of the run. Before
browser journeys, it executes the semantic-operation, inventory, provider-identity, entitlement, rules-policy, and owner-history PostgreSQL
suites against the migrated runtime role. The production-image provider smoke container is removed immediately
after its metadata check so its independent outbox dispatcher cannot consume events intended for the
socket-serving test BFF. The rules-policy parity suite proves the exact memory/PostgreSQL
response, compatibility projection, audit, ordered-event, outbox, stale-base concurrency, and rollback behavior
without adding a migration. Its content scenario additionally proves whole-document admission, grandfathered
unrelated edits, direct patch/grant/award/transfer rejection, transfer stale-pin fencing and escrow restoration,
privacy-safe rejected writes, and rollback admission. The semantic suite proves concurrent exact replay, one applied revision/event,
mutated-body rejection, explicit target-owner approval under competing commands, atomic source-slot decrement plus
target healing, source/target/combined watermarks, bounded expiry, lifecycle cancellation, and minimized
explicit-recipient terminal payloads.

The real-stack runner has a 45-minute child-process timeout and total watchdog, a 50-minute workflow-step
timeout, and a 60-minute job timeout. Normal local/CI runs take roughly 6-10 minutes; the margins allow cold image
pulls/builds and slower shared runners without approaching GitHub's broad default ceiling. A timeout prints a
structured stdout diagnostic plus a bounded stderr summary containing the run/project identity, active phase,
requested spec scope, sanitized active command (including cleanup commands), and Playwright artifact paths.
Child and total timeouts send SIGTERM to each exact owned child process group, escalate to SIGKILL after
five seconds, and await termination before isolated Compose/image cleanup or exit 124. A leader exiting on
SIGTERM does not cancel escalation while descendants remain in its group. SIGINT/SIGTERM shutdown uses the
same awaited escalation while preserving exit codes 130/143.

Cleanup has its own one-minute deadline, including cleanup children, rather than inheriting the ordinary
child's 45-minute budget. It remains bounded after normal completion, errors, signals, or total timeout.
The total watchdog remains armed until cleanup settles. Interrupted or timed-out cleanup exits unsuccessfully
and never emits `hub_e2e_cleanup_complete`; remaining isolated Docker resources require manual inspection by
the recorded project/image identity, not broad Docker cleanup. `HUB_E2E_CLEANUP_TIMEOUT_MS` accepts 60,000
through 300,000 ms, and `HUB_E2E_TERMINATION_GRACE_MS` accepts 100 through 10,000 ms. Shorter deadlines are
accepted only with both `NODE_ENV=test` and `HUB_E2E_ALLOW_SHORT_TIMEOUTS=true`. These controls do not increase
CI or Playwright timeouts; outer step/job budgets remain the final safeguard.

`HubCiContract.test.js` invokes the actual runner with mocked Docker and real SIGTERM-ignoring Node processes.
It verifies required-child timeout, total timeout, stalled cleanup after both ordinary failure and total
timeout, a surviving descendant after its leader exits, signal exit codes, and normal successful restart/cleanup.
Exact PID checks require termination before cleanup begins and before runner exit; fixtures clean up only their
owned process groups. The existing 50 ms required-child timeout remains covered, and wrong-exit assertions
include captured stdout/stderr. These are local harness proofs, not real-Docker, database, or deployment evidence.

Resistance probes use a test-only Node preload at the real `spawn` call site. It tracks the actual owned PID,
releases an initialization gate, sends a nonce-bound signal challenge, and requires an acknowledgement written
by that child's signal handler plus a live-PID check before returning the real child to the runner's unchanged
timer call site (500 ms in the ready-child timeout probe). SIGTERM challenges the ignoring children; SIGINT
challenges the descendant's leader, which intentionally exits on the later measured SIGTERM. Assertions
require both challenge acknowledgements and the later measured signal receipts, not just PID presence.
Signal tests likewise wait for acknowledged resistance before interrupting the runner.

This seam deliberately separates startup scheduling from ready-child termination; it is not evidence about
Node boot speed. A separate real-runner probe withholds the initialization gate, deterministically reproducing
the former fixture's missing handler/PID records while independently tracking exactly one spawned child.
That child must still terminate under the unchanged 500 ms deadline with no resistance claim or survivors.
The unpreloaded 50 ms probe remains unchanged. Total and cleanup watchdogs keep their original wall-clock
budgets across the readiness seam; cleanup completion is determined by actual runner output, never readiness.
All probes retain the four-second external hard bound, and the handshake has a shorter three-second bound.

On 2026-09-21, run `35600079625` was cancelled after a timezone misread made a roughly two-minute live Playwright
step appear three hours old. Terminal logs showed PostgreSQL parity had completed and Playwright was active; the
cancelled run is not evidence of a product deadlock. It did expose that the job had no explicit timeout or
phase diagnostic, which the bounded watchdog contract above now corrects.

Memory and real-PostgreSQL tests put 501 privacy-redacted character events before a visible semantic lifecycle
event and prove replay advances by the server-scanned sequence even when a page returns fewer than its limit.
Both stores bound each read to `limit + 1` raw campaign-sequence rows before audience and projection filtering;
the memory cursor test also proves a 150,000-event history remains stack-safe and pages audience-hidden rows
without scanning the whole history.

Invite-admission tests additionally assert the pre-account transaction boundary rather than only final state:
account/identity/session/membership/invite-use/audit/event/outbox either all commit or none do. They cover
max-use races, duplicate raw-token hash conflicts, provider failure after OAuth-state consumption, callback
replay, two-tab cookie/state mismatch, creator purge/revoke interleaving, deletion/suspension status, safe
return paths, final-cookie-jar multi-tab correlation, abandoned/consumed opaque retry replacement, and no raw invite/context material
in receipts, logs, URLs, or backup paths.
Entitlement tests additionally assert zero campaign/membership/audit/event/outbox/receipt writes on denied
creation, revoke-vs-create serialization, concurrent mutual operator revocation, stale-at-commit rejection,
add-only UUID reconciliation, actor-FK-safe purge, and no campaign event for account administration. A mutation
probe must remove the transactional freshness or last-operator guard and demonstrate a targeted failure before
the unmodified gate is trusted.
Realtime tests cover 26 exact continuation pages on one connection, one-time connection-scoped rate-limit
exemptions, forged/replayed marker limiting, reconnect preservation, exact-once accumulation, and explicit
campaign-client close/reset. They also interleave live delivery with a periodic multi-page replay and prove
recovered and live events emit exactly once in sequence order without an overlapping watchdog resync. Dispatcher
tests deliberately return a claimed same-campaign batch out of order and prove sequence-ordered publication plus
failure blocking. Any server error during replay must close/reconnect, preserve its replay marker, and recover
buffered live events exactly once.

The memory semantic suite additionally covers every version-1 kind, player generic-operation denial,
DM/co-DM immediate application, self-target explicit approval, DM non-owner approval denial, unsupported and
stale source cost/policy, apply-time targetability, target-ref rotation, revocation cleanup, and projection
privacy canaries. Protocol-4 source-cost suites additionally prove exact-ID new-campaign rollout state,
production configuration validation, PHB/XPHB Cure Wounds derivation and selector gating, no mutation before
consent, slot decrement plus healing, reject/cancel/expiry no-op behavior, concurrent last-slot serialization,
permanent spent-then-restored slot invalidation, class/preparation/casting-ability derivation, self-target
combined writes, capability skew, per-leg dedupe, privacy-shaped failures, and reactivation of an already-open
Character Sheet after authoritative context changes. The production-derived three-user browser journey begins
with no active rules/capability, observes the disabled selector state, activates rules through the supported API,
and then exercises PHB and XPHB targeting. Its `*` gate remains confined to the isolated test entry point; exact
production enrollment is covered by the closed parser and read-only pre-cutover readiness check.

Wave A2 extends the source-cost proof without adding production templates. `HubSourceCosts` now covers exact
schemas and safe-integer bounds, duplicate aggregation and canonical ordering, standard/pact slot integrity,
campaign-brew item identity, charge/quantity metadata preservation, safe versus unsafe zero removal, unique
feature-resource linkage, exact feature/innate-use mirrors, multi-component resolve-before-mutate behavior, and
spend/restore ABA snapshots for every version-1 binding. Store-level adapter tests inject server-owned test
templates so browser choices cannot select resource ids or amounts; production remains limited to the existing
Cure Wounds standard-slot journey. The semantic mutation gate now plants 19 defects, including source-cost
rederivation bypass, permanent-invalidation removal, ambiguous entry acceptance, partial staging, feature-mirror
omission, unsafe zero removal, and target-event source-detail leakage.
`HubMemorySourceCostAcceptanceAtomicity` injects failures at source/target/combined event creation, projection
invalidation, audit, and semantic-command receipt persistence for distinct and self-target acceptance. Every
failure must restore character data/revisions/watermarks, operation terminal/result ids, event/campaign-event/
outbox/audit collections, and command receipts exactly, after which one retry commits once. The disposable stack
runs `HubSourceCostAdapterAuthorityPostgres` before browser journeys so migration-0010 identity/cardinality,
ordinary owner-write ABA, concurrency, replay, metadata, mirror, and privacy parity are proven under real locks.

Wave A1 additionally owns direct-operation parity for all six version-1 kinds, 30-character condition-source
schema parity, exact changed-body rejection, and the migration-free no-op contract. Memory and PostgreSQL tests
assert unchanged character JSON, a revision-only ordering point, terminal audit/applied-event/receipt evidence,
and no projection invalidation for heal-at-max, add-existing-condition, remove-absent-condition, and
restore-full-slot. Character Sheet tests assert per-track no-op transforms, zero redundant live adoption/render,
one accessible notice, HTTP-plus-realtime dedupe, reverse-delivery resync, save interleavings, and
character/access/document-generation fencing.
`HubDmEffectSubmission.test.js` executes the shipped submit listener and authorization dispatcher: a committed
effect followed by a terminal authorization failure conceals campaign data and stops live updates, without
retrying the mutation. Transient refresh failures preserve committed success; stale responses cannot publish.
`scripts/test-hub-semantic-operation-mutations.mjs` plants twenty defects at the real role, write/event ordering,
idempotency, invalidation, coverage, document-track, post-await fence, and duplicate-delivery call sites. The
gate must demonstrate that every mutant is killed before the unmodified result is accepted.

Wave A3 server authority is covered by `HubMultiTargetOperations.test.js`,
`HubMultiTargetOperationsPostgres.test.js`, migration/role/rollback suites, route/WebSocket protocol tests, and
the real-call-site `scripts/test-hub-multi-target-mutations.mjs` gate. The Memory suite covers protocol 3/4/5
closure, route 429s, 1/2/8 targets, same-owner invitations, source-as-target, privacy-preserving no-op, target
authority retry, independent cancel, lifecycle, bounded expiry/cleanup, persistent protocol markers, pagination,
and injected transaction faults. PostgreSQL's 20-test focused suite owns 1/2/8-target parity, both seed-10
cross-campaign quota races, opposing character order, response/expiry, target-drift retry, ABA, source-as-target,
privacy-preserving no-op, transaction fault rollback, nonblocking campaign/parent/child-first maintenance,
immutable/consent/contiguous-selection constraints, persistent campaign protocol markers, FK-safe
lifecycle/purge, cleanup, and pagination. The mutation gate plants eighteen real-call-site defects, including a
blocking parent lock which lets a child-first locker stall maintenance, source envelope oracle, failed-leg
selection drift, live-parent/candidate membership guard removal, unreviewed no-op retry, and retained audience
discriminator loss, live-parent purge without cancellation, and omitted ready/elapsed receipt event identities,
and must kill all eighteen.
Privacy tests compare source HTTP replay and WebSocket projection against target-owner/DM views at both changed
and allowed-no-op targets, including source-as-target, and assert the source receives neither payload result
fields nor the character aggregate id/revision envelope. Failed-finalization parity tests assert PostgreSQL and
Memory retain approved/unselected legs with no declined event. Direct PostgreSQL negative controls attempt live
candidate delete/replacement and parent candidate-count mutation and require SQLSTATE `23514`.

`HubMultiTargetOperationAdr.test.js` must fail when a required lifecycle, migration, lock-order,
privacy/no-op, rollback, hazard, limit, singular-read rewrite, or handoff clause is removed. When
`HUB_TEST_POSTGRES_URL` is available, it executes the read-only SQL proof inside `BEGIN READ ONLY` and rolls back;
the proof validates candidate uniqueness, selected-subset membership, source/target deduplication, self-target
collapse, and ascending UUID set-shaping/order without creating or mutating schema. It is not a lock proof and is
not a substitute for A3's fresh/upgrade/concurrency/fault-injection PostgreSQL implementation tests.

A3's required implementation matrix includes same-owner/two-target invitations, source-as-target, response versus
finalization/collection-expiry, maintenance expiry without readers, source-cost ABA, move/archive/removal/purge,
protocol-3/4/5 fail-closed mutation/read/WebSocket/resync/replay with protocol-6 success, allowed full-HP and
cross-target audience privacy canaries, opposing UUID and opposite-parent-discovery deadlock probes, fault
injection after every target/event/receipt, Memory/PostgreSQL parity, transactional live-cap winners, churn/429,
oldest-pending pagination without starvation, 90-day bounded cleanup, A3-aware bridge rollback, and true pre-0011
usage-marker-absent preflight for migration 0011. It must also race cross-campaign proposals at the same target-owner cap under
opposite account-discovery order, proving one seed-10 winner, one loser, and no deadlock; marker tests cover
first-use insert, cleanup persistence, backup/restore, role grants, and rollback fencing.
Participant-recovery coverage keeps default pending fairness, pages only the viewer's own live/recent legs,
proves the migration 0012 index in a real runtime-role query plan, and verifies target no-op event sequences
without inventing canonical watermarks.
It also proves database-microsecond cursor pagination for same-transaction legs, repeatable-read membership
fencing for inbox/outgoing, current-visibility shaping for source DTO/replay, and exact own-leg target-ref binding
for duplicate-named characters with move/archive/access-loss invalidation.
Migration 0013 tests reproduce the prior real archive rollback, retain a live parent with a revoked source-owned
candidate plus an approved peer leg, reject source-owned pending/peer-approved and peer auto-approved states,
and kill a real-call-site mutation which restores the old live-parent equivalence.
Exact-replay tests hide or archive a target after proposal, then prove the same command/event/operation identities
return with current neutral presentation. Demoted co-DM response/cancel exact retries are denied in Memory and
runtime-role PostgreSQL while current source, target-owner, and DM participants retain their audience-shaped
replay and stored receipts/events/revisions remain unchanged. Controlled real PostgreSQL interleavings prove
that a privacy write, detail read, and member removal complete without `40P01`; an empty-selection finalization
cannot interleave between detail parent, target, and finalization reads. A call-site mutation removing current
replay participation authorization is killed by the demotion regression.
Historical replay tests approve then deselect a target and propose then finalize/cancel/expire, proving exact
retry returns the original stored command outcome rather than later workflow state while current labels, refs,
capabilities, and audience fences still apply. Runtime-role PostgreSQL races exact target response replay against
source-account purge and detail against retention cleanup in both reader-first and writer-first order. They
require no `40P01`, unchanged durable command evidence, and either one coherent pre-delete aggregate or stable
not-found. Call-site mutants restore later-outcome substitution, the pre-campaign command-row lock, and cleanup
without the campaign advisory; all must be killed.

A separate A3 PostgreSQL source-account-cap test seeds one source account with four live collections, then races
proposals in two different campaigns for slot five under the seed-10 source-account lock. It must produce exactly
one committed winner, one stable `COLLECTION_LIMIT_REACHED` loser, no deadlock, and no loser parent, target-child,
audit, domain-event, outbox, semantic-command, or receipt evidence.

## Test data rules

- Never use a real OAuth token, invite token, database URL, or private character in fixtures.
- Use stable synthetic account/campaign labels and generated UUIDs.
- Malicious fixtures must be inert strings, not executable external resources.
- PostgreSQL drills use a disposable UTF-8 database and an isolated restore target.
- Test-auth code must live only in a test entry point and must fail startup in production mode.

## Remaining V1 target-environment coverage

Annotated release `hub-staging-2026-09-10-r7` is deployed. Its real-host release, manual operations,
Healthchecks.io signals, encrypted off-machine backup, authenticated isolated restore, continuous RPO/RTO,
exact-r6 rollback, exact-r7 return, and exact cleanup passed on 2026-09-12. Genuine scheduled maintenance and
backup executions then passed on 2026-09-13 with one succeeded operational row each, verified
archive/heartbeat evidence, exact production identities, zero restarts, and migrations `0001`-`0007`.
V1-G1 is complete. V1-G2 now requires the physical
[one-DM/two-player game day](runbooks/private-game-day.md).

## Evidence record

For each release candidate, record:

| Field | Value |
|---|---|
| Git commit/image digest | |
| App/protocol/migration versions | |
| Date/operator | |
| Unit/Hub/Character Sheet/DM Screen totals | |
| Migration paths tested | |
| Container/Compose result | |
| Dependency/SBOM/image scan result | |
| Browser contexts/devices | |
| Load/fault scenarios | |
| Backup id and restore target | |
| Restore duration and resulting checks | |
| Open defects/waivers | |
| Go/no-go decision | |

Evidence containing secrets or user data belongs in the approved private operational store, not Git.

## Phase 6B-6E evidence

- Hub: 39 suites / 254 tests.
- PostgreSQL 17: fresh 0001+0002, pre-ledger baseline+0002, concurrent runners, failed 0002 rollback,
  checksum mismatch, restored-database upgrade/readiness.
- Runtime role: CRUD allowed, schema create denied.
- Backup role: reads allowed, writes denied.
- Lifecycle: invite/member/session administration, escrow restoration, character detachment, restricted
  deletion reauthentication/cancellation, FK-safe purge.
- Browser: active account/device controls, pending-deletion surface, DM member/invite controls at desktop and
  390 px mobile with no console error/overflow.
- Deployment: BFF image build via configurable registry, UID 10001/read-only runtime, ~85 MB BFF and ~70 MB
  static images, Compose migration/grant ordering, least-privilege BFF readiness, static/API/auth/WebSocket
  edge probes, and graceful SIGTERM restart.
- Operations: migration 0003; singleton-lock and seeded technical cleanup drills; protected aggregate metrics;
  OAuth query/secret log scan; backup/evidence role boundaries; AES-GCM tamper failure; encrypted backup and
  isolated restore with matching SHA-256 and persistent age metrics.

## Phase 6F evidence

- Hub: 41 suites / 265 tests.
- Repository JavaScript lint, focused Hub/DM Screen SCSS lint, service-worker build, production dependency
  audit, tracked-file secret scan, and CycloneDX Node SBOM generation passed.
- Dedicated Playwright discovery: 2 tests in 2 files.
- Disposable same-origin HTTPS/PostgreSQL stack: both scenarios passed in 50.5 seconds in CI reporter mode.
- Lifecycle scenario: DM/player sign-in, campaign/invite, cloud Character Sheet, XP, structured damage, party
  inventory transfer, second-device session revoke, member removal/detachment, deletion request/cancel.
- Budget scenario: six active members, 1.4 MB character, 500 roll writes/replay page, concurrent transfer
  reservation with one success/one conflict.
- Fault probes: independent BFF restart and PostgreSQL restart both recovered `/api/ready`; stack teardown
  removed the unique per-run test project's containers, networks, volumes, and images without touching a
  normal Hub project or externally supplied production image.
- Cancellation drill: SIGTERM during a child image build propagated to the process group, exited 143, and
  left no matching containers, volumes, or networks.
- Supply chain: production BFF image builds, Node SBOM generation passes, and CI is configured to emit the
  exact image archive, image SBOM, provenance record, Trivy scan, and success/failure Playwright result.
- Image equivalence: the synthetic-auth layer derives from the downloaded production image, and the
  unmodified production image must boot its real entry point and become healthy against the migrated test
  database before Playwright starts.
- Secret fixtures cover direct/YAML, shell `export`, Docker `ENV`, inline JSON, continued lines, classic and
  fine-grained GitHub tokens, database URL, OAuth, cookie, CSRF, metrics, backup, and test-auth assignments.
  Large text/source files are scanned; only known binary formats are explicitly counted as skipped.

See [CI and provenance](ci-and-provenance.md) for job ownership, test-auth boundaries, and artifact semantics.

## Provider registry layers 1-2 evidence

- Registry unit tests prove duplicate/mismatched routes and identities fail closed, configuration errors expose no
  credential text, and a failed sibling registration does not disable valid GitHub authentication.
- Memory and PostgreSQL parity tests cover immutable `(provider, subject)` resolution, atomic
  account/identity/session creation, session provenance, one-time provider/operation/redirect-bound state,
  expiry/cleanup, orphan rollback, deferred last-identity protection, runtime role access, export, and token
  absence.
- Discord tests cover canonical token/profile endpoints, Basic confidential-client exchange, exact `identify`
  scope, decimal-string snowflakes, profile bounding, and generic failure handling.
- Google tests use generated RSA keys and deterministic JWKS to cover issuer/audience/`azp`, expiry/issued-at,
  nonce, `sub`, algorithm/key rotation/cache, and malformed/oversized upstream failures.
- The disposable HTTPS/PostgreSQL stack uses test-image-only deterministic GitHub, Discord, and Google adapters
  and local authorization endpoints. CI makes no external provider call and uses no real provider token. The
  unmodified production image boots all three real adapters and proves readiness without initiating OAuth.

## Shipped V2 foundation evidence

- V2-T5 active-context coverage exercises precedence, capability failure, generation fencing, ordered teardown,
  account isolation, local fallback, same-profile convergence, independent browser profiles, surface defaults,
  temporary-only campaign brew, Character Sheet/DM Screen privacy teardown, BFCache, reconnect, revoke/archive,
  responsive switcher states, and production service-worker/static packaging.
- `npm run test:hub:mutations` copies the relevant lightweight modules into isolated temporary directories and
  kills seven active-context mutants (stale-generation acceptance, teardown reordering, cross-account record
  retention, inverted local fallback, pinned-campaign reselection loss, Character Sheet save-fence removal,
  and DM workspace save-fence removal) plus six rules-policy mutants (strict historical diffs, missing
  encumbrance dependency, stale reconnect loads, editable busy controls, terminal access-lock loss, and hidden
  optional-chunk failure) and twelve content-policy mutants (candidate/source/edition bypasses, canonical identity
  and grandfather-delta mistakes, official-source spoofing, feature-level fencing, context teardown/access-loss,
  policy-version fencing, and refresh-time custom-content fail-open).
  It never rewrites the working tree.
- `test/e2e/hub/active-campaign-context.spec.ts` runs against the disposable exact-image HTTPS/PostgreSQL stack,
  including real `localStorage`, `BroadcastChannel`, Character Sheet, DM Screen, membership, archive, and BFCache
  behavior.
- `test/e2e/hub/campaign-content-gating.spec.ts` drives the production-derived Character Sheet Builder,
  multiclass Level Up, import, direct API rejection, legacy warning/unrelated edit, immutable rollback,
  multi-tab convergence, and explicit local restoration against the real HTTPS/PostgreSQL stack.

- V2-T0 release automation shipped in [PR #219](https://github.com/TrueMichato/ThelemarTools/pull/219):
  25 focused release/deployment/documentation contracts, shell/Bash/Python validation, and Compose rendering
  passed. The PR explicitly leaves the live Oracle induced-failure drill to V1-G1.
- V2-T1 activity history shipped in [PR #218](https://github.com/TrueMichato/ThelemarTools/pull/218):
  75 targeted presentation/deployment/Character Sheet roll-history tests, the full Hub suite, disposable
  PostgreSQL lifecycle integration, JavaScript lint, style lint, and all four Hub CI jobs passed.

## 2026-09-05 merged-head evidence

- [PR #242](https://github.com/TrueMichato/ThelemarTools/pull/242), merged as
  `168d6e9ac36c11e2c938f21a4324b803f3f2fb61`, reported 93 Hub suites / 1,230 tests, 677 full Jest suites /
  17,800 tests, 7/7 active-context, 6/6 rules-policy, and 11/11 content-policy mutants killed, 25 migrated
  runtime-role PostgreSQL tests, and 24 production-derived Chromium journeys.
- [PR #243](https://github.com/TrueMichato/ThelemarTools/pull/243), merged as
  `b8d31d3416b934cc9275b859b5932db050005351` from head
  `c8d5f0333d1bd8f7867b91c7ecb7170a9838671b`, reran the complete Hub suite, mutations (7/7 active-context,
  28/28 rules-policy, 12/12 content-policy), 31 PostgreSQL gate tests, 25 Chromium journeys, JavaScript/style
  lint, production builds, secret scan, dependency audit, and bounded desktop/mobile day/night review.
- PR #243's pre-push full-Jest handoff recorded 678 passing suites plus two nested-Git release-fixture failures;
  those fixtures then passed 17/17 directly. It also recorded the checkout's existing `npm run test:data`
  LinkCheck discrepancy as 550 missing links (534 in generated `data/crafting.json`, 16 elsewhere). Those
  environment-specific observations are preserved rather than advertised as a verified exact current baseline.
- These are merged-code records, not Oracle deployment evidence. V1-G1 must promote and exercise a verified
  descendant release before the newer behavior can be claimed on staging.

## Phase 6G preparation evidence

- Current Hub gate: 45 suites / 315 tests.
- `HubClientIp` verifies the supported header allowlist, single IPv4/IPv6 parsing, safe fallback, structured
  logging, rate-limit isolation, unsupported configuration, and mutual exclusion with proxy trust.
- `HubWebSocket` verifies the resolved provider client address reaches WebSocket connection context.
- `HubRealtime` verifies ping/pong liveness and termination after a missed heartbeat; `HubWebSocket` also
  verifies bounded code-1001 shutdown during plugin pre-close.
- Exact-image real-stack Playwright now covers four scenarios. The readiness journey verifies Hub discovery
  and attachment of detached characters, non-destructive clone as the default, compatibility review before
  an explicit move, another-device lease refusal, retry after lease release, and idempotent move replay.
- The role-aware campaign page contract covers role gating, primary player/DM tasks, inbox and activity states,
  disclosed administration, mutation feedback, and invite-copy behavior. Desktop DM and 390 px player layouts
  were checked with representative data, clean consoles, and no horizontal overflow.
- The lifecycle journey now grants a Longsword through the on-demand core item catalog, proposes and applies a
  contextual spell-slot spend, then selects that stack and transfers it with non-zero CP/SP/EP/GP/PP. The DM
  inbox asserts the human-readable actor, source, item, quantity, denominations, endpoints, and waiting state.
- The item-catalog unit contract combines regular items, base items, and active campaign brew, deduplicates by
  case-insensitive `name|source`, and surfaces loading failures without adding data files to initial Hub boot.
- The signed-out Hub scores 100 in Lighthouse accessibility snapshots in both desktop/day and 390x844
  mobile/night configurations. Both runs report zero failed accessibility audits.
- Real-stack Playwright verifies the skip link moves keyboard focus to the main landmark, the Hub and campaign
  retain a semantic `h1`, Hub-owned controls have accessible names, entry controls retain 44 px targets, and
  signed-out/campaign layouts do not overflow at 390x844 portrait or 844x390 landscape.
- The capability-gated rules journey publishes two advisory policies, detects and recovers a stale base while
  preserving the local draft, rolls back to an immutable earlier version, and verifies the player receives only
  the bounded read-only summary. Catalog/policy/API contracts mutation-check role denial, unknown ids, malformed
  parameters, false enforcement labels, unavailable planned selections, version/catalog/base fencing,
  idempotency-key reuse, concurrent writers, and rollback evidence.
- The Character Sheet campaign flow verifies that opening the campaign panel moves focus to its destination
  picker and closing it restores focus to the replacement toggle.
- Character lifecycle regressions verify that known-new Builder/import saves create directly, adopt the canonical
  id, refresh/select the cloud roster before realtime attachment, and do not emit a deliberate missing-character
  probe. Projection regressions preserve `owner_truth` versus `dm_truth`; a DM view keeps live reads but disables
  mutation controls and skips owner-only sharing, pending-action, targeting, lease, and party-inventory calls.
  Deferred-read coverage bursts projection invalidations and live signals around slow DM reads, proving one active
  request, replaceable trailing demand, eventual newest-projection adoption, lifecycle fencing, and live retry
  after a transient failure.
  Same-tab account-switch coverage proves a failed owner draft is account-scoped, cannot replace a later DM's
  projection, and cannot stale a subsequent invalidation refetch. Selector, New, Duplicate, file-import, and
  programmatic-create barriers prove a save/create completion from A cannot replace a newer B selection.
- Campaign action contracts verify that condition add/remove uses the canonical core plus active campaign-brew
  catalog and submits the selected `name|source` identity rather than accepting free-form condition text. The
  browser journeys recover module and data failures through ordinary realtime refresh, reuse a loaded module for
  data retry, and prove persistent module failures stop after the finite fresh-URL budget without moving the
  catalog into lightweight page boot.
- Failure-state hardening classifies fetch rejection, malformed success, and unreadable 503 responses without
  exposing browser-specific errors. Campaign UI contracts cover offline retention, reconnect refresh, direct
  protocol reload, terminal read-only access state, size/safety validation, insufficient transfer/resource,
  lease, and conflict copy.
- Real-stack lifecycle coverage now proves offline/reconnect posture, protocol-update recovery, an insufficient
  spell-slot action followed by rejection, client-side insufficient-currency feedback, and read-only state
  after live session and membership revocation.
- Realtime campaign coverage proves that accepted Character Sheet HP edits and initiative rolls reach the DM
  roster/activity view, a second device is initially read-only, lease takeover fences the stale writer, and
  campaign pages react immediately to session or membership revocation. DM truth coverage keeps an inspection
  sheet open while the owner performs an ordinary document save, proves the disabled sheet converges without a
  reload, fails the scoped projection reads on one reconnect, reconnects again against the same cursor, proves
  the pending refresh converges, forces a later resync, and verifies no owner-only lease, sharing, pending-action, targeting,
  inventory, or document-mutation request escapes. The browser journey also exercises Enter/Space against a late
  Play Mode role-button, blocks its global toggle shortcut, context menus, and favorite drag reorder, and keeps
  More/Export/Print reachable. Realtime seams prove item invalidation remains live without a DM recipient toast
  and DM-visible XP awards perform a scoped truth refresh without presenting the awarding DM as the recipient.
- Character Sheet repository regressions prove that canonical create/import commits remain successful when roster
  or campaign-control refreshes fail, realtime binds to the canonical id before those reads, and a genuinely failed
  duplicate restores the source character's campaign controls. Realtime teardown regressions preserve structured
  lifecycle causes, including cursor-then-replay cause upgrades, so campaign archive clears the selected campaign and
  temporary context, DM-role loss closes only the private surface, and character archive/move remains resource-scoped.
  Repository ordering coverage proves a delayed stale roster cannot replace a newer accepted realtime revision.
  Deferred move and terminal-delete races switch to a second character before settlement and prove the old operation
  cannot detach, restore, reconcile, navigate over, or conceal the selected character.
- Campaign-move regressions advance the load generation through `A → B → A` while a save is deferred and prove the
  stale move cannot release a lease, detach realtime, mutate the campaign, navigate, or bind an old compatibility
  preview merely because the original character id is selected again.
- Campaign overview revocation coverage removes the active membership over the real socket and proves the entire
  previously authorized DOM is destroyed immediately, not merely disabled while private roster/profile/member,
  inventory, pending-action, transfer, or administration content remains present. A separate HTTP-first journey
  blocks realtime and proves a rejected mutation performs the same concealment, while session revocation retains
  the established last-known signed-out read-only fallback. Character Sheet campaign refreshes separately prove
  signed-out or terminal campaign authority loss propagates, conceals the loaded Hub document, and prevents a
  realtime subscription from attaching to already-invalidated authority.
- Campaign snapshot consumers coalesce `character.projection.invalidated` metadata into one authorization-scoped HTTP refetch and fence older
  in-flight snapshot responses with the campaign event sequence, so an authoritative refresh cannot regress a
  newer visible projection. Policy-change invalidations snapshot the old-or-new authorized audience and redact
  peer actor identity while remaining campaign-scoped and character-id-free, allowing a previously shared row to
  disappear before the replacement snapshot without exposing it to later or never-authorized peers. A single
  10-second client watchdog requests an authoritative snapshot while the
  socket remains live. During replay it allows a full unchanged interval before reconnecting, so advancing
  continuation pages are not interrupted while a stalled chain still recovers.
- Memory, PostgreSQL, and real-browser lifecycle coverage verifies clone destination, move source/destination, and
  archive removal invalidations. The browser keeps both source and destination campaigns live while an owner
  changes an identity-hidden, HP-shared character, proving peers converge only through campaign-scoped,
  character-id-free invalidations. Campaign action/XP selections survive authorized label refreshes, while a
  deliberately empty item-recipient set stays empty and disabled rather than silently retargeting.
- Browser coverage defers an old pending-action response across a newer sharing-policy invalidation, fails the
  replacement snapshot, and proves the stale response cannot repopulate concealed identity. The transfer journey
  separately proves source/target/item/currency drafts survive an authorized refresh, transient submitting state
  does not permanently disable retry, and committed refresh failures retain only a generic recovery row.
- Session-revocation coverage holds a transfer POST in flight while another device revokes the session, then proves
  its late cleanup cannot re-enable any campaign mutation control; Sign out remains the sole enabled control.
- Character Sheet realtime regressions use deterministic fake sockets and repository barriers to prove stale
  socket messages/closes cannot advance the cursor, replay/live duplicates collapse, lifecycle states remain
  ordered across owner/DM watermarks, in-flight saves finish before callbacks, and switch/reopen/access-loss
  generations cannot deliver stale work. Static safety guards prohibit projection fetches, state load/render,
  save, and generic conflict entry from the coordinator.
- Moved-character browser coverage opens the old campaign URL and proves it canonicalizes before campaign
  context activation. Journey Tracker regressions prove linked campaign participants and their activity/slot
  references remain ephemeral.
- GD-FIND-014 authority-routing coverage opens the same character from ordinary Character Sheet navigation and
  Campaign Overview, proves both repository instances accept the same canonical id and revision, then enters
  explicit Local mode with a deliberately colliding local id. Local writes leave the canonical revision/data
  unchanged; refresh and a new tab retain an exact validated return link; returning restores the canonical
  owner document. A parallel DM journey proves the same round trip returns to `dm_readonly` truth and emits no
  canonical write. Unit seams separately hold queued saves before navigation, reject refused recovery, rewrite a
  temporary id after canonical adoption, and fence realtime/recovery callbacks before leaving.
- Transfer acceptance refreshes canonical character documents, shared inventory, balances, source/target/item
  pickers, and the inbox together; the lifecycle journey proves the accepted item is immediately selectable
  from party inventory without reloading. Transfer authority coverage exercises player-to-own/peer/DM-owned and
  DM-to-owned/player-owned destinations, verifies direct DM and same-owner moves are committed atomically by the
  server without a recipient-resolvable reservation or redundant browser resolution, keeps player stash
  requests non-escrowed until DM approval, proves stale approvals return `TRANSFER_INSUFFICIENT`, and forces a
  post-mutation refetch failure before retrying balances and completing another transfer without a page reload.
  Inbox resolution coverage loses approve/decline responses after commit, reuses the same decision key, and
  distinguishes a known committed outcome from a failed authoritative refresh with an explicit inbox retry.
  Character Sheet refresh/retry tests assert a real refetch, visible pending/success/error state, and retained
  last-good stash content; cancelling a definitively failed draft cannot clear its dual-refresh gate or enable a
  new stale proposal, and spectators and unresolved roles receive a read-only stash rather than a rejected
  Request action. Repository and real-stack regressions also prove deterministic Character Sheet item aliases
  cannot create a false inventory overlap, semantically converged stale recovery records clear before the next
  save, canonical-equivalent failed writes stop reporting false pending work, and genuinely unique failed or
  discarded local intent remains recoverable across authoritative, live-operation, and resync paths.
  Recovery-safety regressions additionally cover create/patch `POLICY_VERSION_STALE` with stale embedded carry
  identity, persisted replacement envelopes across reload and later saves, activity-only expiry quarantine,
  deadline crossings during awaited CREATE/PATCH preflight, no key rotation/resend after a stale rejection crosses
  the deadline, response-loss resource casts quarantined before receipt expiry, in-window revision conflicts
  retaining activity after an empty rebase, expired/unexpired/activity-free hydration, committed-then-removed
  creates never being recreated, stable poison heads becoming actionable export/use-server blocks, and definitive
  missing-server PATCH recovery surviving reload before export-then-remove-local resolution. The PATCH regressions
  cover both `CHARACTER_NOT_FOUND` and `IDEMPOTENCY_RESULT_GONE`, including CREATE success followed by activity
  PATCH failure, exercise production `pGetCampaignId`/roster/character reload routing, prove another account
  cannot discover the recovery, prove canonical/temporary aliases survive an owner-visible import-id collision,
  require the stored create record's import id to match the lookup alias, preserve the original temporary alias
  across canonical-key hydration and a second interrupted-startup reload, prove no rematch or replacement CREATE
  occurs, and verify a later save uses a fresh character identity. A real-browser dropdown regression drives the production
  `_updateCharacterDropdown` against an actual `<select>`: successful refresh selects the visible Create New
  Character option, while failed refresh removes the inaccessible character option without rolling back the
  committed discard. Memory and PostgreSQL authority tests prove stale carry rejection changes no character
  revision, audit, event, outbox, or receipt evidence.
- Item-award regressions mutation-verify role/tenant/target gates, strict source and note/quantity bounds,
  trusted site/campaign identity resolution, cross-authority collision rejection, resolved Recent provenance,
  full authoritative metadata persistence, privacy-reduced
  command/event projections, multi-target rollback, exact retry and concurrent duplicate behavior,
  award-to-Character-Sheet-save-to-repeat-award stack identity, direct/stash-return metadata conservation,
  accept/reject/cancel behavior, metadata-diverged same-ID escrow restoration with collision-free source stacks
  and exact quantity conservation, deterministic LIFO lifecycle restoration and cancellation-event order for
  independently reserved whole stacks, stash conservation under contention, memory/PostgreSQL parity, carry
  invalidation, stable audit/event/projection ordering,
  privacy-safe preview states, normalized retry identity, legacy-summary Character Sheet rehydration, trusted
  focus/weapon hydration across quantity-only authoritative changes, custom-item metadata preservation, raw
  patch-value rematerialization, and open-sheet authoritative reconciliation. A complete generated-artifact
  equality test prevents the browser
  item data and BFF award catalog from drifting. Character Sheet migration coverage also rejects renderer/filter
  caches, empty renderer-created `entries`, and renderer-injected `additionalSources` while retaining
  source-authored `hasRefs` and `additionalSources` from real site catalog entries through repeat award and stash
  return. A production-order loader regression mutates both a shipped instrument and a synthetic campaign-brew
  instrument in place, proving the minimal site repair projection was captured before enhancement and excludes
  mutable brew metadata. Duplicate official/brew UIDs, recursive `_copy` parent collisions, typed/typeless Hub
  inventory, variant-component collisions against prerelease/brew, and changed brew content across export/reload
  are also pinned fail-closed while local-save brew effect hydration remains covered. The real-stack
  lifecycle commits a multi-character catalog award
  behind a lost response, changes incidental form state, retries with the same key, verifies canonical weapon
  type/damage/value/weight metadata on both characters, observes exactly one live arrival on an already-open
  owner sheet, then verifies the same metadata after a stash round trip without loss or duplication.
- The saturation scenario runs after the interactive journeys, writes 500 rolls, exercises six members, large
  character documents and transfer contention, then waits for the transactional outbox to drain completely
  before cleanup.
- The current four-scenario PostgreSQL/HTTPS run passes in 3.0 minutes and still recovers from independent BFF
  and database restarts, passes production-entry-point smoke, and removes its isolated resources.
- Oracle operations contracts cover persistent systemd timers, host-readable encrypted backup output,
  non-destructive off-machine pulls, readiness/WebSocket/TLS/host/Compose/operational-metric checks, and the
  isolated restore procedure.
