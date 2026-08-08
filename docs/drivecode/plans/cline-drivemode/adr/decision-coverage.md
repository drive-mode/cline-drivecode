# Decision coverage inventory

**Companion.** Chronology: [decision-changelog.md](decision-changelog.md). Status board: [ADR-0000](ADR-0000-status-board.md).

**Purpose.** Atomic binding-clause inventory of ADR-0001…0029, leadership DEC-\*, and Architecture D1–D10 — grounded in Decision sections and [ADR-0000](ADR-0000-status-board.md) Impl.  
**Sources.** `adr/ADR-*.md`, `decisions/DEC-*.md`, [foundation/01-architecture.md](../foundation/01-architecture.md).  
**ADR-0000.** Exists as the living **status board** (legend, Impl column, clusters, coverage gaps, Still Open). Body detail for 0000 is not inventoried here.  
**Coverage quality.** Covered = tip matches decision end-to-end · Partial = Accepted (or Recommended) with Impl gap · Paper = Proposed · Deferred = explicitly off path · Hole = topic needs a decision and none exists (final section only).

---

## Architecture D1–D10 (binding foundation defaults — not numbered ADRs)

Status: **Accepted (architecture)** per ADR-0000 board. Hotpath slices are **H1–H5** ([ADR-0029](ADR-0029-room-hotpath-redesign.md)); do not reuse `D*` for those.

### D1 · Kernel package `@cline/drive`

- Drive logic lives in `sdk/packages/drive` — pure layer over native Cline sessions.
- Owns Drive state machine (active flag + sub-mode), narration policy, interrupt policy.
- No UI, no transport, no persistence of its own.
- Depends on `@cline/shared`; never reaches into apps. Legal direction: `shared → llms → agents → core → apps`.

### D2 · Hub is the single writer

- Hub daemon is the signaling plane; clients discover it (preferred default port; free-port fallback unless `CLINE_HUB_PORT` is set).
- Room state mutated only through hub ops; clients/agents publish facts and receive broadcasts.
- Exactly one writer for the shared room object; everything else is a derived projection.
- No second daemon; cursor-drive MCP on `:7891` is not ported; nothing defaults to `:7891`.

### D3 · Room-first; Drive mode primary activation; Chat default surface

- Core primitive remains a `Room` with `Participant` members.
- Drive is a Cline mode (peer to Plan/Act); on attaches/creates room; off returns Plan|Act ([ADR-0007](ADR-0007-drive-as-cline-mode.md)).
- Chat is the default work surface while Drive is on (feed, composer, optional stage split); Drive activity lists rooms but is optional navigation.
- Join is synonymous with entering Drive mode + focusing the active room.

### D4 · Events-first stage; bidirectional sharer

- Agent stage is last-event-wins projection over versioned session events; no pixels on agent path in MVP; no CRDT.
- Versioned event union in `@cline/shared` is the render contract.
- `sharer: human | agent`; human share MVP is structured (selection/file/terminal pin); WebRTC/pixel later.

### D5 · Hooks are the interception path

- Drive influences prompts/turns via `@cline/core` runtime hooks; documented mutation contract (DRV-HOOK-POLICY), not side channels.
- No Cursor chrome DOM hacks; address set enforced on send/turn path hub and kernel own.

### D6 · Surfaces render, never own state

- Hub Chat, Drive activity, PiP, ai-elements, TUI are thin renderers of the same event stream.
- Roster, transcript focus, address chips are projections — never writable client copies.

### D7 · Facet catalog + lanes + hub durable writes

- Every knob is a catalog entry (owner, scope, lane, privacy, conflict, phase, default, schema).
- Lanes: `durable` (`.cline/drive/*.json`, hub-only atomic write) · `live` (room memory via ops) · `ephemeral` (client chrome, never broadcast).
- Durable may seed live at room create; never overwrite live mid-call.
- Drive overlays `ConfiguredAgent`; `AgentProfile` owns appearance + permission intent; packs are `RosterPack` (never `Team`); seats carry `seatSources[]`.

### D8 · Runtime topology local / cloud / hybrid

- Session declares `DeploymentProfile`; `TopologyPolicy` in `@cline/drive` is pure and fail-closed.
- Local is airgap for LLM and voice (no Web Speech). Audio never enters hub events. ([ADR-0009](ADR-0009-runtime-topology-local-cloud.md))

### D9 · Provider harness (BYOK)

- STT/TTS via `DriveProviderManifest` + registry; LLM BYOK stays in Cline/`@cline/llms`.
- Facet-backed selections; not a second settings bag; not a Drive-owned key vault. ([ADR-0010](ADR-0010-provider-harness-byok.md))

### D10 · Three-lane state partition

1. Durable event log — append-only `DriveEvent` (+ bank family) keyed by `roomId` + `seq`.
2. Ephemeral live room — one hub-owned `RoomSnapshot`; dual live Maps forbidden.
3. Durable facets — `.cline/drive`; seeds live at create; never overwrites mid-call.  
([ADR-0013](ADR-0013-state-partition.md); hydrate-after-trim via [ADR-0029](ADR-0029-room-hotpath-redesign.md) H1)

**Architecture non-goals (load-bearing):** separate Cline Drive product shell · Drive tab as only entry · Drive-owned agent registry for prompts/tools/models · flat settings without lanes · port cursor-drive MCP wholesale · stage as separate app/service · CRDT multi-writer for MVP.

---

## ADR-0001 · `.driveagent/` is the agent home

1. **Status / Impl.** Accepted · **partial** (resolve/load/compile + get; no hub home write)
2. **Decision.** Each Drive-managed agent has a home at `<workspace>/.driveagent/<slug>/` (optional user-tier `~/.driveagent/`) compiled into the host runtime — not a facet-inflated registry and not `.claude/`.
3. **Binding clauses**
   - Slug is identity; display names are labels.
   - `AgentProfile` remains overlay (displayName, inks, permission *intent*, pack membership) and refs `{ kind: "driveagent", slug }` or `{ kind: "builtin", id }`.
   - Definition files live only in the home (`agent.yaml`, `permissions.yaml`, `env.yaml`, `knowledge/`).
   - Compile, don’t fork — loader projects into host-shaped view; no second prompt store in Drive config.
   - Do not name the directory `.claude/`; UI says “agent home” / “Driveagent.”
   - Builtin pair partner may be read-only synthetic home (`editable: false`).
   - Definition edits while seated mark seat stale until reseat (no mid-turn hot-swap).
   - Roster click opens participant sheet (Transcript | Profile), not “open home.”
   - Home reads/writes affecting seats go through hub ops; webview never second writer of room state.
   - Existing `.cline/agents/*.yaml` may import once; dual-authoring forever is a failure mode.
   - **Invariants:** no Drive facet contains `systemPrompt` / `tools` / `skills` / `providerId` / `modelId`; slug dirs `[a-z0-9-]+`; UI never says `.claude/` for this home; spoken “team” is pack displayName or recruit query, never a type in this home.
4. **Non-goals / rejected.** Facet-only registry · `.cline/agents/` only forever · `.claude/` directory name.
5. **Open.** (none listed in ADR body)
6. **Domain tags.** `agent-home`, `knowledge`, `privacy`
7. **Coverage quality.** Partial

---

## ADR-0002 · Canonical knowledge YAML; derived graph projection

1. **Status / Impl.** Accepted · **decision**
2. **Decision.** Human-editable canonical YAML under `.driveagent/<slug>/knowledge/` compiles to derived `graph.json` under `.derived/`; recruit/inject use compiled graphs, not raw private notes.
3. **Binding clauses**
   - Canonical: `catalog.yaml`, `nodes/`, `edges.yaml`, optional `private/`.
   - Derived under `.derived/`; never hand-edit; compile overwrites.
   - Schemas validate canonical (fail lint on unknown edge kinds, dangling refs).
   - Deterministic compile (stable key order).
   - Prefer committing canonical; derived may be committed for CI or ignored locally.
   - Do **not** use claude-drive per-thread graphify as this portfolio store.
   - MVP node kinds: `capability`, `case`, `constraint`, `artifact`, `concept`.
   - MVP edge kinds: `has_capability`, `applied_in`, `requires`, `conflicts_with`, `related_to`, `learned_from`.
   - Default compile **excludes** `private/`; private compile only with explicit flag.
   - Output shape: `{ version, agentSlug, nodes[], edges[], compiledAt }` stable-sorted by id.
   - Recruit reads compiled graphs only; turn inject uses graduated retrieval (labels/summaries default; full bodies when selected); inject audit records node ids ([ADR-0004](ADR-0004-gated-learn-privacy.md)).
4. **Non-goals / rejected.** SQLite-only SoT · markdown-only wiki · Graphify as SoT (optional later scorer only).
5. **Open.** (none listed)
6. **Domain tags.** `knowledge`, `agent-home`
7. **Coverage quality.** Partial

---

## ADR-0003 · Recruit ranks; RosterPack remains curated seating

1. **Status / Impl.** Accepted · **partial** (RosterPack expand + seat ops; lexical recruit ≠ full recruit)
2. **Decision.** Packs are curated seating presets; Recruit is search/rank over portfolio graphs — both exist; Recruit never writes participants.
3. **Binding clauses**
   - Recruit MVP: lexical/tag scoring over capability catalogs/labels; in-memory index from `.driveagent/**`; no second daemon; no embeddings in MVP.
   - Recruit may suggest packs; seating still goes through pack `seatSources` / seatCap / `teamOpt`.
   - Spoken “team” → pack `displayName` or recruit query text — never a Drive type named Team.
   - Seat path always hub room ops; UI seats chosen slug(s).
   - Empty-graph agents remain seatable; they rank low until authored.
   - Recruit under same Add affordance as packs; results seat into **active** room.
   - Newly seated agents do **not** auto-join address set (explicit address or address-follows-focus via Transcript).
4. **Non-goals / rejected.** Packs only · Recruit only · rename RosterPack to TeamPack (Cline `Team` collision).
5. **Open.** (none listed; P4 embeddings deferred via DEC-open forks)
6. **Domain tags.** `agent-home`, `routing`, `spawn`
7. **Coverage quality.** Partial

---

## ADR-0004 · Gated learn; no transcript dump into agent knowledge

1. **Status / Impl.** Accepted · **partial** (event privacy yes; knowledge learn UI open)
2. **Decision.** No automatic transcript→knowledge; learning is propose → accept | reject | mute into canonical YAML, then compile.
3. **Binding clauses**
   - Room events are not durable agent memory.
   - Proposals may carry evidence pointers (`learned_from` to artifact paths, skill ids, event ids) — never embedded raw utterance text by default.
   - Accept is human (or explicit policy) write into `knowledge/`, then compile (ADR-0002).
   - Tiers: ephemeral (RAM) / session (wiped on leave) / durable (home, opt-in); only durable crosses accept gate.
   - Turn injection: graduated retrieval; inject audit records node ids (optionally hashes), not prose.
   - `knowledge/private/` gitignored by convention; export/pack omit private and secretRefs.
   - Must not reintroduce raw audio / full transcript via `learned_from` evidence blobs.
   - Leave/end drops ephemeral and session-tier proposals; only accepted durable edges remain.
   - **Allowed evidence:** skill/tool name, artifact relative path, event id/hash, human-authored note on accept. **Forbidden:** raw utterance, full transcript dump, audio/STT buffers, silent background write.
4. **Non-goals / rejected.** Auto-durable summaries every call · vector store of transcript embeddings (deferred/rejected for MVP) · Drive facet “memory” strings.
5. **Open.** Accept-queue UI (P3) implied as consequence, not a named Open section.
6. **Domain tags.** `privacy`, `knowledge`, `agent-home`
7. **Coverage quality.** Partial

---

## ADR-0005 · Status Hub: SQLite append-only status log in the Cline SDK

1. **Status / Impl.** Accepted · **shipped**
2. **Decision.** First-class Status Hub in the Cline SDK (`@cline/shared` schemas, `@cline/core` store/service/ops): free-form subject, dedicated `status.db`, append-only log with one current row per subject, hub ops + `report_status` tool.
3. **Binding clauses**
   - SDK-scope (not Drive-owned); Drive is first consumer.
   - Two lenses over one log: Board (current) and Changelog (history); same paginated query.
   - Free-form `subject` + attribution columns (session/agent/workspace) — not a session FK.
   - Dedicated `~/.cline/db/status.db` (cron precedent); WAL + busy retry.
   - Append-only; `publish()` stamps prior current superseded + inserts; partial unique index on current subject.
   - Monotonic `seq` cursor for resume (`since: seq`); board pages on (attention band, seq).
   - Text baseline is indexed `LIKE`; FTS5 opportunistic where available; no FTS5-only API constructs.
   - Hub ops: `status.publish|query|current|prune`; event `status.updated` via `StatusService` subscription (not only publish handler).
   - Priority `low|normal|high|critical`; high/critical raise `ui.notify`.
   - Agents publish via `report_status` (default on); attribution from tool context, never model output.
   - Retention: `prune` API from day one; default keep-everything; default retention policy deferred.
4. **Non-goals / rejected.** Persist existing hub events as the status model · reuse `sessions.db` · session/agent FK instead of subject · mutable current-only row · CRDT/distributed status. Task table + status deferred (not rejected).
5. **Open.** Default retention policy deferred; future `serverSeq` unify with hub events noted.
6. **Domain tags.** `status`, `observability`, `state`
7. **Coverage quality.** Covered

---

## ADR-0006 · PiP Partner is a companion surface

1. **Status / Impl.** Accepted · **decision** (companion IA; no PipPartner UI yet)
2. **Decision.** PiP is in-scope companion chrome for an active hub room; primary IA (Drive tab / Spotlight / Chat Join) unchanged.
3. **Binding clauses**
   - PiP does not replace Drive tab, Chat Join, or Spotlight/stage.
   - Same ops as call strip (mute, raise hand, leave, membership); no second writer.
   - Expand focuses active Drive room (and stage when present); PiP is not a second stage.
   - MVP host path: hub webview only; no editor DOM injection.
   - Supersedes “Variant C stays rejected” when that meant PiP-as-primary — companion is accepted.
4. **Non-goals / rejected.** Keep PiP rejected entirely · PiP as primary IA · editor DOM overlay.
5. **Open.** (none listed)
6. **Domain tags.** `ia/mode`, `share/stage`
7. **Coverage quality.** Partial

---

## ADR-0007 · Drive is a Cline mode

1. **Status / Impl.** Accepted · **partial** (hub IA owns work surface; Join/Leave + postures; not Plan|Act peer pill yet)
2. **Decision.** Drive is a first-class Cline mode (akin to Plan/Act): mode on unlocks room/stage/PiP/roster; mode off returns native Cline.
3. **Binding clauses**
   - Enter/exit from same mode surface family as Plan/Act.
   - Mode enables features: presence, stage, address, PiP, ask/debug postures, interrupt.
   - Postures nest under Drive: Plan | Agent | Ask | Debug; Ask/Debug not peer top-level modes.
   - Drive owns the work surface under hub Drive activity (`/drive`); former Chat page not a product destination; `Chat.tsx` remains a module mounted by Drive shell.
   - Drive shell modes: `lobby | call | history`; top-level Sessions folded into Drive history; Rooms remains multi-room discovery.
   - Prefer “Drive on/off” language; Join = Drive mode + attach room under `/drive`.
   - Amends Architecture D3: mode activation + Drive hub activity share one home.
   - Status Hub = live agent ops; retrospective rollups live on Analytics, not a Status lens.
4. **Non-goals / rejected.** Drive tab as only entry · Drive as forever-orthogonal toggle separate from Plan/Act · separate Cline Drive product chrome.
5. **Open.** Peer mode pill vs Join/Leave path still impl gap (noted in ADR).
6. **Domain tags.** `ia/mode`, `product-forks`
7. **Coverage quality.** Partial

---

## ADR-0008 · Task bank is Drive’s execution primitive

1. **Status / Impl.** Accepted · **partial** (workspace bank shipped; receipt/covered-check → ADR-0018)
2. **Decision.** Workspace-backed bank at `.drive/bank/` with `DriveTask` (implementable unit) and `DrivePlan` (ordered task ids); posture derives from bank; covered-check/completion honesty owned with ADR-0018.
3. **Binding clauses**
   - Canonical bank + active plan are **workspace-backed**; room/call ids annotate events only (not second bank authority).
   - Layout: `tasks/`, `plans/`, `archive/tasks/`, `archive/plans/`.
   - `DriveTask` detail in task file; completed → archive (read-only in MVP).
   - `DrivePlan` ordered list of task ids; ephemeral/editable; drained/closed archive; plan edits never rewrite archived tasks.
   - At most one active plan per workspace bank; others may be drafts.
   - Posture while Drive on: empty/no open tasks → Plan; open tasks → Agent bound to now task; Ask/Debug explicit overrides, cleared only by explicit clear.
   - Covered-check **intended**: Agent turn binds `taskId`; unbound mutation tools refused into Plan — tip `allowWorkspaceMutation` still advisory; tool-boundary enforcement → ADR-0018.
   - Partial failure leaves task open with `lastFailure`.
   - When policy demands proof, archival requires verification decision (ADR-0018); tip may still archive without receipt until that lands.
   - **Kanban Done / trash never archives a DriveTask.**
   - Non-bridges MVP: no Focus Chain / `team_task` sync; no `Team*` identifiers under bank code.
   - Persistence not in pure kernel; hub/core FS adapter; single writer.
4. **Non-goals / rejected.** Port cursor-drive `.cursor/plans` · reuse `team_task` · Focus Chain as sole cursor · room-scoped bank as authority.
5. **Open.** Strict covered-check / receipt enforcement follow-ons (ADR-0018).
6. **Domain tags.** `execution`, `state`, `kanban`
7. **Coverage quality.** Partial

---

## ADR-0009 · Runtime topology local / cloud / hybrid

1. **Status / Impl.** Accepted · **partial** (`assertTopologyLegal` + seeds; cap name drift noted)
2. **Decision.** Session has `DeploymentProfile` (`local|cloud|hybrid`) with pure fail-closed `TopologyPolicy` over LLM egress + voice backends together.
3. **Binding clauses**
   - Profile stored as durable facet `runtime.profile`.
   - `RuntimeTopology` immutable value: profile + `ResolvedLlmEgress` + STT/TTS provider ids + egress ceiling.
   - `TopologyPolicy.assertLegal` pure in `@cline/drive`; never imports `@cline/llms` / never opens sockets; core injects egress.
   - Local = airgap LLM + voice: STT `local-worker`; TTS browser `speechSynthesis` or local-worker; Web Speech forbidden; cloud agent base URLs forbidden.
   - Cloud allows cloud LLMs + Web Speech / cloud STT/TTS; default first-install profile `cloud`.
   - Hybrid requires explicit `runtime.egressCeiling`; over-ceiling fails closed.
   - Audio never enters hub events; STT adapters emit text; utterance text via mute-gated voice ingress.
   - HostCapabilities expose voice I/O (`voiceIo`); prefer hub discovery over hardcoded writer URLs.
4. **Non-goals / rejected.** Independent facets with no profile · unified cloud realtime multimodal as primary path.
5. **Open.** (impl name drift vs older MuteGate prose noted; not a product Open list)
6. **Domain tags.** `topology`, `providers`, `privacy`, `distribution`
7. **Coverage quality.** Partial

---

## ADR-0010 · Provider harness (BYOK) with OOTB packs

1. **Status / Impl.** Accepted · **partial** (facets + secrets forbid; adapters not fully registry-wired)
2. **Decision.** Drive owns STT/TTS slots via manifests/registry; LLM stays in Cline; secrets never in Drive facet JSON; default packs seed Local/Cloud/Hybrid.
3. **Binding clauses**
   - LLM is not a Drive provider slot; keys/modules/models stay in Cline / `@cline/llms` / agents YAML; Drive stores `runtime.profile` + pair-partner `AgentRef` only.
   - Manifests declare `id`, `slot` (`stt|tts`), `egress`, `backend`, non-secret `defaultConfig`, optional `modulePath`.
   - Selection facets: `providers.sttId|ttsId|sttConfig|ttsConfig`; old `stt.backend` enum superseded.
   - Schema/CI forbid `apiKey` / `token` in provider configs under `.cline/drive/`.
   - Default packs via `seedFacetsForProfile`: local → local-worker STT + browser TTS; cloud → Web Speech + browser TTS; hybrid → explicit ceiling + user picks.
   - First-install default `cloud`; Ollama detection may suggest Local (checklist, not wizard).
   - Plugin trust MVP: load only workspace/user `.cline/drive/providers/` + builtins; no URL install.
   - Composition root `createVoiceStack` maps registry → ports; UI never imports concrete engines outside adapters.
   - TopologyPolicy fail-closes incompatible selections (ADR-0009).
4. **Non-goals / rejected.** Drive-owned LLM registry with keys in facets · flat settings bag · remote npm/URL plugin install in MVP.
5. **Open.** Ollama detection not implemented (also noted under ADR-0021 Open).
6. **Domain tags.** `providers`, `credentials`, `topology`
7. **Coverage quality.** Partial

---

## ADR-0011 · Demo share track

1. **Status / Impl.** Accepted · **partial** (schemas + snapshot stub; no demo events/track yet)
2. **Decision.** Add `ShareMode` `structured|demo|pixel` with demo artifacts as metadata/URI events on a stage demo track — Cursor-like proof without SFU/WebRTC MVP.
3. **Binding clauses**
   - Pixel reserved/unimplemented until multi-user media.
   - Demo artifacts (`DemoArtifactRef`) via events (`drive_demo_frame`, later `drive_demo_clip`); metadata + URIs only — never inline media bytes.
   - Stage gains demo track (last N artifacts) beside work track — **target shape**.
   - Agent tools align with browser/computer-use patterns (`drive_browser_snapshot`, optional clip).
   - Blobs ephemeral by default; export explicit; privacy forbidden-key tests cover raw frame fields.
   - HostCapabilities add demo capture (`demoCapture`).
4. **Non-goals / rejected.** WebRTC pixel share as MVP · structured-only as sole demo answer · always-on agent desktop stream.
5. **Open.** Wire events + live demo track not shipped (impl note).
6. **Domain tags.** `share/stage`, `privacy`
7. **Coverage quality.** Partial

---

## ADR-0012 · Agent router for multi-agent rooms

1. **Status / Impl.** Accepted · **shipped** (`planRoute` + addressSet)
2. **Decision.** Pure `planRoute` → `RoutePlan` of address-set slices; hub delivery remains sole enforcement; router does not seat/spawn/pick providers.
3. **Binding clauses**
   - Modes: `manual|suggest|auto`; default multi-agent = `suggest`; auto opt-in; low confidence → suggest.
   - Never silent-widen empty addressSet → everyone.
   - Fractions (multi-slice) off by default until dedicated gate.
   - MVP scorer lexical/tag over seated agents’ capability labels; optional LLM rerank later behind facet.
   - Router does not seat, spawn, or pick LLM providers.
4. **Non-goals / rejected.** Manual chips only · LLM on every send (deferred optional) · silent fan-out to all agents.
5. **Open.** (none listed)
6. **Domain tags.** `routing`, `spawn`
7. **Coverage quality.** Covered

---

## ADR-0013 · Three-lane state partition

1. **Status / Impl.** Accepted · **partial** (log + live + facets; hydrate after trim → ADR-0029 H1)
2. **Decision.** Partition Drive state into durable event log, ephemeral live `RoomSnapshot`, and durable facets — adapters later bind to log + `DriveHostPort`.
3. **Binding clauses**
   - Event log: append-only, `roomId` + monotonic `seq`, versioned `DriveEvent` (+ bank family envelope); authority for history/reconnect/audit; retention may trim.
   - Live room: one hub-owned snapshot (+ director fields in same store); process memory; dual live Maps forbidden; rebuildable after trim via fold checkpoint ([ADR-0029](ADR-0029-room-hotpath-redesign.md) H1).
   - Facets: `.cline/drive` hub-written; seed live at create; never overwrite live mid-call.
   - Hub only writer for local MVP; discovery / free-port unless `CLINE_HUB_PORT`.
   - `reduceRoom` pure in `@cline/drive`; IO in `@cline/core` hub.
   - Privacy-strict: no raw audio or full transcripts on the log.
   - Do not port cursor-drive MCP `:7891`.
4. **Non-goals / rejected.** Keep RAM-only until remote · CRDT multi-writer · reuse status-hub SQLite for room events. Remote/org/audit adapters deferred (not this ADR’s impl). Unifying bank markdown root deferred.
5. **Open.** (none listed as Open; H1 completes rebuild claim)
6. **Domain tags.** `state`, `topology`, `hotpath`, `privacy`
7. **Coverage quality.** Partial

---

## ADR-0014 · Chat-fork lifecycle

1. **Status / Impl.** Accepted · **shipped** (hub `drive.fork.*` + PromotePacket)
2. **Decision.** Hybrid visibility workers: invisible by default, auditable on demand; seed + promote (not clone/merge); path-disjoint / worktree isolation for parallel edits.
3. **Binding clauses**
   - Fork only at hard boundaries (Do-item claim, wave batch start, review gate) — not director replan ticks / Spotlight rank / mute UI.
   - Seed with compact `SeedPacket`; prefer `parentSessionId` child / Team sub-sessions over full-message copy.
   - Terminal outcome `PromotePacket` (summary, decisions, show ids, event refs, audit handle); main receives summary only; never splice raw worker turns into `roomTranscript`.
   - Archive then drop: retain via `auditHandle`; after retention drop messages; keep PromotePacket + artifact URIs.
   - Parallel edit forks require path-disjoint contracts and/or `worktreeIsolation`; shared-cwd parallel mutation illegal under `assertForkLegal`.
   - Reject as worker substrate: CLI `/fork`, checkpoint restore, unimplemented hub `session.fork`.
   - Ownership: schemas `@cline/shared`; policy `@cline/drive`; spawn/cancel/audit `@cline/core`; audit UI hub.
4. **Non-goals / rejected.** Visible parallel chats as default · invisible with no audit · raw transcript merge/CRDT · reuse CLI `/fork` or checkpoint restore · wait for full seated director cast.
5. **Open.** W-33 one-shot side-question forks remain related GAP (not this loop). Audit retention window needs explicit policy/GC (consequence).
6. **Domain tags.** `forks`, `execution`, `privacy`, `spawn`
7. **Coverage quality.** Covered

---

## ADR-0015 · Local task-session observability

1. **Status / Impl.** Accepted · **partial**
2. **Decision.** Satisfaction unit is the task; observability local-first from room+bank logs; closed-loop plan improve is gated (ADR-0004 spirit); no phone-home Drive telemetry in MVP.
3. **Binding clauses**
   - Metrics primarily over `DriveTask` / `DrivePlan` lifecycle correlated with call presence — not tokens/sentiment.
   - MVP rollups from local hub/workspace logs; opt-in export inherits DRV-PRIVACY.
   - `callSessionId` (join-scoped) correlates join/leave duration and bank completions; bank uses real `roomId` when from a room.
   - Complete bank event spine before trusting dashboards (opened/bound/completed/archived/plan activated/archived/plan-ref changed).
   - Intent without Goal type: `DrivePlan.title` (+ task ids); no parallel Goal entity for metrics MVP.
   - Mid-plan adds after activate = churn; edits/new goals after successful completions = positive engagement.
   - Stall diagnosis uses structured event ids/paths/skill ids only; proposals propose→accept|reject|mute; no auto transcript→knowledge; no silent plan rewrite.
   - `BankSnapshot` cursor authoritative; learned scorers proposers only.
   - Separation from phase-gate PRD success-metrics; PRD 10 owns session satisfaction.
4. **Non-goals / rejected.** Phone-home PostHog Drive funnels · transcript sentiment · first-class Goal (deferred) · learned cursor as product truth · fold into prd-success-metrics only.
5. **Open.** Session satisfaction metrics accept (ADR-0000 Still Open); dashboard spine completeness gaps (impl note).
6. **Domain tags.** `observability`, `execution`, `privacy`, `adlc`
7. **Coverage quality.** Partial

---

## ADR-0016 · Drive mode distribution & positioning

1. **Status / Impl.** Accepted · **decision** (Route B fork + path H hosted single-writer; freemium via DEC-mobile)
2. **Decision.** Keep Drive in the fork (Route B): self-hosted beta + accepted path H hosted single-writer speaking the same Drive wire; do not merge upstream for now; wedge is the event-sourced presentation protocol.
3. **Binding clauses**
   - Self-hosted beta: clone fork, locally spawned single-writer hub; packaging/docs/preflight/support.
   - Path H: hosted single-writer room service, same wire, for phone/PWA ([DEC-mobile-consumer-owner](../decisions/DEC-mobile-consumer-owner.md)); signaling ADR-0029 H5; credentials ADR-0021; economics Cline freemium (Sign in with Cline primary, BYOK secondary).
   - Still non-goals: multi-human rooms; MCP as room bus; Drive-owned plan/pricing chrome.
   - Route C (protocol upstream) deferred/revisitable after beta evidence; schemas stay clean; fork divergence confined to Drive surfaces.
   - Differentiation claim: events-not-pixels, single-writer hub, typed show artifacts, late-join by seq, privacy-clean metadata events — not “watch an agent on a call.”
4. **Non-goals / rejected.** Decide-by-default silent Route B · position wedge as “watch an agent on a call” · separate SDK repo now (DEC-package-location) · hosted **multi-human** rooms (still rejected) · Route A absorb-as-goal for now.
5. **Open.** Historical Q1–Q6 closed for Route B; Route C revisit after beta. Path H ops model listed as coverage gap on ADR-0000.
6. **Domain tags.** `distribution`, `web-runtime`, `credentials`, `economics`, `product-forks`
7. **Coverage quality.** Partial

---

## ADR-0017 · Narration-bound presentation cues

1. **Status / Impl.** Proposed — deferred · **deferred** (demo canvas only; behind S9)
2. **Decision.** Extend `ScriptBeatSchema` with optional narration-relative cues (`at` fraction 0–1) and optional `bindTimeline` so presentation shares a SayClock with spoken lines.
3. **Binding clauses**
   - Cue kinds: `reveal|emphasize|chime|advance_step`; `targetRef` artifact-relative, not DOM selector.
   - Fractions not milliseconds; refs not selectors; degrades when muted/synthesized/ignored.
   - End state always reachable (scrub/pause/late-join/reduced motion apply all cues immediately).
   - `bindTimeline` retimes artifact timeline to spoken line; does not redesign.
   - Hub stays single writer; cues on director script / `AgentMediaBag`; no new events/ops; clients derive own clock from audio they play.
4. **Non-goals / rejected.** Split every cue into its own beat · absolute millisecond offsets · renderer-side keyword heuristics · leave capability demo-only.
5. **Open.** Accept when Spotlight S9 ships (ADR-0000 Proposed gate). Owner: Harrison.
6. **Domain tags.** `narration`, `share/stage`
7. **Coverage quality.** Deferred

---

## ADR-0018 · Agent runtime contract (DriveTask v1)

1. **Status / Impl.** Accepted · **partial**
2. **Decision.** Locked unit hierarchy and research-18 choices: `DriveTask` → `DriveRun` → `DriveRunWorkItem` ↔ KanbanCard ↔ Session/Worktree; WorkLease at mutation boundary; Agent Control + Interop protocols; completion guard; privacy/security constraints.
3. **Binding clauses**
   - Hierarchy roles as tabled; `DriveRunWorkItem` ≠ wave `DriveWorkItem`; DriveTask ≠ Kanban card; “DrivePlan Controller” = run admission controller.
   - Bank/active plan workspace-backed (reconcile ADR-0008).
   - Archival requires recorded verification when policy demands proof; Kanban Done/trash never archives DriveTask.
   - Evidence allowed: paths, SHAs, test summaries/run ids, branch/PR URLs, bounded error classes, receipt hashes. Forbidden durable memory: raw prompts, transcripts, images, full tool dumps, secrets, full terminal logs.
   - Ids generated; leases/commands carry `runSpecRevision` + idempotency; heartbeat/expiry; CAS before multi-client mutable writers depend on it.
   - Users/product create/reorder/split/archive/override; agents propose; only run controller admits; agents cannot reorder plan or mark DriveTask done.
   - First execution host adapter: DriveKanban; Status/Director/Team projections correlate by id, not authority; chat-fork = recovery substrate, not lease coordinator.
   - No learned task scorer / autonomous plan mutator until privacy-safe history + local eval accepted.
   - WorkLease hangs off DriveTask.id; not DriveHostPort; typed mission packet only (never whole bank / raw room history / other agents’ private context / broad Hub bearer).
   - Agent Control tools: list_eligible_work … release_work (named set).
   - Interop host ops: getCapabilities / applyProjection / execute / observe / collectReceipt — full wire ADR-0019.
   - Managed cards: `externalRef` `system: "driveplan"`; disable dependency auto-start, auto-commit, auto-PR; evidence-ready = Review/awaiting Drive verification; human edits → `projection_diverged`.
   - No parallel Goal entity; TTS stays Drive TtsPort (not curated remote `speak`); plugin trust continues ADR-0010 (workspace-local/vendored patterns).
   - Hub discovery; never hardcoded ports; short-lived workspace/run-scoped capability.
4. **Non-goals / rejected.** Board.json sync/seed as bridge · Kanban as scheduler of record · hang leases on DriveHostPort · adopt curated goal/agents-squad/speak as runtime deps · sidecar-only ID map without card `externalRef` for managed cards · seed tooling as product interop.
5. **Open.** Follow-on list: full Agent Control at tool boundary; completion guard when policy requires; ADR-0019 wire; live Hub state-plane UI; policy pack.
6. **Domain tags.** `execution`, `kanban`, `authority`, `privacy`, `forks`
7. **Coverage quality.** Partial

---

## ADR-0019 · DrivePlan–Kanban Interop wire

1. **Status / Impl.** Accepted · **partial** (`execute` / `collectReceipt` + `KanbanInteropHost`; host adapters thin)
2. **Decision.** Capability surface v0 with `execute` + `collectReceipt` via `KanbanInteropHost`; authority split unchanged from ADR-0018.
3. **Binding clauses**
   - Ops: getCapabilities, applyProjection, observe, execute, collectReceipt; version stays 0 until breaking change.
   - `@cline/drive` stays pure; host enforces `lease.allowedActions` + workspace fingerprint; collectReceipt returns evidence refs never raw transcripts.
   - Kernel validates lease↔run identity; Receipt draft `decision: "accepted"` only when evidence non-empty; human/verifier may still reject at bank complete.
   - Kanban Done/trash never archives DriveTask; seed scripts not product interop; wave WorkItem ≠ RunWorkItem.
4. **Non-goals / rejected.** Hang execute on DriveHostPort · Kanban as scheduler of record · leave execute forever deferred.
5. **Open.** Hub command wrappers; live `projectionDiverged`; capability version bump when command vocabulary freezes. Product managed-execution boundary beyond wire = ADR-0000 coverage gap.
6. **Domain tags.** `kanban`, `execution`, `authority`
7. **Coverage quality.** Partial

---

## ADR-0020 · Session delivery CI/CD (ledger + projected stack)

1. **Status / Impl.** Proposed · **decision**
2. **Decision.** WorktreeLedger authority + SessionDeliveryUnit product identity: `DriveDelivery` owns git history; local ledger SoT; GitHub `gh stack` coalesced projection; Hold = focus park; binding CI scale policy.
3. **Binding clauses**
   - `DriveDelivery` (`dd_…`) durable delivery identity with first-class `title`; ≠ `callSessionId`; survives Hold/leave-rejoin; 1:1 with one isolated worktree while mutating.
   - Flow: WorkLease boundary → local commit → DeliveryLedger → coalesced project → gh stack tip(s).
   - Ledger append-only `{ sha, parentSha, message, taskId?, runId?, leaseId?, at }`; agents do not ad-hoc push every commit; coalesce by time+count.
   - One stack per delivery; layers typically per admitted DriveRun / sealed task; recommend ≤5 layers; same-repo stacks only.
   - Hold moves UI focus; background agents may continue unless `pauseAgents`; do not overload Show `StickyPolicy.hold`; cross-delivery refs typed only.
   - Rewind (pre-merge): reset to ledger SHA + force-with-lease affected tips; Revert (post-merge): revert commit / close layer PR; never rewrite `main`.
   - Receipts must grow typed evidence (`commit:`, `pr:`, `branch:`) before archival depends on delivery proof.
   - CI policy: wire `run_expensive`; preserve always-reporting required gates; draft by default; no skip-CI labels; coalesce projection; document in CI.md; fork/sandbox lanes explicit dual path.
4. **Non-goals / rejected.** Kanban Done as archive authority · board-wide sync/seed as bridge · multi-human media rooms · TaskAtomicPRs as default session model · SessionDeliveryUnit alone as GitHub-authoritative · skip-CI labels / per-commit PR spam.
5. **Open.** Awaiting leadership accept; gate: worktree ledger + `DriveDelivery` identity on tip (ADR-0000).
6. **Domain tags.** `delivery-ci`, `execution`, `forks`, `observability`
7. **Coverage quality.** Paper

---

## ADR-0021 · Drive credential onboarding

1. **Status / Impl.** Proposed · **none**
2. **Decision.** Credentials stay in Cline provider settings; device-code “Sign in with Cline” primary, BYOK secondary; forward `onPrompt` (code + URL only); honest Drive readiness gate; three secret-hygiene fixes prerequisite.
3. **Binding clauses**
   - Drive never stores, proxies, or reads a key; consumes readiness boolean only (ADR-0010).
   - Device-code primary; BYOK via existing provider UI promoted to first-run.
   - Hub forwards `onPrompt` / `onServerListening`; frames carry user code + verification URL — never a token; reply stays `accessTokenPresent: boolean`.
   - Remove `|| "anthropic"` substitution; unconfigured LLM → distinct not-ready that blocks call with route to fix.
   - Hygiene prerequisite: catalog `apiKeyPresent: boolean`; desktop-command OAuth reply stops returning raw token.
4. **Non-goals / rejected.** Paste key into Drive settings field · Drive-specific credential store · loopback OAuth (`oca`/`openai-codex`) as primary · env-vars-only as first-run experience.
5. **Open.** Whether first-run blocks hub or dismissible banner (recommend dismissible for demo route) · Ollama detect/suggest Local (ADR-0010) out of scope here.
6. **Domain tags.** `credentials`, `distribution`, `privacy`, `providers`
7. **Coverage quality.** Paper

---

## ADR-0022 · Agent economics

1. **Status / Impl.** Proposed · **none**
2. **Decision.** Per-participant usage as first-class Drive event (correlate existing SDK measurement); session meter for spend/context/model; connect per-agent model vocab already in `agent.yaml`; budgets warn before act and are scoped.
3. **Binding clauses**
   - Attribute per-message deltas to participant; fold into room state; additive correlation, not second accounting system.
   - Does not change satisfaction unit (ADR-0015): tasks = success; this = resource.
   - Call surfaces session meter; context as *remaining*; compaction announced.
   - Connect `providerId`/`modelId`/`maxIterations` from home compile to session start; keys stay in Cline settings; `AgentParticipantSchema` gains resolved model (schema rev).
   - Budgets warn before act; attributable to agent or call — not process-global silent abort shape of `CLINE_MAX_SESSION_COST`.
   - Usage projection derived (ADR-0013) — not a fourth store.
4. **Non-goals / rejected.** Reuse Hub session list as the meter · second accounting system in Drive · budgets as hard aborts only · per-room model instead of per-agent.
5. **Open.** Where meter lives · advisory vs enforcing budgets in beta · spend per call session vs per room across restarts.
6. **Domain tags.** `economics`, `observability`, `providers`, `credentials`
7. **Coverage quality.** Paper

---

## ADR-0023 · Agent spawn governance

1. **Status / Impl.** Accepted · **partial** (depth shipped #146; consult/delegate seat path + gate classes open)
2. **Decision.** Bound fork generations (depth 1 default); distinguish consult vs delegate; advisory teams are RosterPacks; hub enforces; spawn/seat as gate classes; spawn provenance + cascade dismiss.
3. **Binding clauses**
   - Default `DEFAULT_MAX_CHAT_FORK_DEPTH = 1`; raise only after authority ceilings live (ADR-0027).
   - Consult: opinion only, writes nothing, preset `readonly` always, terminal (may not spawn), default allowed to declared advisory pack.
   - Delegate: committed work, writes files/tasks/PRs, preset up to parent never above, may spawn within depth, requires explicit grant.
   - Advisory team = curated RosterPack with `readonly`; reuse `expandRosterPack` + `capPreset`.
   - Enforcement hub-side; `.driveagent/` stays intent.
   - Spawn/seat become gate classes under DRV-GATES.
   - Every spawned agent attributable via `seatSources:{kind:"spawn",parentId}` and cascade-dismissible.
4. **Non-goals / rejected.** One “can spawn” boolean · enforce `.driveagent/permissions.yaml` directly · per-agent ACLs of who may seat whom · leave fork depth unbounded (closed by #146).
5. **Open.** Raise default fork depth after live `capPreset` · consult own context vs room · delegation approval granularity (per spawn/session/pack) · whether agent may consult pack human never seen.
6. **Domain tags.** `spawn`, `authority`, `roles`, `forks`
7. **Coverage quality.** Partial

---

## ADR-0024 · Drive web runtime

1. **Status / Impl.** Proposed · **none**
2. **Decision.** Extract transport as named port at composition root; browser runs real Drive host on `memoryDriveHost` that must pass `runHostConformance`; no new message types; capabilities that cannot work fail visibly.
3. **Binding clauses**
   - Select transport impl at composition root (`getVsCodeApi` pattern); no component changes when naming inbound subscribe.
   - Web build runs real host seeded from fixture log driving same `reduceRoom` fold.
   - Browser host must pass same conformance suite as daemon (load-bearing).
   - No new message types for browser host — fix seam instead.
   - Silent degradation banned in web build; correlator timeout→lie and hang-on-Checking are bugs.
4. **Non-goals / rejected.** Message-shaped mock · separate demo app · record/replay hub traffic · hosting a real hub (contradicts ADR-0016 self-host framing for this surface).
5. **Open.** How strong is `runHostConformance` · Door B (`desktopCommand`) vs hide settings · fixture ownership · mermaid on phones vs static image.
6. **Domain tags.** `web-runtime`, `state`, `distribution`
7. **Coverage quality.** Paper

---

## ADR-0025 · Declared authority must be enforced authority

1. **Status / Impl.** Accepted · **partial** (E1 L1 consumer landed; Finding 1 rows open)
2. **Decision.** Meta-rule: declared limit without enforcement-path consumer is a defect (CI); delegation may not widen; deny-by-default opt-in at SDK / default at product; verifier identity required with receipts; durable state readable by owning agent.
3. **Binding clauses**
   - Every authority-expressing type needs ≥1 non-test consumer that can refuse; CI asserts count > 0 (existence, not correctness).
   - Child authority capped by parent: `toolPolicies` + `requestToolApproval` thread all delegation paths; child effective policy = intersection; funnel `buildDelegatedAgentConfig`; reuse `capPreset` min-rule; preset→policy table in `@cline/core`.
   - SDK keeps documented `@default true` for ToolPolicy; deny-by-default is explicit embedder posture; Cline products select closed posture.
   - Where receipt required: `decidedBy` required on accepted receipt; checked vs identity of agent bound to run from tool context (never model); deterministic checks outrank model verdicts.
   - Durable state readable by owning agent via projection of existing lanes (ADR-0013) — not fourth store; not transcript read-back (ADR-0004).
4. **Non-goals / rejected.** Invert `resolveToolPolicy` directly · new permission engine · fold into ADR-0022/0023 · enforce whole class at once. Verifier = any non-executor agent deferred (needs decision 5 read-side).
5. **Open.** Closed-posture allowlist contents · whether `beforeTool` may widen · argument-aware gate classification · read side tool vs injection · verifier identity when human on another surface · unenforced-declaration hard CI fail vs exemption list.
6. **Domain tags.** `authority`, `spawn`, `roles`, `execution`, `privacy`
7. **Coverage quality.** Partial

---

## ADR-0026 · Evidence-backed Done needs a refusal path

1. **Status / Impl.** Accepted · **partial** (registry + checker; cold-start `claim:<id>`; Finding 1 matrix / BACKLOG render open)
2. **Decision.** Delivery twin of ADR-0025: claims registry is SoT for delivery status; cold-start docs must cite `claim:<id>`; `verified_shipped` needs evidence path+command; markdown alone is not SoT.
3. **Binding clauses**
   - Registry at `delivery/claims-registry.yaml` with statuses `scaffold|active_partial|verified_shipped|blocked|planned`.
   - Cold-start surfaces must cite `claim:<id>` next to Shipped/Landed/Partial adjectives; bare status words fail `check:drivecode-docs`.
   - `verified_shipped` requires ≥1 evidence entry with existing `path` and non-empty `command`.
   - BACKLOG.md may render registry later; Markdown alone is not SoT.
   - Fix-class matrices / consumer-path grep v2 are follow-on; same refusal pattern as ADR-0025 E1 on runtime side.
4. **Non-goals / rejected.** Prose Done / TASK-GRAPH phase cards as Done ledger (historical TASK-GRAPH remains phase contract, not Done ledger).
5. **Open.** Full Finding 1 consumer matrix · BACKLOG render · consumer-path grep v2.
6. **Domain tags.** `delivery-ci`, `authority`, `observability`
7. **Coverage quality.** Partial

---

## ADR-0027 · Role tiers: permission ceiling or prompt

1. **Status / Impl.** Accepted · **decision** (no third tier until live `capPreset` on `call_seat`)
2. **Decision.** A typed role tier may ship only with an enforcement path (today: wait on delivery D1); prompt-level hierarchy OK but not governance; fork depth stays 1; three role vocabularies named as debt.
3. **Binding clauses**
   - No third value on `TeamMemberSnapshot.role` / no tier vocabulary extension until `capPreset` on live seat path and persisted on participant.
   - Architect/Tech Lead/Developer as `rolePrompt` values endorsed; surfaces must not describe them as permission boundary.
   - `DEFAULT_MAX_CHAT_FORK_DEPTH` stays 1; raising is separate decision after clause 1.
   - Three vocabularies named (not converged here): Team `lead|teammate` · Router `pair_partner|specialist|host|other` · `call_join` `partner|specialist|recorder`.
4. **Non-goals / rejected.** Add third tier now, wire authority later · reject hierarchy outright · fold role into WorkLease and drop member roles (larger; own ADR if pursued). Converging vocabularies out of scope.
5. **Open.** Role vocabulary convergence (ADR-0000 gap / follow-on when D1 lands).
6. **Domain tags.** `roles`, `authority`, `spawn`
7. **Coverage quality.** Partial

---

## ADR-0028 · Drive Mode is the ADLC control plane

1. **Status / Impl.** Accepted · **decision**
2. **Decision.** Drive Mode is this fork’s ADLC control plane; map seven factory properties onto existing planes; no second workflow runtime.
3. **Binding clauses**
   - Human joins a call; room runs factory loop; humans at judgment gates (approve/steer/accept plan-improve), not babysitting every step.
   - No second workflow runtime: hub ops + ChatFork / wave / bank / stall paths only; no Cloudflare Workflows-shaped package / second event bus.
   - Factory property map: Programmatic → HubCommandName+tools · Horizontally scalable → isolation before teamOpt · Reproducible → room+bank JSONL · Real-time push → room.event/status seq/stall · Atomic → DriveTask+Receipt · Permissioned → gates+capPreset · Self-improving → rollup→plan-improve gated.
   - First-use on-ramps (ADR-0021 credentials, first-call TTS) are ADLC work.
   - Status Hub `high|critical` → `ui.notify` stays; when Drive active, selected Status failures also feed Drive stall/bank spine as **offer**, not silent auto-execute.
   - Product copy may say “ADLC control plane”; Drive remains a Cline mode (ADR-0007).
   - Sequences defaults-delivery B2/B3 and enforced-authority E2; does not fork those plans.
4. **Non-goals / rejected.** Port `@cloudflare/ci` / Workers Workflows / Flagship gradual deploy · WebRTC / multi-human media · Agents/Teams spawn UI before D1/E2 enforcement · unify Status Hub and Drive bank into one store · auto-merge to production remotes.
5. **Open.** (none listed; plane-naming gap on ADR-0000)
6. **Domain tags.** `adlc`, `execution`, `status`, `authority`, `ia/mode`
7. **Coverage quality.** Partial

---

## ADR-0029 · Room hot-path redesign (H1–H5)

1. **Status / Impl.** Accepted · **partial** (H1–H4 shipped; H5 open)
2. **Decision.** Amend ADR-0013 rebuild story: fold checkpoint on trim; delta publish; one stage projector clock; layout contract; signaling topology for path H — same Drive wire; MCP off room wire.
3. **Binding clauses**
   - **H1:** On trim, write `checkpoint.json` `{ schemaVersion, seq, snapshot }`; cold hydrate install checkpoint then `readSince(checkpoint.seq)`; else from-zero.
   - **H2:** Default broadcast `room.delta` `{ event, seq }`; full `room.snapshot` on join/reconnect gap/idle coalesce.
   - **H3:** In-process tool/session end → `recordWork` same turn as `tool_event`; remove extra `call_record_work` from critical path; Show/wave fan-out async.
   - **H4:** Call surface = Spotlight + one strip + sheets; Plan editor/bank/audit/meters → sheets/drawers; same composition root hub wide + mobile `?app=1`.
   - **H5 (open):** Extend topology to where hub runs — `local` vs `cloud` hosted single-writer, same wire (path H); MCP stays off room wire.
   - Does not reopen: single-writer hub, events-first stage, rejection of MCP `:7891` room daemon.
4. **Non-goals / rejected.** Raise retention forever / never trim · snapshot every append as default · MCP Streamable HTTP as room transport · CRDT multi-writer.
5. **Open.** H5 hosted signaling writer (after MC1 call verbs unless demo forces); client visual/layout adaptation listed as related gap on ADR-0000.
6. **Domain tags.** `hotpath`, `state`, `share/stage`, `distribution`, `web-runtime`
7. **Coverage quality.** Partial

---

## DEC-agent-source-of-truth

1. **Status / Impl.** Accepted (leadership; 2026-07-29 accept-all) · Impl not columned — treat as Partial with ADR-0001
2. **Decision.** Authoring home is `.driveagent/<slug>/`; runtime remains a single Cline path via compile.
3. **Binding clauses**
   - Humans/tools edit `.driveagent/<slug>/` (canonical YAML).
   - Pure compile in `@cline/drive` → host-shaped view; hub/host FS I/O at boundary; webview never second writer of seat-affecting state without hub ops.
   - `AgentProfile` appearance overlay only; must not contain prompt/tools/skills/providerId/modelId.
   - Legacy `.cline/agents` import once; dual-authoring extinguished by docs+lint/CI.
   - Builtin pair partner may be read-only synthetic home.
   - Locked `AgentRef`: `driveagent` | `builtin` | `configured` (migration-only; lint warns; no new writes).
   - Vision non-goal rewritten: Drive does not store prompts/tools/models in call facets; exactly one runtime path.
4. **Non-goals / rejected.** Facet-only prompt store · `.cline/agents` only forever · `.claude/` name · two runtimes (Drive + Cline).
5. **Open.** (none; verification items are gates)
6. **Domain tags.** `agent-home`, `product-forks`
7. **Coverage quality.** Partial

---

## DEC-package-location

1. **Status / Impl.** Accepted · package on tip — **Covered** for location decision; conformance growth continues
2. **Decision.** Phase 1: `@cline/drive` lives in this monorepo at `sdk/packages/drive`.
3. **Binding clauses**
   - `drivecode-sdk` is a **role** (portable meta-harness), not a second package name in-monorepo.
   - Package grows: pure kernel policies, `DriveHostPort`, capability descriptor, conformance kit, `reduceRoom` / `projectStage`.
   - Hub commit/broadcast stays in `@cline/core`.
   - Extract to separate published repo only when a second host needs the package and conformance is green against non-Cline fakeHost.
4. **Non-goals / rejected.** Separate repo now · pass-through package above `@cline/drive` · Drive logic only in `@cline/core`.
5. **Open.** (none)
6. **Domain tags.** `distribution`, `web-runtime`, `product-forks`
7. **Coverage quality.** Covered

---

## DEC-open-product-forks

1. **Status / Impl.** Accepted (bundle)
2. **Decision.** Closes preference forks: focus-room default, filtered transcript projection, structured user share, violet edge accent, revise-not-restart, catch-up line, mic ⊥ TTS.
3. **Binding clauses**
   - **Multi-room focus:** MVP default `focus-room`; exactly one room runs agent turns; unfocused = view-only; switch pauses after current tool; notifications for unfocused out of MVP.
   - **Per-agent transcript:** filtered projection of shared room log; private log Phase 2+ option if needed.
   - **User share MVP:** structured only; pixel/WebRTC later.
   - **Brand accent:** violet edge for selection; do not ship violet-fill density as default Drive chrome.
   - **Revise-not-restart:** barge-in default revise (preserve useful tool results) unless explicit restart/cancel; misclassification lean revise; hard cancel via raise-hand/end.
   - **Catch-up:** one factual “since you left” line from stage/now-next; no LLM narrative when history thin.
   - **Mic mute ⊥ TTS quiet:** independent controls; strip shows both.
4. **Non-goals / deferred.** Wake/sleep voice phrases · one-shot fork vs seated specialist · semantic/embeddings recruit · TextChannels product. Pixel user-share in MVP **Rejected** (ADR-0000 closed list). Background turns in unfocused rooms **Rejected**.
5. **Open.** Catch-up copy owner still product gap (ADR-0000 Still Open → DRV-LEAVE-END).
6. **Domain tags.** `product-forks`, `ia/mode`, `share/stage`, `privacy`, `brand`, `forks`
7. **Coverage quality.** Partial

---

## DEC-mobile-consumer-owner

1. **Status / Impl.** Accepted (2026-08-07)
2. **Decision.** Path H yes; mic muted on join; PWA name “Cline Drive”; MC3 on Now roadmap; hosted-turn economics = Cline freemium (Sign in primary, BYOK secondary).
3. **Binding clauses**
   - Hosted single-writer hub (same wire) accepted for phone/PWA real turns; self-hosted Route B remains valid; multi-human rooms stay non-goal; engineering ADR-0029 H5; credentials ADR-0021.
   - Mic muted on join; Mute/Unmute = Enable microphone; no hot-mic-from-beat-one default.
   - Home-screen/PWA display name “Cline Drive” (not “Drive” alone).
   - MC3 (PWA) on Now sequencer — not optional phase-8 polish.
   - Hosted turns: Sign in with Cline / account credits primary; BYOK secondary; do not ship BYOK-only first-run for path H; no Drive-owned plan/pricing chrome.
   - Sequencing: finish MC1 call verbs first; H5 unblocked but after those unless demo forces earlier.
4. **Non-goals / rejected.** Multi-human rooms · Drive-owned plan/pricing chrome · BYOK-only consumer first-run for path H.
5. **Open.** Path H ops model (auth/tenancy/residency/who pays) — ADR-0000 gap.
6. **Domain tags.** `distribution`, `web-runtime`, `credentials`, `economics`, `brand`, `product-forks`
7. **Coverage quality.** Partial

---

## DEC-drive-mark-official

1. **Status / Impl.** Accepted
2. **Decision.** Official Drive feature logo is monochrome Cline-in-wheel light/dark pair; wait motion picks one primary axis (event-oriented vs location-oriented); loading geometry keeps head upright.
3. **Binding clauses**
   - Official mark: light/dark monochrome silhouette — not purple fill; not Cline app wordmark.
   - Event-oriented waits bind to unfinished work (`isHydrating`, join, reconnect); stop when event ends.
   - Location-oriented waits bind to destination chrome; short/finite; prefer rock/opacity over continuous spin.
   - Loading: rim/spokes may spin; head stays upright; do not full-spin single-path combined mark.
   - Product code keeps `currentColor` icons; assets generated from official `assets/drive/source.png`.
4. **Non-goals / rejected.** Animate every wait the same · full-mark 360° spinner · purple filled logo · JS timeline / Lottie pack.
5. **Open.** Eyes stay cutouts until mask layers (consequence); verification checklist in DRIVE-MARK.md.
6. **Domain tags.** `brand`
7. **Coverage quality.** Covered

---

## DOMAIN MATRIX

| Domain tag | Covered by | Still missing / weak |
|---|---|---|
| **agent-home** | ADR-0001, ADR-0002, ADR-0003, ADR-0004, DEC-agent-source-of-truth | Hub home write path; full recruit; learn UI; compile-into-running-agent path |
| **knowledge** | ADR-0002, ADR-0004 | Compile wired into `@cline/drive` graph path (board: decision); gated learn accept UI |
| **privacy** | ADR-0004, ADR-0009, ADR-0010, ADR-0011, ADR-0014, ADR-0015, ADR-0018, ADR-0021, DEC-open-product-forks | Secret-hygiene fixes (0021); transcript→knowledge always forbidden — keep scanners honest |
| **status** | ADR-0005, ADR-0028 | Status→Drive stall bridge (0028); plane-naming vs Engine/Director nouns (hole) |
| **ia/mode** | ADR-0006, ADR-0007, ADR-0028, DEC-open-product-forks, D3 | Drive as peer Plan\|Act pill; PiP UI; Show vs stage ownership nouns (hole) |
| **execution** | ADR-0008, ADR-0014, ADR-0015, ADR-0018, ADR-0019, ADR-0020, ADR-0025, ADR-0026, ADR-0028 | Covered-check enforcement; full Agent Control; DriveDelivery (Paper); Kanban managed-execution product boundary (hole) |
| **topology** | ADR-0009, ADR-0013, D8, D2 | Path H cloud signaling (0029 H5); hosted ops model (hole) |
| **providers** | ADR-0010, ADR-0009, ADR-0021, ADR-0022, D9 | Registry-wired adapters; Ollama detect; per-agent model connect (Paper 0022) |
| **share/stage** | ADR-0011, ADR-0006, ADR-0017, ADR-0029 H3–H4, D4, DEC-open-product-forks | Demo track events; narration cues (Deferred); client visual/layout adaptation (hole) |
| **routing** | ADR-0012, ADR-0003 | Fraction splitting gated; LLM rerank optional |
| **state** | ADR-0013, ADR-0029, ADR-0005, ADR-0022, D7, D10 | H5 cloud writer; usage projection when 0022 accepts; dual-map debt closed by H-path |
| **forks** | ADR-0014, ADR-0023, ADR-0020, DEC-open-product-forks | Consult/delegate seat path; worktree isolation for Hold; one-shot fork vs specialist deferred |
| **observability** | ADR-0005, ADR-0015, ADR-0022, ADR-0026 | Session satisfaction accept; Drive meter surfaces (Paper); claim BACKLOG render |
| **distribution** | ADR-0016, DEC-package-location, DEC-mobile-consumer-owner, ADR-0024, ADR-0029 H5 | Path H ops; credentialed beta gate (Paper 0021); browser conformance (Paper 0024) |
| **narration** | ADR-0017, D1 (narration policy ownership) | Deferred behind S9 |
| **kanban** | ADR-0018, ADR-0019, ADR-0008 | Thin host adapters; managed-execution ownership beyond wire (hole) |
| **delivery-ci** | ADR-0020, ADR-0026 | DriveDelivery runtime (Paper); wire `run_expensive`; full Done consumer matrix |
| **credentials** | ADR-0021, ADR-0010, DEC-mobile-consumer-owner, ADR-0016 | Device-code hub path + hygiene (Paper); Windows cred perms acknowledged out of scope |
| **economics** | ADR-0022, DEC-mobile-consumer-owner, ADR-0016 | Meter placement/advisory vs enforce (Paper/Open); freemium failure ops (hole) |
| **spawn** | ADR-0023, ADR-0003, ADR-0012, ADR-0014, ADR-0025, ADR-0027 | Live `capPreset` on `call_seat` (D1); consult vs delegate product; spawn UI behind E2 |
| **web-runtime** | ADR-0024, ADR-0029 H4–H5, DEC-mobile, ADR-0016 | Conformance-passing browser host (Paper); hosted signaling |
| **authority** | ADR-0025, ADR-0026, ADR-0018, ADR-0023, ADR-0027 | Finding 1 rows; receipt identity; deny-by-default product posture details |
| **roles** | ADR-0027, ADR-0023 | Vocabulary convergence (hole/follow-on); typed third tier blocked on D1 |
| **adlc** | ADR-0028, ADR-0015 | Plane-naming ADR; first-use on-ramps blocked on 0021 Paper |
| **hotpath** | ADR-0029 (amends ADR-0013) | H5 only |
| **brand** | DEC-drive-mark-official, DEC-open-product-forks (violet edge), DEC-mobile (“Cline Drive”) | Mask layers for eyes; install string vs mark are separate |
| **product-forks** | DEC-open-product-forks, DEC-agent-source-of-truth, DEC-package-location, DEC-mobile, ADR-0007, ADR-0016 | Catch-up copy; one-shot fork; TextChannels; multi-device parity contract (hole) |

---

## HOLES → drafts (2026-08-08)

Former holes now have **Proposed** records (Paper until Accepted). Clause detail lives in each draft; this table is the pointer map.

| Former hole | Draft | Coverage quality |
|---|---|---|
| Plane naming (+ show/stage nouns) | [ADR-0030](ADR-0030-plane-naming.md) | Paper |
| Client visual / layout | [ADR-0031](ADR-0031-visual-layout.md) | Paper |
| Path H ops | [ADR-0032](ADR-0032-path-h-ops.md) | Paper |
| Kanban managed-execution boundary | [ADR-0033](ADR-0033-managed-execution-boundary.md) | Paper |
| Role vocabulary convergence | [ADR-0034](ADR-0034-role-vocabulary.md) | Paper (blocked on D1) |
| Multi-device parity | [DEC-multi-device-parity](../decisions/DEC-multi-device-parity.md) | Paper |
| Codebase-map firewall | [DEC-codebase-map-firewall](../decisions/DEC-codebase-map-firewall.md) | Paper |
| Late-join / return catch-up | [ADR-0035](ADR-0035-late-join-catch-up.md) | Paper |

### Still Open (product gaps — not holes in the ADR sense, but undecided product detail)

| Topic | Blocking artifact |
|---|---|
| Approval UI owner detail | DRV-GATES |
| Catch-up orientation copy owner | DRV-LEAVE-END |
| One-shot fork vs specialist | Later / WDK (not Phase 0) |
| Session satisfaction metrics accept | ADR-0015, PRD 10 |
| Voice backend for the beta | drive-audio initiative |
| Beta support path | MVP Phase 5 (owner: Harrison) |
| Live `capPreset` on `call_seat` | defaults-delivery D1 |
| Hosted signaling writer | ADR-0029 H5 |

### Proposed ADRs / DECs — accept when shipped (gates)

| Record | Gate to Accept |
|---|---|
| **0020** | Worktree ledger + `DriveDelivery` identity on tip |
| **0021** | Device-code path + three secret-hygiene fixes |
| **0022** | Room usage events + per-agent model/budget surface |
| **0024** | Browser host passes `runHostConformance` |
| **0017** | Keep deferred until Spotlight S9 |
| **0030** | AGENTS plane table + first rename proof (`visual/layout`) |
| **0031** | Layout module on tip with host-frame ResizeObserver |
| **0032** | H5 writer + honest entitlement failure |
| **0033** | Managed cards refuse bank archive from Kanban Done |
| **0034** | After delivery D1; unified seat role writes only |
| **0035** | Catch-up line on leave/return + snapshot gap path |
| **DEC-multi-device-parity** | MATRIX Tier 1 rows green on primary devices (or explicit lite) |
| **DEC-codebase-map-firewall** | Skill + AGENTS refuse path; no write side channel |
