# ADR-0025 · Declared authority must be enforced authority

**Status:** Accepted (2026-08-03)
**Owner:** Drivecode SE lead
**Constrained by:** [ADR-0018](ADR-0018-agent-runtime-contract.md) (runtime
contract, `WorkLease`, receipts), [ADR-0022](ADR-0022-agent-economics.md)
(budgets warn before they act, and are scoped),
[ADR-0023](ADR-0023-agent-spawn-governance.md) (spawn governance; enforcement is
hub-side, `.driveagent/` stays intent),
[ADR-0013](ADR-0013-state-partition.md) (three lanes; no fourth store).
**Evidence:** [research/23-agent-first-design.md](../research/23-agent-first-design.md).
**Companions:** [defaults-delivery.md](../delivery/defaults-delivery.md) (task
D1), [initiatives/enforced-authority](../initiatives/enforced-authority/README.md).  
**Twin:** [ADR-0026](ADR-0026-evidence-backed-done.md) (delivery Done refusal).  
**Impl:** `partial` — E1 refusal consumer locks Finding 2 / L1 delegation
threading (`sdk/packages/core/src/runtime/enforced-authority-consumer.test.ts`).
Remaining Finding 1 rows and initiative slices stay open.

## Context

Three ADRs already decide most of what this repo needs about agent authority.
ADR-0023 settles spawn governance and says the hub decides. ADR-0022 settles
budgets. ADR-0018 names the completion guard. (As of the 2026-08-08 cleanup,
ADR-0023 is Accepted with Impl partial; ADR-0022 remains Proposed.)

None of them states the rule they all assume: **that a declared limit is worth
anything only if something reads it.** The audit in research/23 found that
assumption failing in the same way in six places, which makes it a class rather
than a backlog.

This ADR decides only that rule, plus the two rows no existing ADR covers. Where
ADR-0018, 0022, or 0023 already decides something, this ADR cites it and stops.

### Finding 1 — the gap is a class, not a list

| Declared | Enforced | Where it stops |
|---|---|---|
| `PermissionPreset` / `capPreset` min-rule | no | `effectivePreset` has zero non-test consumers |
| `.driveagent/permissions.yaml` `presetIntent` | no | `compileDriveagentHome` validates `permissions` and drops it; `CompiledDriveagentView` has no field for it |
| `DriveRunIsolation`, `writeClaims`, `allowedActions` | no | nothing persists a `DriveRun`; the values reach a Kanban card as label text |
| DRV-GATES six-class taxonomy | no | `classifyToolNameForGate` drives UI labels; classification is name-based, so `run_commands` never classifies as destructive whatever its arguments |
| Receipt verifier evidence | partly | `evidenceRefs.length === 0` throws; the contents are an unvalidated `string[]` |
| Receipt verifier *identity* | no | `decidedBy` is optional and read by nothing |

Each of these was written carefully and each is correct. The defect is that none
of them is on a path that can stop anything. ADR-0023 already names one instance
— *"`capPreset = min(parent, child)` already exists and is unwired"* — and
[defaults-delivery.md](../delivery/defaults-delivery.md) already carries D1 to
fix that one. Fixing instances one at a time is what produced six of them.

### Finding 2 — two delegation paths drop authority entirely

This was a live hole: `createSessionSpawnTool` and `spawnTeamTeammate` once
skipped `toolPolicies` / `requestToolApproval` while
`buildDelegatedAgentConfig` already accepted both.

**Closed for L1 (wiring + E1 consumer).** Host spawn, team bootstrap, and
`buildDelegatedAgentConfig` now thread parent authority and intersect policies.
`enforced-authority-consumer.test.ts` refuses a merge that removes those
consumers. Remaining Finding 1 rows (preset→policy, `presetIntent`, receipts,
…) are still open initiative slices.

### Finding 3 — the base runtime fails open, and that is a published contract

`resolveToolPolicy` returns `{...policies["*"], ...policies[toolName]}`, which is
`{}` when nothing is configured (`agent-runtime.ts:133-142`). The gate tests
`policy.enabled === false` and `policy.autoApprove === false` (`:1480-1481`), so
an unconfigured tool is enabled and auto-approved.

This is deliberate and documented. `ToolPolicy` marks both fields `@default true`
(`shared/src/llms/tools.ts`), and three published docs state the behaviour. It is
also not unenforced — `ToolPolicy` *is* read, both at the runtime gate and again
as a tool-list filter in `runtime-builder.ts`. The defect is the default, not the
wiring, and inverting it silently would break every embedder who passes no
policies.

There is already an in-repo precedent for the safe shape: `cron-runner.ts`
emits `{"*": {enabled: false}}` and then allowlists per tool. Deny-by-default is
reachable without changing what `resolveToolPolicy` means.

## Decision

**1. A declared authority type with no enforcement-path consumer is a defect,
and CI says so.**

Every type that expresses a limit — presets, isolation modes, write claims,
allowed actions, gate classes, receipt fields — must have at least one non-test
consumer on a path that can refuse an action. A test asserts this per type and
fails when the count drops to zero.

This is deliberately the cheapest possible mechanism. It is a grep with an
opinion, and it would have caught all six instances in Finding 1. It does not
verify that enforcement is *correct*; it verifies that enforcement *exists*,
which is the failure this repo actually has.

**2. Delegation may not widen authority. This ships before anything else here.**

A child agent's authority is capped by its parent's. Concretely: `toolPolicies`
and `requestToolApproval` thread through every delegation path, and the child's
effective policy is the *intersection* of what the caller requests and what the
parent holds — never a replacement.

`buildDelegatedAgentConfig` is the single funnel all three paths pass through, so
it is where the cap belongs. Per ADR-0023 §3 this reuses `capPreset`'s min-rule
rather than inventing a second lattice; per the `@cline/drive` import boundary,
the preset→policy *table* lives in `@cline/core` and only the pure rank
comparison may live beside `capPreset`.

Ordering follows ADR-0023 §1's principle exactly — the hole that exists ships
before the capability that does not.

**3. Deny-by-default is opt-in at the SDK boundary and default at the product
boundary.**

Two different questions, currently answered as one:

- **The SDK runtime** keeps its documented `@default true`. Deny-by-default
  arrives as an explicit posture an embedder selects, not as a silent flip of a
  published contract. Existing embedders are unaffected.
- **Cline's own products** select the closed posture. `defaultToolAutoApprove =
  true` in the CLI and the hub's open default are product choices, and
  [22-default-posture](../research/22-default-posture.md)'s rule — sit on the
  safe side of every asymmetric axis — settles which way they go.

The asymmetry is the whole argument: an unnecessary prompt costs a keystroke, an
unnecessary `run_commands` costs whatever the command did.

**4. Where a receipt is required, verifier identity is required with it.**

ADR-0018 names the completion guard and its evidence requirement. It does not say
the verifier must differ from the executor, and `decidedBy` currently permits an
agent to accept its own work — the guard checks that evidence *exists*, not that
anyone independent looked at it.

`decidedBy` becomes required on an accepted receipt and is checked against the
identity of the agent bound to the run. The identity source is the tool context,
never the model — the rule `report_status` already follows, and for the same
reason.

Structural independence is what makes this worth enforcing: a verifier that
reads the executor's summary rather than the artifact is a second opinion about
a narrative. Where a deterministic check exists, it outranks a model verdict.

**5. Durable state is readable by the agent that owns it.**

Drive's durable state is currently a write-only sink from the agent's side.
`report_status` publishes and there is no read-side tool; the bank snapshot and
status board never enter a prompt; session resume replays the transcript the
status log exists to avoid.

An agent must be able to answer "where am I" from durable state rather than from
its own history. This is the one row here that is genuinely undesigned, and the
design constraint is inherited: per ADR-0013 the read side is a projection of
existing lanes, not a fourth store, and per ADR-0004 and the existing
forbidden-key scanners it must not become a transcript read-back by another name.

## What a user gets

- A sub-agent cannot do what its parent was not allowed to do.
- An agent cannot mark its own work verified.
- A closed-by-default posture in Cline's products, without breaking anyone
  embedding the SDK.
- An agent that resumes from durable state instead of reconstructing itself from
  chat history.

## Consequences

- **`AgentParticipantSchema` needs a field for the effective preset.** It is
  `.strict()` today, so this is a schema rev; optional keeps it parse-compatible
  with existing snapshots and durable event logs, required does not.
- **`CompiledDriveagentView` grows `presetIntent`.** Type-only and
  boundary-legal. Note there is no path today that turns a compiled home into a
  running agent, so this is a build-out rather than a rewire.
- **The enforcement test will fail on the day it lands** — that is its purpose.
  It should ship with the instances it catches already in the initiative's slice
  list, or it will be skipped rather than fixed.
- **Products changing posture will generate prompts users did not have before.**
  ADR-0022's warn-before-act shape applies here too; a closed default that
  produces constant prompts trains people to approve without reading, which is
  worse than the open default it replaced. Escalation rate is a design budget,
  not a free resource.
- **Deny-by-default interacts badly with two existing shortcuts.** The CLI
  approval controller returns approved before consulting the per-request policy
  when its global auto-approve flag is set, and `beforeTool` hook overrides are
  spread *after* the resolved policy, so a hook can currently widen as well as
  narrow. Both need a decision or the ceiling leaks.
- **A preset→policy table must not trust preset *names*.** `ToolPresets.plan` is
  documented "read-only, no shell access" and ships `enableBash: true` — and the
  grant is the correct half. `prompt/cline.ts:25-31` records the decision that
  `run_commands` "intentionally stays available in plan mode … the mitigation for
  plan-mode mutations is prompting plus mode-switch notices, not tool removal,"
  and `cline.test.ts:36-44` locks it. Fix the stale comment, not the flag, and
  build any preset ceiling from the flags rather than from what a preset is
  called. Capping a *child's* shell authority is a per-delegation policy
  question, not a global preset change.

## Alternatives rejected

- **Invert `resolveToolPolicy` directly.** Rejected. It changes a documented
  `@default true` for every embedder passing no policies, and the tool-list
  filters read `enabled` without reading `autoApprove`, so the immediate effect
  is an empty tool list rather than a prompt.
- **A new permission engine.** Rejected. `ToolPolicy` is already enforced at two
  points, `capPreset` is already correct, and `cron-runner` already demonstrates
  the allowlist shape. Nothing here needs new design — which is the finding, not
  a convenience.
- **Fold this into ADR-0022 or ADR-0023.** Rejected. Both are `Proposed` and
  authored to a different question; absorbing them would force a supersede on
  the board and re-open two settled designs to state a rule neither disputes.
- **Enforce the whole declared/enforced class at once.** Rejected. The class is
  the finding; the fix is per-slice, ordered by which holes are live.
- **Let the verifier be any agent other than the executor.** Deferred, not
  rejected — it is strictly better than today and weaker than independence, and
  choosing between them needs the read-side design from decision 5.

## Open

1. **What the closed posture actually allows.** `SAFE_AUTO_APPROVE_TOOL_NAMES`
   exists in the CLI and excludes `run_commands`, `editor`, and `apply_patch`.
   Whether that list is the product default or merely a starting point is
   undecided.
2. **Whether `beforeTool` hook overrides may widen.** Narrowing-only is the safe
   answer and breaks any hook that currently grants.
3. **Argument-aware gate classification.** DRV-GATES is name-based, so
   `run_commands` cannot classify as destructive however it is invoked. Making it
   argument-aware is a real design question, not a lookup-table change.
4. **Whether the read side is a tool or an injection.** A `read_status` tool
   costs a turn; injecting bank state into the prompt costs context on every
   turn and re-opens what ADR-0022 says about announcing compaction.
5. **What identity the verifier check trusts** when the verifier is a human on
   another surface rather than an agent in the run.
6. **Whether unenforced-declaration is a CI failure or a tracked exemption
   list.** Hard failure is honest and will block unrelated work the first time
   someone lands a schema ahead of its consumer.
