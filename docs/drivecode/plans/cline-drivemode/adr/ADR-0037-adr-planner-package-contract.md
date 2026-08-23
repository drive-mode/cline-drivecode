# ADR-0037 · ADR Planner production package and invocation contract

**Status:** Proposed
**Owner:** Harrison / Drivecode
**Decider:** Harrison
**Initiative:** [adr-planner](../initiatives/adr-planner/)
**Plan:** [Milestone 1](../initiatives/adr-planner/milestone-1-implementation-plan.md)
**Constrained by:** [ADR-0036](ADR-0036-adr-planner-plugin-boundary.md)

## Context

ADR-0036 requires a bounded package plugin rather than a skill-only install or
the monorepo root. The repository currently has production SDK package and app
workspace roles plus `sdk/examples/plugins/*`, but no production plugin role.
Using the examples directory would make release ownership and CI coverage
ambiguous. Using `sdk/packages/*` would mix a host-loaded plugin with SDK
libraries and the SDK publish pipeline.

Cline package discovery reads `package.json.cline.plugins`; a top-level
`skills/` directory beside that manifest is injected with the plugin. Project
installs live under `.cline/plugins/_installed`. The installer supports exact
npm sources and staged `--force` replacement, while git installation cannot
select a monorepo subdirectory.

Plugin support currently applies to SDK, CLI, Kanban, and SDK-backed Hub
surfaces, not the VS Code or JetBrains extensions. The first package contract
must state this rather than imply cross-host availability.

## Proposed decision

1. Add a top-level production workspace role at `plugins/*`; ADR Planner lives
   at `plugins/adr-planner`.
2. Use `@cline/adr-planner` as the proposed publication coordinate, contingent
   on confirming registry namespace authority before first publish. If that
   namespace is unavailable, the decider chooses a replacement scope before
   implementation rather than adding a second alias. The development package
   remains `private: true`, and `qh2-template` must not reference an unverified
   coordinate.
3. The package declares one Cline entry point and bundles one top-level
   `skills/adr-planner/SKILL.md` directory.
4. The plugin module declares only `commands` and `tools` for M1. It registers
   `/adr-preplan`, `/adr-plan`, `adr_planner_validate`, and
   `adr_planner_readiness`.
5. Commands return `submitPrompt` and begin explicit workflows. They do not run
   planning in setup, hooks, or background events.
6. Tools are adapters over pure TypeScript schemas and policy functions. The
   M1 tools receive structured input; they do not scan the repository, read
   secrets, mutate ADR status, access the network, or install/update packages.
7. The package imports host APIs through optional peer dependency
   `@cline/sdk`. Non-host runtime dependencies must be declared and included in
   package-content review.
8. `qh2-template` installs an exact package version project-locally with
   `cline plugin install --npm <coordinate>@<version> --cwd .`. Upgrade uses
   the same exact coordinate with `--force`; no planning run performs install
   or update. Git-root install is not a fallback.
   Before registry authority exists, ADR-0044 permits a private-beta bridge:
   checkout an immutable repository commit, materialize only this package's
   declared runtime files at one stable ignored project path, and install that
   bounded candidate locally. Installing the temporary clone or monorepo source
   directory is not permitted.
9. The package supports CLI, SDK, Kanban, and SDK-backed Hub in the first
   release. VS Code and JetBrains are explicit compatibility exclusions until
   they implement the package-plugin contract.
10. Plugin-load failure remains nonfatal to ordinary Cline use. A validator or
    readiness failure emits diagnostics and cannot produce a passing gate.
11. Public development fixtures may be used by repository tests but are
    excluded from the runtime package. Held-out briefs and all private gold are
    excluded from the workspace package, tarball, logs, and build context.
12. Mutable project configuration, planning artifacts, and install receipts
    live outside `.cline/plugins/_installed`. A forced package replacement may
    never overwrite them, and a new receipt is written only after discovery
    and schema-compatibility smoke checks pass.
13. Held-out evaluation uses a fresh workspace copy and fresh model session per
    run, with no inherited chat, memory, development artifacts, or writable
    access to gold. The evaluated binary is identical to the release candidate.

## Options considered

| Option | Result |
|---|---|
| `plugins/adr-planner` production workspace | Proposed. Clear ownership, package boundary, and independent CI/release path. |
| `sdk/examples/plugins/adr-planner` | Rejected. Example workspaces do not prove production packaging or release governance. |
| `sdk/packages/adr-planner` | Rejected. It conflates a host-loaded plugin with SDK libraries and existing SDK publication. |
| Root `.cline/plugins/adr-planner.ts` file | Rejected. It cannot bundle schemas, tests, dependencies, and a skill as one versioned install unit. |
| Git install of `cline-drivecode` | Rejected by ADR-0036; no monorepo subdirectory selector. |
| Vendor plugin source in `qh2-template` | Rejected. It creates a second source of truth and template drift. |
| Hooks/rules that run planning automatically | Rejected for MVP. Planning writes and readiness evaluation require explicit invocation. |

## Consequences

### Positive

- Plugin source, deterministic policy, skill, tests, and package version share
  one bounded release unit.
- The monorepo gains an honest production-plugin role instead of promoting an
  example by convention.
- Template installs can be exact, project-scoped, offline during managed runs,
  and atomically replaced.
- Namespaced commands avoid collision with generic `/plan` behavior.

### Negative

- Root workspace, lint, typecheck, test, CI path filters, and release automation
  must learn the new `plugins/*` role.
- A new npm publication workflow and namespace authorization are required.
- Initial plugin availability does not include the IDE extensions.
- Project-local installed package bytes are copied into `.cline/plugins`, so
  template policy must decide whether those managed bytes are committed or
  recreated from the pin.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| `@cline` namespace cannot publish this fork's package | Confirm authorization before implementation; choose one replacement coordinate once. |
| Package code gains broad filesystem/network authority | M1 capabilities limited to commands/tools; pure structured-input tools; package-content and import review. |
| Skill and policy disagree | Machine validation/readiness is authoritative; skill fixtures assert current schema/policy version. |
| Host plugin absence is mistaken for a passing gate | Only a signed/identified readiness artifact can claim pass; missing command or artifact is no claim. |
| CI ignores the new role | Root scripts and workflow filters are part of M1.1 acceptance. |
| Forced upgrade destroys project configuration | Keep mutable state outside the managed install root; preflight schema compatibility; write receipt only after smoke success. |
| Held-out context leaks through prior runs | Fresh evaluator workspace/session per run; no inherited chat, memory, cache, or gold write access. |

## Acceptance conditions

1. Benchmark owner accepts the M0 gold boundary and release policy or records
   an explicit development-only deferral.
2. Decider accepts the path and publication coordinate, including namespace
   ownership.
3. A temporary project proves package entry and bundled skill discovery.
4. Local fresh install and induced failed forced-upgrade tests prove replacement
   behavior.
5. Package tarball proves evaluator separation and contains no hidden runtime
   fetch path.
