# ADR-0023 · Agent spawn governance

**Status:** Proposed (2026-08-02)
**Owner:** Drivecode SE lead
**Constrained by:** [ADR-0003](ADR-0003-recruit-and-roster-pack.md) (recruit
ranks, packs stay curated), [ADR-0012](ADR-0012-agent-router.md) (the router
does not seat or spawn), [ADR-0014](ADR-0014-chat-fork-lifecycle.md)
(chat-fork lifecycle), [ADR-0018](ADR-0018-agent-runtime-contract.md)
(capability-scoped `WorkLease`, follow-on).
**Prior art:** [DRV-TEAM-OPT](../features/DRV-TEAM-OPT.md).
**Companions:** [ADR-0022](ADR-0022-agent-economics.md),
[research/21](../research/21-operator-experience.md).

## Context

The question this answers: *can a user set strict rules for which agents their
agents may bring in — for example, letting Cline consult a security advisory
team — and can a spawned agent itself spawn?*

Investigating produced two findings that point in opposite directions.

### Finding 1 — agents cannot seat agents, so the capability must be built

`call_seat` is reached from exactly one place in product code: a webview click
handler (`Chat.tsx:455-470`). Recruit only *ranks*; it never writes
participants, exactly as ADR-0003 requires. There is **no agent-facing seat
op**. So agent-to-agent teaming does not exist and the limits can be designed
in from the start rather than retrofitted.

### Finding 2 — agents already cause forks, unboundedly deep

This is the urgent half, and it is live on `main` today.

Every completed or failed tool event on any session posts `call_record_work`
(`apps/cline-hub/src/server/agent-events.ts:52,176`), whose handler fires
`runChatForkDirectorTick` best-effort
(`drive-room-handlers.ts:868-873`). The tick claims forks **itself**
(`drive-fork-tick.ts:60-78`). No human click, no agent tool call, no approval
gate — a fork is a side effect of doing work.

Worker sessions are room-linked (`drive-fork-handlers.ts:229`), so **their**
tool events flow back through the same path with `parentSessionId` set to the
worker. The non-fork parent filter (`drive-fork-tick.ts:36-41`) is a fallback
that is bypassed when `parentSessionId` is supplied.

**There is no depth counter, no ancestry check and no cycle guard anywhere in
the codebase.** The only brakes are `DEFAULT_MAX_CONCURRENT_CHAT_FORKS = 2`
(`chatForkLifecycle.ts:9`) and per-Do-item dedupe. Both are room-global, so
recursion is **capped in width and unbounded in generations**.

`assertForkLegal` (`chatForkPolicy.ts:59-135`) is the only spawn gate and it
checks legality of the *work item* — claim reason, Do status, path
disjointness. It says nothing about who spawned, or how deep.

### Finding 3 — the governance primitive exists and is unwired

`PermissionPreset = readonly | standard | full`
(`facets/rosterPack.ts:10`) and `capPreset = min(parent, child)`
(`expand.ts:22-28`) already implement the operator-hierarchy rule — a child
can never exceed its parent — as a pure function. It is wired only into the
unused harness path. `call_seat` hardcodes `seatSources:[{kind:"manual"}]`
and no preset (`drive-room-handlers.ts:915-922`).

`.driveagent/permissions.yaml` is **self-declared intent**, and says so in the
shipped example: *"Intent only. Hub policy owns enforcement."* Roles
(`partner | specialist | recorder`) are labels; the only behavioural use is a
`+0.1` routing score. All agents are equal in code.

DRV-TEAM-OPT already designed the spawn side — partner-requested specialist,
`seatSources:{kind:"spawn",parentId}`, capability preset never exceeding the
partner's, cascade dismiss. **Cascade dismiss is built**
(`room/seatSources.ts:111-170`); the spawn side is not.

## Decision

**1. Bound fork generations now, independently of anything else here.**

Unbounded generations is a live defect, not a missing feature. A fork carries
its ancestry; `assertForkLegal` gains a depth and cycle check; the default
depth is small (1 — a worker may not cause workers) and configurable upward.
This ships before any new capability, because it is the hole that exists.

**2. Distinguish *consulting* from *delegating*. This is the core of the
design.**

The two things the question conflates have very different risk:

| | Consult | Delegate |
|---|---|---|
| Returns | an opinion | committed work |
| Writes | nothing | files, tasks, PRs |
| Preset | `readonly`, always | up to the parent's, never above |
| Depth | terminal — a consultant may not spawn | may spawn, within depth |
| Default | allowed to a declared advisory pack | requires explicit grant |

"Cline consults the security advisory team" is a **consult**: it is
read-only, bounded, terminal, and cheap to allow. Letting an agent hand real
work to another agent is a **delegate**, and deserves a gate. Collapsing them
into one "can spawn" permission would either block the useful case or permit
the dangerous one.

**3. An advisory team is a RosterPack, not a new concept.**

ADR-0003 keeps packs curated. A "security advisory team" is a curated pack
with `readonly` preset. This reuses `expandRosterPack` and the existing
`capPreset` min-rule rather than inventing a parallel grouping.

**4. Enforcement is hub-side; `.driveagent/` stays intent.**

The shipped example already states this. An agent home declares what it *wants*
(`presetIntent`, and now which packs it may consult); the hub decides. A
self-declared permission that the hub honours is not a permission.

**5. Spawn and seat become gate classes under DRV-GATES.**

`gates.ts` is a taxonomy today with no spawn class. Delegation is exactly the
kind of consequential action the gate taxonomy exists for, so it belongs there
rather than in a bespoke approval path.

**6. Every spawned agent is attributable and cascade-dismissible.**

`seatSources:{kind:"spawn",parentId}` per DRV-TEAM-OPT, so the roster can
always answer "who brought this agent in", and dismissing a parent removes its
children — which already works.

## What a user gets

- A rule like *"Cline may consult `security-advisory`, may not delegate"* —
  expressible, and enforced by the hub.
- A guarantee no configuration can violate: **a child never exceeds its
  parent's preset**, because the min-rule is applied at expansion.
- A bounded blast radius: depth-limited generations, width already capped at 2
  concurrent forks.
- A roster that shows provenance rather than a flat list of agents that
  appeared.

## Consequences

- Fork depth-limiting may **suppress work that happens today**. Any change to
  when forks fire needs to be visible, or it will read as the agent going
  quiet — which is precisely the dead-air problem in
  [research/21](../research/21-operator-experience.md).
- Enforcing presets makes previously-inert config load-bearing. Anything
  relying on the current "all agents equal" behaviour changes.
- Consult still costs tokens. Cheap in risk is not free in spend — this needs
  [ADR-0022](ADR-0022-agent-economics.md)'s per-participant accounting, or a
  consult becomes an invisible budget leak.
- ADR-0014's "invisible auditable workers" is in **direct tension** with this.
  The user is asking for visibility and control over spawning; ADR-0014
  deliberately hides forks. Both can hold — invisible by default, inspectable
  and governable on demand — but the tension should be named, not smoothed
  over.

## Alternatives rejected

- **One "can spawn" boolean.** Collapses consult and delegate, so it either
  blocks the advisory case or permits unattended delegation.
- **Enforce `.driveagent/permissions.yaml` directly.** Self-declared
  permission is not permission; a compromised or careless agent home would
  grant itself anything.
- **Per-agent ACLs of which agents may seat which.** Correct and unusable —
  n² rules a human will not maintain. Presets plus packs get most of the value.
- **Leave fork depth unbounded and rely on the width cap.** Width caps
  concurrency, not generations; a chain of depth-1 forks still runs forever.

## Open

1. **Default fork depth.** 1 (workers may not cause workers) is the safe
   default and may suppress legitimate cascades. Needs a real-workload check.
2. **Does a consult get its own context, or see the room?** Cheaper and safer
   isolated; less useful.
3. **Whether delegation needs approval per spawn, per session, or per pack.**
   Per spawn is safest and most annoying.
4. **Whether an agent may consult a pack the human has never seen.** Argues
   for packs being explicitly granted per room rather than globally available.
