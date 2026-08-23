# ADR Planner Milestone 1 implementation evidence

**Recorded:** 2026-08-14
**Branch:** `feat/adr-planner-milestone-0`
**Package:** `plugins/adr-planner` (`@cline/adr-planner@0.0.0`, private)
**Decision state:** ADR-0036 Accepted; ADR-0037 Proposed

## Result

The private development package proves the M1 package boundary without
publishing a coordinate or modifying `qh2-template`. It participates in the Bun
workspace and CI, registers only explicit commands and pure tools, bundles one
skill, validates versioned artifacts deterministically, calculates readiness
fail-closed, and installs through the real Cline CLI into a fresh project.

This is implementation evidence, not owner acceptance of ADR-0037 and not a
release claim. M0 gold, release policy, registry authority, canonical template
source, installed-byte policy, and standing reviewer decisions remain open.

## Implemented surface

| Surface | Evidence |
|---|---|
| Package role | Root `plugins/*` workspace, root scripts, lockfile, and path-filtered CI workflow include `plugins/adr-planner`. |
| Commands | `adr-preplan` and `adr-plan` return explicit `submitPrompt` workflows; neither accepts ADR substance. |
| Tools | `adr_planner_validate` and `adr_planner_readiness` are structured-input adapters over pure TypeScript. |
| Schemas | Evidence, profile, concern, graph, questions/experiments, ADR candidates, routed outputs, readiness, run manifest, and artifact envelope schemas are versioned. |
| Policy | Canonical JSON/digest, graph, route, artifact, and readiness checks are deterministic and fail closed. Producer error diagnostics remain errors even when payload and digest are valid. |
| Skill | `skills/adr-planner/SKILL.md` is discovered from the installed package and preserves human decision authority. |
| Boundary | No hook, rule, MCP server, provider, repository scan, background task, network operation, or artifact write is registered. |
| Archive | Private package archive contains 16 public runtime entries and excludes tests, scripts, baseline, reviews, held-out briefs, and gold. |

The plugin uses `@cline/sdk` only for erased TypeScript contract imports. Tool
objects are constructed without a runtime SDK import so a copied package does
not rely on monorepo workspace links; Cline remains the host of plugin APIs.

## Verification results

| Verification | Result |
|---|---|
| SDK build | All SDK packages built successfully before plugin validation. |
| Full workspace typecheck | All workspace typechecks passed, including Core, CLI, SDK, Hub, IDE, Kanban, examples, and ADR Planner. |
| Plugin typecheck | Passed. |
| Focused unit tests | 22 passed, 0 failed, 55 assertions. |
| Deterministic replay | Canonical output remained byte-identical across ten replays. |
| Formatting/lint | Biome check passed after applying the repository import-order rule. |
| Package review | `verify-package.ts` accepted a 16-entry private archive. |
| Fresh CLI install | Real `cline plugin install <local-package> --cwd <fixture> --json` succeeded. |
| Installed sandbox smoke | One entry, one skill root, two commands, and two tools discovered; invalid artifact returned `valid: false`; invalid readiness returned `blocked`. |
| Forced replacement | `--force` replaced the same managed install path and the external configuration hash remained `264838dc7ca438c2acc29f15d0187c6bb43a3cdbc00bf92084e7e8fd4492d502`. |
| Failed forced replacement | An intentional dependency-installer exit 42 aborted staging; the prior installed plugin still passed the full sandbox smoke and external configuration retained the same hash. |

The source-run sandbox adds a development inspector listener by design. The
installed acceptance smoke sets `CLINE_BUILD_ENV=production`, matching release
sandbox behavior and avoiding a restricted test-runner listener; sandboxed IPC,
module loading, registration, command invocation, and tool invocation remain
real.

The wider host plugin Vitest suites are not a clean release signal in this
worktree: the focused Core run passed 37 tests but one dependency-isolation
assertion failed, while Core plugin-install and CLI plugin suites stopped during
existing host module loading with an undefined Zod namespace. No host source
file was changed for M1. The real CLI install plus sandbox smoke above exercises
the acceptance path directly; the host-suite failures should be triaged
separately before a repository-wide release claim.

## Acceptance commands

```bash
mise exec bun@1.3.13 -- bun run build:sdk
mise exec bun@1.3.13 -- bun run types
mise exec bun@1.3.13 -- bun -F @cline/adr-planner typecheck
mise exec bun@1.3.13 -- bun -F @cline/adr-planner test
mise exec bun@1.3.13 -- bun biome check --diagnostic-level=error plugins/adr-planner .github/workflows/adr-planner-plugin.yml
mise exec bun@1.3.13 -- bun biome lint --diagnostic-level=error package.json
mise exec bun@1.3.13 -- bun plugins/adr-planner/scripts/verify-package.ts

cline plugin install ./plugins/adr-planner --cwd <fresh-fixture> --json
cline plugin install ./plugins/adr-planner --cwd <fresh-fixture> --force --json
CLINE_BUILD_ENV=production bun --conditions=development plugins/adr-planner/scripts/smoke-installed.ts <fresh-fixture>
```

The local acceptance run used the repository CLI source plus Bun as the
configured npm-compatible dependency installer because neither `node` nor
`npm` was available in the execution environment.

## Remaining release gates

1. Harrison accepts or amends ADR-0037 and confirms a publication coordinate
   with registry authority.
2. Harrison accepts M0 gold boundaries and release policy, supplies or defers a
   standing release reviewer, and identifies or authorizes recreation of
   `qh2-template`.
3. The chosen `qh2-template` repository pins the accepted coordinate and proves
   fresh generation plus explicit upgrade behavior.
4. Release CI runs the same install fixture against the immutable publication
   candidate and records an external receipt only after discovery and schema
   compatibility pass.
