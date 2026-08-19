# Drivecode handoff

## Problem

Drivecode should make Cline feel like a pair-programming call with recruitable agents, shared work, and clear room context. The product north star is a Drive tab with Discord-style information architecture, Slack-like chrome, pair-call interactions, and the cline.bot visual brand.

**Current delivery update (2026-08-19):** Presenter authority, temporary Agent
Titles, and the signed/non-exportable Director descriptor are **merged on
`main`** — [PR #17](https://github.com/drive-mode/cline-drivecode/pull/17)
landed 2026-08-18 after its Hub/CLI `presenterGrantId` fixture/projection
failures were fixed in `9647c40`. The standalone collaboration-harness fold
was reconciled to this coordinator's leave/room-end title cleanup in merged
[collaboration-harness #4](https://github.com/drive-mode/collaboration-harness/pull/4),
and the writer's coordinator-idempotent room end landed in merged
[drivemode-mcp #4](https://github.com/drive-mode/drivemode-mcp/pull/4).
The canonical contract is
[the SDK architecture](../../sdk/ARCHITECTURE.md#drive-presenter-authority-and-director-policy).
All consumer documentation must keep **Spotlight** as the surface, `stage` as
the wire projection, **Presenter** as a temporary exclusive title, and
**Director** as proprietary host policy.

The native App Store candidate is the standalone
[`drive-ios`](https://github.com/drive-mode/drive-ios) repository. The in-tree
[`apps/drive-ios`](../../apps/drive-ios/) project is a legacy fixture, not the
native delivery source of truth. The standalone app's eight-PR preview stack
merged to its `main` on 2026-08-18; it remains an unreleased preview, and its
canonical release gate is
[`docs/APP-STORE-REVIEW.md`](https://github.com/drive-mode/drive-ios/blob/main/docs/APP-STORE-REVIEW.md).

## Requirements

Keep these constraints:

- The Cline hub is the single writer for Drive room state (discovery / `ensureDetachedHubServer`; do not hardcode ports).
- Do not add a second daemon or default anything to `:7891`.
- Use Bun. Do not use npm, yarn, or pnpm in this repository.
- Keep privacy-strict defaults. Do not persist audio or transcripts without an explicit and visible debug setting.
- Build the stage from typed events first. WebRTC and remote media come later.
- `Spotlight` names the user-facing surface; `stage` names the typed wire
  projection. `Presenter` is a temporary title authorizing an agent to present
  on that stage, never another surface or role tier.
- The built-in Director policy remains signed, versioned, host-owned, and
  non-exportable. Clients receive only an allowlisted descriptor and overlays.
- `RosterPack` is a Drive seating preset. It is not Cline `Team`, which remains the runtime execution group.
- `AgentProfile` is an appearance overlay on Cline's configured agent.
- Keep prompts, tools, skills, provider settings, and model IDs in Cline-owned agent configuration or `.driveagent/<slug>/` source that compiles into it.
- Do not fork `ConfiguredAgent` into Drive-owned prompt storage.
- Do not modify Cursor or VS Code chrome through DOM injection.
- Do not create a second agent registry or a second runtime path.

The phase 1 package decision is **closed** by [cline-drivemode/decisions/DEC-package-location.md](plans/cline-drivemode/decisions/DEC-package-location.md): `@cline/drive` in this monorepo. Extract only when a second host needs the package.

Leadership planning wave entry. [cline-drivemode/LEADERSHIP-BRIEF.md](plans/cline-drivemode/leadership/LEADERSHIP-BRIEF.md). Phase 0 entry checklist. [cline-drivemode/CHECKLIST-phase0-entry.md](plans/cline-drivemode/leadership/CHECKLIST-phase0-entry.md).

## State so far

### Active engineering track

| Item | Status |
|---|---|
| Show backlog director (slices 1–7 + S) | **On main** (merged #55) |
| `createDriveHarness` + webview `reduceRoom` fold | **On main** (merged #56) |
| Hub join / raise-hand / address / stage / mode / show via harness | **On main** (merged #58) |
| Phase-2 pure helpers + durable pack registry + DirectorOps | **On main** — see [06-sdk-leverage.md](plans/drivecode-sdk/delivery/06-sdk-leverage.md) |
| Task-satisfaction + session moments (W0–W4 + retention caps) | **On main** (merged #80); residuals in REMAINING |
| Pack library UI / Add→Pack | **Partial** (claim:drv-roster-pack-library) — `RosterPackLibrary` / `AddPackMenu`; optional `/pack` composer still open |
| DRV-GATES feed UI + reconnect UX + recruit Add path | **Partial** (claim:drv-gates-feed) — GateFeedCard + session allow; RecruitAddPicker; reconnect empty states; taxonomy gate ACs open |

Prefer `main`. After SDK edits: `bun run build:sdk`. Historical harness session notes: [07-agent-handoff.md](plans/drivecode-sdk/delivery/07-agent-handoff.md) (superseded).

### Upstream Cline and SDK baseline

[PR #23](https://github.com/drive-mode/cline-drivecode/pull/23) is the active
upstream-integration boundary. As captured 2026-08-19, it carries the official
Cline SDK `0.0.75` line and fetched `cline/cline` source head
[`98d3e52a0`](https://github.com/cline/cline/commit/98d3e52a028c8b8426852baa4154e4aabf284dab).
Those are separate parity checks: upstream source can advance without an SDK
version bump. Land this PR with a **merge commit only**, after its full hosted
matrix is green, so the repaired upstream ancestry is preserved. The exact
sync procedure, ownership boundary, validation commands, and continuation
checklist live in
[10-upstream-sdk-sync-handoff.md](plans/drivecode-sdk/delivery/10-upstream-sdk-sync-handoff.md).

### Execution backlog

- The canonical status source is
  [claims-registry.yaml](plans/cline-drivemode/delivery/claims-registry.yaml).
- [delivery/BACKLOG.md](plans/cline-drivemode/delivery/BACKLOG.md) is the
  human-readable work-selection render. If it disagrees with the registry, the
  registry wins.
- [TASK-GRAPH.md](plans/cline-drivemode/delivery/TASK-GRAPH.md) and older
  delivery handoffs are phase/history references, not current status sources.
- Do **not** re-run `scripts/seed-drive-kanban.mjs`; it seeds the historical
  graph. Retire or re-point the private board to the claims registry first.
- [portfolio-now](plans/cline-drivemode/initiatives/portfolio-now/) is the
  canonical dependency sequencer for the connected golden path. It orders
  registry claims; it does not replace their status.

### Terminology note (2026-08)

- Architecture Decision Records were renamed from mistaken local **ARD** spelling to industry-standard **ADR** (`plans/cline-drivemode/adr/ADR-NNNN-*.md`). Leadership **DEC-*** files are unchanged.
- Do not create a parallel `docs/adr/` at repo root — nest path only.

### Product and interaction plans

- `docs/drivecode/plans/cline-drivemode/foundation/00-vision.md` defines the Drive tab, pair-call experience, and staged product direction.
- `docs/drivecode/plans/cline-drivemode/foundation/01-architecture.md` defines the room model, the hub boundary, and the event-first architecture.
- `docs/drivecode/plans/cline-drivemode/foundation/05-workflows.md` contains 45 user workflows (incl. Group I SDLC / requirements leadership). It maps them to features and calls out gaps.
- `docs/drivecode/plans/cline-drivemode/foundation/06-platform-config.md` defines the 34-facet platform inventory, `RosterPack`, `AgentProfile`, ownership, privacy, and phases.
- `docs/drivecode/plans/cline-drivemode/features/` contains the DRV feature plans.
- `docs/drivecode/plans/cline-drivemode/initiatives/show-backlog-director/` is the dependency-mapped implementation plan for planned Show backlog + director (enqueue → rank → present → script); feature [DRV-SHOW-BACKLOG](plans/cline-drivemode/features/DRV-SHOW-BACKLOG.md). **Implementation of listed slices is on main** — treat plans as reference, not a greenfield backlog.
- `docs/drivecode/plans/cline-drivemode/delivery/TASK-GRAPH.md` orders phases and acceptance gates.
- `docs/drivecode/plans/cline-drivemode/delivery/AGENT-RUNBOOK.md` explains how the next agent should select, implement, and verify tasks.
- `docs/drivecode/plans/cline-drivemode/prd/prd-driveagent-portfolio.md` defines Driveagent portfolios, knowledge graphs, and recruit.
- `docs/drivecode/plans/cline-drivemode/prd/prd-task-satisfaction-observability.md` (PRD 10) + research `15`/`16` explore task-centric session satisfaction, local rollups, and gated plan improve ([initiative](plans/cline-drivemode/initiatives/task-satisfaction-observability/), [ADR-0015](plans/cline-drivemode/adr/ADR-0015-task-session-observability.md) Accepted).
- `docs/drivecode/plans/cline-drivemode/initiatives/session-satisfaction-moments/` defines product moments on the call arc ([visual plan](plans/cline-drivemode/initiatives/session-satisfaction-moments/visual-plan.md), [canvas](design/canvases/session-satisfaction-moments-canvas.html)).
- **Remaining implementation checklist:** [delivery/REMAINING-task-satisfaction.md](plans/cline-drivemode/delivery/REMAINING-task-satisfaction.md) (satisfaction track landed; residuals in that file).
- `docs/drivecode/plans/cline-drivemode/adr/` records the decisions for Driveagent home, canonical graph data, recruit, RosterPack, gated learning, and agent runtime (see status board + **Impl** column).
- `docs/drivecode/plans/cline-drivemode/initiatives/driveplan-agent-runtime/` ships [ADR-0018](plans/cline-drivemode/adr/ADR-0018-agent-runtime-contract.md) slices (`DriveRun` / lease / receipt; Kanban projection stub). Parallel to phased TASK-GRAPH UX — does not replace Phase 1–3 gates.
- `docs/drivecode/plans/cline-drivemode/examples/driveagent-pair-partner/` is the concrete agent-home and graph fixture.
- `docs/drivecode/plans/cline-drivemode/initiatives/mobile-consumer/` phone-first consumer shell (PWA + wireframes).
- `docs/drivecode/plans/cline-drivemode/initiatives/multi-device/` owns the
  cross-device contract. The standalone
  [`drive-ios`](https://github.com/drive-mode/drive-ios) repository is the
  native implementation source of truth; [`apps/drive-ios`](../../apps/drive-ios/)
  is a legacy fixture. Presenter HTML:
  [`mobile-drive-ios-demo.html`](design/wireframes/mobile-drive-ios-demo.html).
- `docs/drivecode/plans/cline-drivemode/leadership/LEADERSHIP-BRIEF.md` is the SE/PM planning wave that closes contradictions and names Phase 0 entry criteria.
- `docs/drivecode/plans/cline-drivemode/leadership/SYSTEMS-ANALYSIS.md` is the end-to-end systems analysis (context, interfaces, NFRs, as-is/to-be, delivery slices) — **§13.0 is current as-is**.

### Drivecode SDK plan

- `docs/drivecode/plans/drivecode-sdk/foundation/00-discovery-omnigent.md` records the Omnigent-inspired meta-harness research.
- `docs/drivecode/plans/drivecode-sdk/foundation/01-problem-and-scope.md` defines the portability problem and scope.
- `docs/drivecode/plans/drivecode-sdk/foundation/02-architecture.md` defines the host port, capability descriptor, policies, and conformance kit.
- `docs/drivecode/plans/drivecode-sdk/foundation/03-phased-plan.md` provides verifiable implementation phases.
- `docs/drivecode/plans/drivecode-sdk/foundation/04-relationship-to-cline-drivecode.md` explains how the harness relates to the Cline SDK and the cline-drivecode product.
- `docs/drivecode/plans/drivecode-sdk/delivery/06-sdk-leverage.md` is the leverage checklist (harness vs `@cline/sdk`) — **Done** on main.
- `docs/drivecode/plans/drivecode-sdk/delivery/07-agent-handoff.md` is **historical** (PR #58 track; superseded by this nest HANDOFF).
- `docs/drivecode/plans/drivecode-sdk/decisions.tsv` is the decision trail for that plan.

The harness proposes operations, the Cline host commits them through the hub, and the webview or CLI projects resulting events (`reduceRoom` — one fold).

### Wireframes and brand

- `docs/drivecode/design/wireframes/DRIVE-TAB.md` records the Discord information architecture inside Slack-like single-workspace chrome.
- `docs/drivecode/design/wireframes/drive-tab-discord-slack.html` is the primary interactive Drive tab prototype.
- `docs/drivecode/design/brand/CLINE-BRAND-TOKENS.md` records the palette, typography, spacing, borders, and radii measured from cline.bot.
- `docs/drivecode/design/brand/DRIVE-MARK.md` locks the official light/dark Drive feature mark and event- vs location-oriented wait motion ([DEC-drive-mark-official](plans/cline-drivemode/decisions/DEC-drive-mark-official.md)).
- `docs/drivecode/design/brand/MOBILE-BRAND-STYLING.md` locks light-first mobile consumer tokens (green Live; Hub palette; iOS wireframe as visual SoT).
- `docs/drivecode/design/wireframes/index.html` contains the earlier Chat-based variants. Its banner marks them as superseded where appropriate.
- Prefer the in-repo overview canvas: [docs/drivecode/design/canvases/overview-canvas.html](design/canvases/overview-canvas.html). Click-through runbook: [DEMO.md](design/wireframes/DEMO.md).

### Implementation (no longer “scaffold only”)

Hub-owned rooms, Show backlog wire commands, Drive webview chrome, Status Hub, and task-satisfaction spine exist on main. Entry points:

- Hub webview Drive: `apps/cline-hub/src/webview/src/drive/` (`useDriveSession`, `foldRoomSnapshot`, stage/roster/show UI)
- Hub handlers: `sdk/packages/core/src/hub/server/handlers/drive-*.ts`
- Harness: `sdk/packages/drive/src/harness.ts`
- Product screenshots: `docs/drivecode/assets/{hub,tui,demos,logos}/`

CLI Status uses the live hub adapter; CLI Drive toggle best-effort `call_join`/`call_leave` via discovered hub (Phase 4; local chrome stays on if hub is down).

### Top gaps

- **Mobile consumer product:** [mobile-consumer](plans/cline-drivemode/initiatives/mobile-consumer/) defines the shared phone-first jobs and path H. The standalone [`drive-ios`](https://github.com/drive-mode/drive-ios) app is now an implemented preview, not merely a plan; its managed chat, target, account, call, and release-service connections remain open. Surfaces: [mobile-drive-surfaces.html](design/wireframes/mobile-drive-surfaces.html). **Path H Accepted** ([ADR-0016](plans/cline-drivemode/adr/ADR-0016-distribution-and-positioning.md) + [DEC-mobile-consumer-owner](plans/cline-drivemode/decisions/DEC-mobile-consumer-owner.md)); writer track is [ADR-0029](plans/cline-drivemode/adr/ADR-0029-room-hotpath-redesign.md) **H5**.
- **Room hot path (H1–H4 shipped):** [drive-hotpath](plans/cline-drivemode/initiatives/drive-hotpath/) + [ADR-0029](plans/cline-drivemode/adr/ADR-0029-room-hotpath-redesign.md) — checkpoint, delta publish, in-process stage projector, layout sheets; **H5** cloud signaling is open engineering under the accepted path H, no longer owner-gated.
- **MC1–MC3 on hub (`?app=1`):** Join/Continue; hold-to-talk; 44px Leave strip; landscape two-column; raise-hand banner; Preview chip; credential-free Join→demo; PWA manifest **Cline Drive**. Next: iOS glance / hosted D5.
- **Golden-path project map:** [portfolio-now](plans/cline-drivemode/initiatives/portfolio-now/) sequences trusted host → target registry → managed chat → iOS binding → durable resume → cross-repo conformance. The older `?demoPlans=1` map remains a historical showcase until it projects registry claims.
- **Invocation-scoped sensing:** [ADR-0037](plans/cline-drivemode/adr/ADR-0037-invocation-scoped-sensing.md) is preserved as a Proposed decision after merged [PR #15](https://github.com/drive-mode/cline-drivecode/pull/15). Runtime implementation is Later and is not authorized by the merge.
- **Owner defaults (2026-08-07):** [DEC-mobile-consumer-owner](plans/cline-drivemode/decisions/DEC-mobile-consumer-owner.md) — path H yes; mic default muted; PWA name **Cline Drive**; MC3 on Now; hosted economics **Cline default (freemium)**, BYOK secondary.
- **UX quality (web + mobile browser):** [ux-quality](plans/cline-drivemode/initiatives/ux-quality/) — surface inventory, award bar, phases 0–7 over [drive-web](plans/cline-drivemode/initiatives/drive-web/) + [hosted-preview](plans/cline-drivemode/initiatives/hosted-preview/). Native iOS is active in the standalone repository; Android remains YAGNI. Keep web and native on the same room/title contracts.
- **ADLC factory track (plan):** [adlc-drive-factory](plans/cline-drivemode/initiatives/adlc-drive-factory/) + [ADR-0028](plans/cline-drivemode/adr/ADR-0028-adlc-control-plane.md) (**Accepted**) — first-use on-ramps, Status→Drive offer bridge, traces polish, receipt ship atom. Does not replace [MVP-beta.md](plans/cline-drivemode/delivery/MVP-beta.md) (MVP already delivered).
- **ADR board cleanup (2026-08-08):** [ADR-0000](plans/cline-drivemode/adr/ADR-0000-status-board.md) — clusters + decision coverage gaps; ADR-0023 reconciled; 0023/0027/0028/0029 Accepted.
- ADR-0019 full DrivePlan–Kanban Interop wire (after ADR-0018 D1–D2 proved on this branch) — [driveplan-agent-runtime](plans/cline-drivemode/initiatives/driveplan-agent-runtime/).
- Optional composers: `/recruit`, `/pack`; the spatial Dependency map ships,
  as do the neutral GP0–GP9 model and scoped host read. Their lifecycle-neutral
  `/tasks` adapter remains the bounded `DRV-DEP-MAP` residual.
- Isolation required before `teamOpt` multi-seat beyond fail-closed seatCap.
- Discord channels IA polish (out of Tracks A–F).

## Demo

Open [docs/drivecode/design/wireframes/DEMO.md](design/wireframes/DEMO.md) for HTML, hub Chat, CLI, and overview canvas steps. Live hub rooms use `bun run --cwd apps/cline-hub dev` / `bun run cli -i` with provider credentials; demo adapters stay behind composition-root flags (`CLINE_DEMO_*`, `?demoPlans=1`) — see root `AGENTS.md`.

## Core tension

Drive needs a portable domain and policy layer without becoming a second agent runtime. Putting the package in this monorepo gives phase 1 direct access to Cline types, hub operations, tests, and release checks. Extracting it too early would add versioning and adapter work before another host proves that boundary.

The implementation must also keep `AgentProfile` separate from agent behavior. Profiles may change display name and visual identity. They must not become a second home for prompts, tools, skills, providers, or model selection.

## Decision (Accepted 2026-07-29)

**Package location — Accepted.** See [cline-drivemode/decisions/DEC-package-location.md](plans/cline-drivemode/decisions/DEC-package-location.md).

**ADR-0000…0013 + DEC bundle — Accepted** via human `accept all` (2026-07-29). ADR-0014 (Chat-fork lifecycle) later Accepted on main.

Board: [cline-drivemode/adr/ADR-0000-status-board.md](plans/cline-drivemode/adr/ADR-0000-status-board.md).
