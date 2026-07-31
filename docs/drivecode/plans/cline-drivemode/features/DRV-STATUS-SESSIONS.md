# DRV-STATUS-SESSIONS · Status Hub accomplishment lens

Back to [README](../README.md). Phase 2+ **Landed (W3.1)**. Product: [PRD 10](../prd/prd-task-satisfaction-observability.md). Requirements: [req-status-accomplishment](../initiatives/session-satisfaction-moments/req-status-accomplishment.md).

## Implementation status

**Landed (#80).** Residuals in [REMAINING-task-satisfaction.md](../delivery/REMAINING-task-satisfaction.md).

## Problem / user value

Rollups are framed as eng/debug. Users and leads need a product lens: did sessions get work done? Open Status and see recent Drive sessions as accomplishment (tasks completed, clean-drain, continue), then drill into bank/plan/room.

## Acceptance criteria

- Lists recent rollups with S2/S3/E1 chips without raw JSONL.
- Drill-down to bank and room/plan context works.
- No utterance inputs; no default cloud egress.
- Fixture coverage for clean / churny / continue / stickiness.
- Distinct from agent Board / Changelog / Dependency map (label clearly). Ports only at view layer; demos at composition roots.

## Dependencies

- Obs slices / [DRV-TASK-METRICS](DRV-TASK-METRICS.md), [DRV-CALL-SESSION](DRV-CALL-SESSION.md), ARD-0005 Status shell, DRV-TASK-BANK UI. Soft: [DRV-SHIPPED-DIGEST](DRV-SHIPPED-DIGEST.md) as export launch point.

## Surfaces touched

- Status Hub **sessions** mode (`StatusSessionRollupSource` / teams ports)
- Drill-down to bank / room / plan via `callSessionId` + `roomId`
- Localhost product stance once Obs R1 green

## Agent tasks

- [x] Add accomplishment lens listing recent `SessionRollup`s with S2/S3/E1 chips (no raw JSONL).
  - Owner package: `@cline/cline-hub` (+ `@cline/drive` `statusSessions.ts`)
  - Verify: fixture renders for clean / churny / continue / stickiness (`STATUS_SESSION_FIXTURES` + demo adapter)
  - Done when: list is labeled distinct from Board/Changelog/Dependency map.
- [x] Wire row drill-down to bank and room/plan context.
  - Owner package: `@cline/cline-hub`
  - Verify: click-through smoke (Open room / Drive)
  - Done when: row opens bank/plan/room without leaving localhost.
- [x] Enforce no utterance inputs and no default cloud egress on the lens.
  - Owner package: `@cline/drive` / hub composition
  - Verify: privacy tests + composition-root demo wiring only (`?demoSessions=1`)
  - Done when: forbidden keys rejected; demos not in view layer.

## Risks

- Confusing Status agent log with Drive satisfaction. Mitigation: clear product label.
- Claiming satisfaction before instrumentation honesty. Mitigation: ship behind Obs R1 green.
