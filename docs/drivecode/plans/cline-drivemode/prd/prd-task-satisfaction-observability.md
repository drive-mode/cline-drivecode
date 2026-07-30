# PRD 10 · Task-centric session satisfaction & closed-loop improvement

**Status.** Draft for leadership acceptance  
**Related.** [research/15](../research/15-task-satisfaction-observability.md), [research/16](../research/16-task-as-unit-models.md), [ARD-0015](../ard/ARD-0015-task-session-observability.md), [ARD-0008](../ard/ARD-0008-task-bank.md), [ARD-0004](../ard/ARD-0004-gated-learn-privacy.md), [prd-success-metrics](prd-success-metrics.md), initiative [task-satisfaction-observability](../initiatives/task-satisfaction-observability/)  
**Rule.** Metrics are verifiable signals, not timelines. Tasks are the unit of measurement.

## Problem

Without session-level task outcomes, Drive cannot tell whether a call helped the user accomplish intent. Phase-gate metrics (PRD success-metrics) prove smoke and privacy; they do not prove **satisfaction**. Users who cannot complete tasks in Drive will not keep using Drive. We also lack a privacy-safe path from “stuck session” → “better planning next time.”

## Goals

- Measure Drive sessions in **tasks** (and plan structure), not tokens or vanity funnels.
- Correlate call presence (join/leave) with bank lifecycle (complete, churn, drain).
- Treat post-success plan continuation as **positive engagement**.
- When sessions stall, diagnose from structured logs and **propose** planning improvements behind the same gated accept pattern as learn.
- Keep all MVP observability **local** (no phone-home Drive telemetry).

## Non-goals

- Replacing [prd-success-metrics.md](prd-success-metrics.md) phase/CI gates.
- First-class `Goal` entity (intent stays on `DrivePlan.title`).
- Learned model as sole writer of `nowTaskId` / plan refs.
- Transcript retention, utterance analytics, or silent PostHog Drive funnels in MVP.
- Survey / NPS machinery in MVP.

## Personas

| Persona | Need |
|---|---|
| Everyday Drive user | Sessions that finish work; clear recovery when stuck |
| Pair partner (agent) | Bound tasks; honest failure → fix-up proposals |
| Drive eng / PM | Local rollups that diagnose retention risk |
| Privacy-conscious user | No silent export of call content |

## Core concepts

### Call session

A bounded presence window: join → (work) → leave/end, identified by `callSessionId`. Duration and bank events correlate through this id (and `roomId`).

### Task as unit

`DriveTask` is the atomic accomplishment. Plans sequence tasks. Session success is primarily **tasks completed toward the active plan**, not message count or tokens.

### Session rollup (local)

Aggregate counts only: duration, tasks completed, mid-plan adds, clean-drain boolean, post-success plan edit, failure stickiness. No utterance text.

### Closed loop

Observe → Diagnose → Propose → Gate → Improve. Proposals may be planning skills, plan templates, or sibling fix-up tasks. Writes require accept.

## Requirements

### R1 · Instrumentation

1. Emit complete bank lifecycle events on the production hub path (`onBankEvent` → bank log).
2. Hub supports complete / bind / activate so completions are real in product sessions.
3. Emit plan-ref mutation events (or equivalent op log) for mid-plan adds.
4. Bind bank events to `callSessionId` / real `roomId`.
5. Optional leave/end summary event with **counts only** (no transcript).

### R2 · Metric set (session)

| ID | Metric | Pass / use |
|---|---|---|
| S1 | Session duration | Diagnostic; pair with S2 |
| S2 | Tasks completed / session | Primary accomplishment |
| S3 | Plan clean-drain | Plan held; goal roughly achieved without thrash |
| E1 | Post-success plan continue | Positive engagement |
| E2 | Intent refresh (new/activated plan or title) after progress | Positive goal redirect |
| E3 | Tasks / session-minute | Throughput diagnostic |
| P1 | Mid-plan add churn | Plan quality |
| P2 | Failure stickiness | Recovery pressure |
| A1/A2 | Diagnose→propose / propose→accept | Closed-loop health |

### R3 · Local dashboard / export

1. Hub or Status-adjacent local view of recent session rollups (opt-in / debug-visible).
2. Export is explicit; inherits DRV-PRIVACY redaction.
3. Prefer derivation from event logs over a parallel analytics store.

### R4 · Action on stall

1. Detect stall patterns (e.g. low S2 + high P1/P2, or open tasks with `lastFailure` past threshold events — threshold is a facet, not a calendar).
2. Run structured log analysis (event ids, artifact paths, skill ids).
3. Emit gated proposal: planning skill patch and/or plan/task drafts.
4. Human accept | reject | mute (ARD-0004).
5. Never auto-mutate durable knowledge or silently rewrite the active plan from a model.

### R5 · Task-as-unit doctrine

1. Product docs and dashboards speak in tasks and plans, not tokens.
2. Deterministic plan cursor remains source of truth for Now/Next.
3. Any next-task scorer is a **proposer** only ([research 16](../research/16-task-as-unit-models.md)).

### R6 · Product moments (call arc)

Lived satisfaction components are specified under [session-satisfaction-moments](../initiatives/session-satisfaction-moments/) (stuck recovery, felt agency, clean-drain, return loop, plan re-entry, Status sessions, shipped digest, recruit-on-stall, SDLC→bank). Visual plan: [visual-plan.md](../initiatives/session-satisfaction-moments/visual-plan.md).

## Acceptance criteria

- [ ] Documented metric definitions S1–S3, E1–E3, P1–P2, A1–A2 with derivation from existing or newly specified events.
- [ ] Instrumentation checklist (R1) mapped to DRV-CALL-SESSION / DRV-TASK-METRICS / DRV-TASK-BANK gaps.
- [ ] Privacy review: no new forbidden payload keys; no phone-home default.
- [ ] Closed-loop path specified against ARD-0004 (DRV-PLAN-IMPROVE).
- [ ] Leadership can answer the north-star question with evidence from a local smoke session.

## North-star question

> After a Drive session, did the user get enough completed work — and enough control over the plan — that they would start another?

## Dependencies

- DRV-TASK-BANK / ARD-0008 (primitive)
- DRV-EVENTS / bank events
- DRV-PRIVACY / ARD-0004
- DRV-LEAVE-END (session boundary)
- DRV-CALL-SESSION, DRV-TASK-METRICS, DRV-PLAN-IMPROVE (this PRD)

## Rollout (capability order)

1. Instrumentation complete (R1) — unblocks trustworthy S*/P*.
2. Local rollup + smoke verification (R3).
3. Stall diagnose → gated propose (R4).
4. Research track for learned proposers remains optional and behind accept.

## Open questions

See [research/15 § Open questions](../research/15-task-satisfaction-observability.md#open-questions) and [leadership brief](../leadership/BRIEF-task-satisfaction.md).
