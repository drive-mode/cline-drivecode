# 23 · Agent-first design — what replaces SOLID when the caller is not a person

**Date:** 2026-08-03 · **Status:** analysis, no decision
**Scope:** design doctrine for agent-operated systems, audited against this repo.
**Companions:** [ADR-0018](../adr/ADR-0018-agent-runtime-contract.md) (runtime
contract, `WorkLease`, receipts), [ADR-0023](../adr/ADR-0023-agent-spawn-governance.md)
(spawn governance), [22-default-posture](22-default-posture.md) (what ships out
of the box), [21-operator-experience](21-operator-experience.md).

## Why this document exists

SOLID is a set of heuristics for arranging classes that a person will read and a
person will call. Both halves of that assumption are now optional. When the
caller is an agent, the questions that decide whether a system is well designed
are not about interface segregation — they are about what the agent is allowed
to touch, whether anyone can tell what it did, and who decides it was right.

A candidate replacement has been circulating in the industry conversation, and
it is worth naming precisely so it can be argued with. It goes: **A**uthority
must be explicit, **G**oals must be observable, **E**nvironments must be legible,
**N**on-determinism must be bounded, **T**raceability must be native, **S**tate
must be durable.

Every one of those is correct. That is the problem with it.

This document does three things. It argues the acronym form is a trap that will
reproduce SOLID's failure mode. It proposes a frame that generates the same
content but can actually be failed. Then it audits this repo against that frame,
because Drive is a system whose entire premise is agents operating durably under
observation, which makes it the honest test case — and the audit is unflattering
in places.

## Thesis

**In human-authored software the loop closes at write time. In agentic software
it closes at run time, and every guarantee that used to come from "a person
looked at this before it ran" now needs a named runtime substitute.**

That is the whole idea. A developer decided what the code would do. A reviewer
checked it. CI verified it. Deployment was the only decision left to runtime,
and it was a decision about *whether*, not *what*. Agentic systems move the
decision itself to runtime, which means every property that review used to
supply is now unowned unless something at runtime owns it.

The generative question is therefore not "is authority explicit?" — nobody will
answer no. It is: *review used to guarantee this; what guarantees it now?*

## Where the AGENTS draft is weak

### It is a list of virtues, not constraints

No engineer will argue for implicit authority, unobservable goals, or hostile
environments. A principle that cannot be argued against cannot be violated, and
a principle that cannot be violated does no work.

This is exactly how SOLID decayed. Dependency inversion is a real idea; as a
virtue it became "inject everything," and codebases filled with single-implementation
interfaces that exist to satisfy a letter. The same decay is already visible in
the agent version. "Traceability must be native" reads as *log everything*, which
is the failure the same draft warns about when it says memory must be
intentional. The draft contains its own counter-argument and does not notice.

### There is no cost model

Every one of these principles is expensive, and the draft never says when to
skip one. Durable state costs a schema and a migration path for runs that
outlive the deploy. Traceability costs storage, retention policy, and a new PII
surface. Independent verification costs a second model call on every action.
Reversibility costs branch and staging infrastructure. These are correct
investments for an agent with production credentials and wrong for an agent that
summarizes a document.

The same conversation that produced the AGENTS draft argued for YAGNI and for
avoiding hasty abstractions. Those disappear from the agent half — precisely
where they matter most, because agent infrastructure is the most churn-prone
code being written anywhere right now.

### The acronym selected the ideas

Six letters spell a word, and the word did the choosing. "Goals must be
observable" and "non-determinism must be bounded" are one idea at two altitudes:
both say the acceptance test must exist before the run. Meanwhile the genuinely
unsolved problems — the human attention budget, trust between agents, migrating
state under a running agent — sit in a *supporting principles* appendix, which is
where ideas go to die.

### The principles collide, and the draft does not adjudicate

Four collisions that any real system hits:

| Collision | Why it bites |
|---|---|
| Durable state vs. intentional memory | Resume and remember are the same mechanism. Every "pick up where it left off" is state that outlived its purpose unless something expires it. |
| Traceability vs. reversibility | If actions are rolled back, the trace describes a world that no longer exists. An audit log of reverted actions is fiction unless the revert is traced at equal fidelity. |
| Bounded authority vs. observable goals | Measuring an outcome usually means reading production. Reading production is authority. The tighter the envelope, the more goals the agent cannot verify for itself. |
| Independent verification vs. cost | Planner → Executor → Verifier with one model behind all three is theater. Independence has to be structural, and structure costs more than a second prompt. |

### It is not falsifiable

No system described anywhere in the draft violates it. A principle set that
never says no to a concrete design is a mood, not a doctrine.

## The rebuild

Replace the six virtues with one table. The left column is a guarantee code
review used to provide. The right column is the thing that has to provide it now.

| Guarantee that came from review | Runtime substitute |
|---|---|
| It can only touch what it is supposed to | Capability scoping enforced at the tool boundary, not in the prompt |
| Someone agreed this is what we wanted | A goal contract whose acceptance test exists *before* the run |
| We can tell what it did and why | A decision trajectory — context in, choice out — not a request log |
| A second person checked it | Verification with structural independence from the executor |
| We can revert the commit | Reversibility as the default shape of an action |
| It will not run forever or cost unbounded money | Budgets that terminate the run, not budgets that warn |
| Someone knew when to stop and ask | Escalation as a modeled state transition with defined triggers |

This is falsifiable by construction. For each row a system either names the
mechanism or it does not, and "the model is instructed to" is not a mechanism.

**The single most useful test in the table is the first one.** If the boundary
can be moved by text in the context window, there is no boundary — there is a
suggestion with good manners. ADR-0023 states this better than this document
can: *"A self-declared permission that the hub honours is not a permission"*
([ADR-0023-agent-spawn-governance.md:112](../adr/ADR-0023-agent-spawn-governance.md)).

### When none of this applies

The rule the draft is missing. Score the agent on two axes:

- **Blast radius** — what the worst single action can damage.
- **Time unattended** — how long it runs before a human sees the result.

Low on both, and almost none of this machinery is worth building: a read-only
agent whose output a person reads before acting needs typed tools and nothing
else. The rows earn their place as either axis grows, and they are needed in
roughly the order listed. A system that builds durable state and trajectory
capture before it has a capability boundary has bought the expensive rows and
skipped the cheap one.

## Drive audited against the table

Drive is the right test case because it is not a toy. It is a product for
watching and steering agents that run long enough for a person to lose track of
them, and it has been built with unusual attention to what an agent should not
be able to do. Both halves of what follows are load-bearing.

### What is genuinely good

Stated plainly, because the rest of this section is critical.

**Attribution is taken from the trusted context, never from the model.** The
`report_status` tool fills session, agent, and workspace from the tool context —
*"an agent should not be able to file a status update as some other agent"*
([report-status.ts:13-14](../../../../../sdk/packages/core/src/extensions/tools/executors/report-status.ts)).
This is the exact runtime substitute for a signed commit, in about four lines. It
is the best single expression of the doctrine anywhere in the repo.

**An illegal state is made unrepresentable in the schema rather than policed in
the service.** The status store carries a partial unique index so that two
current rows for one subject cannot exist
([status-schema.ts:37-38](../../../../../sdk/packages/core/src/status/store/status-schema.ts)).
Parse, don't validate, applied to a database.

**Durable state cannot escalate capability.** `DRIVE_FACET_FORBIDDEN_PROMPT_KEYS`
rejects `systemPrompt`, `prompt`, `tools`, `skills`, `providerId`, `modelId`
from durable Drive facets
([facets/schemas.ts:76](../../../../../sdk/packages/shared/src/drive/facets/schemas.ts)),
and `DRIVE_ENV_FORBIDDEN_SECRET_KEYS` rejects plaintext credentials in favour of
opaque `secretRef`s
([home/schemas.ts:11](../../../../../sdk/packages/shared/src/drive/home/schemas.ts)).
Observability state cannot quietly rewrite what the agent is or what it may call.

**Handoff summaries cannot invent.** `assembleHandoffPacket` is pure string
assembly over the event log and bank snapshot — *"Never invents facts"*
([handoff.ts:5](../../../../../sdk/packages/drive/src/handoff.ts)) — with a
recursive key scan rejecting transcript, audio, and utterance keys. The thing
that tells a returning human what happened is not a model.

**Escalation triggers on the shape of the work, not on what was said.** The stall
classifier requires two independent signals before it will call a session stuck
([stallClassifier.ts:184-188](../../../../../sdk/packages/drive/src/stallClassifier.ts)),
and its output is a structured fingerprint, never an utterance. Escalation that
fires on one weak signal is the mechanism by which human-in-the-loop becomes
noise.

**Interruption is a typed transition, not a kill switch.** `classifyInterrupt`
maps intent × turn state onto `pause-after-tool | hard-cancel | queue-steer`,
defaulting to revise rather than restart so tool results survive the correction
([interruptPolicy.ts](../../../../../sdk/packages/drive/src/interruptPolicy.ts)).
Most systems offer stop and nothing else, which trains people not to steer.

**Conformance tests invocation, not declaration.** The host kit exists because
*"a host can declare a legal capability matrix and still be a silent no-op, which
only invocation catches"*
([hostBehavior.ts:6](../../../../../sdk/packages/drive/src/conformance/hostBehavior.ts)),
and `capability_noop` is a reportable issue code. This is the right instinct
applied in the right place — and it is exactly the instinct missing from the
permission layer below.

**Undo is real.** Checkpoints write a git stash under a private ref per run, and
restore runs as a transaction with `commit()` / `rollback()`
(`sdk/packages/core/src/session/checkpoint-restore.ts`). Of all seven rows in the
table, reversibility is the one Drive most clearly owns.

### Where the type system outruns the engine

**The finding to build on: this repo has a policy type system without a policy
engine.**

`PermissionPreset` defines `readonly | standard | full` as an authority ceiling,
and `capPreset` implements a correct monotone lattice so a child can never exceed
its parent ([facets/expand.ts:88](../../../../../sdk/packages/drive/src/facets/expand.ts)).
It is designed well and unit-tested. It also has **zero non-test consumers** — the
only references to `effectivePreset` in the entire repo are its own definition,
its own assignment, and two assertions in `expand.test.ts`. It never becomes a
`ToolPolicy` and never reaches the runtime.

The one real chokepoint is about fifteen lines in `agent-runtime.ts`, and it
fails open. `resolveToolPolicy` merges the `"*"` entry with the per-tool entry
and returns `{}` when nothing is configured
([agent-runtime.ts:133](../../../../../sdk/packages/agents/src/agent-runtime.ts));
the gate then tests `policy.enabled === false` and `policy.autoApprove === false`
([agent-runtime.ts:1480-1481](../../../../../sdk/packages/agents/src/agent-runtime.ts)).
An unconfigured tool is enabled and auto-approved. There is no deny-by-default
mode. The CLI then sets `defaultToolAutoApprove = true`
([apps/cli/src/main.ts:855](../../../../../apps/cli/src/main.ts)), which applies
to `run_commands` as much as to `read_files`.

The same gap repeats at every layer:

| Declared | Enforced | Evidence |
|---|---|---|
| `PermissionPreset` ceilings, correctly capped | No | `effectivePreset` has no non-test consumer |
| `.driveagent/permissions.yaml` intent | No | ADR-0023 calls it self-declared |
| `DriveRunIsolation`, `writeClaims`, `allowedActions` | No | `DriveRun` has no store — schema, a pure propose-only helper, a pure guard, and a Kanban projection, nothing that persists |
| DRV-GATES six-class taxonomy | No | Classification is name-based and drives UI labels |
| Receipt requires verifier evidence | Partly | `evidenceRefs.length === 0` throws ([completionReceipt.ts:75-77](../../../../../sdk/packages/drive/src/driveplan/completionReceipt.ts)); the contents are an unvalidated `string[]` |
| Verifier is distinct from executor | No | `decidedBy` is optional and read by nothing — schema plus one test fixture, repo-wide |

The receipt case is the sharpest, because it is the row the table cares most
about. `assertCompletionReceipt` is a correct guard: it matches run to task,
receipt to task, receipt to run, and requires `decision === "accepted"` with
non-empty evidence. It also returns immediately when no `DriveRun` is bound — and
since nothing in the repo persists a `DriveRun`, nothing ever binds one. The
verification row is currently held by a guard that is structurally sound and
never runs.

Four more, briefly:

- **`run_commands` is an unbounded escape hatch.** Its input union accepts a bare
  string, and there is no command allowlist or argument inspection anywhere.
  Once it is approved, every narrower tool policy is bypassable by shell.
- **Shell inherits the full parent environment** — `env: { ...process.env, ...config.env }`
  ([bash.ts:142](../../../../../sdk/packages/core/src/extensions/tools/executors/bash.ts)).
  The `secretRef` discipline in the config layer is undone by the tool layer.
- **Budgets do not terminate.** `maxIterations` is unset on every production path;
  the USD cap is opt-in via `CLINE_MAX_SESSION_COST` and unset. Worse, the VS Code
  auto-approval settings still carry `maxRequests` as a tombstone — *"Legacy field
  - Max requests limit feature has been removed"*
  ([AutoApprovalSettings.ts:10-11](../../../../../apps/vscode/src/shared/AutoApprovalSettings.ts)) —
  and `consecutiveAutoApproved` no longer exists anywhere in the repo. The one hard
  budget on the approval path was deleted. **This is the direction-of-travel finding:
  when the declared ceiling and the enforced ceiling are not wired together, it is
  always the enforced one that erodes.**
- **A label and its grant disagree.** The `plan` preset is documented *"read-only,
  no shell access"* and ships `enableBash: true`
  ([presets.ts:40-46](../../../../../sdk/packages/core/src/extensions/tools/presets.ts)).

### The write-only state loop

Drive's durable state is excellent and the agent cannot read it.

Agents publish through `report_status`, and there is no `read_status` or
`query_status` tool — the read side is hub commands for the UI. The bank snapshot,
the current task, and the status board are never injected into a prompt. Session
resume is transcript replay: `loadInteractiveResumeMessages` reads the persisted
messages file and feeds it back as initial messages
(`apps/cli/src/utils/resume.ts`).

So the status header is aspirational in one direction and true in the other. A
*human* can answer "what is happening" without replaying a transcript. An *agent*
cannot. The Drive state plane and the Cline session plane are not connected, and
that gap — not any missing principle — is the largest distance between this
architecture's ambition and its implementation.

One correction while auditing: [reference/architecture.md](../../../reference/architecture.md)
lists room persistence as a non-goal and calls the room plane an ephemeral Map.
That is stale against ADR-0013 and against `hydrateFromLog`, which rebuilds a
room snapshot by folding the durable event log. The accurate and more interesting
claim is **derived state is ephemeral, the log is durable**.

## The cheapest test for each row

The point of the table is that each row can be checked in about ten minutes.

| Row | Failure signature | The test |
|---|---|---|
| Capability scoping | Permission is a UI prompt; one credential works everywhere | Ask the agent nicely to exceed its scope. If prompt text moves the boundary, there is no boundary |
| Goal contract | Completion criterion is that the agent said it was done | Delete the agent's own report. Can success still be determined? |
| Trajectory | Tool calls are visible, the context that produced them is not | Pick one decision from last week and reconstruct why. Time-box it |
| Independent verification | Verifier reads the executor's summary | Hand the verifier a broken artifact with a confident summary saying it is fine |
| Reversibility | Writes land on main; deletes are hard | Revert one agent action. Time it |
| Budget | Nobody can state the ceiling | Ask what the most expensive possible single run costs. No answer means no budget |
| Escalation | The failure mode is retrying differently, forever | Count escalations in the last hundred runs. **Zero is a bug, not a triumph** |

Against these, Drive passes reversibility outright, passes escalation in design,
and fails capability scoping, budget, and independent verification — not because
the ideas are absent, but because the code that expresses them is not wired to
anything that can stop a tool call.

## What the draft skipped

### Human attention is the scarce resource and nothing budgets it

Every approval gate, escalation, and verification-needs-a-human is a withdrawal
from a fixed daily pool. A system that escalates correctly but constantly is a
system that gets ignored, and an ignored escalation is worse than none because it
manufactures the appearance of oversight. This is alarm fatigue, and it is the
real failure mode of human-in-the-loop — not agents failing to ask, but agents
asking so often that asking stops meaning anything.

The implication is that escalation needs a *rate* budget alongside its trigger
conditions, and that the system should be able to spend attention where it is
worth the most rather than uniformly. It also reframes what Drive is. A product
built around a call, a spotlight, a stall classifier that demands two signals,
and a recovery card that never writes without an accept is not primarily an
observability product. It is an **attention allocation** product, and that is the
sharper claim.

### Provenance laundering between agents

When agent B reads agent A's output, A's guess silently becomes B's premise.
Confidence is not transitive but it is inherited, and summarization strips hedges
before it strips content — the qualifier is the first thing to go. Three agents
deep, a maybe is a fact with no record of where it stopped being one.

What is needed is provenance that survives summarization and a durable
distinction between *observed* and *generated*. Drive's forbidden-key scanners
are the same instinct pointed at privacy; the same mechanism pointed at
provenance would be new.

### State migration under a running agent

Durable, versioned, resumable state means a schema that in-flight runs depend on,
and runs outlive deploys. This is an ordinary distributed-systems problem that
agent frameworks have just acquired and none of them answer. It is the concrete
cost behind "state must be durable," and it is why the exemption rule matters:
durable state is not free, it is a migration obligation.

### Independence has to be structural

Three cheap sources of real independence, in descending order of value:

1. **Different information.** The verifier reads the artifact and never the
   executor's narrative. This is the highest-value and lowest-cost change
   available to almost any agent system.
2. **Different mechanism.** A deterministic check beats a model check wherever one
   exists. A test suite is a better verifier than a careful reviewer prompt.
3. **Different framing.** Ask the verifier to refute, not to review. Reviewers
   confirm; refuters look for the failure.

Organizational separation — three prompts labelled planner, executor, verifier —
supplies none of these.

### Non-determinism is a feature being paid for

The draft treats variance purely as a hazard to contain. But a model is in the
system precisely because it handles inputs nobody enumerated. Bound the
non-determinism completely and what remains is a workflow engine with an
expensive parser attached.

The real question is not how much variance to allow but *where*. The draft's own
best line answers it — the model may propose, deterministic systems decide — and
that line belongs at the top of the doctrine rather than the middle of a section.
Variance in proposal, determinism in validation. `assembleHandoffPacket` and the
stall classifier are both this principle already: the model does the work, and a
pure function decides what is true about it.

### Agent retry is not request retry

A retried HTTP call with an idempotency key is the same call. A retried *agent*
re-plans, so it is a different agent with correlated failure modes — it will tend
to fail the same way for the same reason, which is exactly what retry logic
assumes is not true.

The distinction worth encoding: **retries belong at the tool level**, where they
are deterministic and keyed, and **attempts belong at the agent level**, where
they are fresh, budgeted, and capped. Conflating them produces a system that
retries its way through a budget without ever changing the outcome.

## Open

1. Should `effectivePreset` compile into `ToolPolicy` at seat time, or is the
   preset lattice the wrong shape for a runtime that only understands per-tool
   enable and auto-approve? Wiring the existing lattice is the cheaper answer;
   whether it is the right one is undecided.
2. Does deny-by-default belong in `resolveToolPolicy`, or in a host-supplied
   policy resolver above it? The former changes behaviour for every embedder.
3. What is the minimum `DriveRun` persistence that makes the receipt guard live?
   Until something binds a run, the verification row has no owner.
4. Should `decidedBy` be required and checked against the executing agent id, and
   what is the identity source that check would trust?
5. Is there a read-side status tool that does not reintroduce the transcript
   replay the status log exists to avoid?
6. Does the attention budget belong in the stall policy as a rate limit, or is it
   a product-level concern for the call surface?

## What this replaces

Nothing yet. The table in [The rebuild](#the-rebuild) is offered as the review
lens for agent-facing work in this repo, in the same way high cohesion and low
coupling serve for ordinary code. If it survives use, the binding half belongs in
an ADR that cites this document — the pattern
[21](21-operator-experience.md) and [22](22-default-posture.md) follow.
