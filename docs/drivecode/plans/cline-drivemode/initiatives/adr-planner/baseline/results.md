# Prompt-only baseline results

**Baseline:** `prompt-only-m0.1`
**Status:** captured and validated; gold-relative scores provisional
**Runs:** 12
**Raw concerns:** 98
**Questions:** 66
**Readiness blockers:** 59

## Outcome

The prompt-only baseline reliably finds the obvious decision surface, but it is
not reliable enough to be the product. Semantic concern-set stability is high
after human normalization, while routing, lifecycle gates, concern boundaries,
and criticality vary materially. The baseline also systematically omits some
concerns across all three runs, which stability alone cannot reveal.

## Structural validation

| Check | Result |
|---|---|
| Raw files present | 12 of 12 |
| JSON parse without repair | 12 of 12 |
| Fully schema-valid enum values | 11 of 12 |
| Duplicate concern ids | 0 |
| Missing prerequisite/question/blocker references | 0 |
| Dependency cycles | 0 |
| Prompt or case hash drift | 0 |

`DEV-01` run 1 used the invalid `resolution` value `requirement` on three
concerns. The raw file remains unchanged. This is a baseline failure, not a
reason to repair the evidence silently.

## Semantic stability

The proposed normalization is in [normalization.json](normalization.json). It
uses the unresolved owner-adjudication concern boundaries, so these values are
analysis results, not final gold scores.

| Case | Concern counts | Mean pairwise Jaccard | Stable core / union | Proposed concern coverage by run |
|---|---|---:|---:|---|
| DEV-01 | 11, 10, 11 | `0.917` | `7/8 = 0.875` | `0.889`, `0.778`, `0.778` |
| DEV-02 | 6, 7, 6 | `1.000` | `5/5 = 1.000` | `0.714`, `0.714`, `0.714` |
| DEV-03 | 6, 8, 7 | `1.000` | `5/5 = 1.000` | `1.000`, `1.000`, `1.000` |
| DEV-04 | 10, 8, 8 | `0.806` | `8/11 = 0.727` | `0.909`, `0.909`, `0.727` |

- Macro mean pairwise Jaccard: `0.931`.
- Micro mean pairwise Jaccard: `0.905`.
- Macro stable-core rate: `0.901`.
- Micro stable-core rate: `0.862`.

These numbers depend on semantic normalization. Raw ids alone are not stable
enough to compare because equivalent concerns use different names.

## Systematic omissions

| Case | Omission across all three runs | Effect |
|---|---|---|
| DEV-01 | Explicit backup/restore and destructive-change recovery | Pilot durability can appear covered by generic observability without restore evidence. |
| DEV-02 | Plugin capability/permission boundary | A project-local install can still have unsafe filesystem, command, or network authority. |
| DEV-02 | Pin/version ownership and forced-upgrade behavior | Generated projects lack a reproducible update contract. |
| DEV-04 | None across all runs, but security, vendor processing, and incident/change control each disappear in at least one run | Regulated planning has a volatile critical tail. |

DEV-03 covered the proposed simple-case concerns every time, but overproduced
ADRs for editing/build choices and sometimes blocked a nonexistent pilot. High
recall therefore does not imply proportional routing or gate accuracy.

## Classification instability

- DEV-01 async delivery changed from `experiment/plan/implementation` to
  `decision/adr/preplan` to `task/plan/implementation`.
- DEV-01 billing changed route across `plan`, `requirement`, and `adr`.
- DEV-02 managed-session trust changed route across `requirement`, `adr`, and
  `requirement` despite identical evidence.
- DEV-03 publishing changed route across `runbook`, `plan`, and `runbook`, and
  its gate changed between implementation and release.
- DEV-04 the combined clinical concern changed route from requirement to
  requirement to risk register.
- DEV-04 SMS criticality changed `major`, `critical`, `major`.

The plugin needs deterministic significance reason codes, route rules, and gate
calculation. Prompting alone does not stabilize these decisions.

## Gate behavior

| Gate | Blocked | Not applicable | Pass |
|---|---:|---:|---:|
| Pre-plan | 12 | 0 | 0 |
| Implementation | 12 | 0 | 0 |
| Pilot | 8 | 4 | 0 |
| Release | 10 | 2 | 0 |
| Operate | 9 | 3 | 0 |

No false-pass occurred because no run passed any gate. That is safe but not
well calibrated. DEV-02 and DEV-03 each had one run block a pilot that the
other two marked not applicable. A useful planner must distinguish safety from
blanket refusal.

## Question behavior

All 66 questions referenced at least one concern id, so structural question
utility was `1.000`. Semantic utility is not yet scored: some questions ask for
details already discoverable from repository evidence, and several split one
decision into multiple low-impact questions. Milestone 1 needs evidence-first
question suppression and a question-budget test.

## Validation assessment

**Share with noted caveats.** Source isolation, hashes, run counts, JSON parse,
references, and stability calculations are reproducible. Final precision,
recall, critical recall, route accuracy, Cohen's kappa, and dependency-edge
scores must wait for the benchmark owner to accept the concern split/match map.

Required caveats:

- Three runs expose variance but do not estimate the full model distribution.
- Semantic normalization contains adjudicator judgment.
- One-to-many scope splits improve coverage but do not establish raw precision.
- This structured prompt baseline is stronger than an unconstrained chat
  baseline and should be labeled accordingly.

## Design requirements derived from the baseline

1. Deterministically validate enums and reject or repair only with a recorded
   diagnostic.
2. Separate applicability from the unknown facts needed to resolve it.
3. Require significance reasons before routing to ADR.
4. Calculate gates from concern state instead of allowing the model to choose
   gate status directly.
5. Include recovery, plugin authority, and version/update concerns in the
   relevant applicability profiles.
6. Detect duplicate and over-broad concerns before scoring or artifact output.
7. Treat a stable systematic omission as worse than a variable extra concern.

