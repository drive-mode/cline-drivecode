# Remaining work · Task satisfaction + session moments

**Status.** Living backlog (update as slices land)  
**Branch context.** Observability W0–W3 + Slice 2/P2 + Slice 3/W4 + **§2.5 retention caps** landed. Residual gaps below (moments chrome, host skill compile, privacy UI).  
**Related.** [task-satisfaction-observability](../initiatives/task-satisfaction-observability/) · [session-satisfaction-moments](../initiatives/session-satisfaction-moments/) · [PRD 10](../prd/prd-task-satisfaction-observability.md) · [ARD-0015](../ard/ARD-0015-task-session-observability.md) (Proposed)

This document is the **implementation checklist** for everything still open after the planning wave and the W0 instrumentation commit. Prefer amending this file over inventing parallel backlogs.

---

## Documentation map (read before building)

| Layer | Artifact | Role |
|---|---|---|
| Doctrine | [research/15](../research/15-task-satisfaction-observability.md), [research/16](../research/16-task-as-unit-models.md) | Why task = unit; mid-plan churn vs post-success engagement |
| Product | [PRD 10](../prd/prd-task-satisfaction-observability.md) | Metrics S*/E*/P*, privacy, non-goals |
| Decision | [ARD-0015](../ard/ARD-0015-task-session-observability.md) (**Proposed**) | Local-first session observability + gated improve |
| Leadership | [BRIEF-task-satisfaction](../leadership/BRIEF-task-satisfaction.md) | Dual-proxy defaults; open forks |
| Observability slices | [task-satisfaction-observability/](../initiatives/task-satisfaction-observability/) | Slice 1 emit · Slice 2 rollup · Slice 3 diagnose/propose |
| Product moments | [session-satisfaction-moments/](../initiatives/session-satisfaction-moments/) | Nine `req-*.md` + [visual-plan](../initiatives/session-satisfaction-moments/visual-plan.md) |
| Feature specs | `features/DRV-{CALL-SESSION,TASK-METRICS,PLAN-IMPROVE,STUCK-RECOVERY,FELT-AGENCY,CLEAN-DRAIN,RETURN-LOOP,PLAN-REENTRY,STATUS-SESSIONS,SHIPPED-DIGEST,RECRUIT-STALL}.md` | Per-DRV ACs |
| Canvas | [session-satisfaction-moments-canvas.html](../../../design/canvases/session-satisfaction-moments-canvas.html) | Arc overview |
| Harness note | [09-next-task-proposer](../../drivecode-sdk/delivery/09-next-task-proposer.md) | Deterministic bank cursor; scorers propose only |
| **This file** | delivery checklist | Build order + open vs shipped; amend as work lands |

---

## 0. Snapshot: done vs open

```mermaid
flowchart TD
  subgraph Done["Done on branch"]
    CS["callSessionId mint/reuse/close"]
    Emit["bank emit spine"]
    HubOps["hub complete/bind/activate/failure"]
    Log["bank JSONL onBankEvent"]
    Rollup["deriveSessionRollup pure"]
    Bridge["Hub webview/CLI bank bridge"]
    Felt["Felt agency chrome + steer"]
    Reader["Session rollup reader + debug dump"]
    P2ev["drive_task_failed / P2 stickiness"]
    CleanDrain["Clean-drain ritual invite"]
    PlanReentry["Plan re-entry row + chips"]
    RecruitStall["Recruit-on-stall + agentId"]
    StatusSessions["Status Hub sessions lens"]
    ShippedDigest["Opt-in shipped digest"]
    SdlcBank["SDLC freeze → bankable tasks"]
    StallClass["Stall classifier + auto fork"]
    PlanImprove["Gated plan-improve propose/accept"]
    Retention["Room/bank JSONL retention caps"]
  end
  subgraph OpenObs["Open · observability residuals"]
    PrivUI["debugRetention UI + raised caps wire"]
    PrivRetentionFacet["privacy.retention durable facet"]
  end
  subgraph OpenMoments["Open · residual moments"]
    W1Gaps["W1.1 redirect / feed narration"]
    HostSkill["Host .driveagent skill compile"]
  end
  Done -->|"honesty gate"| OpenObs
  Done -->|"honesty gate"| OpenMoments
  Bridge --> Reader
  Reader --> StallClass
  StallClass --> PlanImprove
  Felt --> W1Gaps
  CleanDrain --> SdlcBank
  PlanReentry --> StatusSessions
  RecruitStall --> StatusSessions
  StatusSessions --> ShippedDigest
  StatusSessions --> SdlcBank
  Retention --> PrivUI
```

Caption:

- Kernel correlation + pure rollup + local reader/debug dump exist; **product path** emits complete/bind/failure via hub webview bank bridge.
- Hub commands + webview protocol expose complete/bind/activate/failure with `roomId` / `callSessionId`.
- `drive_task_failed` + P2 stickiness in `deriveSessionRollup` landed (REMAINING §2.3 Option A).
- Felt agency (W1.1) chrome + mid-turn steer path landed; return loop (W1.2) + stuck recovery fork (W1.3 manual) landed.
- Clean-drain ritual (W2.1) NowNext successor + soft invite landed; invite ≠ auto E1.
- Plan re-entry (W2.2) unfinished-plan row + rollup chips + Resume landed.
- Recruit-on-stall (W2.3) Who-should-take-this + `call_seat` + optional `agentId` on bind/complete landed.
- Status Hub sessions mode (W3.1) landed — `StatusSessionRollupSource` / `statusSessions.ts` + hub `/status` fourth mode.
- Shipped digest (W3.2) landed — opt-in Markdown/JSON export (`shippedDigest.ts`, Status/Settings button, `cline doctor shipped-digest`).
- SDLC bankable (W3.3) landed — `sdlcBankable.ts` + `drive_bank_accept_sdlc_freeze` + Plan-posture accept chip; **stage freeze cards still stubbed**.
- **Slice 3 + W4.1/W4.2 landed:** pure `classifyStall` / `diagnoseAndPropose`; auto stall opens same gated `StuckRecoveryFork` (deduped with manual lastFailure); post-session `PlanImproveGate` (`kind: planning`) with accept→`.drive/plan-improve/` only (host `.driveagent` skill compile still out of band).
- **§2.5 retention caps landed:** room `events.jsonl` default max **2048** records; bank `events.jsonl` default max **4096**; trim-oldest on append. Catalog has live `privacy.debugRetention` (default `false`); call-strip indicator + raised debug caps wiring still open. Durable `privacy.retention` facet still not in live catalog.
- ARD-0015 remains **Proposed** (leadership accept still open).
---

## 1. Shipped (do not re-implement)

| Item | Where |
|---|---|
| `callSessionId` on room + bank event bases | `@cline/shared` `events.ts`, `bankEvents.ts`, `callSession.ts` |
| Leave `durationMs` when last human leaves; re-join mints new id | `DriveRoomStore.join/leave` |
| Bank emits: opened, activated (incl. create+activate), bound, completed, failed, archived, plan_step (adds), plan_archived | `bankStore.ts` |
| Hub bank log wire | `drive-bank-handlers` → `appendBankLogEvent` |
| Room/bank JSONL retention caps (DRV-PRIVACY) | `logRetention.ts` — room 2048 / bank 4096; `privacy.debugRetention` catalog (UI wire residual) |
| Hub commands: `drive_bank_complete_task`, `bind_now`, `activate_plan`, `record_failure` | `hub.ts` + transport + handlers |
| Hub webview bridge: protocol frames + `drive-bank` forward + `bankSession` mutators + PlanEditor complete / Agent bind / tool failure | `apps/cline-hub` webview + server |
| Felt agency (W1.1): interrupt chrome, plan-edit consequence, recovery vs collaborative add, mid-turn steer chip | `agencyChrome.ts`, DriveCallChrome, NowNext, PlanEditor, server send steer, Composer |
| Stuck recovery (W1.3): Spotlight fork after `nowLastFailure`; gated narrow / fix-up / recruit stub / pause(Ask) | `stuckRecovery.ts`, `StuckRecoveryFork.tsx`, Chat Spotlight |
| Clean-drain (W2.1): S3 gate + NowNext successor invite (invite ≠ E1) | `@cline/drive` `cleanDrain.ts`; NowNext successor; Chat counters |
| Plan re-entry (W2.2): unfinished-plan row + rollup chips + Resume | `planReentry.ts`, `PlanReentryRow`; Drive chrome off-call |
| Recruit-on-stall (W2.3): Who-should-take-this + call_seat + agentId | `recruit/scoreNeed.ts`, `RecruitStallPicker`, `call_seat`, bank `agentId` |
| Status Hub sessions (W3.1): fourth mode + S2/S3/E1 + drill | `@cline/drive` `statusSessions.ts`; hub `StatusSessionsPanel`; `StatusSessionRollupSource`; `?demoSessions=1` |
| Shipped digest (W3.2): opt-in Markdown/JSON export | `@cline/drive` `shippedDigest.ts`; Status/Settings export; `cline doctor shipped-digest` |
| SDLC bankable (W3.3): freeze accept → DriveTasks + plan | `@cline/drive` `sdlcBankable.ts`; hub `drive_bank_accept_sdlc_freeze`; `SdlcFreezeAcceptChip` (stage UI stubbed) |
| Stall classifier + auto fork (W4.1): `classifyStall` → same gated `StuckRecoveryFork` | `@cline/drive` `stallClassifier.ts`; hub `stuckRecovery` autoStallOffer + Chat Spotlight |
| Plan-improve Slice 3 (W4.2): diagnose → `kind: planning` → accept/reject/mute | `@cline/shared` `planningProposal.ts`; `@cline/drive` `planImprove.ts`; hub `PlanImproveGate` + `drive_plan_improve_resolve` |
| Join/leave reply includes `callSessionId` / `durationMs` | `drive-room-handlers` |
| Pure `deriveSessionRollup` (S1–S3, E1–E3, P1–P2) | `@cline/drive` `sessionRollup.ts` |
| `drive_task_failed` emit + P2 stickiness | `bankStore.recordTaskFailure` → `deriveSessionRollup.failureStickyCount` |
| Session rollup reader + local debug dump | `@cline/core` `sessionRollupReader.ts`; hub `drive_session_rollups`; Drive Settings dump; `cline doctor session-rollups` |
| Planning docs, DRVs, visual plan, canvas | `docs/drivecode/...` |

**Verified:** `@cline/drive` / `@cline/shared` tests green; core unit green aside from known cloud git `insteadOf` artifact.

---

## 2. Observability remaining (foundation)

### ~~2.1 Hub webview + server bridge (blocks live product path)~~ ✅ done

**Why.** Kernel commands exist; Chat/Drive UI still only speaks `get|seed|create_task|edit_plan_tasks`. Completions in product sessions will not hit the bank log until this lands.

| Work | Owner | AC |
|---|---|---|
| ~~Extend `webview-protocol.ts` host↔webview frames for complete/bind/activate/record_failure~~ | `@cline/cline-hub` | Types compile; frames round-trip |
| ~~Forward in `server/drive-bank.ts` + allowlist in `server.ts`~~ | `@cline/cline-hub` | Hub invokes new `drive_bank_*` commands |
| ~~Extend `bankSession.ts` request helpers + callers (complete on task done, bind on Agent posture, failure on tool fail)~~ | hub webview | Live smoke: complete one task → bank JSONL has `drive_task_completed` with matching `callSessionId` |
| ~~Pass `roomId` + `callSessionId` from session into every bank op~~ | hub webview | Log correlation test / manual smoke |
| ~~Tests in `bankSession.test.ts`~~ | hub | Snapshot + error paths |

**Deps:** W0 (done).  
**Docs:** amend [DRV-TASK-BANK](../features/DRV-TASK-BANK.md), [slice-1](../initiatives/task-satisfaction-observability/slice-1-instrumentation.md).

**Shipped:** webview frames + server bridge; `DriveUiState.callSessionId` from join/leave `room_snapshot`; PlanEditor ✓ → `mutateBankCompleteTask`; Agent posture bind-once; failed `tool_event` → `mutateBankRecordFailure`; activate helper exported.
### ~~2.2 Slice 2 UI — local rollup surface~~ ✅ done

**Why.** `deriveSessionRollup` is pure-only; nothing reads room+bank logs into a product or debug view.

| Work | Owner | AC |
|---|---|---|
| ~~Reader: load room JSONL + bank JSONL for a `callSessionId` (or recent sessions)~~ | `@cline/core` | `readSessionRollups` / `createFsSessionRollupSource` + tests |
| ~~Debug panel or CLI dump of last N `SessionRollup`s~~ | hub + CLI | Drive Settings dump + `cline doctor session-rollups`; localhost only |
| ~~Wire rollup chips into future Status lens (see 3.6) without duplicating store~~ | composition root | Shared `SessionRollupSource` port; **W3.1 Status sessions mode landed** |

**Deps:** 2.1 for honest live data.  
**Docs:** [slice-2](../initiatives/task-satisfaction-observability/slice-2-local-session-rollup.md), [DRV-TASK-METRICS](../features/DRV-TASK-METRICS.md).

**Shipped:** FS reader over room + bank JSONL → `deriveSessionRollup`; hub `drive_session_rollups`; Drive Settings “Dump last rollups”; CLI `doctor session-rollups`.

### ~~2.3 P2 failure stickiness (event or correlated)~~ ✅ done

**Why.** Rollup `failureStickyCount` was hard-coded `0` — no failure bank event existed; only `lastFailure` on disk.

| Option | Choice |
|---|---|
| **A (shipped)** | Emit `drive_task_failed` (taskId only; note stays on disk `lastFailure`) from `recordTaskFailure` |
| B | Derive P2 offline from task files + complete events (FS archaeology) — not chosen |

**P2 definition:** count of distinct `taskId`s with ≥1 in-session `drive_task_failed` and no later `drive_task_completed` for that id (recovery pressure still open).  
**Docs:** PRD 10 P2 + [DRV-TASK-METRICS](../features/DRV-TASK-METRICS.md).

### ~~2.4 Slice 3 — diagnose → propose → gate~~ ✅ done

See [slice-3](../initiatives/task-satisfaction-observability/slice-3-diagnose-propose-gate.md) and [DRV-PLAN-IMPROVE](../features/DRV-PLAN-IMPROVE.md).

| Work | Owner | AC |
|---|---|---|
| ~~Pure stall classifier (`SessionRollup` + open `lastFailure`) → reason codes~~ | `@cline/drive` | `classifyStall` fixtures: low S2 / high P1 / sticky P2 |
| ~~Proposal schema `kind: planning` (evidence = event ids / paths / skill ids only)~~ | `@cline/shared` | Forbidden-key tests on `PlanningProposal` |
| ~~Accept \| reject \| mute UI (parallel queue tagged `kind: planning`)~~ | hub | `PlanImproveGate`; reject/mute leave disk unchanged |
| ~~Accept durable write (allowed targets only)~~ | hub + `@cline/drive` | Accept → `.drive/plan-improve/` artifact or skill enqueue file; **not** `.driveagent` compile |

**Deps:** 2.1–2.2. Distinct from in-call [DRV-STUCK-RECOVERY](../features/DRV-STUCK-RECOVERY.md) (post-session / after End only).

**Residual gaps (honest):**

- Host planning-skill **compile into `.driveagent/`** is still out of band — accept enqueues `planning_skill` under `.drive/plan-improve/queue/` for the host; no second agent runtime in `@cline/drive`.
- Unified learn-queue UI with knowledge-graph learn (ARD-0004 W-39) not merged — parallel `kind: planning` gate shipped instead.
- Stall policy thresholds are constants (`DEFAULT_STALL_POLICY`); facet `privacy` / stall facets not in live catalog yet.
- Feed narration of recovery / plan-improve proposals still open (W1.3 residual).
- Mid-call auto fork uses session counters + open `lastFailure`, not a full JSONL re-rollup each tick.

### 2.5 Retention caps + privacy facets — **partial (caps done)**

| Work | Note |
|---|---|
| ~~Implement room/bank history caps from DRV-PRIVACY~~ | **Done:** `logRetention.ts` — room default **2048**, bank default **4096**; trim-oldest on append (`JsonlRoomEventLog` / `appendBankLogEvent` / `MemoryRoomEventLog`). Configurable via `maxRecords`. Debug raised caps constants exported (`DEBUG_*`) for later wire. |
| `privacy.debugRetention` facet | **Partial:** live catalog entry (`defaultValue: false`, session scope). **Still open:** call-strip visible indicator; wire facet → `DEBUG_*` caps; durable `privacy.retention` facet still planned-only. |

---

## 3. Product moments remaining (by wave)

Requirements already exist under [session-satisfaction-moments/](../initiatives/session-satisfaction-moments/). This section is the **build order + gaps vs those reqs**.

### W1 — Keep the call alive

| ID | Component | Req | Key remaining work |
|---|---|---|---|
| W1.1 | [DRV-FELT-AGENCY](../features/DRV-FELT-AGENCY.md) | [req-felt-agency](../initiatives/session-satisfaction-moments/req-felt-agency.md) | **Landed (partial):** agency interrupt chrome (finishing/paused); PlanEditor → BankSnapshot consequence banner; recovery vs collaborative add (`nowLastFailure`); mid-turn send → steer pending prompts + Composer chip + “Steer applied”. **Still open:** interrupt redirect Now rewrite announce (W-13); optional plan-ref `source` facet; Spotlight delta beyond NowNext/agency banner |
| W1.2 | [DRV-RETURN-LOOP](../features/DRV-RETURN-LOOP.md) | [req-leave-end-return](../initiatives/session-satisfaction-moments/req-leave-end-return.md) | **Landed (partial):** `call_end` + `control.end`; pure `handoff.ts` Tier-0 packet; End narration; rejoin “since you left” line; Leave≠End chrome. **Still open:** End→next-task resume CTA / Drive tab row (W2.2 PLAN-REENTRY) |
| W1.3 | [DRV-STUCK-RECOVERY](../features/DRV-STUCK-RECOVERY.md) | [req-stuck-recovery](../initiatives/session-satisfaction-moments/req-stuck-recovery.md) | **Landed:** Spotlight `StuckRecoveryFork` after `nowLastFailure` **and** auto stall classifier (W4.1); gated narrow / fix-up / recruit→W2.3 picker / pause(Ask+raise-hand); dismiss mutes identical offerKey; manual+auto deduped. **Still open:** feed narration of proposal |

**W1 honesty deps:** 2.1 bank bridge; interrupt/steer/now-next already partially shipped.

**Leadership forks still open (block freeze):**

1. Stuck fork: manual-only vs auto — **shipped both (deduped)**; leadership may still prefer manual-only.  
2. Pause-plan semantics (default: Ask override, no new status).  
3. Must every in-band fix-up gate? (tension ARD-0008 “may propose” vs ARD-0015 accept).
4. Host `.driveagent` compile on plan-improve accept vs enqueue-only (enqueue shipped).
5. Unify planning gate with gated-learn knowledge queue?

### W2 — Habit + multi-agent

| ID | Component | Req | Key remaining work |
|---|---|---|---|
| W2.1 | [DRV-CLEAN-DRAIN](../features/DRV-CLEAN-DRAIN.md) | [req-clean-drain-ritual](../initiatives/session-satisfaction-moments/req-clean-drain-ritual.md) | **Landed:** S3 gate via snapshot transition + session counters; NowNext successor + narration invite; Set next goal → Plan mode (invite ≠ E1); dismissible |
| W2.2 | [DRV-PLAN-REENTRY](../features/DRV-PLAN-REENTRY.md) | [req-cross-day-return](../initiatives/session-satisfaction-moments/req-cross-day-return.md) | **Landed:** off-call PlanReentryRow (title + open count + S2/S3/E1 chips); Resume → joinDrive; drafts omitted |
| W2.3 | [DRV-RECRUIT-STALL](../features/DRV-RECRUIT-STALL.md) | [req-recruit-on-stall](../initiatives/session-satisfaction-moments/req-recruit-on-stall.md) | **Landed:** Who-should-take-this picker; lexical rank; `call_seat`; optional `agentId` on bind/complete |

**W2 forks:**

1. Clean-drain primary surface (narration vs NowNext vs Spotlight).  
2. Plan summary on list vs post-join only.  
3. Attribution: extend `drive_task_completed` with `agentId` vs session correlation only.

### W3 — Proof + guided

| ID | Component | Req | Key remaining work |
|---|---|---|---|
| W3.1 | [DRV-STATUS-SESSIONS](../features/DRV-STATUS-SESSIONS.md) | [req-status-accomplishment](../initiatives/session-satisfaction-moments/req-status-accomplishment.md) | **Landed:** Status Hub `sessions` mode; S2/S3/E1 chips; drill to room/bank via `callSessionId`; port-only (`StatusSessionRollupSource`); demo at composition root (`?demoSessions=1`) |
| W3.2 | [DRV-SHIPPED-DIGEST](../features/DRV-SHIPPED-DIGEST.md) | [req-value-proof-digest](../initiatives/session-satisfaction-moments/req-value-proof-digest.md) | **Landed:** opt-in schema + Markdown/JSON builder; Status sessions + Drive Settings export; `cline doctor shipped-digest`; privacy/redaction tests; default off |
| W3.3 | Amends [DRV-SDLC-GUIDE](../features/DRV-SDLC-GUIDE.md) | [req-sdlc-bankable](../initiatives/session-satisfaction-moments/req-sdlc-bankable.md) | **Landed (partial):** `buildSdlcFreezeAcceptPlan` / `acceptSdlcFreeze` / hub `drive_bank_accept_sdlc_freeze` / Plan accept chip. **Stub:** W-44 stage freeze checklist UI — set `pendingSdlcFreeze` to exercise accept |

### ~~W4 — Auto + post-session~~ ✅ done (residuals noted)

| ID | Component | Key remaining work |
|---|---|---|
| ~~W4.1~~ | Auto stall → Spotlight fork | **Landed:** `classifyStall` drives W1.3 fork without raise-hand; deduped with manual lastFailure |
| ~~W4.2~~ | Post-session plan-improve | **Landed:** Slice 3 diagnose → `PlanImproveGate` after End; accept → `.drive/plan-improve/` only |

**W4 residuals for leadership:** host `.driveagent` skill compile path; unified learn queue; stall policy as facet; feed narration.

---

## 4. Cross-cutting / process

| Item | Status | Action |
|---|---|---|
| ARD-0015 leadership accept | Proposed | Accept or amend on status board |
| Dual proxy default (S3+E1) | Leadership default in brief | Confirm or elevate S1 |
| Accept-queue unification (`kind`: learn / planning / recovery) | Default: reuse | **Partial:** `kind: planning` + `kind: recovery` shipped as parallel gates; knowledge learn queue unify still open |
| TASK-GRAPH indexing | Satisfaction DRVs not in phase gates yet | Add Phase 2+ optional gate note when W1 starts |
| CLI Drive join/leave parity | CLI chrome often local-only | Required if CLI counts toward metrics ([DRV-CALL-SESSION](../features/DRV-CALL-SESSION.md)) |
| `call_end` still missing from hub command union | Done (W1.2) | `HubCommandName` + transport + webview + End chrome |
| History retention caps | **Partial** | Caps done (room 2048 / bank 4096). Residual: debugRetention UI + raised-cap wire; `privacy.retention` durable facet |

---

## 5. Recommended implementation sequence

```text
1. ~~Hub bank bridge (2.1)~~ ✅
2. ~~W1.1 Felt agency~~ ✅ (chrome + steer path; redirect Now rewrite + plan-ref `source` still open — see §3 W1.1)
3. ~~W1.2 Return loop (call_end + handoff)~~ ✅ (resume CTA / Plan-reentry Drive tab still open — see §3 W1.2)
4. ~~W1.3 Stuck recovery (manual)~~ ✅ (+ W4.1 auto classifier)
5. ~~Slice 2 UI reader (2.2)~~ ✅
6. ~~Failure event for P2 (2.3)~~ ✅
7. ~~W2.1 Clean-drain~~ ✅
8. ~~W2.2 Plan re-entry~~ ✅
9. ~~W2.3 Recruit-on-stall (+ agentId)~~ ✅
10. ~~W3.1 Status sessions lens~~ ✅
11. ~~W3.2 Shipped digest~~ ✅
12. ~~W3.3 SDLC bankable (accept writer; stage UI stub)~~ ✅
13. ~~Slice 3 + W4 auto stall / plan-improve~~ ✅ (host skill compile + unified learn queue still open — see §2.4 residuals)
14. ~~§2.5 room/bank retention caps~~ ✅ (`privacy.debugRetention` UI + raised-cap wire + `privacy.retention` still open — see §2.5)
```

No calendar estimates — order is dependency-only.

---

## 6. Documentation debt (complete before / with each build)

| When | Doc updates |
|---|---|
| After 2.1 | Mark slice-1 “product path wired”; update DRV-TASK-BANK agent tasks |
| After 2.2 | ~~Mark slice-2 UI done; link Status~~ ✅ |
| After 2.3 | ~~P2 via `drive_task_failed`; PRD 10 / DRV-TASK-METRICS~~ ✅ |
| After 2.4 / W4 | ~~Mark slice-3 + W4.1/W4.2; note host skill / unified queue residuals~~ ✅ |
| Before W1 freeze | Resolve §3 W1 forks in BRIEF or DEC |
| On ARD-0015 accept | Flip status board Proposed → Accepted |
| After each DRV lands | Check off ACs on feature file; update this remaining list |
| Wireframe | Amend `DRIVE-TAB.md` / HTML when Plan-reentry row ships |

---

## 7. Explicit non-goals (still)

- Phone-home Drive telemetry / PostHog funnels  
- NPS / survey machinery  
- Learned sole writer for Now/Next  
- First-class Goal entity  
- Training a task model inside `@cline/drive`

---

## 8. Open questions index (consolidate)

From research / briefs / reqs — still unresolved:

1. Dual proxy: S3+E1 vs elevate duration?  
2. Accept-gate owner / unified queue?  
3. Hub task completion as hard gate for any satisfaction *claims*? (**Satisfied by 2.1 bridge.**)  
4. Healthy mid-plan add churn threshold?  
5. Backfill local history vs clock at instrumentation-complete?  
6. Stuck auto vs manual? **Default shipped: both** (manual lastFailure + auto classifier; deduped). Leadership may still prefer manual-only.  
7. Pause-plan meaning?  
8. Clean-drain home surface?  
9. Plan re-entry on list vs after join?  
10. `agentId` on bank complete events? **Shipped optional.**  
11. Digest format / window / include P*? **Shipped opt-in Markdown/JSON.**  
12. SDLC Musts → 1:1 tasks vs epic? **Accept writer ships 1:1; stage UI stub.**  
13. Host `.driveagent` compile on plan-improve accept vs enqueue-only? **Enqueue-only shipped; compile still open.**  
14. Unify planning gate with gated-learn knowledge queue? **Parallel `kind: planning` shipped; unify still open.**

Track answers in [BRIEF-task-satisfaction](../leadership/BRIEF-task-satisfaction.md) or a DEC when decided.
