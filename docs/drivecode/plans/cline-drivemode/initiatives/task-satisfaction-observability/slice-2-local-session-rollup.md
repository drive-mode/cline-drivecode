# Slice 2 · Local session rollup

**DRV:** [DRV-TASK-METRICS](../../features/DRV-TASK-METRICS.md)  
**Requires:** [slice 1](slice-1-instrumentation.md)

## Outcome

Pure `deriveSessionRollup` implements PRD 10 metrics S1–S3, E1–E3, P1–P2. A debug-gated local view shows recent rollups.

## Work

1. Add `SessionRollup` type (counts + booleans + session id; no prose blobs).
2. Implement derivation from ordered room + bank envelopes.
3. Fixture matrix: clean-drain, mid-plan churn, post-success continue, failure stickiness.
4. Debug UI or `cli doctor`-adjacent dump — localhost only.
5. Cross-link metric ids in PRD 10 / research 15.

## Verify

- Unit fixtures for each metric family case
- Manual smoke: one live session → rollup appears locally
- Confirm no new telemetry events in `@cline/core` PostHog / core-events for Drive rollups

## Done when

Leadership can read a rollup from a smoke path without reading raw JSONL by hand.
