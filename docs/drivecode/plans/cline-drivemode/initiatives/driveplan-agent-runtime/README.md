# DrivePlan agent runtime

**Status:** active
**ADR:** [ADR-0018](../../adr/ADR-0018-agent-runtime-contract.md) (Accepted — Impl partial; Agent Control + completion guard landed, ADR-0019 wire later)
**DRV:** [DRV-TASK-BANK](../../features/DRV-TASK-BANK.md)

## Purpose

Ship the agent-first execution contract: `DriveTask` → `DriveRun` → `DriveRunWorkItem` ↔ managed Kanban card ↔ `WorkLease` / Receipt — without treating Kanban Done as archive authority.

## Linked design

- [implementation-state-plane.html](../../../../design/canvases/implementation-state-plane.html) — fixture visual of admission waves (not live Hub data)
- Cursor canvas `driveplan-agent-runtime.canvas.tsx` (workspace canvases) — contract overview

## Slices

| Slice | Status | Notes |
|---|---|---|
| Hub brand tokens on state plane | done | `cline-canvas-tokens.css` |
| Shared schemas (`DriveRun`, lease, receipt) | done | `@cline/shared` `drive/run.ts` — `DriveRunWorkItem` ≠ wave `DriveWorkItem` |
| Read-only one-task/one-run projection | done | Kanban `externalRef` + `@cline/drive` `kanbanInterop` stub + hub `driveplan.project_to_kanban` artifact |
| Agent Control tools | done | Hub: `driveplan.list_eligible_work` / `claim_work` / `report_progress` (+ `put_run` / `get_run`); lease/run persist under `.drive/bank/` |
| Completion guard | done | `assertCompletionReceipt` via `bankStore.completeTask`; hub `drive_bank_complete_task` accepts `boundRun` + `receipt` |
| ADR-0019 Interop wire | partial | `execute` / `collectReceipt` + `KanbanInteropHost` in `@cline/drive`; live Kanban host adapter still open |

## Non-goals

- Board-wide sync / seed-as-product-path
- Remote curated plugins as product deps (`speak`, npm install path)
- Overloading room-wave `DriveWorkItem` for run work items
