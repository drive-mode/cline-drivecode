# ADR-0027 · A role tier is a permission ceiling, or it is a prompt

**Status:** Proposed (2026-08-04)
**Owner:** Drivecode SE lead
**Constrained by:** [ADR-0025](ADR-0025-enforced-authority.md) (**governing
rule** — a declared limit with no enforcement-path consumer is a defect class;
`capPreset` is its instance #1, carried as delivery task D1),
[ADR-0023](ADR-0023-agent-spawn-governance.md) (spawn governance — see the
reconciliation clause below),
[ADR-0018](ADR-0018-agent-runtime-contract.md) (capability-scoped `WorkLease`),
[ADR-0012](ADR-0012-agent-router.md) (the router does not seat or spawn),
[ADR-0003](ADR-0003-recruit-and-roster-pack.md) (recruit ranks; packs stay
curated).
**Detail:** [research/25](../research/25-role-tiers-and-delegation.md).

> **Scope note.** [ADR-0025](ADR-0025-enforced-authority.md) already decides the
> general rule this record leans on, and already names `capPreset` as an
> unenforced declaration. This record does **not** restate that rule. It decides
> the narrower question ADR-0025 does not reach: *given* that rule, may a third
> role tier be added, and what happens to delegation depth.

## Context

A three-tier delegation hierarchy — Architect → Tech Lead → Developer, with a
shared design document and a human giving in-loop feedback — is a recurring ask.
[research/25](../research/25-role-tiers-and-delegation.md) audited it against the
tip and found the mechanism almost entirely present:

- The handoff edge is `MissionLogKind`'s `"handoff"`
  (`sdk/packages/shared/src/team/types.ts:33-35`).
- The response edge is `TeamMailboxMessage` (`types.ts:53`).
- The shared design document is `TeamOutcome` + `TeamOutcomeFragment`
  (`types.ts:120-145`) — `draft` → `in_review` → `finalized`, with
  `requiredSections` defaulting to `current_state`, `boundary_analysis`,
  `interface_proposal` (`schema.ts:9`).

What is absent is the middle tier. Adding it is a one-line union edit
(`TeamMemberSnapshot.role`, `types.ts:65-67`). That cheapness is the trap this
record exists to name.

Three findings shape the decision.

**1. Role identity is a prompt, not a type.** `TeammateLifecycleSpec.rolePrompt`
is a `string` (`types.ts:72-73`); nothing downstream branches on it. In Drive's
router, the only role that changes behaviour changes it by one tenth of a point:

```ts
// sdk/packages/drive/src/router/planRoute.ts:36-38
if (agent.role === "pair_partner") {
	score += 0.1;
```

**2. Depth is already governed — ADR-0023's Finding 2 is stale.** `c8d2e53`
([#146](https://github.com/hhalperin/cline-drivecode/pull/146)) added
`DEFAULT_MAX_CHAT_FORK_DEPTH = 1`
(`sdk/packages/drive/src/director/chatForkLifecycle.ts:16`), enforced in
`assertForkLegal` with a `depth_exceeded` reason
(`sdk/packages/drive/src/director/chatForkPolicy.ts:84-89`). The default is
deliberate: *a worker may not cause workers.* A middle tier that delegates is
depth 2 by definition.

**3. Authority is still not governed — ADR-0023's Finding 3 holds.** The
operator-hierarchy rule is written and correct:

```ts
// sdk/packages/drive/src/facets/expand.ts:21-26
/** Effective preset is the min of parent ceiling and child intent. */
export function capPreset(
	const rank = Math.min(PRESET_RANK[parent], PRESET_RANK[child]);
```

Its only non-test consumer is `sdk/packages/drive/src/harness.ts:346,370`. The
live seat path — `call_seat`,
`sdk/packages/core/src/hub/server/handlers/drive-room-handlers.ts:967` — never
computes or stores a preset. A seated agent's role constrains nothing.

## Decision

**1. A role tier may be introduced only together with an enforcement path —
which, today, means it waits on D1.**

This is [ADR-0025](ADR-0025-enforced-authority.md)'s rule applied to role tiers,
not a new rule. Concretely: no third value is added to
`TeamMemberSnapshot.role`, and no role-tier vocabulary is extended, until
`capPreset` is called on the live seat path and persisted on the participant
(`sdk/packages/shared/src/drive/room.ts:110` already carries the field). That is
ADR-0025's instance #1 and
[defaults-delivery.md](../delivery/defaults-delivery.md)'s **task D1** — already
scoped, already owned. This record adds only the consequence: **a new tier is
blocked on D1 rather than proceeding in parallel with it.**

The test a proposed tier must pass is
[23-agent-first-design](../research/23-agent-first-design.md)'s: *review used to
guarantee this; what guarantees it now?* A tier whose answer is "the prompt says
so" is a prompt, and should ship as one.

**2. Prompt-level hierarchy is explicitly endorsed, and explicitly not
governance.**

Architect / Tech Lead / Developer as `rolePrompt` values, coordinating through
`team_create_outcome`, `team_send_message` and `team_mission_log`, works today
with no code change. Teams wanting the diagram should use it. Product surfaces
and docs must not describe it as a permission boundary, because it is not one.

**3. `DEFAULT_MAX_CHAT_FORK_DEPTH` stays 1.**

Raising it is a separate decision that must come *after* clause 1, not
alongside it. Delegation depth without an authority ceiling widens blast radius
with nothing to bound it — the failure mode ADR-0023 was opened to prevent, in
the one dimension that is still open.

**4. ADR-0023 must be reconciled before it is cited again.**

Its Finding 2 describes a codebase that no longer exists. It should be amended
to record that #146 closed the depth gap, keeping Findings 1 and 3, and either
accepted or withdrawn. Until then this record's clause 3 is the operative
statement on depth.

**5. The three role vocabularies are a known defect, not a decision.**

Three disjoint enums are live today:

| Vocabulary | Values | Location |
|---|---|---|
| Team | `lead`, `teammate` | `sdk/packages/shared/src/team/types.ts:65-67` |
| Router | `pair_partner`, `specialist`, `host`, `other` | `sdk/packages/shared/src/drive/router.ts:49` |
| `call_join` | `partner`, `specialist`, `recorder` | `drive-room-handlers.ts:74-90` |

Converging them is out of scope here. Naming them prevents a fourth from being
added under the impression that a role vocabulary is missing.

## Consequences

**Positive**

- The cheap change stays cheap and stays honest: teams get the hierarchy as
  prompts immediately, without the product claiming enforcement it lacks.
- Clause 1 turns an abstract complaint ("roles carry no authority") into a
  concrete, small, testable unit of work at a named call site.
- Clause 4 stops a stale ADR from being cited as current — the specific way this
  planning nest has previously drifted.

**Negative**

- Anyone wanting the three-tier diagram as a *typed* feature is told no, and the
  reason is work in a different subsystem than the one they asked about.
- Clause 5 documents an inconsistency without fixing it, which is a debt marker
  that can rot in turn.

**Dependencies, stated plainly**

- Clause 1 is **downstream of [ADR-0025](ADR-0025-enforced-authority.md)**, which
  is still **Proposed**. If ADR-0025 is rejected, clause 1 should be re-argued on
  ADR-0018's `WorkLease` grounds rather than assumed.
- Clause 1 is **blocked on delivery task D1**
  ([defaults-delivery.md](../delivery/defaults-delivery.md):80), described there
  as "the cheapest structural win in this entire plan". This record does not
  re-scope D1; it only states that a role tier waits for it. Note D2
  ("consult vs delegate as gate classes") already depends on D1, so the ordering
  here matches the existing graph rather than adding a constraint to it.
- The code claims in Context were verified against the tip (`c4bd276`) on
  2026-08-04, not taken from the ADRs that assert them — which is how the stale
  Finding 2 in clause 4 was caught.

## Alternatives considered

- **Add the third tier now, wire authority later.** Rejected: it ships a name the
  runtime cannot enforce, which is the defect class
  [research/23](../research/23-agent-first-design.md) exists to name. "Later"
  has, for `capPreset`, already been several releases.
- **Reject the hierarchy outright.** Rejected as overreach — the prompt-level
  version is useful, costs nothing, and is already reachable. Forbidding it would
  be unenforceable anyway.
- **Fold role into `WorkLease` and drop member roles entirely.** Attractive and
  larger than this record. It would supersede parts of ADR-0012 and ADR-0003 and
  deserves its own ADR if pursued.
