# DRV-FELT-AGENCY · Visible plan control after steer / interrupt / edit

Back to [README](../README.md). Phase 2+ Planned. Product: [PRD 10](../prd/prd-task-satisfaction-observability.md). Requirements: [req-felt-agency](../initiatives/session-satisfaction-moments/req-felt-agency.md).

## Problem / user value

North star includes “control over the plan,” but steer, interrupt, and plan edit often leave NowNext/Spotlight visually unchanged. After the user steers, interrupts, or edits, they must see the consequence on the cursor and stage.

## Acceptance criteria

- Steer consume → NowNext and/or Spotlight update within one tool boundary; steer chip clears.
- Raise-hand → immediate finishing copy; pause does not look like racing work; redirect rewrites Now and announces it.
- PlanEditor add/remove/reorder → BankSnapshot-driven NowNext without reload.
- Two distinct UI treatments: human/collaborative mid-plan add vs fix-up after `lastFailure`.
- No fake plan when bank empty; collapse rules preserved. Copy names the consequence — never “churn” jargon. No utterance keys in control chrome.

## Dependencies

- [DRV-STEER-QUEUE](DRV-STEER-QUEUE.md), [DRV-INTERRUPT](DRV-INTERRUPT.md), [DRV-NOWNEXT](DRV-NOWNEXT.md), DRV-TASK-BANK emit. Soft: optional plan-ref `source` (`human | steer | recovery | partner`) for UX.

## Surfaces touched

- NowNext (mandatory delta)
- Spotlight / plan card
- Call strip (interrupt state)
- Steer queue chip (pre-consume only)

## Agent tasks

- [ ] Emit visible NowNext/Spotlight deltas on steer consume and raise-hand pause/redirect.
  - Owner package: `@cline/cline-hub` + `@cline/core`
  - Verify: hub fixture for steer → chip clear + cursor rewrite
  - Done when: consequence is named in chrome within one tool boundary.
- [ ] Refresh NowNext from BankSnapshot on PlanEditor mutations without full reload.
  - Owner package: `@cline/cline-hub`
  - Verify: add/remove/reorder smoke
  - Done when: plan card and NowNext match disk after edit.
- [ ] Distinct chrome for collaborative mid-plan add vs fix-up after `lastFailure`.
  - Owner package: `@cline/cline-hub`
  - Verify: side-by-side fixture render
  - Done when: treatments differ; no churn jargon in copy.

## Risks

- Over-signaling every reorder. Mitigation: name consequence only on cursor/stage-changing actions.
- Dual spotlight planes. Mitigation: use converged sharer. Stub PlanEditor ids weaken felt control — prefer real bank ids.
