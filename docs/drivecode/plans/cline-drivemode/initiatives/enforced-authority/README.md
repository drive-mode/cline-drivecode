# Enforced authority

**Status:** Accepted (2026-08-03) — Impl `partial`
**ADR:** [ADR-0025](../../adr/ADR-0025-enforced-authority.md) (Accepted —
declared authority must be enforced authority), implementing decisions already
taken in
[ADR-0018](../../adr/ADR-0018-agent-runtime-contract.md),
[ADR-0022](../../adr/ADR-0022-agent-economics.md), and
[ADR-0023](../../adr/ADR-0023-agent-spawn-governance.md)
**DRV:** [DRV-GATES](../../features/DRV-GATES.md), [DRV-TASK-BANK](../../features/DRV-TASK-BANK.md)
**Evidence:** [research/23](../../research/23-agent-first-design.md),
[research/24](../../research/24-scale-and-context.md)

## Purpose

Close the gap between authority this repo declares and authority it enforces.

Most of the design already exists and is correct. `capPreset` implements the
min-rule; `assertCompletionReceipt` is a sound guard; `buildDelegatedAgentConfig`
already accepts and forwards tool policies; `cron-runner` already demonstrates
the deny-by-default allowlist shape. The work here is almost entirely **wiring
existing code to paths that can refuse an action**, not new design.

Two ADRs this depends on are `Proposed` with `Impl: none`. Slices that implement
them are marked; they should not land ahead of their decision being accepted.

## Ordering principle

Live holes before missing features — [ADR-0023](../../adr/ADR-0023-agent-spawn-governance.md)
§1's rule: *"This ships before any new capability, because it is the hole that
exists."*

Slices L1-L4 are defects on `main` today. Everything after them is a decision
being implemented.

## Slices

### Live holes

| Slice | Status | Notes |
|---|---|---|
| **L1** · Delegation must not widen authority | **done** | Parent authority threaded through `createSessionSpawnTool`, `spawnTeamTeammate`, and `buildDelegatedAgentConfig` (`intersectToolPolicies`). Locked by `sdk/packages/core/src/runtime/enforced-authority-consumer.test.ts` (ADR-0025 E1 slice for this hole). |
| **L2** · Bound spawn depth and concurrency | proposed | ADR-0023 §1 for chat forks. Separately, `spawn-agent-tool.ts` has no concurrency, queue, or depth construct at all, and the runtime executes tool calls in parallel — one turn emitting N spawns starts N sub-agents, each able to spawn. Team runs already have an admission scheduler to route through |
| **L3** · Room fold survives retention | **partial** | Fold `checkpoint.json` on trim + hydrate from checkpoint + tail ([ADR-0029](../../adr/ADR-0029-room-hotpath-redesign.md) slice 1). Hydrate no longer skips via process-global `appliedEventIds`. Remaining: per-room id set hygiene / raise trim watermark (research/24). |
| **L4** · Stop persisting team state per token delta | proposed | `onTeamEvent` calls `persistRuntime(exportState())` with no event-type filter; `exportState` copies every run including its `AgentResult`. Cost grows with session length times agent count. Filter, debounce, and stop storing a full result in a per-event-serialized record |

### Enforcement

| Slice | Status | Notes |
|---|---|---|
| **E1** · Enforcement-consumer test | **partial** | L1 / Finding 2 consumers locked (`enforced-authority-consumer.test.ts`). Broad “every declared authority type” matrix still open — ship remaining rows with their wiring slices, not as a red suite. |
| **E2** · `effectivePreset` → `ToolPolicy` | proposed | ADR-0023 §3. Already tracked as **D1** in [defaults-delivery.md](../../delivery/defaults-delivery.md) ("wire `capPreset = min(parent, child)` into `call_seat`"). The preset→tool-name table must live in `@cline/core`; `sdk/packages/drive/src/import-boundary.test.ts` forbids value imports from `@cline/shared` in drive source. Needs an optional field on `AgentParticipantSchema`, which is `.strict()` — a schema rev |
| **E3** · Make `ToolPresets.plan` say what it grants | proposed | Documented "read-only, no shell access", ships `enableBash: true` — **the grant is correct and the comment is stale.** `prompt/cline.ts:25-31` records that `run_commands` stays available in plan mode for read-only investigation and `cline.test.ts:36-44` locks it. Fix the comment; add the missing `presets.test.ts` assertion, since nothing currently pins the tool *present*. Blocks E2 only in the sense that a preset ceiling must read flags, never preset names |
| **E4** · Deny-by-default posture | proposed | ADR-0025 §3. Opt-in at the SDK boundary — inverting `resolveToolPolicy` changes a documented `@default true` and the tool-list filters read `enabled` without `autoApprove`, so a naive flip empties the tool list rather than prompting. Product surfaces select the closed posture separately. Also closes the CLI approval-controller short-circuit and decides whether `beforeTool` hooks may widen |
| **E5** · `presetIntent` survives compilation | proposed | `compileDriveagentHome` validates `permissions` and drops it; `CompiledDriveagentView` has no field for it. Type-only change. Note nothing turns a compiled home into a running agent yet, so this is a build-out |

### Verification

| Slice | Status | Notes |
|---|---|---|
| **V1** · `DriveRun` persistence | proposed | ADR-0018 follow-on #2. `assertCompletionReceipt` returns immediately when no run is bound, and nothing persists a `DriveRun`, so the guard never runs. Until this lands, the verification row has no owner |
| **V2** · Verifier identity | proposed | ADR-0025 §4. `decidedBy` becomes required on an accepted receipt and is checked against the agent bound to the run; identity comes from tool context, never the model. Depends on V1 |
| **V3** · Evidence taxonomy with teeth | proposed | `evidenceRefs` is an unvalidated `string[]`; ADR-0018 §2.3's allowed/forbidden list is prose only. The forbidden-key scanner pattern already used by stall, plan-improve, and recruit is the shape to reuse |

### Budgets

| Slice | Status | Notes |
|---|---|---|
| **B1** · A production `maxIterations` default | proposed | ADR-0022 §3. `PRODUCT_DEFAULT_MAX_ITERATIONS = 50` exists but applies only when a host opts in; otherwise the loop is unbounded. Note the ceiling currently throws rather than returning a result — turning it on converts silent grinding into a thrown error, so the shape needs deciding with it |
| **B2** · Warn-then-terminate, scoped | proposed | ADR-0022 §4. `CLINE_MAX_SESSION_COST` is opt-in, process-global, and aborts with no warning phase. Reconciles with [research/23](../../research/23-agent-first-design.md): warn *then* terminate — a budget that only warns is not a budget |

### Read side

| Slice | Status | Notes |
|---|---|---|
| **R1** · Agent read-back of durable state | proposed | ADR-0025 §5, and the largest design surface here. `report_status` is write-only, there is no read-side tool, and session resume replays the transcript the status log exists to avoid. Per ADR-0013 this is a projection of existing lanes, not a fourth store. Do last |

## Non-goals

- **Re-deciding ADR-0022 or ADR-0023.** Both are written. Slices marked against
  them implement them and should not land ahead of their acceptance.
- **A new permission engine.** `ToolPolicy` is already enforced at two points and
  `capPreset` is already correct. Nothing here needs new design — that is the
  finding, not a convenience.
- **Scale work beyond L3 and L4.** [research/24](../../research/24-scale-and-context.md)
  is a measurement pass with no decisions. Only its two correctness-and-cost
  defects are in scope here; the open control loop it describes needs its own ADR
  if anyone wants to close it.
- **Argument-aware gate classification.** Real design question, open in ADR-0025.
