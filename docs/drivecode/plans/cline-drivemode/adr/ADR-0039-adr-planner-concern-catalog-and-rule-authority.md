# ADR-0039 · ADR Planner concern catalog and rule authority

**Status:** Proposed
**Owner:** Harrison / Drivecode
**Decider:** Harrison
**Initiative:** [adr-planner](../initiatives/adr-planner/)
**Plan:** [Milestone 3](../initiatives/adr-planner/milestone-3-implementation-plan.md)
**Constrained by:** [ADR-0036](ADR-0036-adr-planner-plugin-boundary.md),
[ADR-0037](ADR-0037-adr-planner-package-contract.md),
[ADR-0038](ADR-0038-adr-planner-evidence-trust-boundary.md)

## Context

Repository evidence and a six-dimension profile do not themselves produce a
useful planning checklist. The planner needs durable knowledge about potential
planning concerns, explicit rules for when each concern applies, correct
artifact routing, architecture-significance reasons, and prerequisite order.
If those semantics live only in a skill prompt, the same facts can produce
different checklists, unknowns can silently become false, and a plausible model
answer can bypass graph or readiness invariants.

The earlier ADR Planner research synthesized a dependency-ordered pre-code
inventory and established that the ADR checklist is a derived view over a
broader planning inventory. The M0 benchmark and labeling handbook then fixed
the current concern classifications and release metrics. M3 must turn that
design into deterministic policy without tuning against unaccepted gold labels
or exposing a caller-controlled rule language through the model tool.

Repository discovery is also open-world. A detected CLI proves that a CLI
surface exists; it does not prove that web, API, or other surfaces do not exist.
Rules therefore cannot treat a missing positive detector as an explicit false.

## Proposed decision

1. Add a versioned, package-owned planning-concern catalog. Its validated
   canonical digest is bound to the version and the runtime nucleus is deeply
   frozen. Catalog definitions are separate from evaluated project concern records and include stable ids,
   one decision question, dependency band, applicability rule, default
   classification, prerequisites, rationale, and source references.
2. Begin with a 12-concern nucleus spanning product boundary, quality
   priorities, system boundary, data authority, retention/deletion, trust
   boundaries, external interfaces, deployment/rollback, observability,
   backup/restore, scale triggers, and tenancy isolation. Expansion toward the
   full catalog occurs only after the deterministic nucleus is evaluated.
3. Use a deliberately small declarative rule language: constants, equality,
   set membership, `all`, `any`, and `not`. Catalog data cannot execute code or
   call tools.
4. Evaluate rules with strong Kleene three-valued logic. `all` is false when
   any branch is false and unknown otherwise unless all branches are true;
   `any` is true when any branch is true and unknown otherwise unless all
   branches are false; `not unknown` remains unknown.
5. Represent project characteristics as positive, evidence-backed facts from a
   versioned registry that fixes each key's value type, compatible operators,
   and allowed authority sources.
   Missing facts evaluate to unknown. Explicit false is accepted only through
   a trusted programmatic context now and a future host-attested human channel;
   repository absence never manufactures false.
6. The model-facing M3 tool accepts an empty strict object, recollects bounded
   repository evidence, profiles it, derives positive facts, and evaluates the
   package-owned catalog internally. It accepts no facts, evidence, catalog,
   rules, paths, classifications, routes, or significance reasons from the
   caller.
7. Emit a deterministic evaluation trace for every concern, including the rule
   path, observed fact state, result, and evidence ids. Full child steps remain
   auditable, while top-level missing facts and evidence include only decisive
   branches so dominated unknowns cannot generate useless questions. Traces
   explain policy; they do not contain raw source content.
8. Applicable concerns use their catalog classification. Not-applicable
   concerns receive the fully coherent not-applicable classification. Unknown
   concerns remain unresolved and name the missing fact keys; they are not
   silently excluded.
9. Only an applicable concern whose route is `adr` and whose catalog definition
   carries at least one permitted significance reason becomes an ADR candidate.
   Unknown concerns do not become ADR candidates before their material facts
   are resolved.
10. Treat `prerequisites` as precedence edges. Validate duplicate ids, missing
    references, inactive prerequisites, and cycles before emitting an
    authoritative plan. Other future relationships such as traceability or
    proof do not participate in ordering.
11. Propagate urgency only from applicable dependents backward through active
    prerequisites. Unknown dependents remain provisional. Use stable
    topological ordering with urgency, sequence band, and bounded ASCII
    code-unit id as deterministic tie-breakers, in that order.
12. A fatal schema, authority, catalog, or graph error returns `blocked` with no
    partial concern inventory, ADR list, or authoritative order. The result
    schema enforces this distinction.
13. The public pure evaluator marks its output `untrusted-library`. Only the
    plugin-internal empty-input repository path can mark output
    `repository-derived`; that trusted entry point is omitted from public
    export maps.
14. M3 performs no repository writes, artifact persistence, ADR acceptance,
    risk acceptance, readiness pass, network access, background scan, or
    template mutation.

## Rule semantics

| Expression | True | False | Unknown |
|---|---|---|---|
| `equals(fact, value)` | known value equals expected | known value differs | fact missing |
| `contains_any(fact, values)` | known set intersects expected | known set has no match | fact missing |
| `all(rules)` | every child true | any child false | otherwise |
| `any(rules)` | any child true | every child false | otherwise |
| `not(rule)` | child false | child true | child unknown |

Repository-derived facts are positive observations. For example,
`surface.cli=true` may be emitted, while `surface.web=false` is never inferred
from the absence of a web detector.

## Options considered

| Option | Result |
|---|---|
| Versioned declarative catalog plus deterministic evaluator | Proposed. It is inspectable, testable, source-backed, and independent of model wording. |
| Prompt-only checklist generation | Rejected as authority. It cannot guarantee unknown preservation, stable routing, or valid dependencies. |
| Universal flat checklist | Rejected. It rewards blanket blocking and makes irrelevant concerns indistinguishable from material ones. |
| Opaque scoring model | Rejected as the inclusion authority. Scores may rank later, but applicability and ADR inclusion require explicit rules and reason codes. |
| Arbitrary executable rules or caller-supplied catalog | Rejected. It creates code-execution and policy-injection surfaces. |
| Treat missing repository signals as false | Rejected. Detection is incomplete and open-world; absence is not evidence of non-applicability. |
| Encode the full 40–60 concern catalog immediately | Deferred. A small nucleus must first prove semantics, graph behavior, precision, and reviewability. |

## Consequences

### Positive

- The same normalized facts and catalog version produce the same concern and
  ADR views.
- Every result is explainable from a fixed rule and bounded evidence.
- Unknowns remain visible instead of becoming false negatives.
- Non-ADR planning work remains in the inventory and prerequisite graph.
- Catalog expansion can be measured against precision and critical recall.

### Negative

- Repository-only runs remain unknown-heavy until M4 provides a host-attested
  question/answer channel.
- A curated catalog and source registry require versioning and maintenance.
- The 12-concern nucleus is intentionally incomplete and cannot support a
  production release claim.
- Current concern records represent precedence only; richer graph node and
  edge types remain later work.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Catalog overfits development gold | Encode the research-derived nucleus before owner adjudication; keep held-out assets outside package/repository; measure additions under the release policy. |
| Missing fact becomes false | Strong Kleene semantics; positive open-world repository facts; unknown monotonicity tests. |
| ADR explosion | Applicable-only ADR filter, explicit significance reasons, and non-ADR routes retained. |
| Model injects policy or authority | Empty strict tool input; internal collection, profile, fact derivation, and bundled catalog. |
| Invalid graph emits plausible plan | Validate before output and return no partial authoritative inventory on fatal errors. |
| Stable ids hide changed semantics | Catalog version bump, version-bound canonical digest, deep-frozen runtime policy, and source/rationale review are required for semantic changes. |

## Acceptance conditions

1. Catalog and rule schemas reject unknown fields, arbitrary operations,
   duplicate ids, missing source references, and invalid classifications.
2. Positive, negative, unknown, boundary, duplicate, and permutation fixtures
   exercise all rule operations and every nucleus concern.
3. Missing facts never evaluate to false, and adding unrelated facts does not
   reorder unrelated concerns.
4. Cycles, dangling prerequisites, and applicable concerns requiring a
   not-applicable prerequisite block with no partial plan.
5. Earliest urgency from applicable dependents propagates to active
   prerequisites and every active prerequisite precedes its dependent in
   urgency, sequence-band, then bounded ASCII code-unit order.
6. Only applicable ADR-routed concerns with permitted reason codes become
   proposed ADR candidates.
7. Ten identical runs are byte-identical, including traces and diagnostics.
8. Installed-package smoke invokes the M3 tool against a non-empty fixture and
   proves that caller input and privacy canaries cannot enter the plan.
9. M1–M2 validation, privacy, package-boundary, and no-write guarantees remain
   green.

## Revisit triggers

- Add host-attested brief/user facts and bounded questions in M4.
- Add typed non-precedence graph relationships when readiness compilation needs
  artifact, control, and proof nodes.
- Expand the base catalog only under source, fixture, and benchmark governance.
- Add domain overlays only after base-catalog precision is measured.
- Revisit rule operations only when a real concern cannot be expressed without
  arbitrary code or hidden defaults.
