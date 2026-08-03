# 24 · What degrades at scale — the open control loop

**Date:** 2026-08-03 · **Status:** analysis, no decision
**Scope:** context-window engineering and throughput, measured against the tip.
**Companions:** [23-agent-first-design](23-agent-first-design.md) (the doctrine
this measures against), [ADR-0025](../adr/ADR-0025-enforced-authority.md),
[ADR-0022](../adr/ADR-0022-agent-economics.md) (context and spend as a product
surface), [ADR-0013](../adr/ADR-0013-state-partition.md) (three lanes),
[12-performance](12-performance.md) (baseline probes, still `TBD`).

## Why this document exists

[research/23](23-agent-first-design.md) audited authority and found declared
limits that nothing enforces. This document asks the same question of resources —
context, tokens, throughput, durability — and finds a variant of the same shape.

It is a measurement pass, deliberately. [12-performance](12-performance.md)
states the principle already ("measure before C2+ changes") and its five baseline
probes are all still `TBD`. Nothing here decides anything. Where a claim needs a
number nobody has, this document says so rather than guessing.

## Thesis

**The mechanics are strong and the control loop is open. Every quantity that
governs behaviour is either estimated and never verified, or measured and never
used.**

Token counts are estimated by a heuristic and never compared against the real
counts the provider returns on every response. Cache read and write tokens are
parsed, summed, and displayed, and nothing acts on them. Compaction fires on the
estimate. Retention caps are enforced without anyone checking what the trimming
costs or breaks. Quality at long horizon is a property of good static heuristics
rather than of any feedback signal.

That is the same defect class [ADR-0025](../adr/ADR-0025-enforced-authority.md)
names for authority, pointed at resources: **a number that governs nothing is the
resource-side twin of a permission that enforces nothing.**

## What is genuinely good

Worth stating plainly, because the rest of this document is critical.

**Tool-pair atomicity is correct and non-obvious.** Compaction never lands a cut
between a `tool_use` and its `tool_result`; closures are computed by BFS over
shared ids so pairs move atomically. The comment in `compaction-shared.ts` states
exactly why — an orphaned `tool_result` is rejected by the provider — and there
is a named regression test for it. This is the most common way naive compaction
produces 400s, and this code will not produce them.

**Budget arithmetic uses the right unit.** The trigger measures the *full
request* — system prompt, tool schemas, and messages — and converts a request
budget into a message budget by subtracting overhead. It also measures
post-truncation messages rather than the raw transcript, so it will not compact
away context the truncation layer already handled. Both have regression tests.

**Compaction is a projection, not a rewrite.** The canonical transcript stays
append-only and compaction persists to a sidecar, which keeps checkpoints and
rollback possible. Survivors are frozen so repeated passes are idempotent, with
a comment naming the duplicate-summary bug that would otherwise recur.

**Stale-file rewriting is sophisticated and cache-aware.** A re-read replaces the
earlier result with `[outdated - see the latest file content]`, so thirty reads
of one file cost one copy rather than thirty. Rewrites are batched at 64 KB
specifically to amortise prefix-cache breaks, are sticky once committed, and are
un-committed if a rollback makes a locator current again.

**Skills use progressive disclosure.** Only skill *names* reach the tool
description; the body loads when the tool runs. This is the correct pattern, and
it is the counter-example that makes the rules problem below stand out.

**Admission control exists where someone thought about it.** Team runs have a
real scheduler: a concurrency cap, a queue bound, per-teammate lanes, priority
selection, and retry backoff. WebSocket delivery has soft and hard watermarks
with coalescing. These are well built.

**The comments document their own gaps.** `compaction.ts` names a telemetry hole
in its own wrapper. The compaction-state hash carries a comment explaining a bug
that hashing `id`/`ts` previously caused. This is unusually honest code.

## Part 1 — the context window

### Fixed overhead is unbounded, unmeasured, and large

Rules are concatenated in full into `{{CLINE_RULES}}`. No truncation, no cap, no
relevance filter, no size warning.

Measured on this repository at the tip:

| Source | Bytes | Estimated tokens |
|---|---|---|
| `AGENTS.md` | 11,986 | ~3,995 |
| `.clinerules/*.md` (8 files, top level) | 60,138 | ~20,046 |
| `.clinerules/cline-overview.md` alone | 27,191 | ~9,064 |
| **Rules total** | **72,124** | **~24,041** |
| System prompt + tool schemas (agent mode) | ~29,300 | ~9,700 |
| **Fixed overhead before one conversation byte** | | **~34,000** |

Against a 200k window that is roughly 17% gone permanently, and against the 0.9
compaction trigger it is about 19% of the usable budget. A user with a large
`AGENTS.md` loses a fifth of their context window and is never told.

Nothing measures this, warns about it, or caps it. Skills got progressive
disclosure; rules are the one always-resident unbounded channel.

### The estimator is a heuristic that is never checked

`sdk/packages/shared/src/llms/tokens.ts`:

```ts
export const CHARS_PER_TOKEN = 3;
export function estimateTokens(chars: number): number {
	return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));
}
```

The comment is honest about the intent — 3 rather than the conventional 4 "so
trigger thresholds fire before provider rejection rather than after." Three
properties follow, and only the first is documented:

1. **Deliberately conservative.** Fine.
2. **Not per-model.** The same constant drives Claude, GPT, Gemini, and Qwen.
   There is no tokenizer anywhere in the repo.
3. **Counting JSON syntax as content.** Request size is estimated from
   `JSON.stringify({systemPrompt, messages, tools}).length`, so escaping, key
   names, and structural punctuation are counted as prompt.

For code-heavy tool results with heavy escaping, the combined effect plausibly
overestimates real input tokens by a wide margin. **The size of that error is
unknown, and it is unknown while the correct answer is already in hand** — the
provider returns real `inputTokens` and `cacheReadTokens` on every response, the
runtime parses them, and the CLI status bar renders them. Nothing compares the
estimate to the actual, emits the ratio, or applies a per-model correction.

This is the cheapest high-value fix in the area: one subtraction per turn, logged.

Compaction constants, for reference (`compaction-shared.ts`):

| Constant | Value |
|---|---|
| `DEFAULT_MAX_INPUT_TOKENS` | 128,000 |
| `CONTEXT_WINDOW_INPUT_RATIO` | 0.9 |
| `COMPACTION_TRIGGER_RATIO` | 0.9 |
| `DEFAULT_TARGET_RATIO` | 0.7 |

So the effective trigger is 90% of reported `maxInputTokens`, or 81% of the
context window when only a window is known — measured in estimated tokens.

### What compaction discards

Both strategies are careful about *structure* and lossy about *content*.

**Agentic** folds everything before the cut into a summary capped at 1,024 output
tokens. Before the summarizer sees the folded span it is budget-projected
(thinking dropped, images dropped outside the live tail) and then flattened to
text with tool results truncated at 2,000 chars. So the summary compresses a
lossy rendering of an already-lossy projection — three stages, not one.

Re-compaction folds only what is new and passes the prior summary forward, so
summaries are summaries of summaries. Each generation is capped at 1,024 tokens.
Over a long session that is a lossy filter with no floor and no fidelity metric.
Automatic compaction never rebuilds from canonical history — only manual
`/compact` does, and the code says so explicitly. **A bad first summary is
permanent, silent, and invisible.**

**Basic** is the better-engineered of the two. Every typed user prompt survives.
Dropped work is re-surfaced as a `<SYSTEM_NOTICE>` listing files read and edited
with line ranges, commands truncated to 100 chars, and the three most recent
assistant responses verbatim.

Its degradation profile is the sharper one: what survives an old turn is **a path
list plus line ranges, not content**. The agent knows it edited `foo.ts:120-140`
and not what it wrote there. Nothing in the prompt tells it to re-read before
relying on that memory. This is precisely where verification breaks at long
horizon — an agent asked "did your earlier change do X?" will answer from a file
list.

Attachments survive only on the latest typed prompt, with a comment arguing they
are "stale context bloat once the turn is old enough to compact." Reasonable, and
in the basic path a dropped image leaves no placeholder — the model has no marker
that an image was ever there.

### The prefix cache has one breakpoint, so everything is collateral

`ai-sdk.ts` walks the message list backwards, finds the last `user` message,
marks its last text part `ephemeral`, and breaks. **Exactly one breakpoint.**
System prompt and tool schemas carry none.

For an append-only agent loop, one breakpoint at the end is the right basic
strategy: the cached prefix is everything, each turn writes a new full prefix and
reads the prior one. The failure mode is that *any* mid-transcript edit discards
the cached tools and system prompt too, even though those bytes never changed.
A rewrite at message 12 of a 400-message transcript throws away nearly the whole
cache.

The code already treats this as a first-class constraint — the 6 MB aggregate
byte budget exists specifically because "budget truncation rewrites bytes
mid-transcript, which invalidates provider prefix caches from the first rewritten
block onward, so it must remain a rare overflow valve rather than the steady
state," and stale-read rewrites are batched at 64 KB for the same reason. That
reasoning is correct and written down.

What is missing is everything downstream of it. The 64 KB threshold is an
unvalidated guess ("roughly 8 provider-capped read results") with no feedback
confirming it suits a 300-message session as well as a 20-message one. There is
no cache hit-rate metric and no signal when a long session's cache-read ratio
collapses. Anthropic offers four breakpoints and this uses one; a second, stable
breakpoint after system and tools would make the ~10-15k-token static prefix
immune to every invalidation above.

Four further invalidation sources, none of them measured: the `skills` tool
description is a live getter interpolating current skill names, so adding a skill
mid-session changes a tool schema; rules re-resolve on every run, so editing
`AGENTS.md` mid-session changes the system prompt; `{{CURRENT_DATE}}` means a
session spanning local midnight rebuilds a different prompt; and no `ttl` is ever
set, so everything uses the 5-minute default and human think-time expires it
routinely.

### Two truncation systems, one contract

`buildBudgetProjection` defines three policy intents. One of them,
`normal_provider_request`, is **never constructed anywhere** — three references
exist repo-wide and all three are type declarations or the switch case itself.

The job it describes is done instead by `MessageBuilder`'s byte budget, which
uses a different algorithm with different protections. Two independent truncation
systems with non-overlapping invariants and no shared contract is a real seam,
and the dead policy intent is the evidence that someone intended one system.

## Part 2 — throughput and durability

### Team state is persisted on every event, including every token delta

`runtime-builder.ts` wires `onTeamEvent` to call `teamStore.handleTeamEvent` and
then `teamStore.persistRuntime(key, teamRuntime.exportState(), …)`. **There is no
event-type filter** — the only type checks are bookkeeping for
`teammate_spawned` / `teammate_shutdown`, after which persistence runs
unconditionally.

`exportState()` copies every task, mailbox message, mission-log entry, outcome,
outcome fragment, and run. `TeamRunRecord.result` holds the run's `AgentResult`
(assigned at `multi-agent.ts:1325`), which carries its messages. Completed runs
are never evicted from `this.runs`.

Every teammate re-emits its agent events as team events, and the runtime emits a
`content_start` for every text delta. So each streaming token from any teammate
triggers a `JSON.stringify` over accumulated run results plus a SQLite
transaction proportional to tasks + runs + outcomes + fragments.

**Cost grows with session length and multiplies by agent count.** This is the
most expensive thing in the repo per unit of work, and the cheapest to fix:
filter agent events out of the persist path, debounce, and stop putting a full
`AgentResult` in a record that gets serialized on every event.

### Retention rewrites the whole log on every append past the cap

`DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS` is 2,048 and
`DEFAULT_BANK_EVENT_LOG_MAX_RECORDS` is 4,096. `appendSync` trims when
`count > maxRecords`, and `trimJsonlFileToMaxRecords` returns a file at exactly
`maxRecords`.

So the append after a trim makes it `maxRecords + 1` and trims again. **Past the
cap, every single append performs a full file read, split, slice, temp write, and
rename** — roughly six syscalls plus O(file) I/O per event, forever. Trimming to
80% of the cap instead would amortise this across ~400 appends.

This is reached by one long session, not by many agents.

### Retention silently breaks the room fold — a correctness bug, not a perf one

This is the finding worth acting on first.

`hydrateFromLog` rebuilds a `RoomSnapshot` by replaying `readSince(roomId, 0)`
through `reduceRoom`. There is **no snapshot or checkpoint of the fold anywhere
in the codebase**. The only thing bounding rebuild cost is the trim.

But the trim removes the *oldest* records while `meta.nextSeq` keeps advancing.
Once a room passes 2,048 events, the `control.join` events that seated the
current participants are gone and their `control.leave` events do not exist. A
cold rebuild therefore produces a snapshot missing people who are still in the
room, with nothing to recover from.

Compounding it: `appliedEventIds` is a `Set` that is added to in three places and
**never deleted from, never cleared, and never capped**. It outlives the data it
guards, so a replay in the same process skips events whose ids it still holds —
producing an incomplete fold even before the trim is reached.

The retention cap and the from-zero fold are individually reasonable and mutually
incompatible. ADR-0013 partitions state into three lanes and says the live
snapshot is "rebuildable by replaying the log"; that guarantee does not survive
the retention policy.

### Cursor reads ignore the cursor

`readSinceSync` reads the entire file and `JSON.parse`s every line *before*
filtering on `raw.seq <= afterSeq`. A client resuming at seq 2,047 of 2,048 pays
a full-file read and parse, plus Zod validation on each surviving record. Two
handlers call it with `afterSeq: 0` on the room join path.

This is currently masked by the 2,048 cap — but the cap is the thing anyone
would want to raise, and this is what stops them.

### Synchronous SQLite blocks the event loop under contention

`PRAGMA busy_timeout = 5000` on both the shared DB helper and the status schema,
with `SQLITE_BUSY_RETRY_LIMIT = 3` and exponential backoff from 50 ms — and the
sleep is `Atomics.wait` on a `SharedArrayBuffer`, which blocks the thread.

`node:sqlite` and `bun:sqlite` are synchronous. So a contended statement can
block inside C for 5 s, then block the JS thread for 50, 100, and 200 ms —
roughly 20 s of frozen event loop in the worst case, during which the process
serves no sockets, no streaming, and no timers.

In-process publishes self-serialize and are fine. The contention is
**cross-process** — CLI, hub daemon, and VS Code each open their own connection.
This is an availability property, not a throughput one.

**One correction worth recording**, because it was assumed in planning and is
wrong: the `seq` assignment `SELECT COALESCE(MAX(seq),0)+1` inside `BEGIN
IMMEDIATE` is *not* a bottleneck. `status_seq_idx` is a unique index on
`seq DESC`, making `MAX(seq)` an O(1) index-edge probe, and `BEGIN IMMEDIATE`
takes the write lock first so the read is correct. Optimising it would buy
nothing. The real per-insert cost is index write amplification — seven indexes
plus three FTS triggers where FTS5 is available — and `status.db` has no
scheduled prune, so that cost grows against a monotonically larger table forever.

### `spawn_agent` has no admission control at all

Team runs get a scheduler with `maxConcurrentRuns` defaulting to 2, a queue
bound, and per-teammate lanes. Chat forks are capped in width and — per ADR-0023 —
not in depth.

`spawn_agent` has none of it: searching `spawn-agent-tool.ts` for any
concurrency, semaphore, or queue construct returns nothing. The tool calls
`createDelegatedAgent` and awaits `run`. The runtime executes tool calls in
parallel when configured, so **one model turn emitting N spawn calls starts N
sub-agents simultaneously, each able to spawn again**. Latent today because
models rarely fan out that hard; it stops being latent the moment someone prompts
for it.

This is the same path [ADR-0025](../adr/ADR-0025-enforced-authority.md) Finding 2
identifies as dropping tool policies. The two defects compound: unbounded
children, each with wider authority than its parent.

### The bank assumes a single writer that nothing enforces

`nodeBankFs.write` is `mkdir` plus `writeFile` — no lock, no `O_EXCL`, no
temp-then-rename, no version check — while the event logs *do* use
temp-write-and-rename. `openWorkspaceBankStore` constructs a fresh unsynchronized
store per call, so even two callers in one process are unserialized.

Concrete consequences: two concurrent plan activations can each demote the other
and both write themselves active; `bindNowTask` is check-then-act, so two agents
can both observe a task `open` and both bind it; `writeFile` truncates before
writing, so a concurrent read can observe a partial file; and `completeTask`
writes then moves non-atomically.

ADR-0018 §2.4 defers this explicitly — "optimistic revision / CAS required before
multi-client mutable bank writers depend on it" — and frames the positive
consequence as agents getting authority "without becoming bank writers." That is
a coherent position. **It is safe only while single-writer is actually enforced,
and nothing enforces it.**

## Breaks at 5 versus breaks at 500

A finding without this distinction cannot be prioritised.

| Finding | Breaks at | Kind |
|---|---|---|
| Team state persisted per token delta | ~3 agents, or one long session | performance |
| Full-log rewrite per append past cap | one long session | performance |
| Retention breaks the room fold | one room past 2,048 events | **correctness** |
| `spawn_agent` unbounded concurrency and depth | one model turn that fans out | **containment** |
| Bank races | 2 concurrent writers | **correctness**, deferred by ADR-0018 |
| Synchronous SQLite blocking | ~4 concurrent processes | availability |
| Cursor reads full-parse the file | ~50-200, masked by the cap today | performance |
| `status.db` never pruned | weeks of use | performance |
| Unbounded in-memory sets | long-lived hub daemon | performance |

## What nobody has measured

Stated as a list because it is the actionable part.

1. **Estimated versus actual tokens per turn.** Both numbers exist. Nothing
   subtracts them.
2. **Cache hit rate.** `cacheReadTokens` and `cacheWriteTokens` are parsed and
   summed. No hit-rate metric, no alert when it collapses.
3. **Rules footprint.** Measured by hand for this document; nothing in the
   product measures it.
4. **Summary fidelity.** Nothing evaluates whether a compaction preserved what
   mattered.
5. **Quality over iteration count.** Nothing tracks whether iteration 60 is worse
   than iteration 6. The mistake tracker resets on every success and is blind to
   slow degradation that never trips three consecutive failures.
6. **Re-read rate after compaction.** The direct test of whether the path-list
   summary is sufficient.
7. **Any of the five probes in [12-performance](12-performance.md).** Still `TBD`.

The absence of 1 and 2 is the thesis: the measurement exists, is displayed to the
user, and governs nothing.

## Open

1. Should the estimator be calibrated with a rolling per-model correction, or
   replaced with a real tokenizer? Calibration is cheaper and keeps the
   conservative bias where it belongs.
2. Is a second cache breakpoint after system and tools worth the provider-specific
   complexity? It appears to be a small change with a large payoff, but nothing
   here measures the payoff.
3. Should rules have a budget, and what happens when a workspace exceeds it —
   warn, truncate, or refuse? Truncating rules silently is worse than the
   problem.
4. Does the room fold need checkpointing, or should retention stop trimming
   events that the fold depends on? These are different products: one bounds
   rebuild cost, the other preserves correctness.
5. Is single-writer on the bank a constraint anyone can state and enforce, or
   does ADR-0019's lease protocol become a prerequisite rather than a follow-on?
6. Does `spawn_agent` route through the team-run admission policy, or get its
   own? ADR-0023 governs seating and spawning at the Drive layer; this is the
   SDK layer beneath it.
7. What is the long-horizon counterweight to goal drift? The completion reminder
   is injected once at run start, which makes it the oldest message and the first
   compaction casualty.
