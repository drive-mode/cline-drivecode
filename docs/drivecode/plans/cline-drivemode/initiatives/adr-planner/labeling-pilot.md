# ADR Planner independent labeling pilot

**Status:** independent review complete; owner adjudication pending
**Schema:** [m0.1](labeling-handbook.md)
**Cases:** DEV-01 through DEV-04

This file preserves the first independent-review pilot. Reviewer submissions
are locked before comparison. The adjudicated labels are benchmark evidence,
not planner-generated output.

## Review record

| Reviewer | Pass | Cases | Status |
|---|---|---|---|
| [Reviewer A](reviews/reviewer-a.md) | independent-1 | DEV-01..DEV-04 | locked |
| [Reviewer B](reviews/reviewer-b.md) | independent-1 | DEV-01..DEV-04 | locked |
| Harrison / benchmark owner | adjudication-1 | DEV-01..DEV-04 | pending |

## Independent labels

The compact locked submissions are preserved in
[reviewer-a.md](reviews/reviewer-a.md) and
[reviewer-b.md](reviews/reviewer-b.md). Reviewer A produced 27 concern rows;
Reviewer B produced 30.

## Disagreements

Preliminary one-to-one normalization found 25 matching concerns across a union
of 32, for concern-set Jaccard `0.781`. Coverage of A by B is `25/27 = 0.926`;
coverage of B by A is `25/30 = 0.833`. These are pre-adjudication measures and
must be recalculated if the owner approves one-to-many splits.

| Case | Main disagreement | Type | Owner decision needed |
|---|---|---|---|
| DEV-01 | A combined SLO/monitoring/recovery; B split recovery from operability. A alone made security baseline explicit. | scope, omission | Split recovery and operability; decide whether security is separate gold concern. |
| DEV-01 | Data was `applicable/critical` in A and `unknown/major` in B. Billing route was requirement in A and ADR in B. | applicability, classification | Preserve unknown sensitivity while keeping lifecycle decision applicable; split entitlement architecture from billing policy. |
| DEV-02 | A combined discovery with install and separated trust; B separated discovery and permissions. | scope, omission | Keep discovery, install/trust, permissions, versioning, and acceptance as independently scoreable concerns. |
| DEV-02 | Missing template source was task in A and external constraint in B. | classification | External constraint until source/owner is recovered; recovery work remains a task. |
| DEV-03 | A combined publishing and rollback and added public quality; B split publishing/rollback and omitted quality. | scope, omission | Split publishing from rollback; decide whether quality is required or optional for this benchmark. |
| DEV-03 | Publishing was critical in A and major in B. | criticality | Use critical only if absence defeats the stated reliable-publishing outcome; document this benchmark convention. |
| DEV-04 | A combined accountable owners with launch stop; B split governance, launch stop, and emergency failsafe. | scope, omission | Keep governance, clinical failsafe, and release stop independently scoreable. |
| DEV-04 | Security/vendor routes differ between requirements/risk records and ADRs. | classification | Route durable security/vendor architecture to ADR, behavioral safeguards to requirements, and unresolved external exposure to risk register. |

All DEV-04 concerns were critical in both reviews. Both reviewers independently
rejected the unsupported claims that HIPAA applicability, model safety, SMS
confidentiality, or permissibility of raw-prompt retention could be assumed.

## Adjudicated gold

Recommended concern boundaries for owner review:

- DEV-01: tenancy; identity/authorization; data lifecycle; async delivery;
  billing/entitlement; security baseline; recovery; operability/SLO; pilot.
- DEV-02: template source; plugin discovery contract; project-local trust
  boundary; capability/permissions; versioning; generation/upgrade acceptance;
  production-data not-applicable control.
- DEV-03: editing; build/publish; rollback; lightweight public quality;
  dynamic backend not-applicable control.
- DEV-04: accountable governance; legal applicability; clinical intended use;
  clinical failsafe; model validation; privacy/data lifecycle; security;
  vendor processing; SMS; incident/change control; release stop.

These are recommendations, not gold, until Harrison accepts or changes them.

## Agreement measures

Concern matching is calculable now and reported above. Per-field agreement,
Cohen's kappa, dependency edge precision/recall, and cycle count require the
owner-approved split/match map; calculating them before that would encode the
adjudicator's judgment as if it were independent evidence.
