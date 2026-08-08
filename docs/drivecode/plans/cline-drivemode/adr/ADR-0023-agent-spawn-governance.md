# ADR-0023 · Agent spawn governance

**Status:** Accepted (2026-08-08) — body reconciled with tip  
**Impl:** partial — fork **depth** shipped (#146); consult/delegate seat path and
gate classes still open  
**Owner:** Drivecode SE lead  
**Cluster:** Spawn & role authority — with [ADR-0025](ADR-0025-enforced-authority.md)
(meta-rule) and [ADR-0027](ADR-0027-role-tiers.md) (tier ceiling guard).  
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

### Finding 1 — agents cannot seat agents, so the capability must be built

`call_seat` is reached from product UI (webview click handlers). Recruit only
*ranks*; it never writes participants, exactly as ADR-0003 requires. There is
**no agent-facing seat op**. So agent-to-agent teaming does not exist and the
limits can be designed in from the start rather than retrofitted.

### Finding 2 — fork depth is bounded (was unbounded; closed by #146)

**Historical defect (pre-#146):** every completed or failed tool event posted
`call_record_work`, whose handler fired `runChatForkDirectorTick` best-effort.
Worker sessions are room-linked, so their tool events re-entered the same path.
Width was capped (`DEFAULT_MAX_CONCURRENT_CHAT_FORKS = 2`); generations were not.

**Current tip:** `c8d2e53` ([#146](https://github.com/hhalperin/cline-drivecode/pull/146))
added `DEFAULT_MAX_CHAT_FORK_DEPTH = 1`
(`sdk/packages/drive/src/director/chatForkLifecycle.ts`), enforced in
`assertForkLegal` as `depth_exceeded`
(`sdk/packages/drive/src/director/chatForkPolicy.ts`). Default: *a worker may
not cause workers.* Raising depth is a separate decision (see ADR-0027 clause 3).

**Still true:** forks remain an implicit side effect of work (director tick),
not an explicit agent “spawn” tool. Governance of *who may seat whom* is still
open (Findings 1 and 3).

### Finding 3 — the governance primitive exists and is unwired

`PermissionPreset = readonly | standard | full` and
`capPreset = min(parent, child)` already implement the operator-hierarchy rule
as a pure function. It is wired only into the harness path, not the live
`call_seat` path. `.driveagent/permissions.yaml` remains **self-declared
intent**; hub policy owns enforcement.

DRV-TEAM-OPT already designed the spawn side — partner-requested specialist,
`seatSources:{kind:"spawn",parentId}`, capability preset never exceeding the
partner's, cascade dismiss. **Cascade dismiss is built**; the spawn side is not.

## Decision

**1. Bound fork generations (shipped).** Default depth 1; configurable upward
only after authority ceilings are live (ADR-0027). Clause kept for history and
as the acceptance criterion for the depth guard.

**2. Distinguish *consulting* from *delegating*. This is the core of the
design.**

| | Consult | Delegate |
|---|---|---|
| Returns | an opinion | committed work |
| Writes | nothing | files, tasks, PRs |
| Preset | `readonly`, always | up to the parent's, never above |
| Depth | terminal — a consultant may not spawn | may spawn, within depth |
| Default | allowed to a declared advisory pack | requires explicit grant |

"Cline consults the security advisory team" is a **consult**. Handing real
work to another agent is a **delegate**. Collapsing them into one "can spawn"
permission would either block the useful case or permit the dangerous one.

**3. An advisory team is a RosterPack, not a new concept.**

ADR-0003 keeps packs curated. A "security advisory team" is a curated pack
with `readonly` preset. Reuse `expandRosterPack` and `capPreset`.

**4. Enforcement is hub-side; `.driveagent/` stays intent.**

An agent home declares what it *wants*; the hub decides.

**5. Spawn and seat become gate classes under DRV-GATES.**

Delegation belongs in the gate taxonomy rather than a bespoke approval path.

**6. Every spawned agent is attributable and cascade-dismissible.**

`seatSources:{kind:"spawn",parentId}` per DRV-TEAM-OPT.

## What a user gets

- A rule like *"Cline may consult `security-advisory`, may not delegate"* —
  expressible, and enforced by the hub (when seat path lands).
- A guarantee no configuration can violate: **a child never exceeds its
  parent's preset**, because the min-rule is applied at expansion.
- A bounded blast radius: depth-limited generations (shipped), width capped.
- A roster that shows provenance rather than a flat list of agents that
  appeared.

## Consequences

- Depth limiting may suppress cascades that looked useful under unbounded
  generations — visible as quieter agents ([research/21](../research/21-operator-experience.md)).
- Enforcing presets makes previously-inert config load-bearing.
- Consult still costs tokens — needs [ADR-0022](ADR-0022-agent-economics.md).
- ADR-0014's "invisible auditable workers" stays: invisible by default,
  inspectable and governable on demand.

## Alternatives rejected

- **One "can spawn" boolean.** Collapses consult and delegate.
- **Enforce `.driveagent/permissions.yaml` directly.** Self-declared
  permission is not permission.
- **Per-agent ACLs of which agents may seat which.** Correct and unusable.
- **Leave fork depth unbounded and rely on the width cap.** Closed by #146;
  width ≠ generations.

## Open

1. **Whether to raise default fork depth** after `capPreset` is on the live
   seat path (blocked on ADR-0027 / delivery D1).
2. **Does a consult get its own context, or see the room?**
3. **Whether delegation needs approval per spawn, per session, or per pack.**
4. **Whether an agent may consult a pack the human has never seen.**
