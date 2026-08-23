# PRD · ADR Planner

**Status:** active; M0 owner acceptance, M1–M4 private proofs, M4 hardening open
**Owner:** Harrison / Drivecode
**Architecture:** [ADR-0036](../adr/ADR-0036-adr-planner-plugin-boundary.md);
[ADR-0037](../adr/ADR-0037-adr-planner-package-contract.md),
[ADR-0038](../adr/ADR-0038-adr-planner-evidence-trust-boundary.md), and
[ADR-0039](../adr/ADR-0039-adr-planner-concern-catalog-and-rule-authority.md), and
[ADR-0040](../adr/ADR-0040-adr-planner-host-attested-workflow-authority.md) and
[ADR-0044](../adr/ADR-0044-adr-planner-install-attestation.md)
(Proposed implementation candidates)
**Initiative:** [adr-planner](../initiatives/adr-planner/)

## Problem

Coding agents can produce a plan quickly, but generic plans are unstable:
they omit use-case-specific decisions, turn routine tasks into ADRs, assume
unknown constraints, ask low-value questions, and declare readiness without
evidence. Teams need a repeatable pre-planning and planning workflow that is
available at repository creation and remains useful for later brownfield work.

## Outcome

A repository generated from `qh2-template` starts with a Cline-native ADR
Planner installed. Before production-intent code, the user can run pre-plan to
discover the material decision surface, then plan to resolve and route it. The
result is proportionate to the use case and produces an auditable readiness
verdict.

## Users

**Primary:** a technical lead or hands-on builder starting a production app or
material initiative in an `qh2-template` repository.

**Secondary:** a maintainer assessing a brownfield feature, migration, or
architecture change.

**Evaluator:** a benchmark owner comparing planner outputs against independent
gold labels.

## Functional requirements

| ID | Requirement | Milestone |
|---|---|---|
| `ADRPL-FR-001` | Provide explicit pre-plan and plan workflows through a bundled Cline skill | M1/M4 |
| `ADRPL-FR-002` | Ingest repository evidence and preserve source provenance | M2 |
| `ADRPL-FR-003` | Classify the case across the six benchmark dimensions, preserving unknowns | M2 |
| `ADRPL-FR-004` | Emit applicable, not-applicable, and unknown planning concerns | M3 |
| `ADRPL-FR-005` | Classify resolution, urgency, artifact route, gate, criticality, and prerequisites | M3 |
| `ADRPL-FR-006` | Route only significant durable choices to ADR candidates with reason codes | M3 |
| `ADRPL-FR-007` | Ask bounded questions whose answers can change the plan | M4 |
| `ADRPL-FR-008` | Propose experiments when evidence should be produced rather than guessed | M4 |
| `ADRPL-FR-009` | Generate a dependency-ordered decision plan and readiness report | M4 |
| `ADRPL-FR-010` | Refuse a lifecycle gate when applicable critical obligations lack evidence | M4 |
| `ADRPL-FR-011` | Support greenfield, brownfield, negative/simple, ambiguous, and adversarial cases | M5 |
| `ADRPL-FR-012` | Preserve accepted decisions and show change impact on later runs | M5 |
| `ADRPL-FR-013` | Install project-locally from a pinned package coordinate during template bootstrap | M6 |
| `ADRPL-FR-014` | Upgrade atomically through an explicit pinned reinstall flow | M6 |

## Quality and safety requirements

| ID | Requirement |
|---|---|
| `ADRPL-NFR-001` | Deterministic schemas, normalization, graph validation, and readiness calculation must not depend on model prose |
| `ADRPL-NFR-002` | The same normalized evidence and decisions must produce byte-stable machine artifacts |
| `ADRPL-NFR-003` | The system must label unsupported inference rather than silently converting it to fact |
| `ADRPL-NFR-004` | A critical unsupported inference must never satisfy a blocker or pass a gate |
| `ADRPL-NFR-005` | The planner must minimize repository reads and must not copy secrets, ignored files, raw transcripts, or sensitive source text into telemetry |
| `ADRPL-NFR-006` | Planner writes require explicit invocation; Accepted ADR substance requires explicit human confirmation |
| `ADRPL-NFR-007` | Plugin load failure must fail soft for ordinary Cline use and fail closed for a requested planning gate |
| `ADRPL-NFR-008` | Project-specific overrides must be visible, versioned, and distinguishable from bundled defaults |
| `ADRPL-NFR-009` | Held-out gold must be inaccessible to the plugin and excluded from package/build artifacts |
| `ADRPL-NFR-010` | Every release result must identify plugin commit, evaluator version, model version, prompt hash, and case-set version |

## Required artifacts

Machine-readable outputs, exact filenames subject to Milestone 1 schema ADR:

- evidence inventory with provenance and conflicts;
- project profile across six dimensions;
- planning concern inventory;
- prerequisite graph;
- bounded question/experiment queue;
- ADR candidate list with significance reason codes;
- requirements, risks, and operational obligations;
- lifecycle readiness report with blockers and evidence; and
- run manifest identifying versions and inputs.

Human-readable Markdown is a projection of these artifacts, not the source of
truth for evaluation.

## Non-goals

- Writing production application code in the same operation as planning.
- Automatically accepting an ADR or business risk.
- Treating every checklist row as applicable.
- Replacing product discovery, legal review, threat modeling, or domain experts.
- Creating a second Drive workflow runtime, daemon, or hidden planning store.
- Requiring remote plugin fetch during a managed planning session.
- Solving historical cross-session chat organization in the first plugin slice;
  that remains a later consumer of the same evidence and decision graph.

## Success criteria

Milestone 0 success is defined by the benchmark contract. Product release
requires thresholds derived from the prompt-only baseline, with a hard
invariant of zero false passes caused by missed critical blockers in the
held-out release set.

## Risks

| Risk | Response |
|---|---|
| Generic checklist bloat | Applicability first; negative cases; precision and irrelevant-blocker scoring |
| Model-generated gold contamination | Independent reviewers; held-out evaluator separation |
| ADR overproduction | Significance reason required; route accuracy metric |
| Template drift | Pin retained by template; explicit forced reinstall; fresh and upgrade fixtures |
| Monorepo install ambiguity | Publish/install a bounded package, never the repository root |
| False confidence | Evidence-backed readiness and critical unsupported-inference refusal |
