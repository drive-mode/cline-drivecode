# DRV-DEP-MAP · Interactive Status Hub dependency graph

Back to [README](../README.md). Initiative: [status-dependency-graph](../initiatives/status-dependency-graph/). Wireframe: [status-dependency-graph.html](../../../design/wireframes/status-dependency-graph.html).

Status Hub ships the spatial **Dependency map** lens: pan / zoom / deterministic
Fit, clickable and keyboard-navigable task nodes, optional artifact labels, task
detail, and a **Plans rail**. The open slice is no longer visualization. It is a
read-only canonical project-map source for GP0–GP9, distinct from Team runtime
and the historical `?demoPlans=1` fixture.

## Problem / user value

Operators asking “what blocks what?” get a layered list and a text “Blocked by / Unblocks” aside. They cannot:

- See the graph topology at a glance
- Trace the **artifact or result** flowing along an edge
- Tell which **plan** a task belongs to without reading descriptions
- Explore large graphs without drowning in a two-column card wall

The map should answer three questions in one composition: **order**, **payload**, **plan**.

## Acceptance criteria

- Dependency map remains a Status Hub lens (`board` | `changelog` | `dependency-map`); it does not become a second task store.
- The primary surface is a **viewport graph**: drag to pan, wheel / pinch / buttons to zoom, native scroll when content overflows the viewport.
- **First paint and `Fit` always frame every task** inside the viewport (padding). Zoom may leave content off-screen afterward; Fit restores the full-graph frame. Layout follows the fit/density ladder in the initiative UX (viewport-fit gaps → LOD → adaptive LR/TD → plan hulls / stacks as escape).
- Each task is a **node**; `dependsOn` relationships are **edges**. Edge labels show the artifact / result passed when known; unlabeled edges still draw when only the dependency exists.
- Clicking (or activating) a node selects it, highlights incident edges, and opens a **task detail** panel (status, description, blockers, dependents, artifacts, plan membership).
- Every task and plan exposes a **progressive display ID** (`T001`… / `P001`…) that is immutable, monotonic, and searchable; nodes and the Plans rail show the ID; bank-backed entities mint these ids at create time (see initiative UX).
- Plans appear in a fixed **rail on the right** of the graph. Selecting a plan highlights its tasks in that plan’s color and dims non-members. Nodes carry a plan-color accent when they belong to a plan.
- Keyboard and screen-reader paths from the current map are preserved or improved (focusable nodes, live region for selection, no bare-letter hotkeys that steal host shortcuts).
- Empty / loading / integrity (cycle, missing ref) states remain explicit; the UI never invents edges or plan membership.
- Demo bootstrap (`?demoPlans=1`) continues to work via composition-root adapters only.

## Dependencies

- Existing Status Hub Dependency map model (`buildDependencyMap` in `@cline/shared`).
- Team task snapshot transport (`status.tasks_snapshot` / `StatusTeamsSource`).
- Plan membership prefers [DRV-TASK-BANK](DRV-TASK-BANK.md) `DrivePlan.taskIds` when a bank snapshot is available; demo may project phase/plan groups until the bank is wired into this lens.
- Artifact labels on edges need a declared projection source (see initiative [UX.md](../initiatives/status-dependency-graph/UX.md) data contract) — do not scrape free text as truth.

## Surfaces touched

- `apps/cline-hub/src/webview/src/components/views/dependency-map.tsx` (+ graph viewport / plans rail)
- Optional model extension beside `sdk/packages/shared/src/status/dependency-map.ts` for plan ids and edge payloads (pure projection only)
- Demo fixture / plans source in `@cline/drivecode-demo` when demo needs explicit plan groups and edge artifacts
- Docs screenshots under `docs/drivecode/assets/hub/`

## Delivery state and remaining task

- [x] Lock the UX and wireframe.
- [x] Extend the pure projection with declared plans, display IDs, and artifact labels.
- [x] Ship the graph viewport, Fit/density ladder, Plans rail, detail, and keyboard path.
- [x] Add validated GP0–GP9 claim metadata, a neutral `ProjectMap`, and scoped
  `drive_project_map_get` read operation. The host refuses missing/invalid
  registries and symlink escapes and returns no raw host path.
- [ ] Adapt the neutral project map into `/tasks` without fabricating TeamTask or
  DriveTask lifecycle or reading the demo fixture.
  - Owner packages: `@cline/shared`, `@cline/core`, `@cline/cline-hub`
  - Verify: hub tests cover GP0–GP9 with no historical `NOW-*` ids; missing map
    falls back to the Team runtime view and raw claim status remains inspectable.
- [ ] Refresh hub demo screenshots and DEMO runbook paths for the graph lens.
  - Owner package: repo docs
  - Verify: assets under `docs/drivecode/assets/hub/`; DEMO.md cites live URL query
  - Done when: selected + overview shots match the new composition.

## Risks

- Canvas-only graphs that strand keyboard users. Mitigation. Nodes remain focusable controls; viewport is an enhancement, not the only path.
- Inventing artifact labels from titles. Mitigation. Edges stay unlabeled unless the projection has an explicit artifact/result field.
- Confusing Status Dependency map with Drive Show / agent portfolio graphs. Mitigation. Keep `DepMap` naming; no Show backlog coupling ([diagram conventions](../../../../../.claude/diagram-conventions.md)).
- Treating a claim status like executable task lifecycle. Mitigation. The claims
  projection is delivery truth only; DriveTask state remains independent and
  host-written.
