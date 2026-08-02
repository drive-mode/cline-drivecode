# Requirements · In-call stuck recovery

**DRV:** [DRV-STUCK-RECOVERY](../../features/DRV-STUCK-RECOVERY.md)  
**Related:** ADR-0008 §7, DRV-PLAN-IMPROVE (post-session), DRV-INTERRUPT, DRV-GATES, DRV-NOWNEXT, DRV-RECRUIT-STALL

## Problem

Mid-call task failure without a recovery path causes abandon. Post-session plan-improve is too late for this session’s retention.

## User job

When Now sticks, choose a clear recovery path without leaving Drive.

## Triggers

| Signal | Action |
|---|---|
| `recordTaskFailure` → `lastFailure` on open task | Offer recovery fork (W1 default) |
| Session stall classifier (low S2 + high P1/P2) | Optional auto-offer after Obs slice 2 |
| Raise-hand / gate deny | May open same fork; do not replace interrupt/gates |

## Surfaces

- Spotlight / stage: primary fork card
- Feed: narration of failure + proposal
- NowNext: updates after accept
- Accept queue: `kind: recovery` (or reuse planning kind)

## Proposal types

| Option | Accept → mutation |
|---|---|
| Narrow task | Edit now-task body and/or replace plan refs |
| Add fix-up | `createTask` + append to active plan; original keeps `lastFailure` |
| Recruit | Seat via hub ops (see DRV-RECRUIT-STALL); no bank write alone |
| Pause plan | **TBD** — default W1: Ask override + raise-hand stop (no new status yet) |

## Acceptance criteria

1. Failure leaves task open with `lastFailure`; never silent archive.
2. Fork options are gated; no auto bank mutation without accept (except documented in-band partner propose decision — see OQ).
3. Accept fix-up/narrow updates bank + NowNext from disk snapshot.
4. Reject/mute: no durable write; no silent identical re-offer without new intent.
5. Privacy: proposals use event/task/skill ids — no utterances.
6. Interrupt and steer remain available during recovery.

## Dependencies

- Hub `recordTaskFailure` / complete / bind ops (Obs slice 1 / bank gaps)
- DRV-NOWNEXT, DRV-STAGE/Spotlight, accept UI
- Soft: DRV-RECRUIT-STALL for recruit option

## Risks

- Approval fatigue if merged into high-impact gates without distinct lane
- Conflating with post-session DRV-PLAN-IMPROVE
- Pause-plan undefined → ship Ask override first

## Open questions

1. Auto vs manual-only offer?
2. Must every in-band fix-up gate, or may partner propose without gate?
3. Pause-plan = Ask, demote, archive, or new status?
