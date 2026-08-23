# ADR Planner Milestone 0 benchmark contract

**Status:** active; baseline captured, owner adjudication pending
**Owner:** Harrison / Drivecode
**Decision:** [ADR-0046](../../adr/ADR-0046-adr-planner-plugin-boundary.md)

## Objective

Define what a good planning result is before implementation choices influence
the evaluator. Milestone 0 evaluates planning judgment, not prose quality.

The system succeeds when it finds the material decisions for the supplied use
case, routes each concern to the right artifact, orders prerequisites, asks
only questions whose answers can change the plan, and refuses a readiness gate
when critical evidence is missing.

## Operational definitions

| Term | Definition | Counterexample |
|---|---|---|
| Planning concern | A question, constraint, or obligation that can materially change architecture, delivery, safety, cost, or readiness | A generic best practice with no plausible effect on this case |
| ADR candidate | A significant, durable, cross-cutting technical choice with credible alternatives and consequences | A reversible local implementation detail or routine task |
| Critical omission | An absent concern that can enable unsafe or unlawful behavior, data loss, broken public contracts, irreversible lock-in, or failure of the primary outcome | Missing optional polish |
| Irrelevant blocker | A concern marked blocking even though it is not applicable or cannot change the current gate | Demanding multi-region failover for a static personal site |
| Prerequisite | A concern, fact, or experiment whose result is required before another decision can be made responsibly | A merely related concern |
| Readiness obligation | Specific evidence that must exist before a lifecycle gate may pass | “Looks good” or an unverified assertion |
| Unsupported inference | A factual claim not grounded in supplied evidence or an explicitly labeled assumption | An unknown retained as an unknown |

## Two-phase behavior

### Pre-plan

Pre-plan must:

1. identify the product outcome, user, owner, and current lifecycle;
2. gather repository and brief evidence with provenance;
3. classify the project across the six dimensions;
4. distinguish facts, assumptions, conflicts, and unknowns;
5. emit applicable planning concerns and their prerequisite graph;
6. ask a bounded set of high-impact questions or propose experiments; and
7. state whether enough evidence exists to enter detailed planning.

### Plan

Plan must:

1. consume accepted pre-plan evidence without silently changing it;
2. resolve each concern as decision, experiment, task, external constraint, or
   not applicable;
3. route significant durable choices to ADR candidates;
4. route behavior to requirements and operational obligations to runbooks or
   risk records;
5. order work by prerequisites and lifecycle gate;
6. show unresolved blockers and accepted risk; and
7. emit an evidence-backed readiness verdict.

## Six project dimensions

Each case receives one or more labels per dimension. `unknown` is a valid and
important label.

| Dimension | Representative labels |
|---|---|
| Product surface | web, API, CLI, desktop, mobile, library, data pipeline, agentic system, static content |
| Lifecycle and change | greenfield, brownfield feature, migration, replacement, experiment, incident remediation |
| Data and trust | public, internal, personal, financial, health, secrets, regulated, destructive capability |
| Runtime topology | static edge, client-only, server, worker/jobs, event-driven, offline/edge, multi-region, third-party hosted |
| Scale and reliability | single maintainer, small team, enterprise, bursty, latency-sensitive, high availability, unknown |
| Delivery and governance | internal, design partner, public launch, regulated review, customer-managed, open source, unknown owner |

## Lifecycle gates

| Gate | Question | Minimum evidence |
|---|---|---|
| `preplan` | Is there enough grounded context to build a decision plan? | outcome, primary user, owner, lifecycle, evidence sources, material unknowns |
| `implementation` | May production-intent code begin? | critical concerns resolved or owned experiments; dependencies ordered; ADR candidates routed; acceptance evidence defined |
| `pilot` | May external or realistic users/data enter? | access model, data handling, failure paths, rollback, observability, support owner, pilot acceptance criteria |
| `release` | May production traffic and commitments begin? | security/privacy/compliance obligations, SLOs where applicable, deployment and rollback proof, incident/support ownership |
| `operate` | May the system continue or materially scale? | monitored service objectives, recovery evidence, lifecycle/retention controls, cost and capacity ownership, decision review triggers |

A project may mark a gate not applicable with rationale. It may not silently
skip an applicable gate.

## Criticality and inference severity

Concern criticality:

- `critical`: omission can cause safety, legal/privacy, security, irreversible
  data loss, broken public contracts, or failure of the primary outcome.
- `major`: omission can cause substantial rework, outage, unowned operational
  risk, or material cost, but does not meet the critical definition.
- `standard`: useful planning work with bounded and reversible impact.

Unsupported inference severity:

- `critical`: the false claim would pass a blocked gate, accept an ADR, suppress
  a critical concern, or authorize sensitive/destructive behavior.
- `major`: the false claim changes applicability, routing, urgency, or a
  prerequisite.
- `minor`: the false claim affects explanation or non-binding metadata only.

## Evaluation measures

| Measure | Calculation | Release emphasis |
|---|---|---|
| Concern recall | matched applicable gold concerns / applicable gold concerns | critical recall reported separately |
| Concern precision | matched applicable output concerns / output concerns | irrelevant blockers count as false positives |
| Route accuracy | exact artifact route matches / matched concerns | ADR overproduction reported separately |
| Gate accuracy | exact readiness verdict and blocker set | zero tolerated false-pass on critical blockers |
| Dependency quality | edge precision/recall after concern matching | cycles are automatic failures |
| Question utility | questions that can change a label, route, edge, or gate / questions asked | question burden also reported |
| Grounding | supported claims / factual claims | unsupported inference severity weighted |
| Stability | normalized agreement across three identical runs | no hidden-state carryover |

Milestone 0 records metrics and baseline behavior; numeric release thresholds
are set only after the prompt-only baseline exposes realistic variance.

The resulting proposed thresholds and hard-failure conditions are
pre-registered in [release-policy.md](release-policy.md). They require
benchmark-owner acceptance before they become the release policy of record.

## Prompt-only baseline

The baseline uses one fixed prompt, a fresh session, the raw case brief, and no
catalog, examples, gold labels, or prior run. Run each development case three
times at fixed model/settings. Blind reviewers normalize the output to the
label schema and score it with the same matcher used for the plugin.

Record:

- model and version, prompt hash, settings, date, and run id;
- concern precision/recall and critical recall;
- route, gate, dependency, question utility, and grounding scores;
- mean, range, and run-to-run normalized agreement; and
- qualitative failure modes.

The evaluated planner must not generate, edit, or read its own gold labels.

The frozen prompt-only baseline is recorded in [baseline/README.md](baseline/README.md).
Its structural and normalized-stability analysis is complete. Gold-relative
scores remain provisional until the benchmark owner accepts the proposed
concern split and match map.

## Gold separation

- Development case briefs and adjudicated labels may live in this repository.
- Held-out profile metadata may be public, but full briefs and gold labels live
  in a private evaluator location outside the plugin package and build context.
- The release evaluator receives planner outputs, never planner write access.
- Any accidental exposure retires the held-out case and assigns a new id.

## Exit criteria

1. Benchmark contract and labeling handbook receive owner acceptance.
2. At least four development cases have two independent labels.
3. Every disagreement is retained, classified, and adjudicated.
4. Per-dimension agreement and concern-set agreement are calculable.
5. Eight development cases and four held-out profiles are registered.
6. Prompt-only baseline protocol is reproducible and at least one baseline run
   has been captured for each of the first four development cases.
7. No gold answer is generated by or visible to the evaluated planner.
