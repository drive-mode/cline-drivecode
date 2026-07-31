# DRV-TASK-METRICS · Session rollups from task + call events

Back to [README](../README.md). Product: [PRD 10](../prd/prd-task-satisfaction-observability.md). Research: [15](../research/15-task-satisfaction-observability.md). Decision: [ARD-0015](../ard/ARD-0015-task-session-observability.md).

## Problem / user value

Drive needs local, privacy-safe rollups: tasks completed per session, plan clean-drain, mid-plan churn, post-success engagement, failure stickiness. Without them, retention risk is invisible.

## Acceptance criteria

- Pure rollup function(s) in `@cline/drive` (or shared) compute S1–S3, E1–E3, P1–P2 from room + bank event sequences for one `callSessionId`.
- Mid-plan **adds** after plan activate count as churn (P1); plan edits after ≥1 completion in-session count as engagement (E1).
- Clean-drain (S3): plan archives with zero additive mid-plan task ids relative to activation snapshot.
- P2 failure stickiness: distinct taskIds with ≥1 `drive_task_failed` and no later `drive_task_completed` in-session (`recordTaskFailure` emits the event; note stays on disk).
- No utterance text required or accepted as rollup input.
- Local dashboard or debug panel can render recent rollups; default is localhost-only.
- Unit tests cover synthetic sessions: clean drain, churny plan, post-success continue, failure stickiness.
- Does not send Drive metrics to cloud telemetry by default.

## Dependencies

- DRV-CALL-SESSION, DRV-TASK-BANK (event completeness), DRV-EVENTS, DRV-PRIVACY.
- Hub emit path for bank events (`onBankEvent` → log).

## Surfaces touched

- `sdk/packages/drive/src/` (pure rollup)
- `sdk/packages/shared/src/drive/` (optional `SessionRollup` type)
- Hub webview debug / Status-adjacent view (composition root only)
- Docs: PRD 10 metric table

## Agent tasks

- [x] Land bank event emission gaps (plan-ref changed, plan archived, bound) on store + hub wire.
  - Owner package: `@cline/drive` + `@cline/core`
  - Verify: `bun -F @cline/drive test`, `bun -F @cline/core test:unit`
  - Done when: completeTask / editPlanTaskIds / closeAndArchivePlan emit expected events in tests.
- [x] Emit `drive_task_failed` from `recordTaskFailure` for P2 stickiness (REMAINING §2.3 Option A).
  - Owner package: `@cline/shared` + `@cline/drive`
  - Verify: `bun -F @cline/shared test -- bankEvents`, `bun -F @cline/drive test -- sessionRollup bankStore`
  - Done when: `failureStickyCount` derives from failed-without-later-complete taskIds.
- [x] Implement `deriveSessionRollup(events) → SessionRollup` with metric ids from PRD 10.
  - Owner package: `@cline/drive`
  - Verify: fixture tests for S3 / E1 / P1 / P2 cases
  - Done when: fixtures pass; no forbidden keys in types.
- [x] Minimal local UI or CLI doctor-style dump of last N rollups (debug-gated).
  - Owner package: `@cline/core` + `@cline/cline-hub` + `@cline/cli`
  - Verify: `readSessionRollups` tests; hub `drive_session_rollups`; Drive Settings dump; `cline doctor session-rollups`
  - Done when: rollup visible without network egress.
  - Note: Status Hub fourth mode (DRV-STATUS-SESSIONS) still open — consume `SessionRollupSource` / `readSessionRollups` at composition root.

## Risks

- Dashboard before instrumentation → false confidence. Mitigation: ARD-0015 / leadership default: no satisfaction claims until emit path green.
- Counting work.* tools as tasks. Mitigation: primary metrics use bank events only; work.* secondary.
