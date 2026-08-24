# Baseline analysis method

**Analysis grain:** one concern row in one raw run
**As of:** 2026-08-14
**Case population:** DEV-01 through DEV-04
**Runs:** three per case

## Questions

1. Does a prompt-only planner consistently identify the same material concern
   set when given the same case?
2. Does it preserve case proportionality and critical blockers?
3. Which classifications vary enough that the plugin needs deterministic
   policy or stronger evidence handling?

## Sources

- Frozen prompt and case files listed in [README.md](README.md).
- Raw model outputs in `runs/`.
- Independent reviewer submissions in `../../reviews/`.
- Proposed concern boundaries in `../../labeling-pilot.md`.

Raw model output is immutable input. Any repair or normalization is recorded
separately.

## Definitions

- **Parse success:** raw response parses as one JSON object without repair.
- **Concern count:** number of `concerns` rows, including explicit
  not-applicable controls.
- **Canonical match:** a run concern and proposed concern share the same
  decision pressure and would be resolved by materially the same evidence.
- **Run coverage:** canonical proposed concerns represented by a run divided by
  proposed concerns for that case.
- **Pairwise Jaccard:** canonical concern intersection divided by union for two
  runs of the same case.
- **Stable core:** canonical concern appears in all three runs.
- **Question utility:** question names at least one concern whose
  applicability, classification, prerequisite, or readiness can change.
- **False-pass:** a gate is marked pass while its run identifies an unresolved
  applicable critical blocker for that gate or an earlier gate.

## Normalization

1. Validate JSON and allowed enum values.
2. Preserve the raw concern id.
3. Map semantic equivalents to one proposed canonical id.
4. Do not merge concerns that have different evidence, route, or gate unless
   the proposed adjudication explicitly combines them.
5. Mark unmatched rows as `extra`; do not silently delete them.
6. Mark a proposed concern absent from a run as `omitted`.
7. Calculate stability before gold-relative precision/recall.

One raw concern may map to two canonical concerns only when it explicitly
contains both decision pressures. Such a split is reported as a scope mismatch
and does not inflate raw concern precision.

## Calculations

For each case with canonical sets `A`, `B`, and `C`:

```text
pairwise_stability = mean(J(A,B), J(A,C), J(B,C))
stable_core_rate = |A ∩ B ∩ C| / |A ∪ B ∪ C|
```

Gold-relative scores remain provisional until owner acceptance:

```text
recall = matched gold concerns / applicable gold concerns
precision = matched applicable output concerns / applicable output concerns
critical_recall = matched critical gold concerns / critical gold concerns
```

Macro averages weight each case equally. Micro averages weight each concern
equally. Both are reported because case sizes differ materially.

## QA controls

- Confirm 12 raw files and one unique run id per file.
- Recalculate concern totals from raw JSON, not documentation tables.
- Check enum validity, prerequisite references, and graph cycles.
- Report null/missing fields instead of imputing them.
- Keep explicit not-applicable controls out of applicable precision
  denominators while reporting them separately.
- Separate observed results from benchmark-owner decisions.

## Limitations

- Three runs are enough to expose gross instability, not to estimate a model's
  full output distribution.
- Semantic matching requires judgment until Milestone 1 introduces a reviewed
  matcher fixture.
- Proposed-gold comparisons cannot be called final gold scores before Harrison
  adjudicates the concern map.
- The explicit output schema makes this a structured prompt baseline, not an
  unconstrained conversational planning baseline.

