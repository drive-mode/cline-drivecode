# Phase 6 · Traces as product

Back to [overview](overview.md). Extends ADR-0015 surfaces. No second store.

## Goal

Analytics sessions lens lets a human drill a `callSessionId` into the evidence
that fed the rollup (bank event ids / failure headlines), enough to judge a
plan-improve proposal.

## Changes

- Deepen `StatusSessionsPanel` drill: show correlated failure headlines and task
  ids already present on the rollup derivation inputs.
- Keep shipped digest opt-in. Do not persist new transcript fields.
- Do not invent OpenTelemetry export in this phase.

## Data structures

Reuse `SessionRollup` fields. Optional thin view-model for drill rows derived
from the same JSONL the reader already loads.

## Verification

**Static.** Hub webview tests for drill render with fixture rollup + empty case.

**Runtime.** control-ui: `/analytics?demoSessions=1` → open a session → evidence
list matches fixture; live path after a failed bank task shows the failure row.
