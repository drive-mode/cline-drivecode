# ARD-0015: Local task-session observability; tasks as satisfaction unit

## Status

Proposed

## Metadata

- Date: 2026-07-30
- Deciders: Drivecode planning (pending leadership accept)
- Related: PRD 10, research 15–16, ARD-0004, ARD-0008, DRV-CALL-SESSION, DRV-TASK-METRICS, DRV-PLAN-IMPROVE, DRV-PRIVACY

## Context

Drive’s execution primitive is the task bank (ARD-0008). Leadership wants to measure whether Drive sessions satisfy users — call duration, tasks completed, plan clean-drain vs mid-plan churn, and post-success engagement — and to **act** when tasks do not complete (diagnose logs → propose better planning → gated accept).

Existing [prd-success-metrics](../prd/prd-success-metrics.md) covers phase gates and privacy CI, and explicitly forbids phone-home Drive telemetry in MVP. Bank event schemas exist but production emission and call-session correlation are incomplete. A “task model” metaphor (tasks ≈ tokens) risks becoming a second runtime or a retention excuse if unbounded.

## Decision

1. **Satisfaction unit is the task.** Session success metrics are defined primarily over `DriveTask` / `DrivePlan` lifecycle correlated with call presence — not tokens, not utterance sentiment.
2. **Observability is local-first.** MVP session rollups derive from room + bank event logs on the local hub/workspace. No default phone-home of Drive session metrics. Opt-in export inherits DRV-PRIVACY.
3. **Call sessions bind the stream.** Introduce `callSessionId` (or equivalent join-scoped id) so join/leave duration and bank completions correlate. Bank store uses real `roomId` when opened from a room.
4. **Complete the bank event spine** before trusting dashboards: emit opened / bound / completed / archived / plan activated / plan archived / plan-ref changed on the hub path.
5. **Intent without a Goal type.** `DrivePlan.title` (+ task ids) is session intent. Do not add a parallel Goal entity for metrics MVP.
6. **Engagement is signed.** Mid-plan adds after activate are **churn** (plan quality). Plan edits / new goals **after successful completions** are **positive engagement**.
7. **Closed-loop improvement is gated.** Stall diagnosis uses structured event ids / paths / skill ids only. Proposals (planning skills, plan templates, fix-up tasks) follow propose → accept | reject | mute (ARD-0004). No auto transcript→knowledge; no silent plan rewrite by a model.
8. **Next-task truth stays deterministic.** `BankSnapshot` cursor is authoritative. Learned next-task scorers, if any, are proposers only and must not become sole writers (see drivecode-sdk next-task proposer note).
9. **Separation from phase-gate PRD.** Keep PRD success-metrics for CI/smoke; PRD 10 owns session satisfaction. Cross-link, do not merge.

## Consequences

**Positive**

- Retention-relevant metrics grounded in shipped primitives.
- Privacy spine preserved while enabling diagnose→improve.
- Clear doctrine: measure Drive in tasks; keep harness from becoming an ML runtime.

**Negative**

- Instrumentation debt must land before dashboards are honest.
- Dual metric docs (phase gates vs session) need index discipline.
- Gated improve UX is another accept queue unless unified with learn.

## Alternatives considered

- **Phone-home PostHog Drive funnels** — Rejected for MVP; contradicts DRV-PRIVACY and prd-success-metrics non-goals.
- **Transcript-based satisfaction / sentiment** — Rejected; forbidden retention surface.
- **First-class Goal object** — Deferred; plan.title suffices for intent mapping.
- **Learned cursor as product truth** — Rejected; un-auditable Now/Next; second runtime risk.
- **Fold into prd-success-metrics only** — Rejected; different audience (gates vs session health).

## References

- [PRD 10](../prd/prd-task-satisfaction-observability.md)
- [research/15](../research/15-task-satisfaction-observability.md), [research/16](../research/16-task-as-unit-models.md)
- [ARD-0004](ARD-0004-gated-learn-privacy.md), [ARD-0008](ARD-0008-task-bank.md)
- [leadership/BRIEF-task-satisfaction.md](../leadership/BRIEF-task-satisfaction.md)
- [delivery/REMAINING-task-satisfaction.md](../delivery/REMAINING-task-satisfaction.md) — living implementation backlog after W0 kernel
