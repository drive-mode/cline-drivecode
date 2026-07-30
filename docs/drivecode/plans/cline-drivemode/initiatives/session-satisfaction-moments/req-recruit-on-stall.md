# Requirements · Recruit-on-stall

**DRV:** [DRV-RECRUIT-STALL](../../features/DRV-RECRUIT-STALL.md)  
**Related:** DRV-RECRUIT, ARD-0003, DRV-STUCK-RECOVERY, DRV-TASK-BANK, DRV-AGENT-ROUTER (not a seater)

## Problem

Recruit is unused at the highest-intent moment: a stuck task. Multi-agent value for satisfaction needs “who should take this?” plus later attribution.

## User job

From a stuck task, find and seat the right agent/pack without rewriting the plan cursor.

## Flow

```text
stuck DriveTask
  → need from title + skill/capability labels + artifact/node ids
  → drive_recruit (query only)
  → pick agent/pack
  → room_seat / add_roster_pack
  → optional bindNowTask + explicit address/focus
```

## Rules

- Recruit never writes `participants[]` or plan order.
- `nowTaskId` stays deterministic; “rebind” = bind execution to current now + seat agent.
- Newly seated agents do not auto-join address set (ARD-0003).
- Router delivers utterances among seated — orthogonal.

## Attribution (pack postmortem)

Today `drive_task_completed` lacks `agentId`. Requirement: bound-agent attribution on complete/bind (runtime context, not model prose) for session/pack rollups.

## Acceptance criteria

1. Stuck task offers “Who should take this?” with structured need only.
2. Results ranked with reviewable reasons; optional pack suggestions.
3. Seat only via hub ops; honor `teamOpt` / `seatCap`.
4. Optional use-for-Now does not reorder plan.
5. Completion/bind events carry (or correlate) agent attribution.
6. No utterance payloads.

## Dependencies

- DRV-RECRUIT + graph index, DRV-STUCK-RECOVERY, roster pack/teamOpt
- Soft: schema amend for `agentId` on bank events

## Risks

- Lexical miss → capability chips
- Confusing recruit UI with router
- Blame theater in attribution — frame as routing signal

## Open questions

1. First-class DRV vs composition of W-38 + stuck UI only? (Answer in this wave: first-class DRV.)
2. Auto-address after seat or human address only?
3. Attribute by agent, pack seatSources, or both?
