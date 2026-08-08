# ADR-0027 · A role tier is a permission ceiling, or it is a prompt

**Status:** Accepted (2026-08-08) — binding guard  
**Impl:** decision — no third tier until live `capPreset` on `call_seat`  
**Owner:** Drivecode SE lead  
**Cluster:** Spawn & role authority — with [ADR-0023](ADR-0023-agent-spawn-governance.md)
and [ADR-0025](ADR-0025-enforced-authority.md).  
**Constrained by:** [ADR-0025](ADR-0025-enforced-authority.md) (**governing
rule** — a declared limit with no enforcement-path consumer is a defect class;
`capPreset` is its instance #1, carried as delivery task D1),
[ADR-0023](ADR-0023-agent-spawn-governance.md) (spawn governance; Finding 2
reconciled),
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

- The handoff edge is `MissionLogKind`'s `"handoff"`.
- The response edge is `TeamMailboxMessage`.
- The shared design document is `TeamOutcome` + `TeamOutcomeFragment`
  (`draft` → `in_review` → `finalized`).

What is absent is the middle tier. Adding it is a one-line union edit. That
cheapness is the trap this record exists to name.

Three findings shape the decision.

**1. Role identity is a prompt, not a type.** `TeammateLifecycleSpec.rolePrompt`
is a `string`; nothing downstream branches on it. In Drive's router, the only
role that changes behaviour changes it by one tenth of a point (`pair_partner`).

**2. Depth is governed** — ADR-0023 Finding 2 is reconciled: #146 shipped
`DEFAULT_MAX_CHAT_FORK_DEPTH = 1` / `depth_exceeded`. A middle tier that
delegates is depth 2 by definition.

**3. Authority is still not governed on the live seat path** — ADR-0023 Finding 3
holds. `capPreset` has no non-test consumer on `call_seat`.

## Decision

**1. A role tier may be introduced only together with an enforcement path —
which, today, means it waits on delivery D1.**

No third value is added to `TeamMemberSnapshot.role`, and no role-tier
vocabulary is extended, until `capPreset` is called on the live seat path and
persisted on the participant. A tier whose only guarantee is "the prompt says
so" ships as a prompt, not as a permission.

**2. Prompt-level hierarchy is explicitly endorsed, and explicitly not
governance.**

Architect / Tech Lead / Developer as `rolePrompt` values work today. Product
surfaces must not describe them as a permission boundary.

**3. `DEFAULT_MAX_CHAT_FORK_DEPTH` stays 1.**

Raising it is a separate decision that must come *after* clause 1.

**4. ADR-0023 is reconciled** (Finding 2 amended; record Accepted 2026-08-08).
This record's clause 3 remains the operative statement on *raising* depth.

**5. The three role vocabularies are a known defect, not a decision.**

| Vocabulary | Values | Location |
|---|---|---|
| Team | `lead`, `teammate` | `sdk/packages/shared/src/team/types.ts` |
| Router | `pair_partner`, `specialist`, `host`, `other` | `sdk/packages/shared/src/drive/router.ts` |
| `call_join` | `partner`, `specialist`, `recorder` | drive-room-handlers |

Converging them is out of scope here. Naming them prevents a fourth from being
added under the impression that a role vocabulary is missing.

## Consequences

**Positive**

- Teams get hierarchy as prompts immediately, without fake enforcement claims.
- Clause 1 turns "roles carry no authority" into a named call-site unit of work.

**Negative**

- Typed three-tier feature stays blocked on a different subsystem.
- Clause 5 documents inconsistency without fixing it.

**Dependencies**

- Downstream of **Accepted** [ADR-0025](ADR-0025-enforced-authority.md).
- Blocked on delivery task D1 in
  [defaults-delivery.md](../delivery/defaults-delivery.md).
- D2 ("consult vs delegate as gate classes") already depends on D1 — ordering
  matches the existing graph.

## Alternatives considered

- **Add the third tier now, wire authority later.** Rejected (ADR-0025 defect class).
- **Reject the hierarchy outright.** Rejected — prompt-level version is useful.
- **Fold role into `WorkLease` and drop member roles entirely.** Larger; own ADR
  if pursued.
