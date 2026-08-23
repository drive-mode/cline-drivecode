# ADR Planner evaluation and release policy

**Policy version:** `m0.1`
**Status:** proposed for benchmark-owner acceptance
**Derived from:** [prompt-only baseline](baseline/results.md)

## Purpose

This policy turns the benchmark contract into an executable release decision.
It deliberately requires both safety and proportionality: a planner cannot
pass by omitting critical concerns, and it cannot pass by blocking every gate
with a generic checklist.

The thresholds are pre-registered before plugin implementation and before any
held-out brief is visible to the implementation team. Development and held-out
results are evaluated separately; a strong public score cannot mask a weak
held-out score.

## Evaluation population

| Slice | Cases | Runs | Use |
|---|---:|---:|---|
| Development | 8 frozen cases | 3 fresh runs per case | Iteration, diagnosis, regression |
| Held-out | 4 private cases | 3 fresh runs per case | Release judgment |
| Deterministic replay | Accepted normalized fixtures | 10 identical replays | Byte stability and validator behavior |

Every release report identifies case-set version, label version, evaluator
commit, plugin commit, model/version, reasoning settings, prompt hash, and run
ids. A missing identity field invalidates the report.

## Automatic failures

Any one of these conditions fails the release regardless of aggregate score:

1. A held-out brief or label is present in plugin source, package contents,
   generated template output, model context, logs, or CI artifacts.
2. Any machine artifact fails its versioned schema or contains an unknown enum.
3. Any prerequisite graph contains a cycle or a reference to a missing concern.
4. Any run passes a lifecycle gate by missing, suppressing, or treating as
   resolved an applicable critical blocker.
5. A critical unsupported inference is used as evidence, satisfies a blocker,
   or changes a gate from blocked to pass.
6. Any held-out critical concern is omitted in any release run.
7. Accepted normalized inputs produce non-byte-identical deterministic
   artifacts or readiness verdicts.

Safety failures are not waivable as a passing release. The team may ship an
explicit experimental build, but it must not carry the release claim.

## Score floors

All floors apply separately to development and held-out slices unless a row
says otherwise. Macro scores weight cases equally. Case minima prevent large
cases from hiding a severe miss in a small case.

| Measure | Aggregate floor | Case/run guardrail |
|---|---:|---:|
| Applicable concern recall | `>= 0.90` macro | no case `< 0.80` |
| Critical concern recall | `1.00` | `1.00` in every run |
| Applicable concern precision | `>= 0.80` macro | no case `< 0.70` |
| Applicability classification accuracy | `>= 0.90` | no unknown silently converted to fact |
| Exact artifact-route accuracy | `>= 0.85` | ADR-route precision `>= 0.90` |
| Exact gate-verdict accuracy | `>= 0.95` | zero critical false-pass |
| Critical blocker-set recall | `1.00` | `1.00` in every run |
| Dependency-edge F1 | `>= 0.85` | zero cycles and zero dangling edges |
| Semantically useful questions | `>= 0.85` | median `<= 8`, maximum `12` per case |
| Grounded factual claims | `>= 0.98` | zero critical or major unsupported inference |
| Mean pairwise concern Jaccard | `>= 0.95` | no case `< 0.85` |
| Stable critical concern core | `1.00` | all critical concerns in all three runs |
| Stable full concern core | `>= 0.95` | no case `< 0.85` |
| Deterministic artifact replay | `1.00` byte-identical | 10 of 10 replays |

Explicit not-applicable controls are scored for applicability accuracy but are
excluded from applicable-concern precision denominators. Question count
includes only questions presented to the user, not evidence checks the plugin
answers from the repository itself.

## Proportionality checks

Aggregate precision does not fully detect blanket refusal. Each release must
also satisfy these checks:

- the simple negative case has no critical blocker or ADR unless gold requires
  it;
- a not-applicable gate is not changed to blocked without an applicable gold
  concern;
- every ADR candidate has a permitted significance reason grounded in case
  evidence;
- unmatched generic concerns and irrelevant blockers are reported explicitly;
  and
- the evaluator reports false-pass and false-block counts separately.

## Baseline-to-policy rationale

| Baseline observation | Policy response |
|---|---|
| 11 of 12 runs were fully enum-valid | Release requires 100% schema validity. |
| Mean pairwise Jaccard was `0.931` | Plugin must reach `0.95` while retaining case-level guardrails. |
| Stable-core rate was `0.901` | Full stable core must reach `0.95`; critical core must be `1.00`. |
| No gate passed, including simple/plugin cases | Gate accuracy and false-block reporting prevent safety-by-blanket-refusal. |
| Recovery, plugin authority, and upgrade ownership were stable omissions | Critical recall is an every-run invariant, not only an average. |
| Routes and criticality varied materially | Exact route accuracy and deterministic policy code receive explicit floors. |
| All questions had structural references | Semantic utility and question burden replace reference presence as the release measure. |

## Decision and change control

The benchmark owner accepts this policy before Milestone 1 behavior is tuned
against it. Later threshold changes require a policy version bump, rationale,
and approval before seeing the candidate release result. Gold corrections do
not automatically permit threshold changes.

A release passes only when all automatic-failure checks and all score floors
pass. Reports include raw numerators and denominators, not only rounded rates.

