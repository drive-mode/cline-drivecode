# ADR-0034 · Converge role vocabularies (after live capPreset)

**Status:** Proposed (2026-08-08) — **blocked on delivery D1**  
**Owner:** Drivecode SE lead  
**Constrained by:** [ADR-0027](ADR-0027-role-tiers.md),
[ADR-0025](ADR-0025-enforced-authority.md),
[ADR-0023](ADR-0023-agent-spawn-governance.md),
[ADR-0012](ADR-0012-agent-router.md).

## Context

ADR-0027 names three live role enums as debt, not a decision:

| Vocabulary | Values |
|---|---|
| Team | `lead`, `teammate` |
| Router | `pair_partner`, `specialist`, `host`, `other` |
| `call_join` | `partner`, `specialist`, `recorder` |

Agents and UIs pick whichever enum is nearby. Converging before
`capPreset` is on the live seat path would ship another unenforced vocabulary
(ADR-0025 / 0027).

## Decision

1. **No convergence until delivery D1** — `capPreset` on `call_seat` and
   persisted on the participant (ADR-0027 clause 1).
2. **Target shape (when unblocked):** one **seat role** enum on the room
   participant (Drive) plus optional `rolePrompt` string for hierarchy theatre.
   Team package roles map to seat role at the boundary; router scores read seat
   role (or a pure projection), not a third enum.
3. **Migration:** deprecate writes to the redundant enums; read paths accept
   old values until one release boundary; lint/CI forbids new write sites.
4. **Still not a tier system.** Architect / Tech Lead / Developer remain
   `rolePrompt` until a separate Accepted change adds enforced tiers.

## Non-goals

- Adding a fourth vocabulary “to unify later.”
- Typed three-tier permissions in this ADR.

## Open

1. Exact unified enum members (names) — pick when D1 lands with real seat UX.
2. Whether `recorder` survives as a seat role or becomes a pack/capability tag.

## Alternatives rejected

- Converge now with string aliases only — still three write paths.
- Drop member roles entirely for `WorkLease` — larger than this record; own ADR.
