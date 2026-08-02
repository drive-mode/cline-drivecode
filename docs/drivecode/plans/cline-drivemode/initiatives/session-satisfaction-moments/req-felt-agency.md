# Requirements · Felt agency

**DRV:** [DRV-FELT-AGENCY](../../features/DRV-FELT-AGENCY.md)  
**Related:** DRV-STEER-QUEUE, DRV-INTERRUPT, DRV-NOWNEXT, PlanEditor, ADR-0015 §6

## Problem

North star includes “control over the plan,” but steer/interrupt/plan edit often leave NowNext/Spotlight visually unchanged — users cannot feel agency.

## User job

After I steer, interrupt, or edit the plan, I see the consequence on the cursor and stage.

## Triggers

| User action | Visible consequence |
|---|---|
| Steer consumed at tool boundary | NowNext/Spotlight reflect new cursor or “steer applied” |
| Raise-hand → pause / redirect | “Finishing step” → paused stage → rewritten Now with announce |
| PlanEditor add/remove/reorder | Immediate NowNext + plan card refresh |
| Fix-up add while `lastFailure` | Distinct recovery treatment vs collaborative add |

## Surfaces

- NowNext (mandatory delta)
- Spotlight / plan card
- Call strip (interrupt state)
- Steer queue chip (pre-consume only)

## Copy principles

- Name the consequence (“Next is now X”, “Paused — waiting on you”, “You added …”).
- Collaborative adds ≠ failure churn in chrome (metrics may still count P1).
- Never show “churn” jargon to users.
- E1 continues after success are positive, never problem-framed.

## Acceptance criteria

1. Steer consume → NowNext and/or Spotlight update within one tool boundary; chip clears.
2. Raise-hand → immediate finishing copy; pause does not look like racing work; redirect rewrites Now and says so (W-13).
3. Plan edit → BankSnapshot-driven NowNext without reload.
4. Two distinct UI treatments: human/collaborative mid-plan add vs fix-up after `lastFailure`.
5. No fake plan when bank empty; collapse rules preserved.
6. Optional `source` on plan-ref events: `human | steer | recovery | partner` for UX (rollup policy separate).

## Dependencies

- DRV-STEER-QUEUE, DRV-INTERRUPT, DRV-NOWNEXT, DRV-TASK-BANK emit
- Soft: plan-ref `source` field in shared events

## Risks

- Over-signaling every reorder
- Dual spotlight planes (use converged sharer)
- Stub PlanEditor ids weaken felt control

## Open questions

1. Minimum signal: narration-only vs mandatory NowNext delta?
2. Does interrupt redirect auto-open PlanEditor?
3. Once `source` exists, down-weight collaborative adds in P1 or UX-only?
