# ADR-0031 · Client visual layout adapts; producers stay viewport-blind

**Status:** Proposed (2026-08-08)  
**Owner:** Drivecode SE lead  
**Constrained by:** [ADR-0030](ADR-0030-plane-naming.md) (`visual/` plane),
[ADR-0029](ADR-0029-room-hotpath-redesign.md) H4 (Spotlight + strip + sheets),
[ADR-0013](ADR-0013-state-partition.md) (surfaces render, never own state).  
**Related:** hub `visualEngine.ts` / `ScreenArtifact.tsx` (feature-branch tip).

## Context

Diagram and stage artifacts must read on phone and ultrawide. If producers bake
breakpoints into Mermaid or Show payloads, every surface forks the protocol.
If every client invents layout ad hoc, agents get no shared contract.

## Decision

1. **Producers are viewport-blind.** Hub / kernel Show materializers emit
   artifact models and Mermaid **without** phone/tablet/desktop branches.
2. **Clients own layout.** A `visual/layout` (or equivalent) module maps
   **host frame** size/format → presentation choices (e.g. Mermaid font scale,
   LR→TB on narrow frames, animation stack vs side-by-side). Prefer
   `ResizeObserver` on the artifact host frame, not `window` alone.
3. **Same artifact, many presentations.** Changing layout never rewrites the
   durable event or Show item identity.
4. **H4 composition stays.** Call surface = Spotlight + one strip + sheets;
   layout adaptation does not reintroduce bank/plan chrome onto the stage.
5. **Naming.** Ownership noun is `visual/`; file verb `layout` — not
   `VisualEngine` ([ADR-0030](ADR-0030-plane-naming.md)).

## Non-goals

- Server-side responsive Mermaid variants.
- Per-device Show item forks in the bank / event log.
- Pixel / WebRTC share (still multi-user media plan).

## Open

1. Exact format buckets (phone / tablet / desktop / ultrawide) vs continuous
   width thresholds.
2. Whether TUI gets a text-only layout profile in the same module or a separate
   thin adapter.

## Alternatives rejected

- Bake breakpoints into `produceMermaid` — poisons the wire for other clients.
- CSS-only with no shared contract — agents cannot reason about adaptation.
