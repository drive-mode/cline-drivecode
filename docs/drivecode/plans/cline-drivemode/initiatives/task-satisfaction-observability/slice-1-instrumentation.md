# Slice 1 · Instrumentation (call session + bank spine)

**DRV:** [DRV-CALL-SESSION](../../features/DRV-CALL-SESSION.md), gaps on [DRV-TASK-BANK](../../features/DRV-TASK-BANK.md)  
**Unblocks:** slice 2–3

## Outcome

A synthetic Drive session can be reconstructed from logs: join → activate plan → complete tasks → (optional plan edits) → leave, with shared `callSessionId` / `roomId`.

## Work

1. Define `callSessionId` lifecycle on join / re-join / leave / end.
2. Pass `roomId` + session into `openWorkspaceBankStore` / bank event emitters.
3. Wire `onBankEvent` → `appendBankLogEvent` on hub bank handlers.
4. Emit missing store events: plan-ref changed (or `drive_plan_step` on add), `drive_plan_archived`, `drive_task_bound` on bind.
5. Hub commands for complete / bind / activate (as needed so product path emits completions).
6. Tests: correlated room + bank JSONL for one session.

## Verify

- `bun -F @cline/shared test`
- `bun -F @cline/drive test`
- `bun -F @cline/core test:unit` (handlers + bank log)
- Fixture: clean session produces ≥1 `drive_task_completed` with matching session/room ids

## Done when

Slice 2 can compute S2/S3/P1 without FS archaeology.

## Implementation status (2026-07-30)

Landed on branch:

- `callSessionId` on room + bank event bases; leave `durationMs` when last human leaves
- Bank store emits bound / archived / plan_step / plan_archived; activate on `createPlan({activate:true})`
- Hub `onBankEvent` → bank JSONL; commands `drive_bank_complete_task|bind_now|activate_plan|record_failure`
- `deriveSessionRollup` (slice 2 pure helper) + tests
