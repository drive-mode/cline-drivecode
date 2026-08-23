# Decision changelog

**Purpose.** Chronology for ADRs and DECs — kept **out** of decision files so
passing an ADR into a context window loads only current truth.

**How to use.** After a rewrite-in-place, append one line under that record’s
heading (`- YYYY-MM-DD — …`, newest last). Do not put `## Changelog` inside ADRs.

**Companion.** Binding-clause inventory: [decision-coverage.md](decision-coverage.md).  
**Index.** Live status: [ADR-0000](ADR-0000-status-board.md).

---

## Timeline (corpus)

- 2026-07-25 — First Driveagent PRD/ARDs + leadership DEC bundle drafted (`docs/plans/…`).
- 2026-07-27 — Status Hub ADR + SDK status log land.
- 2026-07-28 — BYOK / topology / router / task-bank / Drive-as-mode ARD wave (#23).
- 2026-07-29 — Nest under `docs/drivecode/`; ChatFork + three-lane state; human `accept all` ADR-0000…0013 + DEC bundle; ADR-0014 Accepted on tip.
- 2026-07-30 — Nest role skeleton + CI gate (#61); task-session observability ADR drafted.
- 2026-08-01 — ARD→ADR rename (#103); ADR-0016 Route B accept (#101); ADR-0017 narration cues; ADR-0018 + ADR-0020 (#112).
- 2026-08-02 — ADR-0021 credentials (#127); ADR-0022/0023 (#133); ADR-0024 web runtime (#135); Tracks A–F close (#138); hub Drive owns call/history (#150).
- 2026-08-03 — ADR-0019 Kanban wire (#163); ADR-0025 (#fc9b1e135); ADR-0026 (#192); ADR-0025 E1 consumer (#195); ADR-0027 (#191).
- 2026-08-04 — ADR-0028 ADLC control plane (#200).
- 2026-08-05 — DEC-drive-mark-official (#210).
- 2026-08-06 — ADR-0029 hotpath (H1–H4 impl track on hotpath branch).
- 2026-08-07 — Path H + DEC-mobile-consumer-owner; freemium default.
- 2026-08-08 — ADR cleanup on main: reconcile 0023; Accept 0023/0027/0028/0029; path H fold; current-truth hygiene; chronology extracted to this file.
- 2026-08-08 — Comprehensive git-mined changelog + full binding-clause inventory ([decision-coverage.md](decision-coverage.md)).
- 2026-08-08 — Coverage-hole drafts: ADR-0030…0035 + DEC-multi-device-parity + DEC-codebase-map-firewall (Proposed).
- 2026-08-11 — ADR-0036 next-action triad + PRD 11 + research 29 (Proposed); closes the 21-operator-experience gap and answers research 16 open question 3.
- 2026-08-16 — ADR-0037 invocation-scoped sensing (Proposed); amends ADR-0036 decisions 1 and 12 to permit desktop context read only inside a hotkey-bracketed window.
- 2026-08-14 — ADR-0046 Accepted; ADR Planner Milestone 0 benchmark and governance artifacts opened.

---

## ADR-0000 · Decision status board

- 2026-07-29 — Board opened with accept-all for ADR-0000…0013 + DEC bundle; ADR-0014 indexed Accepted.
- 2026-07-30 — Nest migration; board paths updated under `docs/drivecode/`.
- 2026-08-01 — ARD→ADR rename (#103); ADR honesty / Impl column culture (#112); ADR-0016 Route B closed on board.
- 2026-08-02 — Indexed ADR-0021…0024; ADR-0015 Accepted on board via Tracks A–F.
- 2026-08-03 — Indexed ADR-0025…0027; authority twins Accepted.
- 2026-08-04 — Indexed ADR-0028 (Proposed).
- 2026-08-08 — Cleanup: Accept 0023/0027/0028/0029; path H + DEC-mobile; clusters; coverage gaps; Architecture D3 wording; H1–H5 id hygiene; current-truth singular; chronology extracted here.

## ADR-0001 · `.driveagent/` is the agent home

- 2026-07-25 — Drafted as ARD (Driveagent home vs facet registry).
- 2026-07-29 — Accepted (accept-all); nest path `docs/drivecode/…`.
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0002 · Canonical knowledge YAML → derived graph

- 2026-07-25 — Drafted (canonical YAML + compile).
- 2026-07-29 — Accepted (accept-all).
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0003 · Recruit ranks; RosterPack curated seating

- 2026-07-25 — Drafted (Recruit vs RosterPack).
- 2026-07-29 — Accepted (accept-all).
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0004 · Gated learn; no transcript dump

- 2026-07-25 — Drafted (propose→accept learn).
- 2026-07-29 — Accepted (accept-all).
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0005 · Status Hub SQLite status log

- 2026-07-27 — Landed with Status Hub SDK feature; Accepted — implemented.
- 2026-07-29 — Nest under drivecode.
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0006 · PiP Partner companion surface

- 2026-07-28 — Drafted with BYOK/hub wave (#23); Accepted (accept-all wave).
- 2026-07-30 — Nest skeleton paths.
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0007 · Drive is a Cline mode

- 2026-07-28 — Drafted (#23); Accepted.
- 2026-08-01 — Honesty pass / work-surface ownership clarifications (#112).
- 2026-08-02 — Drive owns call/history shell modes (#150).

## ADR-0008 · Task bank execution primitive

- 2026-07-28 — Drafted (#23); Accepted.
- 2026-07-29 — Bank ship wave (#42).
- 2026-08-01 — Workspace-backed bank wording reconciled toward ADR-0018 (#112).

## ADR-0009 · Runtime topology local / cloud / hybrid

- 2026-07-28 — Drafted (#23); Accepted.
- 2026-08-01 — Honesty / topology notes (#112).

## ADR-0010 · Provider harness (BYOK)

- 2026-07-28 — Drafted (#23); Accepted.
- 2026-07-30 — Nest migration.
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0011 · Demo share track

- 2026-07-28 — Drafted (#23); Accepted.
- 2026-08-01 — Impl honesty note (schemas vs live demo track) (#112).

## ADR-0012 · Agent router

- 2026-07-28 — Drafted (#23); Accepted; shipped `planRoute`.
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0013 · Three-lane state partition

- 2026-07-29 — Accepted with three-lane ship (#35).
- 2026-08-01 — Renamed ARD→ADR (#103).
- 2026-08-08 — Live-room hydrate via fold checkpoint (ADR-0029 H1) folded into Decision (no stacked amendment).

## ADR-0014 · Chat-fork lifecycle

- 2026-07-29 — Wired end-to-end; Accepted on tip same day as accept-all wave.
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0015 · Task-session observability

- 2026-07-30 — Drafted (task as satisfaction unit).
- 2026-07-31 — Implementation backlog slices added.
- 2026-08-01 — Honesty / Accept path (#112).
- 2026-08-02 — Accepted on board via Tracks A–F close (#138).

## ADR-0016 · Distribution & positioning

- 2026-08-01 — Proposed in demo/strategy wave (#94); Accepted Route B + self-hosted beta (#101).
- 2026-08-01 — Honesty pass (#112).
- 2026-08-07 — Path H + freemium owner defaults (DEC-mobile; portfolio/hotpath track).
- 2026-08-08 — Status rewritten as singular dual-path distribution on main.

## ADR-0017 · Narration-bound presentation cues

- 2026-08-01 — Proposed with canvas platform (#100); deferred behind Spotlight S9.

## ADR-0018 · Agent runtime contract

- 2026-08-01 — Accepted (unit hierarchy + research-18 locks) (#112).
- 2026-08-02 — Partial impl via Tracks A–F (#138).

## ADR-0019 · DrivePlan–Kanban Interop wire

- 2026-08-03 — Accepted with `execute` / `collectReceipt` + host port (#163).

## ADR-0020 · Session delivery CI/CD

- 2026-08-01 — Proposed (WorktreeLedger + DriveDelivery) (#112).

## ADR-0021 · Drive credential onboarding

- 2026-08-02 — Proposed (device-code first; Drive never holds keys; three hygiene fixes) (#127).

## ADR-0022 · Agent economics

- 2026-08-02 — Proposed (per-participant usage events; meter; scoped budgets) (#133).

## ADR-0023 · Agent spawn governance

- 2026-08-02 — Proposed (consult vs delegate; bound fork depth; hub enforcement) (#133).
- 2026-08-03 — Depth guard shipped in code (#146 / `c8d2e53`) — ADR body still described pre-fix tip until cleanup.
- 2026-08-08 — Finding 2 rewritten for tip; Accepted; Impl partial (consult/delegate seat path open).

## ADR-0024 · Drive web runtime

- 2026-08-02 — Proposed (transport port; conformant browser host) (#135).

## ADR-0025 · Enforced authority

- 2026-08-03 — Accepted (declared limit needs enforcement-path consumer) (fc9b1e135).
- 2026-08-03 — Plan-preset finding corrected (grant deliberate) (7109b17fb).
- 2026-08-03 — E1 L1 refusal consumer lands (#195).
- 2026-08-08 — Twin link to ADR-0026; context notes ADR-0023 Accepted.

## ADR-0026 · Evidence-backed Done

- 2026-08-03 — Accepted (claims registry + Done refusal checker) (#192).
- 2026-08-08 — Twin link to ADR-0025.

## ADR-0027 · Role tiers

- 2026-08-03 — Proposed (tier = ceiling or prompt; wait on live `capPreset`) (#191).
- 2026-08-08 — Accepted as binding guard; depth stays 1; three role vocabularies named.

## ADR-0028 · ADLC control plane

- 2026-08-04 — Proposed (Drive = ADLC control plane; no second workflow runtime) (#200).
- 2026-08-08 — Accepted (decision-level).

## ADR-0029 · Room hot-path redesign

- 2026-08-06 — Proposed on hotpath track; H1 fold checkpoint lands; H2–H4 follow same day (delta publish, in-process stage projector, layout sheets).
- 2026-08-07 — H5 unblocked by path H accept.
- 2026-08-08 — Accepted on main; slices renamed H1–H5; H1–H4 shipped, H5 open.

## DEC-agent-source-of-truth

- 2026-07-25 — Drafted (author in `.driveagent/`; compile into host).
- 2026-07-29 — Accepted (accept-all).

## DEC-package-location

- 2026-07-25 — Drafted (`@cline/drive` in monorepo phase 1).
- 2026-07-29 — Accepted (accept-all).

## DEC-open-product-forks

- 2026-07-25 — Drafted (focus / streams / share / accent / revise / catch-up / mic⊥TTS).
- 2026-07-29 — Accepted (accept-all).

## DEC-drive-mark-official

- 2026-08-05 — Accepted (official light/dark mark + motion axes) (#210).

## DEC-mobile-consumer-owner

- 2026-08-07 — Accepted (path H, muted mic, “Cline Drive”, MC3, freemium).
- 2026-08-08 — Folded onto main; ADR-0029 H5 refs; portfolio-now links dropped for main tip.

## ADR-0030 · Plane naming

- 2026-08-08 — Proposed (room/show/status; ban Engine ownership nouns; docs-first).

## ADR-0031 · Visual layout

- 2026-08-08 — Proposed (producers viewport-blind; client `visual/layout`).

## ADR-0032 · Path H ops

- 2026-08-08 — Proposed (hosted writer auth/tenancy/residency/freemium failure).

## ADR-0033 · Managed execution boundary

- 2026-08-08 — Proposed (DrivePlan owns truth; Kanban = workbench).

## ADR-0034 · Role vocabulary

- 2026-08-08 — Proposed (converge after live `capPreset`; blocked on D1).

## ADR-0035 · Late-join catch-up

- 2026-08-08 — Proposed (snapshot/delta + one factual catch-up line).

## ADR-0036 · Next-action triad

- 2026-08-16 — Decisions 1 and 12 amended by ADR-0037 (invocation-scoped desktop sensing). Decision 2 left standing; decisions 3–11 and 13–15 unchanged.

## ADR-0037 · Invocation-scoped sensing

- 2026-08-17 — Decision 7 re-pointed after ADR-0036 Open 6 was answered: the gate is `prepareToolExecution` in `@cline/agents`, the resolution is the canonical `resolveToolPolicy` in `@cline/shared` (private duplicate deleted by the next-action-triad initiative). Open 8 added to record constraint C2 as inherited and undecided here.

## ADR-0046 · ADR Planner plugin boundary

- 2026-08-14 — Accepted (`cline-drivecode` package plugin + bundled skill; pinned project-local install owned by `hh-template`).

## ADR-0047 · ADR Planner package contract

- 2026-08-14 — Proposed (`plugins/adr-planner`, proposed `@cline/adr-planner`, explicit namespaced commands and pure tools; owner/namespace acceptance pending).
- 2026-08-14 — Implementation evidence only: private package scaffold, pure
  schema/policy kernel, sandbox discovery, bundled skill, package-content
  review, and atomic install/upgrade fixture verified. ADR remains Proposed;
  no publication or `hh-template` mutation occurred.

## ADR-0048 · ADR Planner evidence trust boundary

- 2026-08-14 — Proposed (explicit Git-visible allowlisted metadata collection;
  host workspace root only; secret/symlink/size containment; controlled signals;
  unknown-preserving profiler; no arbitrary paths, raw source output, writes,
  telemetry evidence payloads, or network).
- 2026-08-14 — Implementation evidence only: private M2 collector and profiler,
  adversarial privacy/limit fixtures, real-repository exercise, and copied
  installed-package sandbox smoke verified. ADR remains Proposed.

## ADR-0049 · ADR Planner concern catalog and rule authority

- 2026-08-14 — Proposed (versioned source-backed concern catalog; constrained
  three-valued rules; open-world facts; deterministic routing, ADR filtering,
  prerequisite validation, urgency propagation, and stable ordering; no
  model-supplied policy authority).
- 2026-08-14 — Implementation evidence only: private M3 12-concern nucleus,
  adversarial rule/graph/authority tests, real-repository exercise, and fresh
  installed-package privacy smoke verified. ADR remains Proposed.

## ADR-0050 · ADR Planner host-attested workflow authority

- 2026-08-14 — Proposed (controlled Boolean facts enter only through explicit
  `/adr-attest`; workflow and gate selection use explicit commands; session
  state is bounded, in-memory, and isolated; the model-facing compiler accepts
  only an empty object and cannot accept facts, policy, decisions, waivers,
  risk, or deployment authority).
- 2026-08-14 — Implementation evidence only: private M4 schemas, session store,
  host-composed concern plan, deterministic question/experiment/output/
  obligation compiler, canonical JSON/Markdown, adversarial tests, and fresh
  installed-package privacy smoke verified. ADR remains Proposed.
- 2026-08-14 — Independent lifecycle review invalidated the host-attestation
  claim: command and tool hosts load separate plugin instances, setup scope is
  not task scope, command input has no actor provenance, and bundled source
  cannot mint trusted authority. M4 registration was removed, internal output
  relabeled `untrusted-command-session`, and the model-facing readiness tool
  was forced to block caller-authored passes. ADR-0050 remains Proposed and is
  now blocked on a host-owned provenance/task-state capability.
- 2026-08-14 — Superseding private implementation evidence: the host now
  supplies task-scoped command provenance, persists bounded extension state
  with revision checks and invocation replay protection, derives the plugin
  namespace from a content-bound installation identity, and overwrites tool
  context with a fresh host snapshot across separate command/tool sandbox
  loads. The restored three-command/six-tool package and a fresh installed
  fixture compile a `host-composed` workflow only after an exact
  host-attributed `/adr-attest` mutation. This is a private proof, not a
  production trust claim: explicit mutation confirmation or a host-owned
  declarative grammar, authenticated connector actors, stronger receipts and
  isolation, lifecycle/retention policy, and least-privilege controls remain
  open. ADR-0050 remains Proposed.

## ADR-0051 · Cross-session chat catalog authority

- 2026-08-14 — Proposed: model chat as a durable organizational entity above
  execution sessions; keep active/archive orthogonal to runtime status and
  surface binding; assign lifecycle, lineage, binding, lease, event, and purge
  authority to one core local/hub-conformant catalog. Plain reset preserves and
  unbinds by default; plugin/model surfaces cannot directly mutate lifecycle.
- 2026-08-16 — Advanced behind-gate implementation checkpoint: catalog and
  managed lifecycle authority, production profiles, durable resident reclaim,
  durable manual-compaction receipts/atomic exact-sidecar replay, byte-bounded
  close-on-loss runtime delivery, and the first closed-world
  `tool_executor.askQuestion` broker now exist. The callback is granted only by
  interactive profile revision 2 / policy epoch 2 and is fenced by exact
  connection, session, run, capability, one-shot consumption, and authoritative
  expiry. Managed start profiles now reject prompts, making
  `chat_lifecycle.run_turn` the only managed turn-start authority after resident
  registration. Core typecheck and **4 focused files/59 tests**, including the
  production profile-to-strict-wires round trip, pass; Shared typecheck and **1
  file/10 wire tests** also pass. ADR remains Proposed and the release gate
  remains hard off; additive-delta recovery, remaining callback races,
  production compaction authorization, confirmation UX, and all-caller cutover
  remain.
- 2026-08-16 — Physical callback/cancellation checkpoint: the production
  interactive profile now traverses a fresh one-time workspace capability,
  actual loopback WebSocket, managed start/turn, callback event/response, and
  terminal turn; a second turn proves stop-time cancellation and late-response
  rejection. Stop cancels before Core stop, disconnected-owner reclaim cancels
  before retry, resident writer-authority loss cancels while the Core run is
  unsettled, and disposal cannot revive a request. The physical test exposed
  and closed subscription-command overtaking with a per-socket control barrier
  that preserves command concurrency and late-close cleanup. Shared typecheck +
  **2 files/19 tests** and Core typecheck + **12 files/147 tests** pass. ADR
  remains Proposed and the release gate remains hard off for stream recovery,
  compaction authorization, confirmation UX, and caller cutover.
- 2026-08-16 — Range-aware delivery checkpoint: `sessionSequence` is now the
  inclusive end of a canonical singleton or bounded assistant-delta range.
  Under soft pressure, only the globally newest adjacent queued event for the
  same subscription/session/run merges in place; endpoint metadata and every
  semantic boundary remain intact. A review-discovered stale-resubscribe flaw
  was closed with an opaque per-physical-subscription fence echoed on event
  frames and enforced by Node, including reconnect regeneration. Focused and
  physical WebSocket proof passes. Shared typecheck plus **1 file/10 tests**,
  Core typecheck/smoke plus **15 files/192 tests**, targeted Biome and Drivecode
  document checks, and **2/2** Mermaid parse validation pass. ADR remains
  Proposed and the release gate remains hard off for cursor-anchored recovery,
  compaction authorization, confirmation UX, and caller cutover.
- 2026-08-17 — Cursor-anchored bounded recovery checkpoint: every validated
  singleton is deep-frozen and journaled before fanout under per-session,
  per-runtime, byte/count, and resident-metadata bounds. Fresh subscriptions
  receive an atomic baseline including sequence zero; one same-connection gap
  may replay one exact retained suffix before a matching ready cutoff. Replay
  admission failure, stale/evicted/mismatched cursors, acknowledgement timeout,
  cancellation, epoch change, and a second gap fail terminally. A physical
  workspace WebSocket proves exact `[1, 2, 3]` delivery after withholding event
  2 from the first fence. Automatic cursor resubscribe after disconnect is
  forbidden until client registration and durable resident reclaim; Node
  reports `session_reclaim_required`. Shared typecheck/build plus **1 file/10
  tests**, Core typecheck/smoke/build plus **15 files/197 tests**, scoped Biome,
  Drivecode checks, and **3/3** Mermaid validation pass. ADR remains Proposed
  and the production release gate remains hard off for reconnect orchestration,
  compaction authorization, confirmation UX, and caller cutover.
- 2026-08-17 — Cursor-recovery hardening checkpoint: strict runtime
  subscriptions now require one session while global managed streams remain
  lifecycle-only. A delayed ready frame is valid only when its same-stream
  cutoff lies between the requested and already delivered cursors. Runtime
  journal metadata capacity is reference-counted and reserved before durable
  lifecycle admission. The central WebSocket resource policy defaults to 256
  active or in-flight source subscriptions per connection, enforced before
  source creation by both the socket adapter and Hub transport. The socket
  adapter now coalesces bounded desired state instead of queueing controls,
  binds physical sources to exact admission generations, restarts cleanup after
  in-flight ingress changes, and drops stale-source output before a reused
  fence. Nine reproduced P1s were closed across successive adversarial passes;
  the final independent re-review returned **Ship**. Shared **54 files/503
  tests**, Core typecheck/smoke/build plus **10 files/218 tests**, focused
  Browser **23/23**, scoped Biome/document checks, and **3/3** Mermaid
  validation pass. One unrelated timing-sensitive plugin crash fixture remains
  flaky in the default complete-Core run. The production gate remains hard
  off.
- 2026-08-17 — Caller-adoption planning checkpoint: select a separate
  Core-owned managed Hub facade instead of a mode on the legacy
  schedule-capable `HubSessionClient`; compose strict lifecycle/runtime clients
  and one reviewed controller per resident session. The ordered caller audit
  makes unknown-outcome lifecycle admission, trusted connector-audience
  delivery, and server-enforced isolation of managed rows from unscoped legacy
  reads/subscriptions explicit pre-cutover obligations. No caller or release
  gate changes in this checkpoint.
- 2026-08-17 — Caller-architecture hardening checkpoint: direct code audit and
  supplementary review separated implemented profile continuity from missing
  target authority. The plan now requires immutable chat/event audience scope,
  denial of raw `chat_catalog.*` on production caller sockets, and server-side
  target checks for reads, events, lifecycle, bindings, continuity, recovery,
  and runtime. Pre-audience rows may backfill only from exact immutable profile
  stamps; ambiguous rows are quarantined and unscoped history stays audit-only.
  It also adds a bounded snapshot-sequence projection with exact
  lifecycle replay/readiness, a three-state fresh-process reattach flow, and an
  explicit Drive room/fork/tick/wave coordinator that preserves ADR-0014
  hard-boundary seed/promote/audit semantics, or fail-closed managed-target
  rejection. These are release blockers; the production gate remains hard off.
- 2026-08-17 — Planning-consistency closure: a final independent review found
  two P1 and five P2 contradictions. AUTH-022 and ADR-0051 now make one gate
  atomically select callers, route projection/lifecycle/runtime commands and
  events, and advertise every managed capability. Proposed ADR-0055 separates
  fresh caller-process loss from ADR-0052 daemon-process loss. The M0 kernel
  checkpoint no longer claims milestone completion; PC-3 target authority is
  explicitly open; PC/CA numbering is distinct; multi-workspace selection is
  deferred rather than release-blocking; and Drive convergence preserves
  accepted ADR-0014 hard-boundary SeedPacket/PromotePacket/audit semantics.
- 2026-08-17 — CA-3 confirmation-authority checkpoint: the managed factory no
  longer owns a static confirmation callback. Strict Hub dispatch installs one
  responder for the exact confirmation-capable command and operation, rejects
  caller approval fields and mismatched Core targets, retains all authority
  correlation server-side, and exposes only a frozen action/aggregate/revision/
  effects target plus abort signal to the owner seam. Managed and direct prompts
  share bounds and termination; the command token reaches the final mutation
  fence; stale revision rejects before stop side effects; exact replay performs
  no second side effect. Physical approve/decline/disconnect/shutdown, epoch
  revoke, timeout/throw, retained-callback, mixed-budget, and injection proof
  pass in **5 files / 104 tests**, including physical archived-resume target
  resolution through the authoritative session projection. Production
  composition defaults to decline,
  no owner surface is selected, and the single release gate remains hard off.
  The final independent P0/P1 correctness and security re-review returned
  **PASS**.

## ADR-0052 · Durable managed-session reconnect authority

- 2026-08-15 — Proposed: reject process-local connection takeover and
  stop-then-resume as REL-034 implementations. Reconnect must rekey the existing
  durable lease behind an exclusive guard transition and nonterminal host write
  barrier, increment `writerGeneration`, install the new private credential,
  and then transfer one shared runtime/lifecycle owner. The strict reclaim
  command remains unadvertised until the mutation and race proofs land together.
- 2026-08-15 — Accepted: SQLite token rotation/writer-head CAS, exclusive guard
  reservation, nonterminal host drain/install/reopen, shared runtime/lifecycle
  owner transition, orphan successor reclaim, identical-intent replay, and the
  strict token-free `chat_runtime.session.reclaim` wire now pass focused and
  full regression. The daemon managed-chat release gate remains hard off.
- 2026-08-17 — Replacement-socket controller checkpoint: the sanitized result
  now distinguishes committed authority from ownership with
  `ownerTransferred`. A new physical connection may reconcile an orphaned exact
  receipt but must use a new operation and another durable rekey before a
  generation-guarded cursor subscription. Component cancellation/late-result
  proof and a real three-socket WebSocket pass registration, lost reply, second
  disconnect, same-intent reconciliation, second rekey, replay, and readiness.
  Production callers remain behind the hard-off release gate.
- 2026-08-17 — Replacement-socket adversarial hardening: physical loss now
  reports reclaim before autonomous retry; reclaim command send and cursor
  subscription both require the captured registered generation; retired sockets
  cannot route queued frames; and exact-operation `.cancel` propagates into
  pre-durable guard/host waits or orphan-fences an already committed successor.
  A narrow re-review then found bounded response-receipt eviction could erase
  post-commit cancellation lookup; the current owner now retains the exact
  reclaim intent independently, with a forced-eviction regression.
  Shared **54 files/503 tests**, Core **9 files/236 tests**, both package
  typechecks/builds, scoped Biome, Drivecode checks, and Mermaid validation pass.
  Final independent re-review found no actionable P1/P2; its three narrower
  proof observations now pass controller **5/5**, real-adapter WebSocket
  **14/14**, and host **84/84** follow-ups.
  The production release gate remains hard off pending caller adoption.

## ADR-0053 · Trusted managed manual compaction authority

- 2026-08-15 — Proposed: managed clients may request compaction but never
  provide transcripts, provider configuration, compactors, callbacks, writer
  credentials, summaries, or sidecars. One resident host-owned operation must
  exclude turns, participate in stop/rekey drains, use the current writer fence,
  preserve canonical messages, and project only sanitized terminal outcomes.
- 2026-08-15 — Partial behind-gate checkpoint: strict dispatch, host-owned
  provider/config selection, per-session exclusivity, disconnect cancellation,
  direct sidecar persistence without `agent.restore`, in-process replay and
  changed-intent conflict, fixed safe failure projection, and explicit skipped
  events plus a synchronous terminal result are implemented. ADR remains
  Proposed pending durable running/terminal receipts, atomic head-plus-receipt
  commit, production profile authorization, and the complete
  stop/rekey/renew/process-loss proof matrix.
- 2026-08-15 — Policy checkpoint: the persisted execution-policy digest now
  binds explicit manual-compaction permission, strategy, preserve budget,
  summarizer identity, and `clientCallbackAllowed: false`. The host requires
  explicit permission; production daemon profiles remain ungranted while the
  durable commit blockers are open.
- 2026-08-16 — Durable replay checkpoint: SQLite now owns
  running/completed/skipped/failed/indeterminate receipts, changed-intent
  conflict, process-loss recovery, and cross-process single-running exclusion.
  Completed sidecar-head selection and the receipt commit atomically under the
  writer fence; exact receipt-sidecar replay verifies a cryptographic digest
  even after the current head advances. Independent review reports no remaining
  P0/P1/P2 for this slice. ADR remains Proposed pending production profile
  authorization and the complete stop/rekey/renew/process-loss matrix.

## ADR-0055 · Fresh-process managed-session reattach

- 2026-08-17 — Proposed: distinguish caller-process loss while the managed
  daemon/resident host survives from managed authority/daemon process loss.
  The former may use one target-authorized, read-only three-state continuity
  lookup and then the unchanged ADR-0052 durable rekey; the latter continues to
  require ordinary expiry/resume or confirmed lost-lease recovery. The result
  exposes generation/baseline only for an orphan and no owner, connection, or
  credential detail. Acceptance requires bounded hydration/replay and the full
  physical fresh-process fault matrix; CA-2 cannot expose the command first.
- 2026-08-17 — Gate-off implementation checkpoint: strict
  `chat_runtime.session.continuity` and `.hydrate` schemas, audience-scoped
  target lookup, exact-generation reclaim reuse, bounded hydration, an
  authoritative initial runtime cursor, and facade ready-before-handle behavior
  now land together. Admission lost-reply replay covers all five admission
  commands, including anti-steal after ready. A second physical WebSocket/fresh
  facade proves an event committed during rekey is replayed before readiness;
  stale generation, live owner, replay eviction, cancellation, and daemon
  epoch restart fail closed. The production gate remains hard off, and ADR-0055
  remains Proposed pending explicit owner acceptance.
- 2026-08-17 — CA-2 closure checkpoint: fresh reattach now enters the shared
  controller before its first reclaim, so an unknown initial reply retries the
  exact operation/generation and retains exact cancellation through bounded
  hydration and subscription readiness. Connector policy templates cannot be
  issued directly: the trusted in-process issuer binds one installation to a
  stable opaque audience and the profile resolver rejects a mismatched
  instance. Physical tests drop a committed reclaim reply on a live WebSocket
  and stop/start the Hub to prove one durable rekey, nonresident ordinary
  resume, a new stream epoch, and rejection of the old cursor. The production
  gate is still `false`; owner acceptance and caller/launcher cutover remain
  open.

## DEC-multi-device-parity

- 2026-08-08 — Proposed (shared semantics across hub/pwa/ios/tui; Tier 1 bar).

## DEC-codebase-map-firewall

- 2026-08-08 — Proposed (codebase-map explain-only; no portfolio/Status writes).
