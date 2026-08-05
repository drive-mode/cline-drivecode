# Phase 1 · Framing

Back to [overview](overview.md).

## Goal

Make ADR-0028 discoverable and keep nest indexes honest about the factory track.

## Changes

- Land [ADR-0028](../../adr/ADR-0028-adlc-control-plane.md) on the status board as Proposed.
- Index this initiative from `initiatives/README.md` and a short nest `HANDOFF.md` pointer.
- Cross-link from [defaults-delivery.md](../../delivery/defaults-delivery.md) so B2/B3 are not orphaned.

## Data structures

None. Decision record only.

## Verification

**Static.** `bun run check:drivecode-docs`. Board row present for ADR-0028.

**Runtime.** N/A (docs).
