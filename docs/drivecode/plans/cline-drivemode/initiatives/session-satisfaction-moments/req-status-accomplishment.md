# Requirements · Status Hub accomplishment lens

**DRV:** [DRV-STATUS-SESSIONS](../../features/DRV-STATUS-SESSIONS.md)  
**Related:** ARD-0005, DRV-TASK-METRICS, PRD 10 R3, StatusSnapshotSource ports

## Problem

Rollups are framed as eng/debug. Users and leads need a **product** lens: did sessions get work done?

## User job

Open Status and see recent Drive sessions as accomplishment (tasks completed, clean-drain, continue), then drill into bank/plan/room.

## Data sources

- `deriveSessionRollup` over room + bank events (not `status.db` rows unless later published)
- Open bank / plan for drill-down
- Ports only at view layer; demos at composition roots

## UI shape

- New Status mode or Status-adjacent panel: list of sessions with S2 / S3 / E1 chips
- Row → open bank / room / plan
- Localhost; product stance once Obs R1 green (not permanent debug ghetto)

## Acceptance criteria

1. Lists recent rollups with S2/S3/E1 without raw JSONL.
2. Drill-down to bank and room/plan context works.
3. No utterance inputs; no default cloud egress.
4. Fixture coverage for clean / churny / continue / stickiness.
5. Distinct from agent Board / Changelog / Dependency map (label clearly).

## Dependencies

- Obs slices 1–2, ARD-0005 shell, DRV-TASK-BANK UI

## Risks

- Confusing Status agent log with Drive satisfaction
- Claiming satisfaction before instrumentation honesty

## Open questions

1. Fourth Status mode vs Drive-tab panel vs CLI-first?
2. When does debug-gated language retire?
