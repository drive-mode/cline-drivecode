# Visual plan · Session satisfaction moments

**Grade.** Nest Tier A Mermaid — parse-validate before merge.  
**Canvas.** [session-satisfaction-moments-canvas.html](../../../../design/canvases/session-satisfaction-moments-canvas.html)  
**Initiative.** [README.md](README.md)

Diagram first. Captions carry only what diagrams cannot.

---

## 1. System map (components × planes)

```mermaid
flowchart TD
  subgraph CallPlane["Call plane"]
    StuckRec["StuckRecovery"]
    FeltAg["FeltAgency"]
    CleanDr["CleanDrainRitual"]
    RetLoop["ReturnLoop"]
    RecruitSt["RecruitOnStall"]
  end
  subgraph HabitPlane["Habit plane"]
    PlanRe["PlanReentry"]
    SdlcBank["SdlcBankable"]
  end
  subgraph ProofPlane["Proof plane"]
    StatSes["StatusSessions"]
    Digest["ShippedDigest"]
  end
  subgraph DataPlane["Data plane"]
    Bank["DriveTask / DrivePlan"]
    Rollup["SessionRollup"]
    Events["Room + bank events"]
  end
  Events -->|"typed"| Rollup
  Bank -->|"BankSnapshot"| CallPlane
  Rollup -->|"counts"| ProofPlane
  Rollup -->|"S3 / E1"| CleanDr
  Bank -->|"lastFailure"| StuckRec
  StuckRec -->|"RecoveryProposal"| Bank
  RecruitSt -->|"drive_recruit"| CallPlane
  RetLoop -->|"HandoffPacket"| HabitPlane
  PlanRe -->|"joinCall"| CallPlane
  SdlcBank -->|"DriveTask drafts"| Bank
```

Caption:

- Call plane keeps the live session satisfying.
- Habit plane brings users back across days / guided starts.
- Proof plane is local and opt-in — not phone-home analytics.
- Data plane is shared with observability initiative (same events/rollups).

---

## 2. Session arc (user journey)

```mermaid
flowchart TD
  A["Join call"] --> B["Plan / Agent on bank"]
  B --> C{"Task fails or stalls?"}
  C -->|"yes"| D["StuckRecovery fork"]
  D --> E["Narrow / fix-up / recruit / pause"]
  E --> F["FeltAgency shows cursor"]
  C -->|"no"| F
  F --> G{"Plan clean-drains?"}
  G -->|"yes"| H["CleanDrainRitual invite"]
  H --> I["User continues or leaves"]
  G -->|"no"| I
  I --> J{"Leave or End?"}
  J -->|"Leave"| K["While-away on rejoin"]
  J -->|"End"| L["HandoffPacket + resume CTA"]
  K --> M["PlanReentry on Drive tab"]
  L --> M
  M --> N["StatusSessions / Digest"]
```

Caption:

- Every diamond is a product moment with a named `req-*.md`.
- Metrics (S*/E*/P*) observe the same arc; they do not replace the moments.

---

## 3. Dependency DAG (build order)

```mermaid
flowchart LR
  Obs1["Obs slice1 emit"]
  Obs2["Obs slice2 rollup"]
  BankOps["Hub failure/complete"]
  FA["FeltAgency"]
  RL["ReturnLoop"]
  SR["StuckRecovery"]
  CD["CleanDrain"]
  PR["PlanReentry"]
  ROS["RecruitStall"]
  SS["StatusSessions"]
  SD["ShippedDigest"]
  SB["SdlcBankable"]
  Obs1 --> Obs2
  BankOps --> SR
  BankOps --> FA
  Obs1 --> RL
  Obs2 --> CD
  Obs2 --> SS
  Obs2 --> SD
  Obs2 --> PR
  FA --> SR
  RL --> PR
  SR --> ROS
  SB --> BankOps
```

Caption:

- Felt agency can start as UI projection once bank snapshots update.
- Auto stall→fork waits on rollups; manual `lastFailure` fork can ship earlier.
- Digest and Status share `SessionRollup`; do not duplicate stores.

---

## 4. Component matrix

| Component | User job | Primary signal | Surface | DRV |
|---|---|---|---|---|
| Stuck recovery | Unstick Now without abandoning Drive | `lastFailure` / stall | Spotlight fork + accept | DRV-STUCK-RECOVERY |
| Felt agency | See that my steer/edit mattered | cursor / plan-ref change | NowNext + Spotlight | DRV-FELT-AGENCY |
| Clean-drain ritual | Celebrate + optionally ask for more | S3 true | Narration / NowNext successor | DRV-CLEAN-DRAIN |
| Return loop | Leave safely; End with proof; resume | handoff + bank | Feed + End CTA | DRV-RETURN-LOOP |
| Plan re-entry | Pick up unfinished work next day | open count + last rollup | Drive tab row | DRV-PLAN-REENTRY |
| Status sessions | See accomplishment across sessions | S2/S3/E1 | Status lens | DRV-STATUS-SESSIONS |
| Shipped digest | Export what Drive shipped | rollup export | Opt-in export | DRV-SHIPPED-DIGEST |
| Recruit-on-stall | Get the right agent for a stuck task | stuck task → recruit | Task card + seat | DRV-RECRUIT-STALL |
| SDLC bankable | Guided work still counts as tasks | freeze → DriveTasks | Plan posture accept | amends DRV-SDLC-GUIDE |

---

## 5. Decision forks (resolve before freeze)

```mermaid
flowchart TD
  F1{"Stuck fork auto or manual?"}
  F1 -->|"manual lastFailure first"| M1["W1 StuckRecovery"]
  F1 -->|"auto stall"| M2["After Obs slice2"]
  F2{"P1 churn vs collaborative adds?"}
  F2 -->|"UX source labels"| U1["FeltAgency source facet"]
  F2 -->|"metrics stay additive"| U2["Rollup unchanged"]
  F3{"Status lens vs debug?"}
  F3 -->|"product when R1 green"| S1["StatusSessions"]
  F3 -->|"debug until smoke"| S2["Keep DRV-TASK-METRICS gate"]
  F4{"End CTA where?"}
  F4 -->|"on End then rejoin"| E1["ReturnLoop"]
  F4 -->|"Drive tab only"| E2["PlanReentry owns CTA"]
```

Caption:

- Recommended defaults: manual fork first; UX source labels + rollup still counts adds; product Status when R1 green; End shows packet + Drive tab owns cross-day CTA.

---

## 6. Privacy spine (all components)

```mermaid
flowchart LR
  In["Events / bank ids"]
  Out["Surfaces / export"]
  Gate["Accept gate"]
  In -->|"no utterances"| Out
  In -->|"proposals"| Gate
  Gate -->|"accepted only"| Durable["Bank / .driveagent"]
```

Caption:

- Same rails as ADR-0004 / ADR-0015.
- Digest is the only user-triggered export path in MVP.

---

## Open questions (initiative)

1. Unified accept queue for recovery + learn + planning (`kind` tags)?
2. `pause plan` semantics (Ask override vs new status)?
3. Attribution `agentId` on `drive_task_completed` vs session correlation only?
4. Clean-drain ritual home: narration vs Spotlight vs NowNext successor?
5. Drive tab plan summary on list vs post-join only?

Detailed ACs live in each `req-*.md`. **Full remaining implementation checklist:** [REMAINING-task-satisfaction.md](../../delivery/REMAINING-task-satisfaction.md).
