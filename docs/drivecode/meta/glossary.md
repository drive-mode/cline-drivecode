# Drivecode glossary (plain language)

Short definitions for terms that show up in PRs #1 and #2. Pair with [PR-1-2-drivecode-eli5-and-review.md](reviews/PR-1-2-drivecode-eli5-and-review.md).

| Term | ELI5 | Precise meaning in these plans |
|---|---|---|
| **Drive / Drivecode** | Coding on a call with AI friends | Product + fork work to make Cline feel like a pair-programming call room |
| **Drive tab** | The home screen for rooms | Primary IA: sidebar of channels/call rooms (Discord-in-Slack chrome) |
| **Chat Join call** | Shortcut button | Opens/focuses the active Drive room; not the product home |
| **Room** | The call you are in | Typed object with participants, transcripts, stage, address set |
| **Hub** | The referee | Daemon discovered via hub file / preferred default port (not a hard-coded bind); only writer of room state |
| **Spotlight** | Shared presentation surface | User-facing surface that projects typed stage state; never pixel capture |
| **Stage** | Wire view of shared work | Last-event-wins protocol projection of edits/tests/decisions shown on Spotlight |
| **Presenter** | Temporary presenter badge | Exclusive, scoped, expiring Agent Title that authorizes one agent to own the typed stage |
| **Director** | Host conductor | Signed, versioned, non-exportable Cline orchestration policy; clients see only an allowlisted descriptor/overlay |
| **Agent Title** | Borrowed capability badge | Temporary auditable authority grant; not a team/router/call role or permanent persona |
| **Address set** | Who you are talking to | Recipients for the next send: everyone, selected agents, or a pack |
| **Roster** | Who is in the call | Participants (human or agent), each with seating sources |
| **RosterPack** | Saved seating chart | Human-curated preset of who to seat; **not** Cline `Team` |
| **Team (Cline)** | Runtime work group | Existing Cline execution-group concept; do not reuse the name for Drive seating |
| **AgentProfile** | Costume / name tag | Appearance overlay (displayName, inks, permission intent) on a real agent |
| **Runtime badge** | Sanitized engine label | Allowlisted family/location label such as Claude or Codex; never exact model ids, endpoints, keys, prompts, or tools |
| **Driveagent / `.driveagent/`** | Agent’s personal binder | Durable home: config + knowledge graph; compiles into host runtime |
| **Knowledge graph** | Map of what the agent knows/can do | Canonical YAML nodes/edges; derived `graph.json` for tools |
| **Recruit** | “Who should do this?” | Rank agents (and maybe suggest packs) from a need query |
| **Seat / seatSources** | Sit down in the room | Hub op that adds a participant; sources refcount why they are seated |
| **Participant sheet** | Transcript \| Profile chooser | Roster click opens identity vs conversation (Discord/Slack pattern) |
| **Gated learn** | Ask before remembering | Propose → accept/reject/mute; no auto transcript → knowledge |
| **`@cline/drive` / drivecode-sdk** | Rulebook for call mode | Same package role: pure Drive kernel + host port + conformance; not a second runtime |
| **Events-first** | Tell the story as cards | Surfaces render versioned events; WebRTC pixels are later |
| **ADR** | Written decision | Architecture Decision Record under `plans/cline-drivemode/adr/`; see status board for Accepted vs Proposed |
| **PRD 6** | Product requirements for portfolios | Driveagent portfolio / graph / recruit requirements doc |
| **DRV-\*** | Feature tickets as docs | Checklistable feature specs under `features/` |
| **Persona / narration** | How the partner talks | Senior-engineer tone; narrate decisions, not every keystroke |
| **Interrupt / raise hand** | Pause the partner | Pause after current tool (or hard cancel per policy) |
| **Conformance kit** | Honesty test for hosts | Fail-closed checks that a host really supports declared Drive capabilities |
| **DriveTask** | One unit of work | Durable implementable unit in `.drive/bank/tasks/`; Drive’s satisfaction unit (not tokens) |
| **DrivePlan** | Ordered checklist of task ids | Ephemeral sequencer over tasks; `title` ≈ session intent (no separate Goal type) |
| **DriveRun** | Approved decomposition of one task | Planner + controller artifact for one `DriveTask` ([ADR-0018](../plans/cline-drivemode/adr/ADR-0018-agent-runtime-contract.md)) |
| **DriveRunWorkItem** | Parallelizable piece of a run | Scheduler unit for a `DriveRun` — not room-wave `DriveWorkItem` |
| **WorkLease** | Temporary agent authority | Mutation / tool-boundary attachment for a task attempt |
| **Receipt** | Evidence for accept or recover | Verification record before archive when policy demands proof |
| **Call session** | One join→leave window | Presence bound by `callSessionId` for duration + task rollups |
| **Session rollup** | Local scorecard for a call | Counts only: completions, churn, clean-drain, engagement — no transcripts |
| **Task-as-unit** | Measure Drive in tasks | Product doctrine: tasks are to Drive what tokens are to LLMs; next-task cursor stays deterministic |
| **Plan clean-drain** | Plan finished as written | Plan archives without additive mid-plan task ids |
| **Post-success continue** | User asks for more after wins | Positive engagement: new/edited plan after completions in-session |

## Forbidden shortcuts (from the plans)

- Do not default anything to port `:7891`.
- Do not put `systemPrompt` / tools / skills / provider / model into Drive facets.
- Do not auto-dump room transcripts into `.driveagent/**/knowledge/`.
- Do not name Drive seating types `Team`.
- Do not treat Chat Join as the only entry once Drive tab exists.
