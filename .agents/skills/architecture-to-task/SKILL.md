---
name: architecture-to-task
description: Converts a desired architecture into a deduplicated Drive project and task map grounded in current repository evidence. Use when someone asks to implement an architecture, map architecture gaps to work, turn diagrams or ADRs into tasks, or refresh Drive's dependency map without creating a second status source.
---

# Architecture to Task

Compile architecture intent into reviewable work. Discovery is read-only; the
human remains the decision and mutation authority.

## Invariants

1. **Current state comes before desired state.** Inspect code, tests, ADRs,
   claims, task-bank records, initiatives, and diagrams before proposing work.
2. **One identity per outcome.** Reuse an existing claim or task when its
   acceptance boundary matches. Similar wording is not a reason to mint a new
   ID.
3. **Separate truths, one writer each.** In Drivecode, the claims registry owns
   delivery evidence while the Drive task bank owns execution lifecycle. Their
   states are linked but never synchronized by equality. Diagrams, initiatives,
   Status maps, and reports are read-only projections.
4. **Unknown is a valid result.** Never convert missing evidence into a task
   completion claim, a dependency, or an ADR verdict.
5. **Decisions and implementation are different artifacts.** A Proposed ADR is
   not an implementation task marked done. An implementation does not accept
   its own ADR.
6. **No direct production action.** This workflow may draft or update planning
   artifacts when asked. It never deploys infrastructure, accepts risk, accepts
   an ADR, or applies generated infrastructure.

## Drive sources

Read the nearest `AGENTS.md` first. For Drivecode, use these in order:

1. `docs/drivecode/plans/cline-drivemode/delivery/claims-registry.yaml` —
   delivery-status source of truth.
2. `docs/drivecode/plans/cline-drivemode/initiatives/portfolio-now/README.md` —
   golden-path dependency sequencer.
3. `docs/drivecode/plans/cline-drivemode/adr/` — decisions and open forks.
4. `sdk/packages/shared/src/drive/bank.ts` and the active bank adapter — task
   execution schema and storage boundary.
5. `apps/drivecode-demo/src/plan-tasks-fixture.ts` — Status map projection;
   never treat it as canonical status.
6. `docs/drivecode/design/canvases/` — explanatory projections and review
   views.

Do not create a root `TASKS.md`, a second active roadmap, or a private status
database for this workflow.

## Compiler pipeline

### 1. Frame the architecture request

Write one sentence each for:

- outcome and primary user;
- system boundary and excluded systems;
- success signal;
- failure tolerance and recovery expectation;
- time horizon only as Now / Next / Later, never invented dates.

Record assumptions and questions. A question that changes authority, data
ownership, trust, or a destructive action blocks that branch; it does not block
unrelated read-only discovery.

### 2. Discover the as-is system

Collect allowlisted evidence from the scoped repositories. For every important
claim, record an evidence locator such as a file, test, command, ADR clause, or
runtime observation. Mark freshness and uncertainty.

Profile all six system dimensions:

| Dimension | Inspect |
|---|---|
| People | users, operators, owners, approvers, support, adversaries |
| Data | identities, events, retention, lineage, sensitivity, volume |
| Hardware | phones, desktops, accelerators, storage, failure domains |
| Software | clients, services, schemas, policies, models, adapters |
| Processes | pairing, approvals, release, incident, deletion, recovery |
| Networks | trust zones, transports, offline behavior, latency, egress |

Classify each observed capability as `verified_shipped`, `active_partial`,
`planned`, `blocked`, or `unknown`. Use the repository's vocabulary where it is
stricter.

### 3. Normalize the desired architecture

Turn prose and diagrams into a small typed graph:

- nodes are capabilities or externally observable outcomes;
- edges are typed: `depends_on`, `authorizes`, `produces`, `projects`,
  `persists`, `observes`, or `blocks`;
- boundaries identify writer, trust zone, data classification, and owner;
- temporal annotations identify TTL, expiry, cache window, batch cadence,
  retry window, and recovery point where relevant.

Keep diagrams under 20 nodes. Split context, data/time, trust, deployment, and
delivery views instead of repeating one overloaded graph.

### 4. Run ADR Planner discipline

If `adr_planner_*` tools are available, use their evidence, profile, concern,
prerequisite, readiness, and workflow operations as guarded diagnostics. A
serialized authority label is not proof: only a host-mediated execution event
can authorize or commit a mutation.

If those tools are unavailable:

- use the same evidence-first and three-valued reasoning discipline;
- preserve `unknown` concern applicability;
- report that no ADR Planner readiness pass was performed;
- never simulate a passing readiness verdict.

Route every gap to exactly one primary artifact:

| Gap type | Primary artifact |
|---|---|
| Durable architectural fork | Proposed ADR |
| Implementable observable outcome | Claim + Drive task |
| Operational procedure | Runbook |
| Unresolved technical fact | Spike / experiment |
| Business or safety exposure | Risk record for human acceptance |
| Explanatory relationship only | Diagram / reference projection |

### 5. Deduplicate before minting

Build candidate fingerprints from:

- normalized outcome verb and object;
- acceptance boundary;
- owning subsystem and repository;
- dependency neighborhood;
- evidence paths and referenced decision IDs.

Compare candidates against the claims registry, task bank, active initiatives,
and open ADRs.

- **Exact identity:** reuse the existing ID and update its projection.
- **Same acceptance boundary:** merge wording and missing evidence into the
  existing record.
- **Partial overlap:** split only along independently verifiable outcomes; link
  the records with typed dependencies.
- **Different boundary:** mint a new stable ID and explain why it is distinct.
- **Superseded work:** preserve history, mark the replacement relationship,
  and do not reopen the old identity.

Emit a deduplication report before proposing writes.

### 6. Compile gaps into tasks

Each task has:

- stable ID and one outcome-oriented title;
- linked claim and decision IDs;
- owner role and owning repository;
- typed dependencies;
- six-system tags;
- acceptance evidence with a named command or observable scenario;
- normal, denial, timeout, offline, stale-permission, and recovery cases as
  applicable;
- status derived from canonical evidence, never from the diagram;
- source evidence locators and explicit unknowns.

Prefer a vertical slice that proves a user outcome across boundaries over a
list of component-construction tasks. Keep a component task only when it has an
independent acceptance boundary.

### 7. Project the project map

Order tasks into:

- **Now:** smallest connected vertical path and its conformance gate;
- **Next:** collaboration, scale, and product breadth unlocked by Now;
- **Later:** options whose entry condition is not yet true.

Write canonical status first, then update projections:

1. claims registry, when delivery evidence changes;
2. active initiative and machine-readable dependency map;
3. diagram sources and generated artifacts;
4. generated, drift-checked Status Hub demo projection;
5. proposed Drive task drafts for human review.

After review, an authorized host may deduplicate again and commit accepted
drafts into `.drive/bank`. This skill never writes the bank directly and never
turns a claim status into a DriveTask status.

The project map is a dependency sequencer over stable IDs. It is not another
backlog.

### 8. Validate like source code

Run cheap deterministic checks before expensive or visual checks:

1. duplicate IDs, orphan dependencies, cycles, missing owners, missing claims;
2. claim-to-task linkage, allowed lifecycle transitions, and acceptance-evidence
   completeness — never state equality;
3. Mermaid syntax, node-count, typed-edge, and link checks;
4. HTML build and headless render gate;
5. cold-read review: can a reviewer recover the stated claims from the visual
   without the author explaining it?

For Drivecode, run the repository commands named by local instructions,
including `bun run check:drivecode-docs`, `bun run test:drivecode-docs`, and the
focused demo tests after changing the Status projection.

## Required output

Return, in this order:

1. **Scope and evidence boundary** — repositories and evidence classes read.
2. **Current-state matrix** — six systems, status, evidence, uncertainty.
3. **Decision and unknown register** — existing ADRs, Proposed ADRs, blockers.
4. **Deduplication report** — reused, merged, split, superseded, and new IDs.
5. **Architecture graph** — desired capabilities and typed dependencies.
6. **Project map** — Now / Next / Later with claims and owners.
7. **Task map** — acceptance-backed tasks and dependency edges.
8. **Proposed mutations** — exact files or records, with human decision gates.
9. **Validation verdict** — commands actually run, failures, and any planner
   gate that was unavailable.

The mutation sequence is always: **propose → deduplicate → human review →
host commit**. A skipped gate is a refusal, not an optimization.

## Refusal conditions

Stop the write phase and report the issue when:

- a new writer or authority boundary is implied without a decision;
- the same outcome already exists and the requested duplicate would drift;
- a task requires accepting an ADR, business risk, privacy policy, or release;
- source evidence conflicts and no owner can resolve it;
- generated infrastructure would be applied rather than reviewed;
- a diagram would expose secrets, host-local paths, prompts, model IDs, keys,
  or proprietary Director policy.

Read [REFERENCE.md](REFERENCE.md) for the Drive projection contract and a
worked golden-path mapping.
