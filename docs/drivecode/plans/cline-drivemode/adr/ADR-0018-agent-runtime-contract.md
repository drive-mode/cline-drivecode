# ADR-0018: Agent runtime contract (DriveTask v1 execution)

## Status

Accepted

## Metadata

- Date: 2026-08-02
- Accepted: 2026-08-02 (Drivecode planning — implementation track opened)
- Deciders: Drivecode planning (cline-drivemode)
- Related: ADR-0008, ADR-0004, ADR-0010, ADR-0015, ADR-0016, research 18, PRD 9

## Context

[Research 18](../research/18-task-as-execution-unit.md) treats `DriveTask` as the durable semantic unit of execution and lists seven decisions that must precede bank schema expansion. Today the tip has a working task bank (`DriveTask` / `DrivePlan` / hub `drive_bank_*`) but completion archives without a proof gate, `allowWorkspaceMutation` is advisory only, and there is no lease/CAS protocol. Kanban is an external launcher on main (`scripts/seed-drive-kanban.mjs` is **delivery tooling**, not product interop), not yet a managed execution host for DrivePlan.

Agents are the primary actors that perform bounded work. Humans remain the authority over commitments and verification. Without an agent-facing contract, teams either scrape boards, invent parallel Goal entities, or let host UIs silently complete durable tasks.

## Decision

### 1. Unit hierarchy (reconcile ADR-0008)

| Type | Role | Primary consumer |
|---|---|---|
| `DriveTask` | Durable outcome / user trust token | Human + product |
| `DrivePlan` | Ordered task checklist (ADR-0008) | Human + sequencer |
| `DriveRun` / `DriveRunSpec` | Approved decomposition of one task | Planner + controller |
| `DriveRunWorkItem` | Parallelizable piece of a run | Scheduler |
| `WorkLease` | Temporary agent authority (refines research-18 `TaskAttempt` / `DriveExecutionContext`) | Agent |
| Receipt | Evidence for accept or recover | Human / verifier |

Identity chain:

```text
DriveTask → DriveRun → DriveRunWorkItem ↔ KanbanCard ↔ Session / Worktree
```

**Naming:** `DriveRunWorkItem` is distinct from room-wave `DriveWorkItem` in `@cline/drive` waves. Do not overload the wave type for run admission.

A `DriveTask` is never equal to a Kanban card. “DrivePlan Controller” in prose means the **run admission controller**, not a rename of bank `DrivePlan`.

### 2. Research-18 decisions (locked choices)

1. **Scope.** Canonical bank and active plan are **workspace-backed** (current implementation truth; amends ADR-0008 room-scoped wording). Room/call ids may annotate events; they are not a second bank authority until a later accepted change.
2. **Completion authority.** Archival of a `DriveTask` requires a recorded verification decision when the task policy demands proof. **Kanban Done / trash never archives a DriveTask.** Human or designated verifier accepts or rejects a receipt.
3. **Evidence policy.** Allowed durable refs: changed paths, commit SHAs, test summaries / run ids, branch and PR URLs, bounded error classes, receipt artifact hashes. **Forbidden as durable coordination memory:** raw prompts, transcripts, images, full tool dumps, secrets, full terminal logs.
4. **Identity / concurrency.** Generated ids; every lease and command carries `runSpecRevision` + idempotency key; heartbeat/expiry on leases; optimistic revision / CAS required before multi-client mutable bank writers depend on it.
5. **Task ownership.** Users (and explicit product flows) create, reorder, split, archive, and override. Bound agents and planners may **propose** run work items, scope changes, and receipts. Only the run controller admits work. Agents cannot reorder the canonical plan or mark a `DriveTask` done.
6. **Integration boundary.** First named execution host adapter is **DriveKanban** (sibling fork product under ADR-0016 Route B). Status Hub, Director, and Team-like projections may correlate by id but are not authorities. Chat-fork remains recovery substrate (ADR-0014), not the lease coordinator.
7. **Learning gate.** No learned task scorer or autonomous plan mutator until privacy-safe structured history exists and local eval evidence is accepted.

### 3. WorkLease attachment

- Hang `WorkLease` off **`DriveTask.id`** (via execution context) at the **mutation / tool boundary**.
- Do **not** attach leases to `DriveHostPort` (room/Director/facets remain a parallel Hub surface).
- Lease includes: identity refs, objective, acceptanceCriteria, evidenceRequirements, workspaceFingerprint, isolation class, writeClaims, allowedActions, dependencyEvidence, budget, heartbeat/expiry.
- Agents receive a typed mission packet only — never the whole bank, raw room history, other agents’ private context, or a broad Hub bearer.

### 4. Two protocols

**Agent Control Protocol** (tools / SDK), capability-scoped:

- `driveplan.list_eligible_work`
- `driveplan.claim_work`
- `driveplan.get_context`
- `driveplan.report_progress`
- `driveplan.checkpoint`
- `driveplan.request_gate`
- `driveplan.request_scope_change`
- `driveplan.submit_receipt`
- `driveplan.release_work`

**DrivePlan–Kanban Interop Protocol** (host), narrow and idempotent:

- `getCapabilities()`
- `applyProjection()`
- `execute(allowedCommand)`
- `observe(cursor)`
- `collectReceipt()`

Full Interop wire shapes are deferred to **ADR-0019**. Managed cards use optional `externalRef` with `system: "driveplan"` (schema field required; Zod strips unknowns). For managed cards: disable dependency auto-start, auto-commit, and auto-PR. Evidence-ready state is **Review / awaiting Drive verification**, not trash. Human edits to projected cards yield `projection_diverged`.

### 5. Completion guard (inspired by curated `goal` plugin; not a dependency)

Premature “done” is refused. A receipt candidate plus verification decision are required before archive when policy says so. Do **not** introduce a parallel Goal entity beside `DriveTask` (aligns ADR-0015 / research 18).

### 6. Security and privacy

- Hub discovery; never hardcoded ports.
- Short-lived workspace/run-scoped capability for the host — not the Hub’s broad bearer.
- Approved execution packet only.
- Persist safe refs only (see evidence policy).
- TTS for Drive remains Drive `TtsPort` / drive-audio (Kokoro / browser speechSynthesis). Do **not** adopt curated remote [`speak`](https://github.com/cline/plugins/tree/main/plugins/speak) (ElevenLabs outbound text conflicts ADR-0004). Steal only the detached non-blocking TTS handoff pattern.
- ADR-0010 continues to reject remote URL/npm plugin install as an MVP product trust path. Prefer **workspace-local or vendored hook patterns** (not a hard dep on `cline plugin install` from [cline/plugins](https://github.com/cline/plugins)) for a managed-session policy pack inspired by:
  - [`goal`](https://github.com/cline/plugins/tree/main/plugins/goal) → receipt / refuse-early-complete (no parallel Goal entity)
  - [`env-blocker`](https://github.com/cline/plugins/tree/main/plugins/env-blocker) + [`gitignore-read-files-guard`](https://github.com/cline/plugins/tree/main/plugins/gitignore-read-files-guard) → privacy deny at tool boundary
  - [`branch-protector`](https://github.com/cline/plugins/tree/main/plugins/branch-protector) → Drive gate / approval UX instead of silent `--force-allow`
  - [`background-terminal`](https://github.com/cline/plugins/tree/main/plugins/background-terminal) → long-job presence correlated to a lease (summaries in receipts, not full logs)
  - [`agents-squad`](https://github.com/cline/plugins/tree/main/plugins/agents-squad) → handoff/lease shape only; Hub owns coordination, not the plugin’s handoff store

### 7. First implementation slice (after accept)

**Read-only managed projection for one `DriveTask` and one `DriveRun`.** Not board-wide sync. Not seed-as-product-path.

**Impl note (2026-08-02):** Schemas live in `@cline/shared` `drive/run.ts` (`DriveRun`, `DriveRunWorkItem`, `WorkLease`, `Receipt`) — not embedded in `bank.ts`. Narrow Interop stub: `@cline/drive` `kanbanInterop` (`getCapabilities` / `applyProjection` / `observe`). Sibling DriveKanban may carry `externalRef`. Agent Control tools and completion-guard enforcement remain follow-on.

## Consequences

**Positive**

- Agents get a machine-readable authority token without becoming bank writers.
- Humans keep verification; completion is auditable.
- Kanban can be a strong isolation/observation host without owning scheduling policy.
- Research-18 decision gate is answered in one place.

**Negative / Trade-offs**

- New types (`DriveRun`, `DriveRunWorkItem`, `WorkLease`, Receipt) and two protocols to maintain.
- DriveKanban fork work required for `externalRef` and managed-card behavior.
- Stricter completion may feel heavier for tiny tasks (mitigation: policy tiers / soft warnings first).

**Risks**

- Confusing bank `DrivePlan` with run controller naming — mitigate with glossary + this ADR’s table.
- Confusing wave `DriveWorkItem` with `DriveRunWorkItem` — keep names distinct.
- Treating seed tooling as product interop — explicitly forbidden here.

## Follow-on (not first PR)

1. **Agent Control Protocol tools** — `driveplan.list_eligible_work` … `release_work` at the mutation / tool boundary (replace advisory-only `allowWorkspaceMutation` in `driveLoop.ts`).
2. **Completion guard** — archive a `DriveTask` only with a receipt + verifier decision when policy requires proof.
3. **ADR-0019** — full DrivePlan–Kanban Interop wire shapes (`execute`, `collectReceipt`, capability negotiation).
4. **Live Hub state-plane view** — product UI wired to bank; design canvas `implementation-state-plane.html` stays fixture-only.
5. **Policy pack** — workspace-local / vendored hooks inspired by curated plugins; not remote `cline plugin install` (ADR-0010).

## Alternatives considered

- **Board.json sync / seed as bridge.** Rejected. Overwrites host state; random ids; no authority split.
- **Kanban as scheduler of record.** Rejected. Dependency auto-start and auto-review are insufficient for gates, budgets, and receipts.
- **Hang leases on DriveHostPort.** Rejected. Host port has no bank methods; bank is a parallel Hub path.
- **Adopt curated `goal` / `agents-squad` / `speak` as runtime.** Rejected as product dependencies (trust, privacy, Goal-type collision, control-plane ownership). Patterns may inspire implementation.
- **Sidecar-only ID map without card `externalRef`.** Rejected for product managed cards (Zod strips unknowns; managed UI needs on-card identity). Sidecar remains fine for unrelated delivery-seed mapping.

## References

- [Research 18 · Task as execution unit](../research/18-task-as-execution-unit.md)
- [Research 19 · ADR validation audit](../research/19-adr-validation-audit.md)
- [ADR-0008 · Task bank](ADR-0008-task-bank.md)
- [ADR-0004 · Gated learn / privacy](ADR-0004-gated-learn-privacy.md)
- [ADR-0010 · Provider harness / plugin trust](ADR-0010-provider-harness-byok.md)
- [ADR-0015 · Task-session observability](ADR-0015-task-session-observability.md)
- [ADR-0016 · Distribution (Route B)](ADR-0016-distribution-and-positioning.md)
- [PRD 9 · Task bank Drive loop](../prd/prd-task-bank-drive-loop.md)
- [PLAN-backlog-reconciliation](../delivery/PLAN-backlog-reconciliation.md)
- [initiative · driveplan-agent-runtime](../initiatives/driveplan-agent-runtime/README.md)
- Cursor canvas: `driveplan-agent-runtime.canvas.tsx` (workspace canvases)
- Deferred: ADR-0019 DrivePlan–Kanban Interop Protocol
