# DRV-PLAN-REENTRY · Cross-day unfinished-plan re-entry

Back to [README](../README.md). Phase 2+ Planned. Product: [PRD 10](../prd/prd-task-satisfaction-observability.md). Requirements: [req-cross-day-return](../initiatives/session-satisfaction-moments/req-cross-day-return.md).

## Problem / user value

Rooms persist, but Drive tab does not surface unfinished plans. Users who leave mid-plan are unlikely to return if re-entry is “empty call” only. Open Drive tab and pick up an unfinished plan with one glance and one click.

## Acceptance criteria

- Room with active plan + open tasks shows plan title + open count on the list (or documented post-join-only if leadership picks that fork).
- Last rollup chips are counts-only from local `SessionRollup` / leave summary — no transcript.
- Selecting a row → same `joinCall` / hub room as Chat Join.
- Draft/non-active plans: listed separately or omitted per one-active-plan-per-room rule (document choice).
- Empty/no-hub state remains honest. Does not turn Drive tab into a second Chat transcript. No utterance payloads; no phone-home.

## Dependencies

- Durable bank + room persistence; SessionRollup ([DRV-TASK-METRICS](DRV-TASK-METRICS.md)); [DRV-DRIVE-TAB](DRV-DRIVE-TAB.md) shell; [DRV-RETURN-LOOP](DRV-RETURN-LOOP.md) for post-join while-away.

## Surfaces touched

- Drive tab room list rows (plan title, open count, last-session chips)
- Post-join NowNext + optional while-away line
- Wireframe IA amend (`design/wireframes/DRIVE-TAB.md`)

## Agent tasks

- [ ] Surface active-plan summary on Drive tab rows (title + open task count).
  - Owner package: `@cline/cline-hub`
  - Verify: fixture rooms with/without open plans
  - Done when: unfinished plan is glanceable before join; empty/no-hub stays honest.
- [ ] Attach counts-only last-session chips from local rollup / leave summary.
  - Owner package: `@cline/drive` + hub
  - Verify: rollup fixture; privacy forbid transcript keys
  - Done when: chips render without utterance fields.
- [ ] Row select joins the same hub room as Chat Join; document draft-plan listing choice.
  - Owner package: `@cline/cline-hub`
  - Verify: join parity smoke
  - Done when: one-click re-entry lands on NowNext with return-loop orientation.

## Risks

- Stale plans clutter. Mitigation: archive hygiene + one-active-plan rule.
- Rollup before emit → false chips. Mitigation: show chips only when rollup honesty is green.
