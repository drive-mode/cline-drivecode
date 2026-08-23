# ADR Planner Milestone 3 implementation evidence

**Verified:** 2026-08-14
**Scope:** private reversible implementation proof in `cline-drivecode`
**Decision state:** ADR-0046 Accepted; ADR-0047, ADR-0048, and ADR-0049 Proposed
**Catalog:** `m3-nucleus.1`
**Catalog digest:** `sha256:013d10d2cdd8539389759ad4c1ad596f4234c6149bc5cc85db7fe450858fc567`

## Verdict

The M3 private proof satisfies its technical exit conditions. The package can
turn M2 repository evidence into a deterministic, explainable concern
inventory using a versioned 12-concern nucleus, controlled open-world facts,
strong Kleene rules, ADR significance filtering, prerequisite validation,
applicable-only urgency propagation, and stable topological ordering.

This proof does not accept ADR-0049, claim that the nucleus is a complete
production checklist, publish the package, add host-attested brief answers,
calculate a passing readiness gate, write planning artifacts, or modify
`qh2-template`.

## Implemented proof surface

| Surface | Evidence |
|---|---|
| Catalog authority | Runtime-validated and deeply frozen nucleus; canonical content digest includes the catalog version; tampering without a new digest fails closed. |
| Fact authority | Versioned registry fixes key type and allowed authority sources; unknown keys and operator/type mismatches are fatal. Repository conversion emits positive observations only. |
| Rule semantics | Constants, equality, set intersection, `all`, `any`, and `not` use three-valued logic. Full trace steps remain auditable while decisive lineage excludes dominated unknowns. |
| Concern routing | All 12 definitions emit applicable, unknown, or coherent not-applicable records. Only applicable, significant ADR routes become candidates. |
| Graph/order | Dangling references, applicable-to-inactive prerequisites, and cycles block with no partial plan. Unknown dependents remain uncertain. Applicable urgency propagates backward; ready nodes sort by urgency, sequence band, then bounded ASCII code-unit id. |
| Result authority | Public `planConcerns` results are marked `untrusted-library`. The package-internal repository planner is absent from public export maps and is the only path that emits `repository-derived`. |
| Tool boundary | `adr_planner_plan_concerns` accepts an empty strict object, recollects M2 evidence internally, and rejects caller facts, catalog, rules, paths, routes, and decisions. |
| Fail-closed contract | The result schema rejects blocked results with authoritative collections and evaluated results with inconsistent cross-references or error diagnostics. |

## Independent adversarial review

An isolated review returned **request changes** before final verification. No
reviewer edits were accepted blindly; each finding was inspected and exercised
locally.

| Finding | Resolution |
|---|---|
| Mutable exported catalog | Confirmed and fixed with deep freeze plus version-bound canonical digest. |
| Library export treated as external interface | Confirmed and fixed. `external-interface` now requires `interface.external`; repository-only library evidence leaves it unknown. |
| Unknown dependent blocked by inactive prerequisite | Confirmed and fixed. The fatal check applies only to applicable dependents. |
| Public pure kernel looked authoritative | Confirmed and fixed with explicit `untrusted-library` result authority and a non-exported trusted repository entry point. |
| No controlled fact registry | Confirmed and fixed with key/type/operator/authority validation. |
| Set values and fact references order-sensitive | Already normalized in the inspected implementation; retained and strengthened with schema transforms and permutation tests. |
| Dominated unknowns leaked into question lineage | Confirmed and fixed while retaining full child trace steps. |
| Unknown urgency and ordering policy underspecified | Confirmed and resolved: only applicable dependents propagate urgency; ready ordering is urgency, band, id. ADR-0049 and the M3 plan now state this. |
| Result schema allowed blocked partial output | Confirmed and fixed with fail-closed and cross-reference refinements. |
| Acceptance tests had gaps | Confirmed and expanded for mutation, digest, fact registry/type, dominated unknowns, unknown dependents, lifecycle-band inversion, distinct permutations, authority markers, result shape, and malicious installed input. |

## Verification ledger

| Verification | Result |
|---|---|
| `bun -F @cline/adr-planner typecheck` | pass |
| `bun -F @cline/adr-planner test` | 72 pass, 0 fail, 314 assertions across 10 files |
| `bun biome check --diagnostic-level=error plugins/adr-planner` | 42 files checked; no findings |
| `bun plugins/adr-planner/scripts/verify-package.ts` | private package archive verified; 29 entries |
| Fresh project-local install and `smoke-installed.ts` | 2 commands, 5 tools, bounded collection, CLI/library profile, repository-derived concern plan, malicious caller policy rejected, no privacy canary leaked |
| `bun run types` | full workspace typecheck pass |
| Drivecode structure and Done tests | pass; recorded after this artifact is linked |
| Internal link check (`--no-site`) | pass; recorded after this artifact is linked |

## Fresh installed-package result

The non-empty privacy fixture produced:

- direct profile surfaces: `cli`, `library`;
- positive facts: `surface.cli`, `surface.library`;
- concern authority: `repository-derived`;
- ADR candidates: `system-boundary` only;
- `external-interface`: unknown, because package exports do not prove an
  independently owned consumer contract; and
- no workspace path, package-name, dependency/version, script, raw-source,
  ignored, secret, or evaluator canary in serialized output.

The smoke also submitted non-empty `facts`, `catalog`, and `rules` payloads.
Every payload was rejected across the sandbox boundary before a concern plan
could be produced.

## Real-repository exercise

The explicit tool pipeline ran against this `cline-drivecode` working tree:

| Stage | Observed result |
|---|---|
| Bounded collection | `collected`; 5,191 Git-visible paths listed; 45 allowlisted candidates; 12 manifests read; 59 controlled evidence records emitted; 0 skipped |
| Six-dimension profile | `productSurface = [cli, library]`; runtime remains unknown; 9 dependency-based candidates remain unsupported |
| Positive planning facts | `surface.cli`, `surface.library` |
| Applicable concerns | `product-boundary`, `quality-priorities`, `system-boundary` |
| Unknown concerns | `backup-restore`, `data-authority`, `deployment-rollback`, `external-interface`, `observability`, `retention-deletion`, `scale-triggers`, `tenancy-isolation`, `trust-boundaries` |
| Not applicable | none; repository detector absence does not manufacture false |
| ADR candidates | `system-boundary` |
| Diagnostics | none |

Stable active order:

1. `product-boundary`
2. `quality-priorities`
3. `system-boundary`
4. `data-authority`
5. `trust-boundaries`
6. `tenancy-isolation`
7. `external-interface`
8. `retention-deletion`
9. `deployment-rollback`
10. `backup-restore`
11. `observability`
12. `scale-triggers`

## Remaining gates

1. Harrison accepts or amends ADR-0049 and the controlled fact/catalog policy,
   or explicitly retains M3 as a private reversible proof.
2. M4 adds host-attested facts, bounded questions/experiments, and readiness
   obligation compilation without weakening the M2/M3 authority boundary.
3. Catalog expansion waits for nucleus precision review against owner-approved
   development gold and the pre-registered release policy.
4. Publication and `qh2-template` integration remain blocked on ADR-0047,
   canonical template recovery/recreation, registry authority, and M6 install
   gates.
