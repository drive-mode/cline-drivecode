# DRV-STUCK-RECOVERY · In-call stuck recovery

Back to [README](../README.md). Phase 2+ Planned. Product: [PRD 10](../prd/prd-task-satisfaction-observability.md). Requirements: [req-stuck-recovery](../initiatives/session-satisfaction-moments/req-stuck-recovery.md).

## Problem / user value

Mid-call task failure without a recovery path causes abandon. Post-session plan-improve is too late for this session’s retention. When Now sticks, the user chooses a clear recovery path without leaving Drive.

## Acceptance criteria

- Failure leaves the task open with `lastFailure`; never silent archive.
- Spotlight offers a gated recovery fork (narrow task, add fix-up, recruit, pause via Ask override). No auto bank mutation without accept.
- Accept of fix-up/narrow updates bank + NowNext from disk snapshot.
- Reject/mute: no durable write; no silent identical re-offer without new intent.
- Proposals use event/task/skill ids only — no utterances. Interrupt and steer remain available during recovery.

## Dependencies

- Hub `recordTaskFailure` / complete / bind ops; DRV-NOWNEXT, DRV-STAGE / Spotlight, accept UI. Soft: [DRV-RECRUIT-STALL](DRV-RECRUIT-STALL.md) for recruit option. Distinct from post-session [DRV-PLAN-IMPROVE](DRV-PLAN-IMPROVE.md).

## Surfaces touched

- Spotlight / stage (primary fork card)
- Feed (failure + proposal narration)
- NowNext (post-accept cursor)
- Accept queue (`kind: recovery` or planning reuse)

## Agent tasks

- [x] Wire `lastFailure` on open tasks and surface a gated recovery fork in Spotlight after `recordTaskFailure`.
  - Owner package: `@cline/core` + `@cline/cline-hub`
  - Verify: unit + hub fixture for failure → fork options
  - Done when: failure leaves task open; fork appears; reject writes nothing.
  - Landed (W1.3): tool_event failed → `mutateBankRecordFailure` → `BankSnapshot.nowLastFailure`; Spotlight `StuckRecoveryFork` when Drive active; Dismiss mutes identical `offerKey` with no bank write.
- [x] Implement accept paths for narrow-task and add-fix-up (bank + NowNext from snapshot).
  - Owner package: `@cline/drive` + `@cline/core`
  - Verify: `bun -F @cline/drive test`, hub accept integration
  - Done when: accept mutates bank; NowNext refreshes; mute does not re-offer identically.
  - Landed (W1.3): pure `planRecoveryAccept` → `mutateBankCreateTask` (+ `mutateBankEditPlanTasks` for narrow); `applyBankSnapshot` refreshes NowNext; pause = Ask override + raise-hand/abort (no new status); recruit CTA = agency banner stub (full seating = W2.3).
- [x] Ensure proposals carry only ids (task/plan/skill/event) — no utterance payloads.
  - Owner package: `@cline/shared`
  - Verify: privacy / forbidden-key tests
  - Done when: schema rejects utterance fields.
  - Landed: `RecoveryProposal` + `recoveryProposalIsPrivate` forbid utterance-like keys; fork copy uses task ids + bank `lastFailure` note only.

## Risks

- Approval fatigue if merged into high-impact gates without a distinct lane. Mitigation: `kind: recovery` separate from plan-improve.
- Pause-plan undefined. Mitigation: ship Ask override + raise-hand stop first; no new status until decided.
