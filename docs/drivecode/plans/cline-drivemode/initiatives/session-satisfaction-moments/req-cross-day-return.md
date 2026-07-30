# Requirements · Cross-day plan re-entry

**DRV:** [DRV-PLAN-REENTRY](../../features/DRV-PLAN-REENTRY.md)  
**Related:** DRV-DRIVE-TAB, DRV-ROOM-MVP, DRV-RETURN-LOOP, DRV-TASK-METRICS

## Problem

Rooms persist, but Drive tab does not surface unfinished plans. Users who leave mid-plan are unlikely to return if re-entry is “empty call” only.

## User job

Open Drive tab and pick up an unfinished plan with one glance and one click.

## Triggers

- Open Drive tab after leave / next calendar day / hub restart
- Multiple rooms with active plans

## Surfaces

| Surface | Content |
|---|---|
| Drive tab room list row | `plan.title`, open task count, last rollup chips (e.g. completed last session / drained?) |
| After join | NowNext + optional while-away line (Return loop) |

Wireframes today lack plan-summary rows — this amends IA (`design/wireframes/DRIVE-TAB.md`).

## Acceptance criteria

1. Room with active plan + open tasks shows title + open count on list (or documented post-join-only if leadership picks that fork).
2. Last rollup is counts-only from local `SessionRollup` / leave summary — no transcript.
3. Selecting row → same `joinCall` / hub room as Chat Join.
4. Draft/non-active plans: listed separately or omitted per one-active-plan-per-room rule (document choice).
5. Empty/no-hub state remains honest (W-01).
6. Does not turn Drive tab into a second Chat transcript.

## Dependencies

- Durable bank + room persistence
- Session rollup (Obs slice 2) for “last session” chips
- DRV-DRIVE-TAB shell

## Risks

- Stale plans clutter — need archive hygiene
- Rollup before emit → false chips
- Unfocused room = view-only policy interaction

## Open questions

1. Plan summary on list vs only after join?
2. How to show draft plans?
3. “Last rollup” = leave summary event vs derived on read?
