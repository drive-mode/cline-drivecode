# DRV-CALL-SESSION · Call session binding for metrics

Back to [README](../README.md). Product: [PRD 10](../prd/prd-task-satisfaction-observability.md). Decision: [ARD-0015](../ard/ARD-0015-task-session-observability.md). Depends on [DRV-LEAVE-END](DRV-LEAVE-END.md), [DRV-EVENTS](DRV-EVENTS.md), [DRV-PRIVACY](DRV-PRIVACY.md).

## Implementation status

**Landed (#80).** Residuals in [REMAINING-task-satisfaction.md](../delivery/REMAINING-task-satisfaction.md).

## Problem / user value

Without a stable call-session identity, join/leave timestamps and bank task completions cannot be correlated. Duration and “tasks per call” stay guesswork.

## Acceptance criteria

- Every join that starts (or resumes) measurable presence attaches a `callSessionId` (new on fresh join; documented rule for re-join after leave).
- Room log events and bank log events for that presence window can be filtered by `callSessionId` and/or consistent `roomId`.
- Leave (and end, when implemented) can derive `durationMs` from session bounds without storing transcripts.
- Optional session-summary event carries **counts only** (tasks completed, plan edits, work event counts) — no message text, no audio keys.
- CLI Drive, if measured, must use hub join/leave (not local-only chrome toggle).

## Dependencies

- DRV-ROOM-MVP, DRV-LEAVE-END, DRV-EVENTS, DRV-PRIVACY, DRV-TASK-BANK (for bank correlation).

## Surfaces touched

- `sdk/packages/shared/src/drive/` (session fields / summary event shape)
- `sdk/packages/core/src/hub/collaboration/` (join/leave/end)
- `sdk/packages/drive/src/` (optional pure duration helper)
- Hub / CLI session wiring

## Agent tasks

- [ ] Specify `callSessionId` lifecycle (fresh join vs re-attach) in shared types + tests.
  - Owner package: `@cline/shared`
  - Verify: `bun -F @cline/shared test`
  - Done when: parse tests cover session id on join and summary shape forbids forbidden keys.
- [ ] Thread session id through room commit path and bank store open options (`roomId` + session).
  - Owner package: `@cline/core` / `@cline/drive`
  - Verify: unit tests correlate synthetic join→complete→leave.
  - Done when: bank events in test log share session/room ids with room events.
- [ ] Document derivation of S1 duration for [DRV-TASK-METRICS](DRV-TASK-METRICS.md).
  - Owner package: docs
  - Verify: cross-link from PRD 10
  - Done when: metric table cites this feature.

## Risks

- Re-join semantics inflate duration if sessions are concatenated incorrectly. Mitigation: explicit session rules in AC + tests.
- Summary events tempting richer payloads. Mitigation: zod `.strict()` + forbidden-key walker.
