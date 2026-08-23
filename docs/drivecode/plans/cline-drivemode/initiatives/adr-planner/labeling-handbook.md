# ADR Planner labeling handbook

**Schema version:** `m0.1`
**Applies to:** development and held-out benchmark cases

## Unit of labeling

The atomic unit is a planning concern, not a document heading. Two labels match
when they express the same decision pressure and would be resolved by the same
evidence, even if wording differs.

Split concerns when they have different prerequisites, artifact routes,
lifecycle gates, or readiness effects. Merge concerns that differ only in
implementation examples.

## Case record

```yaml
case_id: DEV-01
benchmark_version: m0.1
brief_hash: sha256:...
dimensions:
  product_surface: [web]
  lifecycle_change: [greenfield]
  data_trust: [internal]
  runtime_topology: [server, worker_jobs]
  scale_reliability: [small_team, unknown]
  delivery_governance: [design_partner]
source_refs: []
```

Every dimension must have at least one value. Label absent evidence as
`unknown`; do not select the most common default.

## Concern record

```yaml
case_id: DEV-01
concern_id: tenancy-isolation
reviewer_id: reviewer-a
review_round: independent-1
concern: Define tenant data and authorization isolation boundaries.
applicability: applicable
resolution: decision
urgency: now
artifact_route: adr
lifecycle_gate: implementation
criticality: critical
significance_reasons: [cross_cutting, security_boundary, costly_to_reverse]
prerequisites: [identity-and-role-model]
readiness_effect: blocks
evidence_refs: [brief:team-accounts, brief:customer-operational-data]
unknowns: [database_isolation_strategy]
rationale: A cross-tenant access failure would expose customer data.
```

## Allowed values

| Field | Values |
|---|---|
| `applicability` | `applicable`, `not_applicable`, `unknown` |
| `resolution` | `decision`, `experiment`, `task`, `external_constraint`, `not_applicable` |
| `urgency` | `now`, `next`, `later`, `not_applicable` |
| `artifact_route` | `adr`, `plan`, `requirement`, `runbook`, `risk_register`, `none` |
| `lifecycle_gate` | `preplan`, `implementation`, `pilot`, `release`, `operate`, `not_applicable` |
| `criticality` | `critical`, `major`, `standard` |
| `readiness_effect` | `blocks`, `warns`, `none` |

Allowed ADR significance reasons:

- `cross_cutting`
- `public_contract`
- `security_boundary`
- `data_lifecycle`
- `operational_model`
- `costly_to_reverse`
- `vendor_lock_in`
- `regulatory_obligation`
- `multi_team_ownership`

An ADR route requires at least one significance reason. A reason does not make
the concern applicable by itself.

## Labeling rules

1. Read only the frozen case brief and permitted source refs.
2. Record direct evidence before interpreting it.
3. Preserve unknowns. Never turn silence into a default fact.
4. Evaluate applicability before urgency or routing.
5. Use the least ceremonial artifact that preserves the decision.
6. Mark a question useful only if an answer can change applicability,
   resolution, route, prerequisite, or readiness.
7. Mark `blocks` only when the concern prevents the named gate under the
   criticality definitions.
8. A negative/simple case should contain explicit not-applicable labels for
   tempting enterprise concerns so false-positive behavior is measurable.
9. Do not award credit for a long generic checklist that misses case-specific
   critical concerns.
10. Do not infer that a named vendor settles architecture, privacy, reliability,
    or ownership decisions.

## Independent review and adjudication

1. Freeze the brief and calculate `brief_hash`.
2. Reviewer A and Reviewer B label independently with no shared draft.
3. Normalize wording only after both submissions are locked.
4. Calculate agreement before adjudication.
5. An adjudicator reviews each disagreement against evidence and definitions.
6. Preserve both original labels, disagreement type, final label, rationale,
   and adjudicator id.
7. A benchmark owner approves the final gold revision.

Disagreement types:

- `scope`: reviewers identified different concern boundaries;
- `applicability`: applicable/not-applicable/unknown differs;
- `classification`: resolution, urgency, route, gate, or criticality differs;
- `dependency`: prerequisite edge differs;
- `evidence`: evidence interpretation or unsupported inference differs; and
- `omission`: only one reviewer identified a concern.

## Agreement reporting

- Report raw agreement and Cohen's kappa for each categorical field after
  concern matching.
- Report concern-set Jaccard and concern precision/recall in both directions.
- Report dependency edge precision/recall and cycle count.
- Report all criticality and readiness disagreements individually.
- Do not hide disagreement by calculating only on agreed concerns.

## Governance

- Schema changes require a version bump and migration note.
- Case brief changes require a new hash and relabeling.
- Gold changes require two independent labels or a documented defect, plus
  benchmark-owner approval.
- The planner implementation may propose catalog changes but cannot merge gold.
- Held-out labels remain outside the plugin repository and its CI artifacts.
- Release results identify evaluator version, model version, and plugin commit.

