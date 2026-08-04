# 12 · Drive performance architecture

Back to [README](../../../design/wireframes/README.md). Related: [share-and-router/PLAN.md](../initiatives/share-and-router/PLAN.md).

## Goal

Measure Drive compute/memory cost, then optimize via architecture (cache, batch, async, parallel, bounds) — not micro-guesses.

## Baseline probes

Measured 2026-08-04 on the tip (`c4bd276`), bun 1.3.11 / node v24.3.0, after
`bun run build:sdk`. Method and caveats in
[Probe method](#probe-method) below. "After" stays empty until an optimization
actually lands against a baseline — that is the point of the column.

| Probe | Method | Baseline | After |
|---|---|---|---|
| Hub heap after join | `process.memoryUsage().heapUsed` | **~102 MB** resident after server start; **+0.6 MB** first join, **~12 KB** amortized per additional room (100 rooms) | — |
| Mermaid produce cold | `produceMermaidShowArtifact` ms | **0.0076 ms** median (p95 0.052) | — |
| Mermaid produce warm | cache hit ms | **0.0062 ms** median (p95 0.030) | — |
| Director rank 100 shows | `rankShowBacklog` ms | **0.0235 ms** median (p95 0.059) | — |
| Webview messages[] growth | count after N turns | **not measured** — needs live agent turns, which need a funded LLM credential; none available in this environment | — |

### What the numbers say

**The SVG cache currently buys 1.2×, not an order of magnitude.** Cold 0.0076 ms
versus warm 0.0062 ms is close to noise. This is not a bug in the cache; it is a
consequence of what the cache elides. `produceMermaidShowArtifact` hashes the
source, then base64-encodes the SVG into a data URI and rebuilds the
`ShowBacklogItem` **unconditionally** — the cache short-circuits only
`buildStubSvg`, and that is a *stub* wrapper, not a mermaid render
(`produceMermaid.ts:34` "deterministic SVG wrapper (no mermaid runtime required
in core)"). The comment at `showTemplates.ts:59` anticipates a real renderer
landing later.

So the cache is correctly placed for a cost that does not exist yet. When a real
renderer lands the ratio should move sharply; until then, listing the SVG cache
under "Implemented so far" overstates what it currently does. Worth re-running
this probe as the first check after any renderer work.

**Nothing in the measured set is a bottleneck.** Ranking 100 shows costs ~24
microseconds. At these magnitudes the ordered optimization list below is not yet
justified by measurement — which is what this document said would decide it.

### Probe method

Probes 2–4 are pure functions and were driven directly, 200 iterations after 20
warmup iterations, reporting median / p95 / min. Cold-versus-warm is separated
by giving each iteration a unique `mermaidSource` (the cache is keyed by sha256
of the source) and then repeating that exact source; the harness asserts
`cacheHit === false` then `true`, so a silent cache change would fail the run
rather than quietly flatten the result.

Probe 1 boots a real hub via `ensureHubWebSocketServer` in-process, connects a
real client with `connectToHub` over the wire, and issues real `call_join`
commands, reading `heapUsed` from the hosting process after a forced GC. The
per-room figure is marginal cost and is dominated by a fixed first-join
allocation, hence the spread between 1 room (~592 KB) and 100 rooms (~12 KB).
Resident heap after start was stable at ~102 MB across runs.

Probe 5 is honestly unmeasured rather than estimated. It requires real agent
turns; `AGENTS.md` notes that an unfunded key authenticates but fails the turn,
and this environment has no provider credential set at all. Filling it in from a
guess would make it exactly the kind of number
[24-scale-and-context](24-scale-and-context.md) warns about — one that governs
nothing because nobody verified it.

## Implemented so far

- Mermaid producer content-hash **SVG cache** (`produceMermaid.ts`)
- Voice stack **memoized by topology fingerprint** (`createVoiceStack`)
- Director **spotlight hysteresis** via sticky show ids (hold policy)

### Adaptive guardrails milestone (complete)

The first long-horizon guardrail milestone landed on `main` in
[PR #32](https://github.com/hhalperin/cline-drivecode/pull/32). Operational
defaults and overload behavior are documented in
[`sdk/packages/core/RESOURCE_GUARDRAILS.md`](../../../../../sdk/packages/core/RESOURCE_GUARDRAILS.md).

Implemented:

- A versioned, validated resource-policy contract in `@cline/shared`.
- Hardware-derived core policy resolution with finite hard limits, environment
  and SDK overrides, and source attribution for resolved values.
- Lifecycle-owned, observe-only process memory and event-loop diagnostics on
  `ClineCore.diagnostics`.
- Count, aggregate-byte, and single-item admission limits for pending prompts.
- Count and message-byte admission limits for queued team runs.
- One physical execution lane per teammate while independent teammates retain
  team-wide parallelism.
- Physical team-run cancellation that holds scheduler capacity until the
  underlying execution settles and rejects late terminal-state overwrites.
- Lightweight agent streaming snapshots that do not clone full transcripts.
- Bounded WebSocket delivery, coalescing, slow-consumer handling, and inbound
  payload limits.
- Wiring all queue and transport limits to the resolved resource policy.
- Long-transcript, slow-client, and session-churn soak fixtures.

Deterministic coverage exercises 20,000 retained transcript messages across
2,000 deltas, 25,000 replaceable snapshots behind a slow client, and 200 socket
lifecycles with 20 session subscriptions each. These are retained-state and
payload-boundary tests, not machine-dependent wall-clock benchmarks.

The monitor is deliberately observe-only at this stage. Dynamic concurrency
changes require measured baselines and hysteresis; deploying an uncalibrated
feedback loop could make throughput less predictable rather than safer.

### Policy precedence

Resource values resolve in this order:

1. Explicit SDK override.
2. Validated environment override.
3. Hardware-derived or built-in default.
4. Finite hard clamp applied to the selected value.

Power users can raise normal defaults, but no queue, concurrency value, or
memory budget may resolve to infinity. Durable conversation data is not deleted
in response to memory pressure; this milestone limits admission and hot runtime
work instead.

## Next optimizations (ordered)

First fill the five baseline probes above. Then, only where measurements justify
the change:

1. Coalesce `drive.room.changed` broadcasts (16–50ms).
2. Add a blob/object URL LRU and revoke URLs on sticky replacement.
3. Window or virtualize the Chat transcript if message growth dominates.
4. Move heavy SVG work to an optional worker if Hub CPU blocks sessions.

## Principles

- Foundational: measure before C2+ changes
- Minimize reader load: keep producers in one module
- Outcome-oriented: delete dual webview/hub truth when ops land
