# Requirements · SDLC guidance → bankable tasks

**Amends:** [DRV-SDLC-GUIDE](../../features/DRV-SDLC-GUIDE.md)  
**Related:** Group I W-40–W-45, DRV-TASK-BANK, PRD 10 R5

## Problem

Junior-builder / SDLC sessions can “succeed” in chat/stage while producing **zero** bank events — satisfaction metrics then falsely look like failure, and Agent posture has nothing to bind.

## User job

Finish a guided discovery/decision path with a frozen first slice that becomes real `DriveTask`s on an active plan.

## Triggers

- Group I phrases / SDLC mode (W-40–W-44)
- Escape hatch “just build X” → normal work loop (W-08)
- Offer-once when stuck without a problem statement

## Required landing

| Guidance artifact | Bank landing |
|---|---|
| Phase-entry / first verifiable slice | ≥1 `DriveTask` + plan refs |
| Follow-on Musts (optional) | Additional tasks or one epic — document choice |
| Decision / MoSCoW | Plan title / body context; not a substitute for tasks |

Default: proposals into Plan posture **accept** (same gate family), not silent writes. Session-tier stage cards alone are insufficient for S2 credit.

## Acceptance criteria

1. Happy path W-40→W-44 ends with accept path that creates bank tasks + active plan refs.
2. After accept, Agent posture can bind `nowTaskId`.
3. S2/S3 can credit the session when those tasks complete/drain.
4. Escape hatch skips bureaucracy.
5. No transcript→knowledge; privacy-strict.
6. Instant Join not blocked by forced MoSCoW wall.

## Dependencies

- DRV-SDLC-GUIDE skills, DRV-TASK-BANK, PlanEditor / accept UI
- Soft: DRV-CLEAN-DRAIN for post-slice continue

## Risks

- Guidance stays stage-only → false unsuccessful sessions
- Lecture fatigue vs Instant Join
- Over-splitting Musts into tiny tasks (gaming)

## Open questions

1. Auto-create tasks on freeze vs always Plan accept?
2. MoSCoW Musts → 1:1 tasks or one epic?
3. Are guidance stage cards excluded from S* (yes — bank only)?
