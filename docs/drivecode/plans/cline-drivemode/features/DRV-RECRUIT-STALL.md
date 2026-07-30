# DRV-RECRUIT-STALL · Recruit on stuck task

Back to [README](../README.md). Phase 2+ Planned. Product: [PRD 10](../prd/prd-task-satisfaction-observability.md). Requirements: [req-recruit-on-stall](../initiatives/session-satisfaction-moments/req-recruit-on-stall.md).

## Problem / user value

Recruit is unused at the highest-intent moment: a stuck task. Multi-agent value for satisfaction needs “who should take this?” plus later attribution. From a stuck task, find and seat the right agent/pack without rewriting the plan cursor.

## Acceptance criteria

- Stuck task offers “Who should take this?” with structured need only (title + skill/capability labels + artifact/node ids — no utterances).
- Results ranked with reviewable reasons; optional pack suggestions.
- Seat only via hub ops (`room_seat` / `add_roster_pack`); honor `teamOpt` / `seatCap`. Recruit never writes `participants[]` or plan order.
- Optional use-for-Now binds execution to current `nowTaskId` + seats agent; does not reorder plan. Newly seated agents do not auto-join address set.
- Completion/bind events carry (or correlate) agent attribution for session/pack rollups. No utterance payloads; no phone-home.

## Dependencies

- [DRV-RECRUIT](DRV-RECRUIT.md) + graph index, [DRV-STUCK-RECOVERY](DRV-STUCK-RECOVERY.md), roster pack / teamOpt ([DRV-ROSTER-PACK](DRV-ROSTER-PACK.md), [DRV-TEAM-OPT](DRV-TEAM-OPT.md)). Soft: schema amend for `agentId` on bank events. Router is orthogonal (not a seater).

## Surfaces touched

- Stuck-recovery fork “Recruit” option / Spotlight card
- `drive_recruit` query → seat ops
- Bank complete/bind attribution fields
- Pack postmortem / session rollups consumers

## Agent tasks

- [ ] From stuck task, build structured need and offer ranked recruit results with reviewable reasons.
  - Owner package: `@cline/drive` + hub
  - Verify: fixture need → ranked agents/packs; no utterance in payload
  - Done when: “Who should take this?” returns reviewable ranking.
- [ ] Seat via hub ops only; optional use-for-Now binds without reordering plan; honor seatCap/teamOpt.
  - Owner package: `@cline/core`
  - Verify: seat + bind unit tests; address set unchanged on seat
  - Done when: seat does not mutate plan order or auto-address.
- [ ] Carry agent attribution on complete/bind (runtime context) for rollups.
  - Owner package: `@cline/shared` + `@cline/drive`
  - Verify: event schema + rollup fixture
  - Done when: completed stuck task correlates to seated agent without model prose.

## Risks

- Lexical miss → empty results. Mitigation: capability chips on need.
- Confusing recruit UI with router. Mitigation: seat-only framing; router delivers among seated.
- Blame theater in attribution. Mitigation: frame as routing signal for pack postmortem.
