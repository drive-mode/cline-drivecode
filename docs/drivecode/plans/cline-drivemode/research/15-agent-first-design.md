# 15 · Agent-first design, stress-tested

Back to [README](../../../design/wireframes/README.md). Related: [ARD-0005](../ard/ARD-0005-status-hub.md), [ARD-0012](../ard/ARD-0012-agent-router.md), [14-primitives-audit.md](14-primitives-audit.md).

**What this is.** A candidate "AGENTS" design doctrine — *Authority explicit, Goals
observable, Environments legible, Non-determinism bounded, Traceability native,
State durable* — has been circulating as the agent-era answer to SOLID. This doc
tests it against a shipped agent runtime rather than restating it: which parts
hold, which are overreach, what is missing, and what Drive already implements.

Verdict up front: the vocabulary is good, the framing is wrong. Agent-first
design is not a new principle set. It is the old principle set applied at a
boundary that did not exist before — between a probabilistic proposer and a
deterministic system — plus a short list of genuinely new concerns (§6).

## 1. The altitude problem

SOLID's five are properties of one unit of code. You can hold a class in your
head and check them. AGENTS' six are not comparable to each other, let alone to
SOLID.

| Principle | Actually a… | Owned by | Checked when |
|---|---|---|---|
| Authority explicit | runtime policy | platform / security | deploy + every call |
| Goals observable | spec discipline | whoever delegates | task definition |
| Environments legible | API design | tool author | code review |
| Non-determinism bounded | architecture | system designer | design review |
| Traceability native | ops concern | platform | incident |
| State durable | storage design | system designer | design review |

Not a defect, but it means AGENTS cannot be used the way SOLID was used — as a
checklist against a class in review. It is a checklist against a *deployment*.
Anyone applying it per-file will produce ceremony (§5).

## 2. "Goals must be observable" is overreach as stated

The strong form — *an agent should never be responsible for a goal it cannot
independently measure* — would bar agents from most real work. "Reduce CI
runtime below 8 minutes" is the easy case, chosen because it has a cheap oracle.
"Why is this test flaky", "make this API less confusing", "clean up this module"
do not, and those are the majority of engineering.

The useful form is a dial, not a gate. **Verification strength sets the autonomy
budget.**

| Oracle | Example | Autonomy it earns |
|---|---|---|
| Machine-checkable, cheap, total | typecheck, unit test, benchmark | run to completion, land behind a gate |
| Machine-checkable, partial | integration suite, lint, coverage delta | run to completion, human reads the diff |
| Human-checkable, cheap | screenshot diff, one-line answer | agent proposes, human confirms in seconds |
| Human-checkable, expensive | "is this the right architecture" | agent assembles evidence, does not act |
| No oracle | taste, product judgment | not delegable; agent gathers inputs only |

The design work is **moving a task up this table before delegating it** — build
the oracle, then hand over the work. That is the real agent-first investment,
and it is far less glamorous than an orchestration layer. A team that writes a
goal-contract schema before it writes a test harness has built the ceremony and
skipped the substance.

Small instance of this in Drive: work state is a closed enum with an explicit
terminal set, so "is this finished" is machine-checkable instead of a prose
judgment — `StatusStateSchema` / `isTerminalStatusState`
(`sdk/packages/shared/src/status/status.ts:17`).

## 3. Verification independence is about kind, not count

Planner → Executor → Verifier as three prompts to one model buys less than the
diagram implies: the errors correlate. What matters is the *kind* of check.

```
types  >  deterministic policy  >  tests  >  different-model review  >  same-model review
```

A second model's real value is catching **category** errors — it answered a
different question, it optimized the wrong thing — not correctness. Use it
there and stop pretending it is an oracle.

The shape to copy is already in the Drive router. `planRoute` scores utterances
against seated agents with a fuzzy token heuristic that is allowed to be wrong;
`assertDeliveryAllowed` is a pure total function returning a tagged reject with a
machine-readable `code` (`sdk/packages/drive/src/router/planRoute.ts:150`). The
scorer never gets to deliver. Probabilistic proposal, deterministic disposal —
and the disposal is 30 lines of ordinary code, not a policy engine.

One rule in that file deserves promotion to a principle. When the router's
confidence is low it falls back to the pair partner rather than broadcasting to
everyone — *never silent-widen to everyone when agents are seated*
(`planRoute.ts:80`). Generalized:

> **When confidence drops, reduce blast radius.** The instinct to broaden on
> uncertainty ("tell everyone, someone will handle it") is exactly backwards.

## 4. Three things the doctrine is missing

### 4.1 Attention is the scarcest budget

AGENTS budgets money, compute, and time. In practice the binding constraint is
human interruptions. Ten agents that each ping you "only when it matters" is a
pager rotation you did not agree to, and the failure is silent: people stop
reading.

This has to be typed, not left to model judgment. Drive splits it at the schema
level — `high` and `critical` push to the human, everything else lands in a log
read on demand (`shouldPushToUser`, `status.ts:53`) — and the tool guidance tells
the model outright that over-using the loud levels makes every status worthless
(`sdk/packages/core/src/status/guidance.ts`). Loudness is a property of the
message, rate-limitable and auditable, not a decision buried in a prompt.

> **Every agent output carries a declared loudness, and the default is quiet.**

### 4.2 The read path — state legible without replay

AGENTS' *State durable* covers the write side: can the agent resume. The harder
half is the read side: can a human, or a *different* agent, learn the state of
the work without replaying the transcript?

A transcript is a write-optimized log. Answering "what is happening right now"
from one means a linear scan of the least structured data in the system. This is
the actual reason agent systems feel opaque — not missing logs, a missing read
model.

Drive's answer is a per-subject append-only changelog: a caller-chosen stable
`subject` key, monotonic `seq` ordering, `supersededAt` marking non-current rows,
so one table answers both "current state of everything" and "how did this subject
get here". Paging resumes by cursor, never by wall clock
(`status.ts:1-10`, `sdk/packages/core/src/status/store/sqlite-status-store.ts:24`).

> **The state of the work must be readable without replaying the work.** The read
> model is a separate design artifact from the log, and it is the one users touch.

### 4.3 Multi-agent addressing

The doctrine is single-agent shaped. Add a second agent and four questions
arrive at once: who is this message for, who may speak, what happens on
ambiguity, what happens when two agents touch the same thing. Drive answers them
with first-class domain types — `AddressSet`, `RoutePlan`, seats,
`ParticipantAudioFlags` — rather than leaving them to convention. Any doctrine
that omits addressing is describing an assistant, not a system.

## 5. What the doctrine looks like overapplied

The strongest point in the SOLID critique was that rigid application produces
interface bloat and premature abstraction. The same discipline turned on AGENTS:

| Principle | Overapplied | Symptom |
|---|---|---|
| Authority explicit | a capability grant per tool call | human becomes a permission-clicking bottleneck and approves without reading |
| Goals observable | a YAML goal contract to rename a variable | ceremony exceeds the work |
| Environments legible | a typed wrapper per shell command | reimplementing the shell, badly |
| Non-determinism bounded | a policy engine in front of a pure function | latency plus a second place for bugs |
| Traceability native | trace every token | an audit log nobody reads and a retention liability |
| State durable | externalize what was a local variable | a distributed system where a function call was fine |

YAGNI and AHA apply to agent infrastructure exactly as they apply to
abstractions: build the goal contract at the third goal, not the first.

Two corollaries worth stating plainly:

- **Constant escalation is not safety, it is a mis-set autonomy budget.** If an
  agent escalates on most tasks, the fix is a stronger oracle (§2), not more
  approval gates. Approval fatigue converts a safety control into a rubber stamp.
- **Unrehearsed reversibility is theater.** "Soft deletes and snapshots" only
  count if the undo path is exercised. An untested restore is a story about
  safety, and soft deletes carry their own retention and privacy cost.

## 6. The unifying claim

Agent-first design is mostly the existing canon applied at a new boundary: the
one between a probabilistic proposer and a deterministic system.

| Classic principle | What changes when the caller is a model |
|---|---|
| Parse, don't validate | model output is untrusted input — parse at the boundary, never pass a raw string inward |
| Make illegal states unrepresentable | the model will eventually emit every representable state, including the contradictory ones |
| Explicit state machines | work is long-running and resumable, so state must be a value, not scattered booleans |
| Functional core / imperative shell | the model belongs to neither — it proposes into the shell; the core decides |
| Command–Query Separation | a tool that mutates *and* returns state is unsafe to retry; separate them and make mutation idempotent |
| Law of Demeter | a tool that exposes internal structure teaches the model to depend on it, permanently |
| Tell, don't ask | `deploy_service(...)` over `run(cmd)` — the same principle, higher stakes |
| High cohesion, low coupling | a tool surface *is* a coupling surface; every tool you ship is permanent API |

Drive's hub boundary is the first row in practice: every inbound command is
`safeParse`d before it reaches a handler
(`sdk/packages/core/src/hub/server/handlers/drive-handlers.ts`), so a malformed
proposal becomes a typed rejection instead of a partially-applied mutation.

What is actually new is a short list:

1. **Authority envelopes as a runtime value** — capabilities, not credentials.
2. **Attention as a budget** (§4.1).
3. **Durable, resumable work state as a product surface**, not an implementation detail (§4.2).
4. **Results that carry their own evidence**, because the claim "done" is now cheap to produce.

Everything else is a rediscovery under load. Which points at the real mechanism:

> **An agent is a fuzzer for your abstractions.**

Bad interfaces were always bad. Humans navigated them with tribal knowledge —
the memo, the wiki page, the colleague who knows that endpoint lies. A model has
none of that. It sees the type, the name, and the description, and it will find
every gap between what your interface says and what it means, continuously, at
machine speed. Agent-first design mostly means paying the interface debt you
already had.

## 7. Diagnostic

Questions answerable about a repo today. These are the deliverable, not the
acronym.

| # | Question | Good answer looks like |
|---|---|---|
| 1 | What can this agent do that it should not? | an enumerable tool set, not "it has shell" |
| 2 | Where is the model's output first parsed into a type? | one named boundary per surface |
| 3 | Which decisions are pure functions the model cannot skip? | named policy modules with tagged rejects |
| 4 | How do I learn the state of in-flight work without reading a transcript? | a query, not a scan |
| 5 | What interrupts a human, and who decided? | a typed field with a quiet default |
| 6 | If the process dies mid-task, what survives? | durable rows with a resume cursor |
| 7 | What is the oracle for this class of task? | a command that exits non-zero |
| 8 | When the agent is unsure, does blast radius grow or shrink? | shrink — with the fallback in code |
| 9 | Which tools mutate and return state in one call? | none, or a listed exception set |
| 10 | Has the undo path been exercised this quarter? | yes, with a date |

## 8. Where Drive stands

Honest scoring against the above. Strong where the Status Hub and router reach;
absent where nobody has needed it yet.

| Concern | Status | Evidence |
|---|---|---|
| Environments legible | **Strong** | Zod-schema'd tools, typed results, string-returning failures that do not throw (`executors/report-status.ts`) |
| Non-determinism bounded | **Strong** | `planRoute` → `assertDeliveryAllowed`; `safeParse` at hub boundaries |
| State durable + readable | **Strong** | append-only `status.db`, `seq` cursors, `supersededAt` (ARD-0005) |
| Attention budget | **Strong** | priority split + guidance that names the failure mode |
| Multi-agent addressing | **Strong** | `AddressSet`, `RoutePlan`, seats, audio flags |
| Traceability | **Partial** | attribution is filled from tool context, not trusted from the model (`report-status.ts`) — but headline/detail is prose, not a structured decision record |
| Authority explicit | **Partial** | `ToolPresets` gives coarse envelopes — act / plan / search / minimal (`extensions/tools/presets.ts`) — which is tool-level enable/disable, not per-resource scoping. Note `budget` in this repo means context-window tokens (`extensions/context/budget-projection/`), not spend or time; there is no authority-budget primitive |
| Goals observable | **Weak** | terminal states exist; there is no goal contract carrying acceptance criteria or evidence requirements |

The two gaps are the interesting ones, and they are the same gap seen twice: Drive
is excellent at reporting *what happened* and has no vocabulary for *what was
supposed to happen*. A goal contract (§2) and a resource-scoped authority envelope
would close both. Neither should be built before there is a second consumer —
see §5.
