# ADR Planner Milestone 0 owner decision packet

**Prepared:** 2026-08-14
**Decision owner:** Harrison
**Status:** awaiting owner response

This packet contains the decisions that cannot be self-approved by the planner
implementation. Accepting them closes benchmark governance; changing them does
not invalidate the preserved independent reviews or baseline runs.

## Decision 1 · Pilot gold concern boundaries

The independent submissions and disagreement record are in
[labeling-pilot.md](labeling-pilot.md). The proposed normalized boundaries are:

| Case | Proposed concern count | Material adjudication choice |
|---|---:|---|
| DEV-01 | 9 | Keep security, recovery, and operability independently scoreable; split entitlement architecture from billing policy within the billing concern when routes differ. |
| DEV-02 | 7 | Score discovery, project-local trust, capability permissions, version ownership, and install acceptance independently. |
| DEV-03 | 5 | Split publish from rollback; retain one lightweight public-quality concern and explicit dynamic-backend not-applicable control. |
| DEV-04 | 11 | Separate governance, legal applicability, clinical intended use, failsafe, validation, privacy, security, vendors, SMS, incident/change control, and release stop. |

Owner response required: accept these boundaries as development gold `m0.1`,
or identify the rows to split, merge, add, remove, or reclassify. Acceptance
authorizes generation of the final match map and agreement statistics; it does
not automatically accept any ADR or implementation choice.

## Decision 2 · Release policy

The proposed [release-policy.md](release-policy.md) requires zero critical
false-passes, 100% critical recall, deterministic artifacts, and explicit
precision/stability floors. It is intentionally stricter than the prompt-only
baseline and evaluates development and held-out cases separately.

Owner response required: accept policy `m0.1`, or provide threshold changes
before Milestone 1 is evaluated against it.

## Decision 3 · Canonical template source

**Resolved 2026-08-14.** The canonical private template is
[`harrison-quant-h2/qh2-template`](https://github.com/harrison-quant-h2/qh2-template).
It is marked as a GitHub template and owns bootstrap, immutable source-pin,
explicit exception, fresh-generation, and upgrade integration only. Plugin
source and evaluation assets remain in `cline-drivecode`.

The template's local-source bootstrap has passed against the M1–M3 package.
Remote default activation remains gated on a committed, reviewed ADR Planner
source ref or accepted package coordinate.

## Decision 4 · Standing release reviewer

Two isolated reviewers completed the development pilot, but held-out release
gold needs a named human reviewer independent of implementation. Provide the
reviewer name/role, or explicitly defer release-gold construction while M1-M4
development proceeds against public cases.

## Decision 5 · Production package contract

[ADR-0047](../../adr/ADR-0047-adr-planner-package-contract.md) proposes
`plugins/adr-planner`, package coordinate `@cline/adr-planner`, explicit
`/adr-preplan` and `/adr-plan` commands, pure validation/readiness tools, and no
MVP hooks or background execution. The coordinate depends on registry
namespace authority; the path does not.

Owner response required: accept ADR-0047 as proposed, change its path or
coordinate, or defer package implementation.

## Decision 6 · Repository evidence trust boundary

[ADR-0048](../../adr/ADR-0048-adr-planner-evidence-trust-boundary.md)
proposes explicit, Git-visible, allowlisted metadata collection from the
host-provided workspace root. It rejects arbitrary paths, raw source output,
ignored/secret/symlink reads, background scans, writes, telemetry evidence
payloads, and network access; profiling preserves unknowns.

Owner response required: accept ADR-0048 as proposed, amend the read or signal
policy, or keep M2 as a private reversible proof pending later acceptance.

## Decision 7 · Concern catalog and rule authority

[ADR-0049](../../adr/ADR-0049-adr-planner-concern-catalog-and-rule-authority.md)
proposes a versioned package-owned concern catalog, source registry, constrained
three-valued rule language, open-world repository facts, deterministic routing,
and prerequisite ordering. The public model-facing tool accepts no facts,
catalog, rules, classifications, or significance assertions. The 12-concern
nucleus is an implementation and evaluation seed, not a claim of catalog
completeness.

Owner response required: accept ADR-0049 as proposed, amend catalog/rule
authority or source policy, or keep M3 as a private reversible proof pending
catalog precision review.

## Decision 8 · Host-attested workflow authority

[ADR-0050](../../adr/ADR-0050-adr-planner-host-attested-workflow-authority.md)
proposes an explicit `/adr-attest` channel for controlled Boolean human facts,
host-owned session state, explicit pre-plan/plan selection, and an empty-input
canonical workflow compiler. The private proof now bridges separate command and
tool sandboxes with CAS/replay protection and a content-bound plugin identity.
Natural-language briefs remain prompt context. The compiler may propose
questions, experiments, ADR candidates, routed work, and readiness blockers,
but cannot accept an ADR, waiver, risk, or deployment authorization.

Owner response required: accept the provisional boundary, amend it, or keep M4
private while authenticated connector principals, consent UI, signed receipts,
retention, and malicious same-user plugin isolation are designed. Do not treat
serialized `host-composed` text as independent proof.

## Decision 9 · Reproducible install and upgrade attestation

[ADR-0054](../../adr/ADR-0054-adr-planner-install-attestation.md) separates
immutable source identity, installed-content identity, host compatibility, and
atomic upgrade. Its first private slice pins direct runtime dependencies and
has `qh2-template` materialize only the package runtime allowlist at one stable
ignored source path, preventing both temporary-path duplicate installs and
source-tree leakage. Structural installed-package verification, real
generated-repository smoke, and staged post-load rollback remain open.

Owner response required: accept ADR-0054's boundary, amend its receipt or
upgrade model, or keep M6 private. Acceptance does not supply the still-missing
remote source commit or publication authority.

## Copyable response

```text
ADR Planner M0 decisions
- Gold boundaries: accept m0.1 | changes: ...
- Release policy: accept m0.1 | changes: ...
- qh2-template: resolved harrison-quant-h2/qh2-template
- Standing reviewer: <name/role> | defer release-gold construction
- Package contract: accept ADR-0047 | changes: ...
- Evidence boundary: accept ADR-0048 | private proof only | changes: ...
- Catalog/rule authority: accept ADR-0049 | private proof only | changes: ...
- Workflow authority: accept provisional ADR-0050 | private proof only | changes: ...
- Install attestation: accept ADR-0054 | private proof only | changes: ...
```
