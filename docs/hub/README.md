# Campaign Hub

The Campaign Hub is an optional online layer over the existing local-first 5etools experience.
Signed-out character sheets, homebrew, and DM screens remain supported and do not use hub storage.

> **Implementation:** R11f game-day corrections delivered; Wave A0-A6 reviewed, integrated and
> published at `4d9a7220`; reliability and outer-sharing follow-up published at `339ddf24`.
> Wave A live delivery remains pending; inventory Wave B has started with shared status/recovery wording.
> **Deployment:** `hub-staging-2026-10-12-r11f` at
> `4578c8671a7b05066fb9a19411cb8a31cdd753ef` passed independent Oracle runtime/static/recovery checks;
> physical retest is waived for this release, not a new private-launch GO
> **Last reviewed:** 2026-10-14
> **Owner:** Campaign Hub maintainers

## Start here

| Need | Read |
|---|---|
| What exists now | [Current system](current-system.md) |
| What ships next and why | [Living roadmap](roadmap.md) |
| Prioritized game-day findings and the next delivery/release gates | [Game-day backlog and delivery plan](game-day-backlog.md) |
| Campaign Overview design and implementation record | [Campaign Overview redesign brief](campaign-overview-redesign-brief.md) |
| Why it is structured this way | [Architecture](architecture.md) and [ADRs](#architecture-decisions) |
| What was implemented and why | [Implementation history](implementation-history.md) |
| Exact Phase 0-5 working-tree checkpoint | [Checkpoint record](checkpoint.md) |
| Current capabilities/gates | [Implementation status](implementation-status.md) |
| Data, ownership, lifecycle | [Domain model](domain-model.md) and [data lifecycle](data-lifecycle.md) |
| How a browser remembers the active campaign | [Active campaign context](active-campaign-context.md) |
| How campaign rules and content are enforced | [Campaign rule enforcement](campaign-rule-enforcement.md) |
| Schema evolution and DB roles | [Migration guide](migrations.md) |
| OCI/Compose and edge contract | [Deployment guide](deployment.md) |
| Tagged Oracle release | [Deploy and promote runbook](runbooks/deploy-promote.md) |
| HTTP/error/auth contract | [API reference](api-reference.md) |
| WebSocket/event contract | [Realtime protocol](realtime-protocol.md) and [event catalog](event-catalog.md) |
| Who may do what | [Permission matrix](permission-matrix.md) |
| Security and limits | [Security model](security.md) and [performance budgets](performance.md) |
| Logs, metrics, SLOs, alerts | [Observability](observability.md) |
| Local setup/backup/restore | [Operations](operations.md) |
| Tests and release evidence | [Testing guide](testing.md) |
| CI, test-auth boundary, artifacts | [CI and provenance](ci-and-provenance.md) |
| How to change Hub safely | [Contributor guide](contributing.md) |
| Oracle staging and game-day plan | [Staging plan](staging-plan.md) |
| Enable a campaign for peer source costs | [Peer source-cost rollout](runbooks/peer-source-cost-rollout.md) |
| Run the private one-DM/two-player game day | [Game-day runbook](runbooks/private-game-day.md) |
| Managed provider decision | [Provider comparison](provider-comparison.md) |
| Historical Phase 6A-6H launch plan | [Private-V1 roadmap](private-v1-roadmap.md) |
| Diagnose a problem | [Troubleshooting](troubleshooting.md) and [runbooks](runbooks/README.md) |
| Requirement-to-code evidence | [Traceability matrix](traceability.md) |
| Current risks | [Risk register](risk-register.md) |
| Historical post-V1 horizons A-F | [Post-V1 roadmap](post-v1-roadmap.md) |

Documents labeled **planned**, **pending**, or **not implemented** are not current capabilities.

## System summary

- Production authority: Fastify BFF + PostgreSQL under `server/`.
- Browser authority: none; clients use same-origin HTTP/WebSocket APIs.
- Character writes: per-character documents, revision + lease + fencing epoch, path patches and explicit
  conflict recovery.
- DM workspaces: private per-membership Board blobs with the same revision/fencing model.
- Campaign content: immutable brew/rules versions activated as non-persisted overlays.
- Realtime: committed outbox rows -> visibility-filtered WebSocket events; snapshots/replay recover gaps.
- Multiplayer commands: structured effects, grants, party inventory, and escrowed item/currency transfers.
- Campaign controls use character/item names rather than internal IDs, expose CP/SP/EP/GP/PP, and load the core
  plus campaign-homebrew item catalog only when a DM opens it.
- Local mode: unchanged local Character Sheet/DM Screen repositories and personal brew.

| Concern | Existing local path | Hub path |
|---|---|---|
| Characters | `charsheet-characters` roster + rescue mirror | `HubCharacterRepository`, one document per character |
| Homebrew | `BrewUtil2.pSetBrew()` personal persistence | `HubBrewContext` temporary overlay |
| DM screen | `DMSCREEN_STORAGE` Board blob | per-membership `HubDmWorkspaceRepository` |
| API/auth | ordinary network fallback | explicit service-worker NetworkOnly route |

## Character campaign workflow

The Character Sheet campaign control is the canonical place to add an existing character to a campaign:

1. A local character remains local while signed out. After sign-in, **Create cloud copy** saves the local
   character first, creates a separate campaign character, and leaves the local original unchanged.
2. A campaign character copied to another campaign is cloned by default. The original stays in its current
   campaign and the two characters do not share later changes.
3. Moving an attached cloud character is deliberately secondary. The sheet first compares the source and
   destination rules and homebrew, explains the consequences, and requires an explicit checkbox confirmation.
   A move preserves the character id, cancels pending incoming actions, and creates no duplicate.
4. Membership removal or campaign lifecycle changes can leave an owned cloud character detached rather than
   deleting it. `hub.html` lists these as **Cloud characters between campaigns**; opening one allows the same
   cloud character to join an eligible campaign.
5. The current browser releases only the exact editor lease instance it acquired before a move. A stale
   release cannot remove a same-session renewal, and a lease held by another device blocks the operation
   without opening the normal conflict-takeover dialog; the character stays in its source campaign and the
   player can retry after that editor closes or expires.

Copy, attach, and move commands reuse an idempotency key when retried, so a lost response cannot create a
second character or apply the move twice. Local character JSON does not gain Hub ownership metadata.

## Architecture decisions

- [ADR 0001: backend and sessions](adr/0001-backend-and-sessions.md)
- [ADR 0002: documents, events, and leases](adr/0002-documents-events-and-leases.md)
- [ADR 0003: campaign homebrew security](adr/0003-campaign-homebrew-security.md)
- [ADR 0004: portable container topology](adr/0004-portable-container-topology.md)
- [ADR 0005: migration ledger](adr/0005-migration-ledger.md)
- [ADR 0006: operations and retention](adr/0006-operations-retention.md)
- [ADR 0007: lifecycle and account deletion](adr/0007-lifecycle-deletion.md)
- [ADR 0008: CI and artifact provenance](adr/0008-ci-provenance.md)
- [ADR 0009: managed staging provider](adr/0009-managed-staging-provider.md) — superseded
- [ADR 0010: Oracle Cloud Always Free hosting](adr/0010-oracle-always-free-hosting.md)
- [ADR 0011: authorization-scoped character projections](adr/0011-authorization-scoped-character-projections.md) — implemented
- [ADR 0012: idempotent semantic character operations](adr/0012-idempotent-semantic-character-operations.md) — protocol substrate implemented; broader T3 scope remains
- [ADR 0013: device-scoped active campaign context](adr/0013-device-scoped-active-campaign-context.md)
- [ADR 0014: multi-provider account identity](adr/0014-multi-provider-identity.md) — adapters/framework implemented; account linking and rollout pending
- [ADR 0015: versioned Campaign Hub rules policy](adr/0015-campaign-rules-policy.md) — selection plus
  source/species/edition and carry/encumbrance enforcement implemented; other non-content rules remain advisory
- [ADR 0016: atomic source-cost binding for peer character operations](adr/0016-atomic-peer-source-costs.md) —
  implemented for the narrow PHB/XPHB Cure Wounds slice
- [ADR 0017: atomic DM item-award batches](adr/0017-atomic-dm-item-awards.md)
- [ADR 0018: invite-gated first account access](adr/0018-invite-gated-first-access.md)
- [ADR 0019: provider-neutral account entitlements and reauthentication](adr/0019-provider-neutral-account-entitlements.md)
- [ADR 0020: consented multi-target semantic operations](adr/0020-consented-multi-target-operations.md) —
  accepted; Wave A authority and Sheet workflow integrated/published, default-off and not deployed
- [ADR 0021: opted-in self-service party stash withdrawals](adr/0021-opted-in-self-service-stash-withdrawals.md) —
  accepted product/authority boundary; implementation pending, existing approvals unchanged

ADRs 0001-0008 describe implemented portable architecture and launch-readiness decisions. ADR 0009 proposed
a paid managed provider and was superseded on cost grounds by ADR 0010, which selects Oracle Cloud Always
Free; it is retained as the evaluation of record for the paid upgrade path. ADRs 0011 and 0013 are implemented
by V2-T2 and V2-T5. ADR 0012's protocol substrate is implemented while broader T3 effects remain gated. ADR 0014
has provider-neutral GitHub/Discord/Google adapters and account linking; participant-level continuity evidence
remains incomplete. ADR 0015 now enforces
source/species/edition and carry/encumbrance on its proven surfaces while the other non-content rules remain
Advisory. ADR 0016 source-cost atomicity is implemented only for one-player PHB/XPHB Cure Wounds; broader
targeting remains active. ADR 0017 records the implemented V2-T4 DM award slice and its atomic batch,
source-trust, preview, event, and reconciliation contracts.
ADR 0018 replaces provider-subject allowlisting for first account creation with an OAuth-bound campaign invite
context. Its persistence/server foundation and the provider-neutral `campaign:create` entitlement layer are
implemented; first admission remains default-off on a new installation until explicit rollout.
ADR 0019 defines that entitlement layer, provider-bound reauthentication, hidden operator administration, and
the staged enablement/rollback boundary.
ADR 0020 defines the accepted protocol-6 model with at most eight fixed target legs, opaque per-leg invitations,
per-character owner consent, one exact source-selected subset, and one-cost atomic finalization. Published
Wave A includes normalized migration 0011 after A2's migration 0010, recovery/lifecycle corrections 0012/0013,
event-reference indexes 0014, protocol-6 routes/events, both stores, the A4 Sheet workflow and reviewed A5
healing templates. The capability remains default-off. Publication does not change deployed r11f or enroll
a campaign; A7 release, migration/rollback and enablement approvals remain separate.

## Local BFF setup

The BFF and PostgreSQL store live under `server/`. See `server/.env.example` and the operations runbook.

```bash
DATABASE_URL=... npm run hub:migrate
npm run hub:serve
```

The global navigation links to `hub.html`. API and authentication routes are same-origin and explicitly
NetworkOnly in the service worker.

## Historical references

- [Phase 0 proof notes](phase0-proof-notes.md) explain the original integration experiments. They are
  historical; current behavior is in `current-system.md`.

## Personal login

Use [username/password login](local-login.md) for a private JSON user allowlist without OAuth.
Decision: [ADR 0022: Personal file-backed login](adr/0022-personal-file-login.md).
Use [Cloudflare Tunnel](cloudflare-tunnel.md) to expose the full personal Hub through
one public HTTPS hostname with `compose.hub.tunnel.yml`.
For the complete stack in one file, use [Portainer setup](portainer.md) and
`compose.hub.portainer.yml`.
