# Next-action triad — wiring

**Status:** Proposed (2026-08-17) — Impl `none`
**ADR:** [ADR-0036](../../adr/ADR-0036-next-action-triad.md) (Proposed — next-action
prediction is a three-verb operator triad)
**Product:** [PRD 11](../../prd/prd-magic-hotkey.md) · **Research:**
[29-large-task-models](../../research/29-large-task-models.md)
**Constrained by:** [DRV-GATES](../../features/DRV-GATES.md),
[ADR-0025](../../adr/ADR-0025-enforced-authority.md) (a declared limit is only
real if some path can refuse)

## Purpose

Answer [ADR-0036](../../adr/ADR-0036-next-action-triad.md) **Open 6**, which that
record calls "the load-bearing wiring question for M1":

> How an operator-initiated DO reaches the `ToolPolicy` gate (decision 5) without
> running an agent turn. The existing branch is mid-turn and turn-latency would
> break the 200 ms budget, so this is the load-bearing wiring question for M1 —
> and it must be answered by reaching the policy, never by copying it.

Everything below is read off the code on `main`, not proposed from the outside.

## The short answer

**The gate is already turn-independent. Only its call site is inside a turn.**

`prepareToolExecution` in `sdk/packages/agents/src/agent-runtime.ts` gates a tool
in four steps:

| # | Step | Turn-coupled? |
|---|---|---|
| 1 | `resolveToolPolicy(toolName, config.toolPolicies)` | No — pure function of a string and a record |
| 2 | `policy.enabled === false` → refuse | No — pure |
| 3 | `policy.autoApprove === false` → `config.requestToolApproval(...)` | No — the callback is session-scoped |
| 4 | `beforeTool` hooks may return a `policy` override | **Yes** |

Steps 1–3 carry no turn state. `sdk/packages/core/src/services/local-runtime-bootstrap.ts`
resolves both `toolPolicies` and `requestToolApproval` **once per session**, then
hands them to the runtime builder — they are session-scoped inputs to the agent
runtime, not products of a turn. A turn-independent caller can hold the same two
references.

So Open 6 does not need a new mechanism. It needs the decision in steps 1–3
lifted out of `prepareToolExecution` into a function both the agent runtime and
the triad call, with the agent runtime as its **first caller** so the shared path
is the enforced path by construction rather than by discipline.

## The 200 ms budget is not actually at risk

This follows from ADR-0036's own tiering and is worth stating because it shrinks
the problem.

Decision 6 defines Tier 1 as *already auto-approved*: "auto-approved today means
Tier 1 here." For a Tier 1 verb, `autoApprove !== false`, so **step 3 never
runs** — the gate is two object spreads and a boolean check, microseconds.

Step 3 runs exactly when `autoApprove === false`, which is Tier 2 by
construction. Decision 7 makes Tier 2 *arm on the first DO and execute on the
second*, so a human is already in the loop and the approval round-trip is outside
the keypress budget.

**The budget was never threatened by the gate. It is threatened by the turn** —
the model call — which is what must be avoided. Open 6 is a smaller question than
its framing suggests.

## Finding: the copy the ADR forbids already existed

`@cline/shared` exports the canonical `resolveToolPolicy`
(`sdk/packages/shared/src/llms/tools.ts`) under a comment stating why it lives
there:

> Lives here rather than beside a consumer because the enforcement path in
> `@cline/agents` and the delegation cap below must agree bit for bit, and
> `@cline/agents` cannot import `@cline/core`.

The enforcement path in `@cline/agents` did not import it. `agent-runtime.ts`
carried a private duplicate and used that instead. The two were functionally
identical, so this was latent rather than live — but it was a second copy of the
policy resolution at the one place the comment names, and adding the triad as a
third caller on top of it would have made "one policy table" false.

Fixed in this change: `agent-runtime.ts` now imports the canonical resolver and
the duplicate is gone. This is a precondition for Open 6, not a side quest —
"reach the policy, never copy it" requires there to be one policy to reach.

## Two constraints ADR-0036 does not anticipate

### C1 — Hub approval routes on `sessionId` and refuses non-interactive sessions

`sdk/packages/core/src/hub/server/handlers/approval-handlers.ts`:

- looks the session up: `ctx.sessionState.get(request.sessionId)`
- **refuses outright** when `state?.interactive === false`
- publishes `approval.requested` scoped to that `sessionId`

An operator-initiated DO therefore **cannot mint a synthetic `sessionId`**. A
Tier 2 DO must carry the id of a live, interactive session or the hub refuses it
before any human sees a prompt. Refusal is the safe direction, but it has to be a
designed behavior with an honest message, not a surprise discovered at M2.

Note the other two hosts differ: the CLI's approval controller
(`apps/cli/src/runtime/interactive/approvals.ts`) reads only `request.policy`,
and the VS Code host's option type does not even declare `sessionId`. The hub is
the strict one, and the hub is the triad's surface.

### C2 — `beforeTool` policy overrides cannot be reproduced without a turn

`AgentBeforeToolResult.policy` (`sdk/packages/shared/src/agent.ts`) lets a hook
override the resolved policy for a single call, and `beforeTool` hooks receive
`snapshot: AgentRuntimeStateSnapshot` — turn state. Plugin sandboxes, subprocess
hooks, and hook files all register `beforeTool`.

So in any project using hook-driven policy overrides, a triad DO that skips
`beforeTool` resolves a **different** policy than the same tool would get
mid-turn. That is precisely the "second, quieter permission system" decision 6
forbids, arrived at by omission rather than by design.

This needs a decision. Three options:

| Option | Shape | Verdict |
|---|---|---|
| **Refuse per-tool** | Exclude tools whose policy a hook would touch | Not knowable — hooks are opaque functions, not a declared list |
| **Degrade per-session** | If any `beforeTool` hook is registered, the triad drops Tier 1 auto-execute and arms everything | Knowable at bootstrap, safe, preserves one policy |
| **Synthetic snapshot** | Run `beforeTool` against a fabricated turn snapshot | Rejected — hooks may read iteration and history; fabricating them is lying to a security path |

**Recommended: degrade per-session.** Hook registration is known when hooks are
assembled in `local-runtime-bootstrap`, so the triad can ask one honest question
at session start — *can anything override policy here?* — and if so, every verb
arms instead of executing. The cost is one extra keypress in hook-using projects;
the alternative is a quiet divergence between two permission paths.

## Identity fields for a non-turn invocation

`ToolApprovalRequest` carries five identity fields. Their doc comments already
constrain the answers:

| Field | Value for an operator DO | Why |
|---|---|---|
| `sessionId` | The live Drive session's id | **Required** — the hub routes and refuses on it (C1) |
| `agentId` | A reserved operator id, not an agent's | It is "used for attribution"; no agent requested this |
| `conversationId` | Must **not** reuse the agent's | It identifies "the model conversation that produced the tool call" — none did |
| `toolCallId` | Minted per DO | Correlates the press with its `predict.*` records |
| `iteration` | Sentinel | There is no iteration; a real-looking number would be a fabrication |

`conversationId` and `iteration` are the two that invite a quiet lie. Both are
contextual rather than routing keys, so a sentinel is viable — but it must be
explicit, because these fields land in approval prompts and in the label corpus,
and ADR-0036 decision 11 makes that corpus evidence.

## Slices

| Slice | Status | Notes |
|---|---|---|
| **W1** — one resolver | **done here** | `agent-runtime.ts` imports the canonical `resolveToolPolicy`; private duplicate deleted |
| **W2** — extract the gate | next | Lift steps 1–3 into a turn-independent decision function; agent runtime becomes its first caller. No behavior change — the refactor is the deliverable |
| **W3** — decide C2 | blocked on product | Degrade-per-session recommended above; needs a decision before Tier 1 can auto-execute anywhere |
| **W4** — decide identity | blocked on product | `conversationId` / `iteration` sentinels, and the reserved operator `agentId` |
| **W5** — hub non-interactive path | after W3/W4 | Honest refusal message when C1 bites, surfaced at the hint rather than swallowed |

W2 is safe to land ahead of ADR-0036 being accepted: it is a refactor of the
existing enforcement path with no new caller, and it stands on its own merits.
W3 and W5 must not land before the ADR is accepted — they are the decision being
implemented.

## What this does not answer

ADR-0036 **Open 2** (retention cap and kind spelling for the `predict` family) is
untouched here and still gates M0. Open 6 is about reaching the gate; Open 2 is
about recording that it was reached. They are independent.
