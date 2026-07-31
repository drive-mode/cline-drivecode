# Slice 3 · Diagnose → propose → gate

**DRV:** [DRV-PLAN-IMPROVE](../../features/DRV-PLAN-IMPROVE.md)  
**Requires:** [slice 2](slice-2-local-session-rollup.md)  
**Privacy:** [ARD-0004](../../ard/ARD-0004-gated-learn-privacy.md)

## Outcome

Stall patterns produce gated planning proposals with evidence event ids. Accept writes durable skill/knowledge via existing compile path; reject/mute leave disk unchanged.

## Work

1. Pure stall classifier from `SessionRollup` + open `lastFailure` signals (stable reason codes).
2. Proposal schema `kind: planning` (skill patch / plan template / draft tasks) with evidence ids only.
3. Reuse or extend gated-learn accept queue UI.
4. Host-side planning skill invocation (not inside harness runtime).
5. Tests: reject path no write; accept path writes only allowed targets.

## Verify

- `@cline/shared` forbidden-key tests on proposal schema
- `@cline/drive` classifier fixtures
- Hub integration: accept vs reject

## Done when

A stalled fixture session yields one reviewable proposal; accepting it is the only durable write.

**Landed (2026-07-31):** `diagnoseAndPropose` + hub `PlanImproveGate` + `drive_plan_improve_resolve`. Accept writes under `.drive/plan-improve/` (template artifact or skill enqueue). Reject/mute leave disk unchanged. Host `.driveagent` compile remains out of band.

## Non-goals this slice

- Training or shipping a learned next-task sole writer
- Automatic plan mutation without accept
- Host skill compile into `.driveagent/` (enqueue file only)