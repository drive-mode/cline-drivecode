# Phase 5 · Status → Drive bridge

Back to [overview](overview.md). Novel ADLC push link.

## Goal

When Drive is active, a Status update with `state: failed` or `priority: critical`
can open the existing StuckRecovery **offer** (same gated card as stall), not
only `ui.notify`.

## Changes

- Pure classifier in `@cline/drive`: StatusUpdate → offer kind | ignore.
- Hub or webview subscription on `status.updated` applies the offer only if a
  focused Drive room is active and a Now task / callSession exists.
- Default: offer, never auto-accept narrow/fix/recruit.
- `ui.notify` for high/critical stays unchanged.

## Data structures

```text
StatusDriveOffer = { kind: "stuck_recovery", reasonCode, statusUpdateId, callSessionId? }
```

Discriminated ignore vs offer. No new Status schema.

## Verification

**Static.** `bun -F @cline/drive test` for the pure bridge table.
`bun -F @cline/cline-hub test` for active-room vs no-room.

**Runtime.** control-ui: Drive joined + Now task → publish critical/failed status
(doctor or test helper) → StuckRecoveryFork appears → Accept still required.
Without Drive active, only notify/board update.

**Design gate.** Run **interrogate** on auto-offer vs auto-execute before merge.
Default remains auto-offer.
