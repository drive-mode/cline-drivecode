# 25 · Role tiers — what a third agent tier would actually cost

**Date:** 2026-08-04 · **Status:** analysis, no decision
**Scope:** the SDK team subsystem and Drive's roster/router surface, audited
against a three-tier delegation hierarchy (Architect → Tech Lead → Developer).
**Companions:** [ADR-0023](../adr/ADR-0023-agent-spawn-governance.md) (spawn
governance — **its Finding 2 is now stale; see below**),
[ADR-0018](../adr/ADR-0018-agent-runtime-contract.md) (capability-scoped
`WorkLease`), [ADR-0012](../adr/ADR-0012-agent-router.md) (the router does not
seat or spawn), [ADR-0003](../adr/ADR-0003-recruit-and-roster-pack.md) (recruit
ranks; packs stay curated), [23-agent-first-design](23-agent-first-design.md)
(the doctrine this measures against).

## Why this document exists

A three-tier agent hierarchy circulates as a diagram: an **Architect** defines
the system plan, hands off to a **Tech Lead** who coordinates execution, who
hands off to a **Developer** who builds. A shared **AI Document** supports the
Developer's task. The human sits outside, giving in-loop feedback to the top two
tiers. The Developer analyses and responds back up to the Architect.

It is a good diagram. The question is what adopting it would mean here, and the
answer is not the one the diagram implies. Drive has already built most of it —
twice — and the part it has not built is not the part the diagram draws.

## Thesis

**The tiers already exist, as prompts. What the diagram actually asks for is
authority, and authority is the one thing a tier here cannot currently carry.**

Since [#146](https://github.com/hhalperin/cline-drivecode/pull/146) the
delegation *depth* invariant is real and enforced in a pure function. The
*authority* invariant is not: the operator-hierarchy rule is written, correct,
and called by nothing on the seat path. So adding a Tech Lead tier is cheap in
mechanism and expensive in meaning — it introduces a name the runtime cannot
enforce, which is the exact defect class
[23-agent-first-design](23-agent-first-design.md) names: *review used to
guarantee this; what guarantees it now?*

## The diagram, mapped onto the tip

Every edge in the diagram has an implementation today. This is not a proposal
section — it is an inventory.

| Diagram element | Implemented as | Location |
|---|---|---|
| *Handoff* | `MissionLogKind` includes `"handoff"` | `sdk/packages/shared/src/team/types.ts:33-35` |
| *Analyzes and responds to* | `TeamMailboxMessage` (`fromAgentId` → `toAgentId`) | `types.ts:53` |
| *Shares data* | `team_broadcast` | `sdk/packages/core/src/extensions/tools/team/team-tools.ts:692` |
| **AI Document** | `TeamOutcome` + `TeamOutcomeFragment` | `types.ts:120-145`, tools at `team-tools.ts:781-882` |
| *In-loop feedback* | Drive rooms, address sets, `planRoute` | `@cline/drive`, ADR-0012 |
| Architect / Developer | `TeamMemberSnapshot.role: "lead" \| "teammate"` | `types.ts:65-67` |
| **Tech Lead** | — | does not exist |

The "AI Document" deserves emphasis, because it is the least obvious match and
the closest one. `TeamOutcome` is a durable document with `requiredSections`,
a `draft` → `in_review` → `finalized` lifecycle, and per-section
`TeamOutcomeFragment`s that carry `sourceAgentId`, `status`
(`draft` / `reviewed` / `rejected`) and `reviewedBy`. Its default sections are
already architecture-shaped:

```ts
// sdk/packages/shared/src/team/schema.ts:9
export const DEFAULT_OUTCOME_REQUIRED_SECTIONS = [
	"current_state",
	"boundary_analysis",
	"interface_proposal",
];
```

That is a multi-agent design document with review gating, shipped. The diagram
draws it as a new box.

## What is missing is the middle, and the middle is not a type

`TeamMemberSnapshot.role` is a two-value union — `"lead" | "teammate"`. There is
no third tier. Adding one is a one-line union edit.

That one-line edit is also the whole problem, because role identity here is not
a type at all:

```ts
// sdk/packages/shared/src/team/types.ts:72-73
export interface TeammateLifecycleSpec {
	rolePrompt: string;
```

A teammate *is* its prompt. `buildTeammateSystemPrompt` interpolates it under a
`# Team Teammate Role` heading
(`sdk/packages/core/src/extensions/tools/team/subagent-prompts.ts`). Nothing
downstream branches on which role a member holds. A "Tech Lead" would be a
teammate whose prompt says it is a tech lead — which is available today, with no
code change, to anyone who writes that prompt.

Drive's own roster surface has the same shape with a different vocabulary. The
router's role enum is `["pair_partner", "specialist", "host", "other"]`
(`sdk/packages/shared/src/drive/router.ts:49`), and the only place any role
changes behaviour is a tie-break:

```ts
// sdk/packages/drive/src/router/planRoute.ts:36-38
if (agent.role === "pair_partner") {
	score += 0.1;
	reasons.push("role:pair_partner");
}
```

One tenth of one point, for one of four roles. That is the entire behavioural
weight of role in the routing path.

And there is a third vocabulary again: `call_join` accepts
`["partner", "specialist", "recorder"]`
(`sdk/packages/core/src/hub/server/handlers/drive-room-handlers.ts:74-90`).
Three disjoint role enums are live, none of which governs anything:

| Vocabulary | Values | Location |
|---|---|---|
| Team | `lead`, `teammate` | `sdk/packages/shared/src/team/types.ts:65-67` |
| Router | `pair_partner`, `specialist`, `host`, `other` | `sdk/packages/shared/src/drive/router.ts:49` |
| `call_join` | `partner`, `specialist`, `recorder` | `drive-room-handlers.ts:74-90` |

Adding a fourth vocabulary — which is what "add a Tech Lead tier" amounts to if
done casually — is the failure mode worth naming before it happens.

## Correction: ADR-0023's Finding 2 no longer describes the tip

ADR-0023 is still marked **Proposed (2026-08-02)** and states that chat-forks are
"capped in width and unbounded in generations", with "no depth counter, no
ancestry check and no cycle guard anywhere in the codebase."

**That is no longer true.** `c8d2e53` (*fix(drive): bound chat-fork recursion
generations*, [#146](https://github.com/hhalperin/cline-drivecode/pull/146))
added the guard:

```ts
// sdk/packages/drive/src/director/chatForkLifecycle.ts:12-16
/**
 * Default ceiling on fork generations: a worker may not cause workers.
 * ...
 */
export const DEFAULT_MAX_CHAT_FORK_DEPTH = 1;
```

and `assertForkLegal` enforces it, failing closed with a stable reason code:

```ts
// sdk/packages/drive/src/director/chatForkPolicy.ts:84-89
const depth = input.depth ?? 1;
const maxDepth = input.maxDepth ?? DEFAULT_MAX_CHAT_FORK_DEPTH;
if (depth > maxDepth) {
	// "depth_exceeded"
	// `Fork depth ${depth} exceeds max depth ${maxDepth}: a worker may not
	//  cause workers by default`
```

`depth` is documented as "generations from the nearest non-fork ancestor"
(`chatForkPolicy.ts:38-43`), and the hub tick threads it through
(`sdk/packages/core/src/hub/server/handlers/drive-fork-tick.ts:110,150-152`).

This is not read-the-source inference — the guard is covered at three levels,
and the suite passes on the tip (388/388 in `@cline/drive`, 2026-08-04):

| Level | Test |
|---|---|
| Refusal record | `sdk/packages/shared/src/drive/chatFork.test.ts:92-97` |
| Policy | `chatForkPolicy.test.ts:136-172` — including *"throws `depth_exceeded` and never returns a packet past the default depth"* and *"allows depth 2 when `maxDepth` is raised"* |
| Hub handler | `drive-fork-handlers.test.ts:426-476` — a second-generation fork is refused, and permitted only when `maxDepth` is raised |

The middle row matters for the diagram: raising `maxDepth` to 2 is already an
explicit, tested affordance. The tier question is therefore not "can depth 2
work" — it demonstrably can — but "should the default change, and what governs
the second generation once it does."

Two consequences. First, the urgent half of ADR-0023 is done and the ADR's prose
should be reconciled before anyone reads it as current. Second — and this is the
load-bearing point for the diagram — **the default is depth 1: a worker may not
cause workers.** A three-tier hierarchy in which the middle tier delegates is
depth 2. Adopting the diagram literally means raising `maxDepth`, which is a
governance decision with a default that was deliberately chosen, not an
incidental config bump.

## What is still unenforced: authority

ADR-0023's Finding 3 *does* still hold, and it is the real obstacle.

The operator-hierarchy rule — a child may never exceed its parent — exists as a
correct pure function:

```ts
// sdk/packages/drive/src/facets/expand.ts:21-26
/** Effective preset is the min of parent ceiling and child intent. */
export function capPreset(
	...
	const rank = Math.min(PRESET_RANK[parent], PRESET_RANK[child]);
```

`PermissionPreset` is `readonly | standard | full`
(`sdk/packages/shared/src/drive/room.ts:19`) and participants carry an optional
`capPreset` (`room.ts:110`). The wiring is the gap: `capPreset` and
`expandRosterPack` are imported by exactly one non-test consumer,
`sdk/packages/drive/src/harness.ts:346,370`. The live seat path —
`call_seat`, at
`sdk/packages/core/src/hub/server/handlers/drive-room-handlers.ts:967` —
never computes or stores a preset.

So a seated agent's declared role constrains nothing about what it may do.
`.driveagent/permissions.yaml` says as much in the shipped example: *"Intent
only. Hub policy owns enforcement."*

That is the honest state: **depth is governed, breadth of authority is not.**

## What this implies for the diagram

Three readings, in increasing order of cost.

1. **Adopt it as prompt convention.** Zero code. Write an Architect prompt, a
   Tech Lead prompt, a Developer prompt; use `team_create_outcome` for the AI
   Document and `team_send_message` for the response edge. This works today and
   is what the diagram mostly describes. It buys legibility, not enforcement.
2. **Adopt it as a typed tier.** Widen `TeamMemberSnapshot.role`, raise
   `maxDepth` to 2, and accept that the tier still governs nothing until
   `capPreset` reaches the seat path. This is the option that adds a name the
   runtime cannot enforce, and it is the one worth arguing about.
3. **Adopt it as authority.** Wire `capPreset` into `call_seat` so a delegating
   tier's children are capped by its own preset, then let depth follow. This is
   the version where "Tech Lead" means something, and it is ADR-0023's Finding 3
   plus ADR-0018's `WorkLease` — not a new mechanism, an unfinished one.

Reading 3 is the only one that survives the
[23-agent-first-design](23-agent-first-design.md) test. Readings 1 and 2 are
both defensible; they should just not be described as governance.

## Where this document is weak

- It treats "authority" as the interesting axis because ADR-0023 already framed
  it that way. A reader who thinks the diagram is really about *context
  isolation* — each tier seeing less — would find little here, and that reading
  is not obviously wrong.
- It asserts the team subsystem is unused by Drive's room surface on the strength
  of import graphs, not runtime tracing. The two vocabularies (`lead|teammate`
  vs `pair_partner|specialist|host|other`) coexisting is itself a finding this
  document does not resolve.
- No measurement. Whether three tiers produce better work than two is an
  empirical question and nothing here touches it.
