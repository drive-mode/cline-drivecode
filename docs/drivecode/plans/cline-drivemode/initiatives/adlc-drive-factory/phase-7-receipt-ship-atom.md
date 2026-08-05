# Phase 7 · Receipt ship atom

Back to [overview](overview.md). Product wire for ADR-0018. Kernel guard already
exists (`assertCompletionReceipt`).

## Goal

Completing a bank task that has a bound `DriveRun` requires an accepted
`Receipt` on the product path, so Done means evidence, not a button.

## Changes

- PlanEditor / complete mutator: when a run is bound, collect or attach receipt
  payload already parsed by bank handlers.
- Fail closed in UI when the guard would refuse (mirror kernel error).
- Do not build Kanban interop (ADR-0019) here.

## Data structures

Existing `Receipt` / `DriveRun` in `@cline/shared` `drive/run.ts`.

## Verification

**Static.** Core + hub tests: complete without receipt fails when run bound;
complete with receipt archives.

**Runtime.** control-ui: bind run on a task → complete without receipt blocked →
complete with minimal receipt → task archived and rollup reflects completion.
