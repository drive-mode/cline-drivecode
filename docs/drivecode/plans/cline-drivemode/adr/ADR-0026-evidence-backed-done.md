# ADR-0026 · Evidence-backed Done needs a refusal path

**Status:** Accepted (2026-08-03)
**Owner:** Drivecode SE lead
**Constrained by:** [ADR-0025](ADR-0025-enforced-authority.md) (declared
authority without a refusal consumer is a defect class — **runtime twin** of
this record),
[ADR-0020](ADR-0020-session-delivery-cicd.md) (delivery CI shape),
[ADR-0000](ADR-0000-status-board.md) (Accepted ≠ shipped).  
**Twin:** [ADR-0025](ADR-0025-enforced-authority.md) (runtime authority refusal).
**Evidence:** how Critique of planning+Done+CI (2026-08-03); PR burst
#147/#156/#169, #138→#160, #171, #172, #186/#187.
**Companions:** [claims-registry.yaml](../delivery/claims-registry.yaml),
[PLAN-backlog-reconciliation.md](../delivery/PLAN-backlog-reconciliation.md),
`sdk/scripts/check-drivecode-done.ts`.

## Context

Drive delivery had three unjoined planes: prose Done claims, agent package
verify, and path-filtered CI. Nothing could refuse a Done claim that lacked
wiring or acceptance evidence. That is the same defect class ADR-0025 names
for runtime authority.

## Decision

1. **Claims registry** at `delivery/claims-registry.yaml` is the source of
   truth for selectable delivery status (`scaffold` | `active_partial` |
   `verified_shipped` | `blocked` | `planned`).
2. **Cold-start surfaces** (`HANDOFF.md`, `plans/cline-drivemode/README.md`)
   must cite `claim:<id>` next to `**Shipped**` / `**Landed**` / `**Partial**`
   (and related adjectives). Bare status words fail
   `bun run check:drivecode-docs`.
3. **`verified_shipped`** requires at least one evidence entry whose `path`
   exists on tip and whose `command` is non-empty.
4. **`BACKLOG.md`** may render the registry later. Markdown alone is not SoT.
5. **Fix-class matrices** for bugfixes and stack-safe docs/sdk CI land in
   follow-on PRs in this initiative. ADR-0025 E1 shares the same refusal
   pattern on the runtime side.

## Consequences

False Shipped/Landed on cold-start docs fails CI locally via
`check:drivecode-docs`. Agents pick/advance claims from the registry (see
AGENT-RUNBOOK updates in the stack). Historical TASK-GRAPH remains phase
contract, not the Done ledger.

## Status

**Accepted.** Impl: `partial` — registry + done checker, stack-safe docs/sdk CI,
runbook/PR claim contracts, and ADR-0025 E1 L1 consumer are on tip of this
stack. Remaining: full Finding 1 consumer matrix, BACKLOG render, consumer-path
grep v2.
