# Requirements · Leave / End return loop

**DRV:** [DRV-RETURN-LOOP](../../features/DRV-RETURN-LOOP.md)  
**Amends:** [DRV-LEAVE-END](../../features/DRV-LEAVE-END.md)  
**Related:** DRV-NARRATION, DRV-NOWNEXT, DRV-CALL-SESSION, DEC catch-up orientation

## Problem

Leave/End today are ops. Satisfaction needs a **return loop**: structured handoff, while-away continuity, and a resume CTA aligned with the north star.

## User jobs

1. Leave safely knowing work continues and I can catch up in tasks, not transcripts.
2. End with a factual packet of done / open / resume-next.
3. Rejoin or return tomorrow and continue the plan in one action.

## Semantics

| | Leave | End |
|---|---|---|
| Room | Persists | Closes after handoff |
| Work | Continues | Pause-after-tool then close |
| Satisfaction | Presence boundary | Session close + proof |

## Handoff packet (Tier 0 — no hallucination)

| Bucket | Typed sources |
|---|---|
| Done | `drive_task_completed` / done tasks; successful work.* |
| Open | `BankSnapshot.openTaskIds`; `lastFailure` when set |
| Resume-next | `nowTaskId` / `nextTaskId` + titles |
| Evidence | edit paths, command outcomes, decisions |
| Counts-only summary | durationMs, completes, plan edits (DRV-CALL-SESSION) |

Assembler: `sdk/packages/drive/src/handoff.ts` (pure). Carrier: `conversation.narration` and/or structured handoff event.

## Rejoin UX

1. Idempotent re-attach.
2. Feed replay + stage from event log.
3. One factual “since you left” line (files, last command, open plan step) — no LLM invent.
4. NowNext orients cursor.
5. Catch-up summary is a **second consumer** of handoff assembly (not the End document).

## Acceptance criteria

1. Leave ≠ End; both idempotent.
2. End: pause if needed → Tier-0 handoff → close.
3. Synthetic event history → handoff names files, outcomes, open items without invention.
4. Rejoin shows while-away orientation + NowNext.
5. Resume CTA: End packet links to next open task; cross-day CTA owned with DRV-PLAN-REENTRY.
6. Summary/handoff forbid transcript/audio keys.
7. `callSessionId` rules documented for leave→rejoin duration.

## Dependencies

- DRV-LEAVE-END ops (`call_end` in hub)
- DRV-TASK-BANK snapshot, DRV-EVENTS, DRV-PRIVACY caps
- Soft: Obs slice 1 for session binding

## Risks

- Thin events → sparse but honest list
- Conflating catch-up with End handoff
- Session id merge inflating duration

## Open questions

1. Structured handoff object vs narration-only?
2. Continue-plan CTA on End (room closing) vs Drive tab only?
3. Catch-up copy owner (still open on ADR board)?
