# DRV-ANALYTICS · Drive Analytics (retrospective observability)

Back to [README](../README.md). Phase 2+. Product: [PRD 10](../prd/prd-task-satisfaction-observability.md). Initiative: [hub-drive-ia-analytics](../initiatives/hub-drive-ia-analytics/). Decision: [ADR-0015](../adr/ADR-0015-task-session-observability.md). Amends [ADR-0007](../adr/ADR-0007-drive-as-cline-mode.md).

## Implementation status

**Landed** (hub IA consolidation). Reuses rollup / digest primitives from #80.

## Problem / user value

Status Hub answers “where is everything now?” Retrospective questions (“did Drive sessions get work done?”, “what shipped?”) need a separate home so ops and satisfaction are not confused.

## Acceptance criteria

- Hub rail Drive group includes **Analytics** at `/analytics`.
- Lists recent local `SessionRollup` / `StatusSessionRow` chips (S*/E*/P* as available) without raw JSONL.
- Opt-in shipped-digest export lives on Analytics (not Status).
- Status Hub modes are Board / Changelog / Dependency map only (sessions lens migrated).
- Ports only at the view layer; demos at composition roots (`?demoSessions=1`).
- No utterance inputs; no default cloud egress; no parallel metric store.

## Dependencies

- [DRV-TASK-METRICS](DRV-TASK-METRICS.md), [DRV-CALL-SESSION](DRV-CALL-SESSION.md), [DRV-SHIPPED-DIGEST](DRV-SHIPPED-DIGEST.md)
- Soft: former [DRV-STATUS-SESSIONS](DRV-STATUS-SESSIONS.md) panel moved here

## Surfaces touched

- Hub webview: `analytics` view, Drive-group nav, `AnalyticsView`
- Composition root wiring for `StatusSessionRollupSource`
- Status Hub loses sessions mode
- Docs / product demo rail

## Agent tasks

- [x] Add `/analytics` route + Drive-group nav + page shell.
- [x] Migrate `StatusSessionsPanel` (or successor) from Status to Analytics.
- [x] Surface full local rollup chips + shipped-digest download.
- [x] Redirect / retire `?statusMode=sessions` (maps to Analytics via `openAnalytics`).
- [x] Cite live code in nest README; `bun run check:drivecode-docs`.

## Risks

- Confusing Status ops with satisfaction. Mitigation: separate page + clear labels.
- Claiming satisfaction before instrumentation honesty. Mitigation: reuse ADR-0015 rollups only; no phone-home.
