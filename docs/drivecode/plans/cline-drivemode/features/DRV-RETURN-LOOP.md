# DRV-RETURN-LOOP · Leave / End return loop

Back to [README](../README.md). Phase 2+ Planned. Product: [PRD 10](../prd/prd-task-satisfaction-observability.md). Requirements: [req-leave-end-return](../initiatives/session-satisfaction-moments/req-leave-end-return.md). Amends: [DRV-LEAVE-END](DRV-LEAVE-END.md).

## Problem / user value

Leave/End today are ops. Satisfaction needs a return loop: structured handoff, while-away continuity, and a resume CTA. Leave safely knowing work continues; End with a factual packet; rejoin and continue the plan in one action.

## Acceptance criteria

- Leave ≠ End; both idempotent. End: pause if needed → Tier-0 handoff → close.
- Handoff assembler (pure) names done / open / resume-next / evidence from typed events — no LLM invention, no transcript/audio keys.
- Rejoin: idempotent re-attach, feed/stage from event log, one factual “since you left” line, NowNext orients cursor.
- Resume CTA: End packet links to next open task; cross-day CTA owned with [DRV-PLAN-REENTRY](DRV-PLAN-REENTRY.md).
- `callSessionId` rules documented for leave→rejoin duration ([DRV-CALL-SESSION](DRV-CALL-SESSION.md)).

## Dependencies

- [DRV-LEAVE-END](DRV-LEAVE-END.md) ops (`call_end` still missing in hub), DRV-TASK-BANK snapshot, [DRV-EVENTS](DRV-EVENTS.md), [DRV-PRIVACY](DRV-PRIVACY.md). Soft: Obs slice 1 session binding.

## Surfaces touched

- `sdk/packages/drive/src/handoff.ts` (pure assembly)
- Hub leave/end/rejoin chrome + narration / structured handoff event
- NowNext resume orientation; Drive tab CTA via PLAN-REENTRY

## Agent tasks

- [ ] Implement Tier-0 handoff assembly (done / open / resume-next / evidence) from synthetic event history.
  - Owner package: `@cline/drive`
  - Verify: `bun -F @cline/drive test`
  - Done when: summary names files, outcomes, open items without invention; forbids utterance keys.
- [ ] Wire End: pause-after-tool → handoff render → close; Leave remains persist-only.
  - Owner package: `@cline/core` + hub
  - Verify: idempotency tests + live smoke leave/rejoin/end
  - Done when: double-end/leave are no-ops; End closes roster, Leave does not.
- [ ] Rejoin while-away orientation + NowNext cursor; catch-up reuses handoff assembly (not End document).
  - Owner package: `@cline/cline-hub`
  - Verify: leave → work → rejoin fixture
  - Done when: one factual since-left line + NowNext oriented.

## Risks

- Thin events → sparse but honest list. Mitigation: Tier 0 only; never hallucinate.
- Conflating catch-up with End handoff. Mitigation: second consumer of same assembler.
- Session id merge inflating duration. Mitigation: document + test leave→rejoin rules.
