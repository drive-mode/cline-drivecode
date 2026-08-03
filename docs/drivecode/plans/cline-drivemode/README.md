# cline-drivemode · Plan index


Drive **mode** for Cline (cline-drivecode). The user switches into Drive like Plan/Act; that enables pair-call features inside Cline Hub Chat—room, roster, stage, addressing—without a second product shell. The hub Drive activity remains optional room management. This folder is the complete plan set. Plans only, no implementation here.
**Drive** is the product; **drive coding** is the practice it names, the way "vibe coding" names one. The user opens the **Drive tab**, joins a call room, and pair-programs with a senior-engineer agent that holds the **Spotlight**. Chat Join call is a shortcut into the active room. This folder is the complete plan set. Plans only, no implementation here. Terminology is fixed in [00-vision.md](foundation/00-vision.md#naming).

Mode-first integration. [ADR-0007](adr/ADR-0007-drive-as-cline-mode.md), [PRD 8](prd/prd-drive-as-cline-mode.md). Room IA wireframes. [DRIVE-TAB.md](../../design/wireframes/DRIVE-TAB.md).

Repo-level continuation brief. [HANDOFF.md](../../HANDOFF.md).

**Cold-start.** Nest [HANDOFF.md](../../HANDOFF.md). Current as-is: [SYSTEMS-ANALYSIS.md](leadership/SYSTEMS-ANALYSIS.md) §13.0. Satisfaction residuals: [REMAINING-task-satisfaction.md](delivery/REMAINING-task-satisfaction.md).
**Historical delivery handoff.** [HANDOFF.md](delivery/HANDOFF.md) (2026-07-25 — superseded).
**PR 24 (U4 AI SDK 7) handoff.** [HANDOFF-pr24-u4.md](archive/HANDOFF-pr24-u4.md) — remaining work to land the AI SDK major.

## Documents

| File | What it holds |
|---|---|
| [../../native-vs-drivecode.md](../../reference/native-vs-drivecode.md) | Native Cline vs Drivecode value matrix with maturity labels |
| [00-vision.md](foundation/00-vision.md) | Drive mode inside Cline; Chat default work surface; staged delivery |
| [01-architecture.md](foundation/01-architecture.md) | Kernel `@cline/drive`, hub `:25463` single writer, room-first, **Drive mode** primary activation, Chat default surface, events-first stage, D1–D9 |
| [02-research-streaming.md](research/02-research-streaming.md) | Call-architecture research synthesis (Discord, Zoom, Meet, Teams, Webex, Huddles, Twitch) with adopted anti-patterns |
| [03-research-inventory.md](research/03-research-inventory.md) | Cline surface inventory, hub and hook gaps, workflows and skills to define |
| [04-future-multi-user.md](research/04-future-multi-user.md) | Discord-in-IDE desired state, room/participant/track model, phased media strategy |
| [05-workflows.md](foundation/05-workflows.md) | Canonical workflow catalog. 36 sequences a human performs, cited to cursor-drive and claude-drive prior art, tiered and mapped to DRV features or gaps |
| [06-platform-config.md](foundation/06-platform-config.md) | Platform configuration surface. `AgentProfile` and `RosterPack` domain model, facet inventory with owner/scope/lane/privacy/phase, ownership matrix, phasing, open forks |
| [07-runtime-topology.md](foundation/07-runtime-topology.md) | Local / cloud / hybrid runtime topology, egress matrix, voice planes |
| [08-provider-harness.md](foundation/08-provider-harness.md) | BYOK STT/TTS provider registry, OOTB default packs, Drive Settings IA |
| [local-stt.md](ops/local-stt.md) | Loopback whisper-compatible STT for MediaRecorder / local-worker |
| [09-demo-share.md](initiatives/share-and-router/09-demo-share.md) | Demo artifact share track (Cursor-like proof on stage) |
| [10-agent-router.md](initiatives/share-and-router/10-agent-router.md) | Multi-agent utterance router (suggest/auto among seated) |
| [11-spotlight-a2a.md](initiatives/share-and-router/11-spotlight-a2a.md) | Spotlight, per-agent bags, mute/deafen, A2A |
| [12-performance.md](research/12-performance.md) | Drive compute/memory measurement and optimization architecture |
| [13-deps-inventory.md](research/13-deps-inventory.md) | Dependency inventory and compatible upgrade matrix (U0) |
| [14-primitives-audit.md](research/14-primitives-audit.md) | Primitives misuse / dead-code audit (P0) |
| [15-task-satisfaction-observability.md](research/15-task-satisfaction-observability.md) | Session satisfaction via tasks; local rollups; closed loop |
| [16-task-as-unit-models.md](research/16-task-as-unit-models.md) | Task-as-unit doctrine; next-task proposers vs deterministic cursor |
| [17-implementation-backlog-audit.md](research/17-implementation-backlog-audit.md) | Evidence-led reconciliation of shipped Drive work, active backlog, and branch-only candidates |
| [18-task-as-execution-unit.md](research/18-task-as-execution-unit.md) | Product and implementation direction for `DriveTask` as the durable, verifiable execution unit |
| [23-agent-first-design.md](research/23-agent-first-design.md) | Agent-first design doctrine; runtime substitutes for code review; Drive audited against it |
| [24-scale-and-context.md](research/24-scale-and-context.md) | What degrades at scale — context-window engineering, throughput, and the open control loop |
| [enforced-authority/](initiatives/enforced-authority/) | Wiring declared authority to paths that can refuse; ADR-0025 slices |
| [HANDOFF-pr24-u4.md](archive/HANDOFF-pr24-u4.md) | Archive: remaining U4 work for PR 24 (AI SDK 7) |
| [share-and-router/](initiatives/share-and-router/) | Full reference PLAN for demo share + agent router |
| [show-backlog-director/](initiatives/show-backlog-director/) | Implementable Show backlog + director slices (deps mapped) |
| [task-bank-drive-loop/](initiatives/task-bank-drive-loop/) | Multi-phase plan for the task-bank Drive loop |
| [task-satisfaction-observability/](initiatives/task-satisfaction-observability/) | Task-centric session metrics + gated plan improve |
| [session-satisfaction-moments/](initiatives/session-satisfaction-moments/) | Product moments + [visual plan](initiatives/session-satisfaction-moments/visual-plan.md) / [canvas](../../design/canvases/session-satisfaction-moments-canvas.html) |
| [drive-product-demo/](initiatives/drive-product-demo/) | Full-system product demo scene-player ([canvas](../../design/canvases/drive-product-demo.html)) |
| [driveplan-agent-runtime/](initiatives/driveplan-agent-runtime/) | ADR-0018 DriveRun / lease / receipt + Kanban projection stub |
| [hub-drive-ia-analytics/](initiatives/hub-drive-ia-analytics/) | Drive owns call+history; Analytics page; Status stays ops |
| [prd/](prd/) | Product requirements. PRD 6 portfolio; PRD 7 PiP; PRD 8 Drive-as-mode; PRD 9 task-bank; PRD 10 session satisfaction; phase-gate success metrics |
| [BRIEF-task-satisfaction.md](leadership/BRIEF-task-satisfaction.md) | SE/PM brief for session satisfaction wave |
| [adr/](adr/) | Architecture decision records for Driveagent home, graph, recruit, gated learn |
| [LEADERSHIP-BRIEF.md](leadership/LEADERSHIP-BRIEF.md) | SE lead / PM brief for the planning wave (defaults, MoSCoW, risks) |
| [SYSTEMS-ANALYSIS.md](leadership/SYSTEMS-ANALYSIS.md) | End-to-end systems analysis (context, flows, NFRs, as-is/to-be, recommendations) |
| [CHECKLIST-phase0-entry.md](leadership/CHECKLIST-phase0-entry.md) | Gate before schema freeze |
| [MATRIX-workflow-coverage.md](leadership/MATRIX-workflow-coverage.md) | Workflow ↔ feature coverage matrix |
| [decisions/](decisions/) | Leadership DECs (agent SoT, package location, product forks) |
| [ops/hub-drive-ops.md](ops/hub-drive-ops.md) | Hub op catalog and failure modes |
| [ops/beta-support.md](ops/beta-support.md) | Where self-hosted beta testers report problems (proposed default) |
| [schemas/README.md](schemas/README.md) | Phase 0 schema index |
| [examples/driveagent-pair-partner/](examples/driveagent-pair-partner/) | Example `.driveagent` home + BRIEF + sample graph |
| [TASK-GRAPH.md](delivery/TASK-GRAPH.md) | Phases 0 through 5 with verifiable gates |
| [AGENT-RUNBOOK.md](delivery/AGENT-RUNBOOK.md) | How agents pick tasks, spawn, verify, and report |
| [REMAINING-task-satisfaction.md](delivery/REMAINING-task-satisfaction.md) | Living backlog: residuals after #80 land |
| [PLAN-backlog-reconciliation.md](delivery/PLAN-backlog-reconciliation.md) | Proposed staged cleanup to make the Drive backlog trustworthy again |

## SDK layer

The harness layer beneath this plan is designed in [../drivecode-sdk/](../drivecode-sdk/). It resolves `drivecode-sdk` as the same package as the `@cline/drive` kernel specified in [DRV-KERNEL](features/DRV-KERNEL.md) rather than a second one, and adds a host port, a capability descriptor, and a conformance kit to it.

Two things there amend this folder: the pure room reducer and stage projection move from `@cline/core` to `@cline/drive` so the webview can import them instead of growing a second copy ([01-architecture.md](foundation/01-architecture.md) package map), and [DRV-KERNEL](features/DRV-KERNEL.md) gains the port and the kit. Decisions D1 through D9 apply; D8/D9 cover topology and the BYOK provider harness.

## Features

MVP is phases 0 through 3. Future is phases 4 and 5.

| ID | Feature | Phase | Scope |
|---|---|---|---|
| [DRV-ADR](features/DRV-ADR.md) | Architecture decision record | 0 | MVP |
| [DRV-EVENTS](features/DRV-EVENTS.md) | Versioned room and drive event schemas | 0 | MVP |
| [DRV-KERNEL](features/DRV-KERNEL.md) | `@cline/drive` kernel package | 0 | MVP |
| [DRV-HOOK-POLICY](features/DRV-HOOK-POLICY.md) | Runtime hooks with honest override | 0 | MVP |
| [DRV-PRIVACY](features/DRV-PRIVACY.md) | Privacy-strict defaults | 0 | MVP |
| [DRV-PLATFORM-CONFIG](features/DRV-PLATFORM-CONFIG.md) | Facet catalog and durable config store | 0 | MVP |
| [DRV-ROOM-MVP](features/DRV-ROOM-MVP.md) | Smallest room and joinCall façade | 1 | MVP |
| [DRV-DRIVE-TAB](features/DRV-DRIVE-TAB.md) | Drive hub activity (optional room management IA) | 1 | MVP |
| [DRV-ROSTER](features/DRV-ROSTER.md) | Agent roster as participants | 1 | MVP |
| [DRV-AGENT-PROFILE](features/DRV-AGENT-PROFILE.md) | Agent display name and two ink channels | 1 | MVP |
| [DRV-PARTICIPANT-SHEET](features/DRV-PARTICIPANT-SHEET.md) | Roster click: Transcript vs Profile sheet | 1 | MVP |
| [DRV-DRIVEAGENT-HOME](features/DRV-DRIVEAGENT-HOME.md) | `.driveagent/<slug>/` agent home + compile | 1 | MVP |
| [DRV-TOGGLE](features/DRV-TOGGLE.md) | Enter Drive mode from Chat (join / attach) | 1 | MVP |
| [DRV-PERSONA-CHIP](features/DRV-PERSONA-CHIP.md) | Partner presence chip | 1 | MVP |
| [DRV-NARRATION](features/DRV-NARRATION.md) | Narration messages in the feed | 1 | MVP |
| [DRV-MODE-OVERLAY](features/DRV-MODE-OVERLAY.md) | Drive mode + Ask/Agent/Plan/Debug postures | 1 | MVP |
| [DRV-TASK-BANK](features/DRV-TASK-BANK.md) | Task bank; plans ref tasks; auto Plan↔Agent | 1–2 | MVP |
| [DRV-CALL-SESSION](features/DRV-CALL-SESSION.md) | Call session binding for task metrics | 2+ | Landed (main #80) |
| [DRV-TASK-METRICS](features/DRV-TASK-METRICS.md) | Local session rollups (tasks / plan quality) | 2+ | Landed (main #80) |
| [DRV-PLAN-IMPROVE](features/DRV-PLAN-IMPROVE.md) | Gated planning improve from session diagnosis | 2+ | Landed; host skill compile residual |
| [DRV-STUCK-RECOVERY](features/DRV-STUCK-RECOVERY.md) | In-call recovery fork on stuck tasks | 2+ | Landed (manual + auto stall) |
| [DRV-FELT-AGENCY](features/DRV-FELT-AGENCY.md) | Visible plan control after steer/interrupt/edit | 2+ | Landed; W1.1 narration residual |
| [DRV-CLEAN-DRAIN](features/DRV-CLEAN-DRAIN.md) | Clean-drain ritual → next-goal invite | 2+ | Landed (main #80) |
| [DRV-RETURN-LOOP](features/DRV-RETURN-LOOP.md) | Leave/End handoff + while-away return | 2+ | Landed (main #80) |
| [DRV-PLAN-REENTRY](features/DRV-PLAN-REENTRY.md) | Drive tab unfinished-plan re-entry | 2+ | Landed (main #80) |
| [DRV-STATUS-SESSIONS](features/DRV-STATUS-SESSIONS.md) | Session accomplishment lens (migrating to Analytics) | 2+ | Landed (main #80); home → Analytics |
| [DRV-ANALYTICS](features/DRV-ANALYTICS.md) | Hub Analytics (rollups + digest) | 2+ | Landed |
| [DRV-SHIPPED-DIGEST](features/DRV-SHIPPED-DIGEST.md) | Opt-in “what Drive shipped” digest | 2+ | Landed (main #80) |
| [DRV-RECRUIT-STALL](features/DRV-RECRUIT-STALL.md) | Recruit on stuck task | 2+ | Landed (stall path; general Add open) |
| [DRV-LEAVE-END](features/DRV-LEAVE-END.md) | Leave the call, end the session | 1 | MVP |
| [DRV-PARTNER-MVP](features/DRV-PARTNER-MVP.md) | One pair partner, end to end (phase gate) | 1 | MVP |
| [DRV-GATES](features/DRV-GATES.md) | High-impact approval + policy blocks | 1 | MVP |
| [DRV-STAGE](features/DRV-STAGE.md) | The Call Stage (agent work projection) | 2 | MVP |
| [DRV-SHARE](features/DRV-SHARE.md) | Bidirectional stage share (human \| agent) | 2 | MVP |
| [DRV-TRANSCRIPT](features/DRV-TRANSCRIPT.md) | Room transcript vs per-agent focus | 2 | MVP |
| [DRV-CHAT-FORK](features/DRV-CHAT-FORK.md) | Invisible auditable worker forks + PromotePacket | 2+ | Landed |
| [DRV-ADDRESS](features/DRV-ADDRESS.md) | Address set (one / many / everyone / pack) | 2 | MVP |
| [DRV-ROSTER-PACK](features/DRV-ROSTER-PACK.md) | Curated roster presets, added in one action | 2 | Partial (hub seat path; library UI open) |
| [DRV-AGENT-GRAPH](features/DRV-AGENT-GRAPH.md) | Per-agent portfolio knowledge graph | 2 | MVP |
| [DRV-RECRUIT](features/DRV-RECRUIT.md) | Rank agents / suggest packs for a need | 2 | Partial (scoreNeed + stall path; Add UI open) |
| [DRV-PARALLEL-WAVES](features/DRV-PARALLEL-WAVES.md) | Parallel wave execution helpers | — | Archive / research (not MVP-indexed) |
| [DRV-CALL-STRIP](features/DRV-CALL-STRIP.md) | Pinned call controls | 2 | MVP |
| [DRV-NOWNEXT](features/DRV-NOWNEXT.md) | Now/next plan cursor strip | 2 | MVP |
| [DRV-STEER-QUEUE](features/DRV-STEER-QUEUE.md) | Steering while the partner works | 2 | MVP |
| [DRV-INTERRUPT](features/DRV-INTERRUPT.md) | Raise hand | 2 | MVP |
| [DRV-PIP](features/DRV-PIP.md) | PiP Partner companion widget | 2 | MVP |
| [DRV-SKILL-PORT](features/DRV-SKILL-PORT.md) | Port persona and mode skills | 2 | MVP |
| [DRV-SDLC-GUIDE](features/DRV-SDLC-GUIDE.md) | Senior SDLC / requirements leadership on the call | 1 | MVP |
| [DRV-MIC](features/DRV-MIC.md) | Mic input and mute | 3 | MVP |
| [DRV-TTS](features/DRV-TTS.md) | Partner voice out | 3 | MVP |
| [DRV-CAPTIONS](features/DRV-CAPTIONS.md) | Live captions | 3 | MVP |
| [DRV-DEMO-SHARE](features/DRV-DEMO-SHARE.md) | Demo artifact share (screenshots / clips) | 2+ | Planned |
| [DRV-SHOW-BACKLOG](features/DRV-SHOW-BACKLOG.md) | Show backlog + director tick (slices 1–7 + S) | 2+ | Done (main #55) |
| [DRV-DEP-MAP](features/DRV-DEP-MAP.md) | Interactive Status Hub dependency graph + plans rail | 2+ | Planned |
| [DRV-AGENT-ROUTER](features/DRV-AGENT-ROUTER.md) | Route utterances among seated agents | 4 | Planned |
| [DRV-CLI-PARITY](features/DRV-CLI-PARITY.md) | Drive in the TUI | 4 | Future |
| [DRV-ISOLATION](features/DRV-ISOLATION.md) | Worktree isolation for multi-agent seats | 4 | Future |
| [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md) | Optional specialist agents (flagged) | 4 | Future |

Multi-user itself (rooms with several humans, remote events, optional WebRTC) is phase 5 design review territory, held in [04-future-multi-user.md](research/04-future-multi-user.md).

## How agents pick tasks

Short version. Lowest phase with a red gate, then a feature whose dependencies are done, then its checklist top to bottom, verify command per task. Full protocol, environment conventions, and hard constraints are in [AGENT-RUNBOOK.md](delivery/AGENT-RUNBOOK.md).

## Principles behind the plan's decisions

Each principle below drove a concrete choice you can see in the files.

- **Experience First.** Drive is a Cline mode like Plan/Act so call features feel built-in; Chat stays the default work surface. Drive hub activity is optional room IA. Phase order still ships a complete feel per phase.
- **Model the Domain.** `DriveMode → Room(participants, transcripts, stage, addressSet)` is the typed shape schemas and UI project. Addressing is a send parameter, not an afterthought mention.
- **Redesign from First Principles.** Mode-first integration ([ADR-0007](adr/ADR-0007-drive-as-cline-mode.md)) amends Drive-tab-as-sole-home while keeping the room primitive.
- **Sequence Work into Verifiable Units.** Every checklist task ends in a named verify command, every phase ends in a gate, and read-and-map tasks precede write tasks so risky assumptions fail first.
- **Foundational Thinking.** Schemas (DRV-EVENTS) and the kernel (DRV-KERNEL) are phase 0 because every later phase consumes them. The event union is the data shape that makes the stage, the TUI, and remote clients cheap.
- **Subtract Before You Add.** The plan wires bundled ai-elements instead of writing components, collapses cursor-drive's `:7891` daemon into existing hub ops instead of porting it, and keeps the media track to one bytes-free member (`media.artifact`) instead of speculating schema.
- **Boundary Discipline.** Validation lives at hub ops, the kernel is pure with no transport, and surfaces render typed events without re-validating. Ask-mode enforcement sits at the tool-policy layer, not in UI affordances.
- **Separate Before Serializing Shared State.** The hub is the single writer of room state, clients hold read-only projections, and the stage is a derived reducer, so no lock or CRDT is needed anywhere in the MVP.
- **Never Block on the Human.** Preference forks (stream model, user share, accent, focus policy, pause vs cancel) ship with leadership defaults in [decisions/DEC-open-product-forks.md](decisions/DEC-open-product-forks.md) rather than blocking implementation. ADRs stay on the [status board](adr/ADR-0000-status-board.md) until formally Accepted.

## Constraints (binding on all work)

- Bun only. No npm, yarn, or pnpm anywhere in this repo.
- No Cursor or VS Code chrome DOM hacks.
- No second MCP daemon. Nothing defaults to `:7891`. The hub is the only server (preferred default port; discovery / free-port fallback unless `CLINE_HUB_PORT` is set).
- Privacy-strict defaults. No audio or transcript persistence without an explicit, visible debug flag.
- No timeframes in plans or status docs.
- Drive is a Cline mode (Plan/Act-class). Chat is the default work surface; Drive hub activity is optional room IA.
- **`Team` is Cline's word.** It means the runtime execution group in `sdk/packages/core/src/extensions/tools/team/`. Drive's human-curated seating preset is a **`RosterPack`**, and no Drive identifier contains `Team`. UI copy says *pack*. See [06-platform-config.md](foundation/06-platform-config.md#naming-rosterpack-not-teampack-not-team).
- Drive **overlays** appearance on the seated agent. Prompts, tools, skills, provider, and model ids are authored under `.driveagent/<slug>/` (or migration-imported from `.cline/agents/*.yaml`) and **compile** into the host runtime. They are never stored in Drive facets / `AgentProfile`. See [DEC-agent-source-of-truth](decisions/DEC-agent-source-of-truth.md).

## Implementation guidance (poteto-mode non-negotiables for implementers)

- Run the **how** skill over each unfamiliar subsystem (hub server internals, turn loop, hook engine) before changing it.
- Use the **interrogate** skill for adversarial review if a design decision here turns out to be contested in practice.
- Run `/deslop` over every diff before commit and the **unslop** skill over any prose surface.
- Keep a decision trail via the **show-me-your-work** skill for phase-scale work.
- Use Cursor's built-in **babysit** skill after opening each PR.
- Runtime verification uses **control-ui** (hub webview) and **control-cli** (TUI), as named per task.
