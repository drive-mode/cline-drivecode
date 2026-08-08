# ADR-0033 · Managed execution boundary (DrivePlan owns truth)

**Status:** Proposed (2026-08-08)  
**Owner:** Drivecode SE lead  
**Constrained by:** [ADR-0008](ADR-0008-task-bank.md),
[ADR-0018](ADR-0018-agent-runtime-contract.md),
[ADR-0019](ADR-0019-driveplan-kanban-interop-wire.md),
[ADR-0025](ADR-0025-enforced-authority.md),
[ADR-0026](ADR-0026-evidence-backed-done.md).

## Context

ADR-0019 defines the **wire** (`execute` / `collectReceipt`). Product language
still drifts toward “the Kanban board is the plan.” Target boundary (nest
facts): DriveMode / DrivePlan owns task truth, gates, and completion
verification; DriveKanban is the **execution workbench**. Without a binding
record, agents treat board Done as bank archive.

## Decision

1. **DrivePlan / DriveTask is the satisfaction and archive authority.** Kanban
   card Done, trash, or column move **never** archives a `DriveTask` (ADR-0018 /
   0019 restated as product law).
2. **DriveKanban is a managed workbench.** For managed cards
   (`externalRef.system: "driveplan"`): projection from `DriveRun`; auto-review /
   auto-commit / auto-PR / dependency auto-start stay disabled unless a later
   Accepted change says otherwise.
3. **Gates and verification live on the Drive side.** Approval / receipt /
   covered-check refuse paths are hub + bank + Agent Control — not Kanban UI
   alone. Kanban may **display** gate state; it may not **decide** bank complete.
4. **Divergence is visible.** Human edits to managed cards set
   `projectionDiverged` (or equivalent); Drive remains SoT until an explicit
   reconcile op.
5. **CLI seed / launcher is not product interop.** Seed scripts may create
   cards for demos; they are not the managed-execution contract.

## Non-goals

- Replacing DriveKanban.
- Board.json sync as the bridge.
- Making Kanban the scheduler of record.

## Open

1. Exact reconcile UX when `projectionDiverged` is true.
2. Whether a non-Kanban workbench host may implement the same
   `KanbanInteropHost` under another product name.

## Alternatives rejected

- Loose board sync (“keep columns roughly aligned”) — loses gates/receipts.
- Kanban Done → archive DriveTask — violates ADR-0018.
- Fold this into ADR-0019 only — wire ADR stays transport-shaped; this is
  product ownership.
