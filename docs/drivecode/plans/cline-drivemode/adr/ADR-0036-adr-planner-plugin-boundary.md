# ADR-0036 · ADR Planner plugin ownership and installation boundary

**Status:** Accepted (2026-08-14)
**Owner:** Harrison / Drivecode
**Decider:** Harrison
**Initiative:** [adr-planner](../initiatives/adr-planner/)
**PRD:** [ADR Planner](../prd/prd-adr-planner.md)
**Constrained by:** [ADR-0010](ADR-0010-provider-harness-byok.md),
[ADR-0018](ADR-0018-agent-runtime-contract.md),
[ADR-0028](ADR-0028-adlc-control-plane.md).

## Context

Planning quality must be present when a repository is created, not added after
architecture has already emerged from code. The capability needs both agent
orchestration and deterministic behavior: a skill can guide evidence gathering
and decision discussion, while schemas and tools can validate concern records,
dependency graphs, ADR routing, and readiness.

The implementation belongs with Cline and Drive planning behavior in
`cline-drivecode`. Generated repositories should receive it through
`qh2-template`. Existing Cline behavior supports package plugin manifests,
project-scoped installation under `.cline/plugins`, and bundled package skills.
It does not provide automatic plugin updates or a git subdirectory selector.
Installing the `cline-drivecode` repository root would therefore be ambiguous
and unsafe.

The repository already rejects runtime retrieval of remote plugins as a
managed-session trust path. Template bootstrap is a separate, explicit supply
chain action and must retain a reproducible pin.

## Decision

1. `cline-drivecode` is the canonical owner of ADR Planner implementation,
   bundled skill, schemas, templates, tests, development benchmark, and docs.
2. ADR Planner ships as one bounded Cline package plugin with a top-level
   bundled planning skill. It is not a Claude-only marketplace plugin and the
   monorepo root is not its install unit.
3. The plugin exposes two explicit user workflows: pre-plan and plan. It does
   not run as a background hook in the MVP.
4. The skill owns model-guided evidence gathering, questions, explanation, and
   artifact drafting. Deterministic TypeScript owns schemas, normalization,
   dependency validation, artifact routing checks, and readiness calculation.
5. `qh2-template` owns only bootstrap and upgrade integration: package
   coordinate, immutable version/ref pin, project-scoped install invocation,
   and a forced reinstall path for updates.
6. Cline owns materialization, sandboxed loading, workspace discovery, and
   plugin-skill injection. Generated repositories do not vendor a forked copy
   of planner source files by default.
7. Managed planning runs make no network fetch to obtain or update the plugin.
   Installation or upgrade occurs before the run as an explicit template or
   maintenance action.
8. Planner writes require explicit invocation. Changing Accepted ADR substance
   requires human confirmation and follows ADR-0000 change control.
9. Development benchmark cases may be public in this repository. Held-out
   briefs and gold labels remain outside the plugin package and build context.
10. Milestone 1 chooses the exact package path and coordinate. It must add a
    production plugin workspace role rather than disguising the package as an
    SDK example.

## Options considered

| Option | Result |
|---|---|
| Claude-only plugin in `qh2-template` | Rejected. It does not make the capability native to Cline and splits ownership/runtime behavior. |
| Repository-local skill only | Rejected as the final shape. Useful for prototyping, but cannot own deterministic tools, schemas, or package lifecycle. |
| Cline package plugin with bundled skill | Accepted. One install unit supports agent guidance and deterministic enforcement. |
| New standalone repository | Rejected for the first release. It separates planning behavior from the runtime and tests it depends on. |
| Install the `cline-drivecode` Git root | Rejected. The root has no bounded plugin manifest and git install has no subdirectory selector. |
| Fetch/update plugin during each planning run | Rejected. It weakens reproducibility and conflicts with the managed-session trust boundary. |

## Consequences

### Positive

- Every generated project can begin with the same versioned planning behavior.
- The plugin remains testable against the Cline runtime in the same monorepo.
- Skill behavior and deterministic enforcement share one release boundary.
- Planning runs are reproducible and do not depend on network availability.

### Negative

- `qh2-template` must retain source and pin metadata because Cline's installed
  wrapper does not preserve a complete update channel.
- A new production plugin package role and release path must be added to the
  monorepo.
- Template recovery or recreation is required before end-to-end bootstrap and
  upgrade tests can pass.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Template/plugin versions drift | Immutable pin, run manifest, explicit upgrade test |
| Planner silently blocks ordinary Cline use | Plugin load fails soft; requested readiness gate fails closed with diagnosis |
| Skill prose bypasses policy | Machine artifacts and deterministic gate calculation are authoritative |
| Public tests overfit implementation | Private held-out evaluator set and leakage retirement policy |

## Action items

1. Complete Milestone 0 independent labels and prompt-only baseline.
2. [Resolved 2026-08-14] Use the private GitHub template
   `harrison-quant-h2/qh2-template`; keep plugin source in `cline-drivecode`.
3. In Milestone 1, choose the package path/coordinate and add its workspace,
   manifest, bundled skill, schema tests, and smoke fixture.
4. Add fresh-template and forced-upgrade acceptance tests before release.
