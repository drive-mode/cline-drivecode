# CLAUDE.md — cline-drivecode

Guidance for Claude Code (and other coding agents) working in this repository.

`AGENTS.md` is the operational contract for this repo — cloud-agent setup, port
rules, merge authority, learned preferences. It is imported below and **wins on
any conflict**. This file is the map: what lives where, how the pieces fit, and
which commands are real.

@AGENTS.md

---

## What this repository is

Two things at once, in one monorepo:

1. **Upstream Cline** — the open-source coding agent: SDK packages, CLI, VS Code
   extension, Kanban board, docs. This is a fork of
   [`cline/cline`](https://github.com/cline/cline); upstream commits are synced
   *into* the fork by PR, and Drive fork code is never pushed back upstream.
2. **Drive** — the product this fork exists for. Stay on a call with your agents,
   see what they are doing on a shared **Spotlight**, and steer. Drive ships in
   two clients (hub dashboard and CLI TUI) against **one hub daemon**.

Drive is public but **self-hosted**: clone and run it. There is no hosted
service.

### Where it sits in the Drive Mode family

| Repo | Role |
|---|---|
| **cline-drivecode** (this) | Cline fork + Drive product: hub, CLI, VS Code, SDK |
| [`collaboration-harness`](https://github.com/drive-mode/collaboration-harness) | Portable room protocol + pure kernel (an independent implementation of the same fold) |
| [`drivemode-mcp`](https://github.com/drive-mode/drivemode-mcp) | MCP writer + viewer built on that harness |
| [`drive-ios`](https://github.com/drive-mode/drive-ios) | SwiftUI iPhone/iPad client (the App Store candidate) |
| [`site`](https://github.com/drive-mode/site) | drivemode.ai |

The harness and MCP repos are **not** consumers of `@cline/*`. They mirror this
repo's coordinator semantics (`control.end`, Presenter leave/revoke) rather than
sharing code. When you change the room fold here, check them.

## Read these first

| File | Why |
|---|---|
| `AGENTS.md` | Repo rules, cloud-agent setup, merge authority (imported above) |
| `sdk/AGENTS.md` | SDK package boundaries + change routing |
| `sdk/ARCHITECTURE.md` | Source of truth for runtime flows, hub, titles/Director |
| `docs/drivecode/HANDOFF.md` | Drive cold-start brief — current state, merged vs pending |
| `docs/drivecode/README.md` | Shipped Drive reference, cited to live code |
| `docs/drivecode/STRUCTURE.md` | Where a new Drive doc is allowed to go (CI-enforced) |
| `docs/drivecode/CI.md` | The CI contract: path filters, the gate, labels |
| `.clinerules/general.md` | Tribal knowledge: state keys, proto flow, search hygiene |
| `.clinerules/bun-and-node.md` | Bun-is-tooling vs Node-is-runtime keep-list |

## Toolchain

**Bun 1.3.13** is the package manager and task runner. **Node >= 22** is the
runtime. Both are correct at the same time — see `.clinerules/bun-and-node.md`
before "fixing" any `node` token. Never npm/yarn/pnpm; there is one root
`bun.lock` for the whole workspace.

```bash
bun install --frozen-lockfile
bun run build:sdk    # REQUIRED before running anything
bun run preflight    # toolchain, build output, ports, provider
```

### The single most common failure

SDK packages (`@cline/shared|llms|agents|core|drive|sdk`) resolve each other
through **compiled `dist/`** — their `exports` point only at `dist/`, with no
`development` source condition. So:

- After changing SDK source or dependencies, run **`bun run build:sdk`** before
  running the CLI, the hub, or SDK tests. Otherwise imports fail with missing
  `@cline/*` / missing `dist/`.
- Running processes do **not** hot-reload SDK source. Rebuild and restart.
- A focused test failing on a missing export is a workspace-setup problem, not a
  source bug.

## Repository map

```text
sdk/packages/     # the published SDK — shared, llms, agents, core, drive, sdk, ui
apps/cli/         # @cline/cli — terminal UI (OpenTUI) + headless
apps/cline-hub/   # @cline/cline-hub — hub daemon + React dashboard (src/webview)
apps/vscode/      # claude-dev — the VS Code extension (+ webview-ui, proto codegen)
apps/kanban/      # kanban — multi-agent task board (has its own AGENTS.md/CLAUDE.md)
apps/drivecode-demo/  # @cline/drivecode-demo — demo adapters + fixtures, edge-wired only
apps/vscode-rollout/  # A/B rollout stitching for the extension
apps/examples/    # runnable SDK examples incl. desktop-app (Tauri + Next.js + Bun sidecar)
apps/drive-ios/   # LEGACY fixture — the real iOS app is the drive-ios repo
docs/             # Mintlify product docs (docs.json) + docs/drivecode/ (the Drive nest)
evals/            # benchmarks, cline-bench, smoke tests
sdk/scripts/      # repo scripts: clean, version, release, check-links, check-drivecode-*
.agents/ .cline/ .claude/ .clinerules/ .codex/ .cursor/   # per-tool agent config + skills
```

## SDK layering

```text
@cline/shared  → contracts, schemas, paths, hooks, remote-config, storage helpers
@cline/llms    → provider settings, model catalogs, manifests, handler creation
@cline/agents  → the stateless loop: iteration, tool orchestration, event emission
@cline/core    → stateful orchestration: sessions, storage, plugins, tools, the hub
@cline/drive   → the Drive kernel: rooms, facets, director, topology, waves, driveplan
@cline/sdk     → the published façade over core
@cline/ui      → shared UI components + theme (separate version line, 0.2.x)
```

Dependency direction is strictly downward: `shared → llms → agents → core → apps`.
`core` also depends on `drive`; `drive` depends only on `shared`.

**Change routing** (from `sdk/AGENTS.md`):

| Concern | Package |
|---|---|
| Model/provider schemas, handler behavior | `@cline/llms` (see `packages/llms/AGENTS.md`) |
| Stateless loop, tool orchestration, streaming, hooks | `@cline/agents` |
| Sessions, storage, config watching, default tools, plugins, telemetry, hub | `@cline/core` (hub under `src/hub/`) |
| Remote-config schemas, managed instructions, telemetry normalization | `@cline/shared/src/remote-config` |
| Room/facet/director/topology kernel logic | `@cline/drive` |
| Host-specific UX or shell behavior | the app package |

Rules that get enforced in review: `agents` stays stateless; `shared` stays
low-level; internal `packages/core/src` modules must **deep-import leaves**, not
the package root (`from "../.."` / `@cline/core` is banned inside core). Prefer
architectural cleanup over compatibility shims. If you touch hub, bootstrap, or
session flows, update `sdk/ARCHITECTURE.md`.

## Drive: the product layer

Vocabulary is load-bearing and must not drift across repos or docs:

- **Spotlight** — the user-facing shared surface.
- **stage** — the typed wire projection of it.
- **Presenter** — a *temporary, exclusive* Agent Title authorizing an agent to
  present. Six title definitions exist (Presenter, Researcher, Builder,
  Reviewer, Verifier, Scribe).
- **Director** — proprietary host policy in `@cline/core`; clients read only a
  signed, versioned, **non-exportable** descriptor plus the allowlisted overlay
  keys (`pace`, `handoffs`).

The hub is the **sole coordinator**. `createClineDriveHost` replaces
client-proposed ids, permissions, bundles, resources, delegation, policy, and
temporal metadata with a signed host recipe before appending `control.title_*`
events. The title-authorization API takes exactly one explicit `grantId` and
never unions permissions across grants. Transfer is atomic; revoke clears the
agent stage; disconnect/room-end/expiry ends authority synchronously. Legacy
`drive.spotlight.set` is a compatibility alias for an audited Presenter
transfer — new clients use `drive.presenter.*`.

Room truth is partitioned into three lanes (ADR-0013): an **append-only event
log** (`.cline/drive/rooms/<id>/`), the **live `RoomSnapshot`** (rebuildable from
the log), and durable **facets** (`.cline/drive/facets.v1.json`). Status Hub
storage is its own SQLite file (`~/.cline/db/status.db`) with a monotonic `seq`
cursor and a partial unique index that makes "two current rows for one subject"
unrepresentable.

### Where Drive code lives

| Concern | Path |
|---|---|
| Room / participant / stage schemas | `sdk/packages/shared/src/drive/` |
| Status schemas + dependency map | `sdk/packages/shared/src/status/` |
| Drive kernel (sub-modes, narration, topology, BYOK) | `sdk/packages/drive/src/` |
| Room state, `call_*` ops, event log | `sdk/packages/core/src/hub/collaboration/` |
| Presenter grants + Director policy | `sdk/packages/core/src/hub/clineDriveHost.ts`, `directorPolicy.ts` |
| Status store/service, hub handlers | `sdk/packages/core/src/status/`, `src/hub/server/handlers/status-handlers.ts` |
| `report_status` tool | `sdk/packages/core/src/extensions/tools/` (`executors/report-status.ts`) |
| Hub Drive UI (Spotlight, lobby, call) | `apps/cline-hub/src/webview/src/drive/`, `components/views/drive-view.tsx` |
| Status Hub / Analytics views | `apps/cline-hub/src/webview/src/components/views/status-view.tsx`, `analytics-view.tsx` |
| TUI Status Hub + Drive | `apps/cli/src/tui/status/`, `apps/cli/src/tui/drive/` |
| Demo adapters + fixtures | `apps/drivecode-demo/` |

**Ports discipline:** product views depend on ports only (`StatusSnapshotSource`
in the CLI, `StatusTeamsSource` in the hub). Live hub adapters implement them;
demo adapters live in `@cline/drivecode-demo` and are wired **only at composition
roots** (`apps/cli/src/tui/root.tsx`, hub `App.tsx`). Views must never read
`CLINE_DEMO_*` or `?demoPlans` themselves — that is what
`readDrivecodeDemoCliBootstrap()` / `readDrivecodeDemoHubBootstrap()` are for.

## Running things

Read the URL and port from the terminal, always. Preferred defaults are used when
free and fall back to the next free port otherwise; explicit
`CLINE_HUB_DASHBOARD_PORT` / `CLINE_HUB_WEBVIEW_DEV_PORT` fail closed instead of
silently relocating. **Never hardcode a hub or dashboard port.**

```bash
# Hub dashboard (Drive rail, Spotlight, Status Hub, Analytics)
bun run --cwd apps/cline-hub dev      # open the "Cline Hub dashboard listening" URL, then Connect

# CLI / TUI — auto-spawns the hub daemon; do not start the hub separately
bun run cli -i                        # interactive
bun run cli "some prompt"             # one-shot
bun run cli doctor                    # health of a running install
bun run cli doctor preflight          # why something won't start

# VS Code extension
bun run --cwd apps/vscode build:webview && bun --cwd apps/vscode esbuild.mjs

# Desktop app (Tauri) — headless split
bun run --cwd apps/examples/desktop-app dev:sidecar   # backend on 127.0.0.1:3126
bun run --cwd apps/examples/desktop-app dev:web       # Next.js on :3125
```

A real agent turn needs an **LLM provider credential**. An env var alone does not
select a provider — run `bun run cli auth --provider <id> --apikey <key>
--modelid <model>` or pick one under Settings → Providers. With no credentials,
the default `cline` provider fails fast with `Unauthorized`. To look around with
none, use the demo query params (`?demoShareScreen=1`, `?demoPlans=1`,
`?demoSessions=1`).

## Verify: lint, typecheck, test

```bash
bun run check      # runtime-config + biome + build:sdk + cli build + hub webview + typecheck + check-publish
bun run types      # typecheck every package in parallel
bun run lint       # check:runtime-config + biome lint
bun run format     # biome format
bun run fix        # biome check --write --unsafe

bun run test       # sdk packages + cli + hub + vscode
bun run test:unit  # the parallel unit fan-out
bun run test:e2e   # core + cli e2e
```

Focused, from the repo root:

```bash
bun -F @cline/shared test
bun -F @cline/core test:unit
bun -F @cline/drive typecheck && bun -F @cline/drive test
bun -F @cline/cli test:unit
bun -F @cline/cline-hub test
bun -F @cline/vscode test:unit          # ~984 bun tests, no VS Code host needed
```

Drive-specific gates:

```bash
bun run check:drivecode-docs   # nest structure + ADR-0026 Done claims
bun run test:drivecode-docs
bun run check:runtime-config
bun run check:links
```

**Local CI parity for a Drive change** (mirrors `drive-ci`):

```bash
bun run build:sdk
bun run check:drivecode-docs && bun run test:drivecode-docs
bun -F @cline/drive typecheck && bun -F @cline/drive test
bun -F @cline/cline-hub typecheck && bun -F @cline/cline-hub test && bun -F @cline/cline-hub build:webview
bun -F @cline/drivecode-demo typecheck && bun -F @cline/drivecode-demo test
bun -F @cline/cli build && bun -F @cline/cli typecheck && bun -F @cline/cli test:unit
```

### Test runner is decided by the import

A test file imports `bun:test` **XOR** `mocha`. `bun:test` → runs under bun
(node-side unit suites). `mocha` → runs under `@vscode/test-cli` in a real VS
Code extension host and exercises the live `vscode` API. Do not add `bun:test`
to a test that needs the extension host. The SDK/hub/CLI suites use Vitest
configs (`vitest.config.ts`, `vitest.e2e.config.ts`,
`vitest.tuistory.e2e.config.ts`).

### Known environment artifacts (not bugs)

- `@cline/core` → `workspace-manifest.test.ts > prefers origin and returns the
  current branch` fails in cloud VMs, because git `insteadOf` rules rewrite
  GitHub remotes to `https://x-access-token:...@github.com/...`.
- Some `@cline/cli` e2e assertions on exact tool-listing strings drift; treat as
  pre-existing, not an environment problem.

## CI

`drive-ci` is the **single required gate** for Drive merges. Require the check
named `drive-ci` (the gate job) in branch protection — never the individual
Hub/Drive/CLI jobs, and never an OS-specific matrix name (PR matrices are
Ubuntu-only, so a required `Test (windows-latest, …)` stays Pending forever).

- Path filters (`dorny/paths-filter`) select jobs; skipped jobs report success.
  Shared deps (`sdk/packages/shared`, `bun.lock`) are listed on **every**
  consumer filter — the manual equivalent of Nx/Turbo "affected". If you add a
  cross-cutting dependency, add it to the consumer filters too.
- `drive-ci.yml` is deliberately **not** filtered by base branch: this repo lands
  stacked PRs, and a `branches: [main]` filter once let a broken hub webview
  through (#153). Every stack layer pays for the gate.
- Labels are overrides, not the primary router. `ci/*` forces a suite; `area/*`
  is reviewer sugar. `ci/drive` is read directly by `drive-ci`.
- Other suites: `sdk-test.yml`, `ext-vscode-*`, `kanban-test.yml`,
  `docs-link-check.yml`, `drive-ios.yml` (builds `apps/drive-ios`, the legacy
  fixture), plus the publish workflows.
- Publish workflows mint a `build_id` (`product@version+<shortsha>.run<run_id>`)
  before long work so cancelled runs still leave a trail. Full detail in
  `docs/drivecode/CI.md`.

Pre-commit (husky) runs **gitleaks** on staged changes and `lint-staged` in
`apps/vscode`. Install gitleaks locally or commits will refuse to run.

## Documentation rules

- **Single nest.** Every Drive/drivecode doc lives under `docs/drivecode/`. Do
  not recreate `docs/plans/`, `docs/design/`, `docs/reviews/`, or
  `docs/assets/drivecode/`. Placement is defined by
  `docs/drivecode/STRUCTURE.md` and **enforced in CI**
  (`bun run check:drivecode-docs`).
- Product role folders under `plans/cline-drivemode/`; harness track under
  `plans/drivecode-sdk/`; wireframes → `design/wireframes/`; screenshots →
  `assets/{hub,tui,demos,logos}/`; reviews → `meta/reviews/`; multi-file tracks →
  `initiatives/<slug>/` (README required).
- Decision records are **ADR** — never "ARD" — as
  `plans/cline-drivemode/adr/ADR-NNNN-*`.
- Cold-start surfaces must cite `claim:<id>` next to Shipped/Landed/Partial;
  `verified_shipped` requires existing evidence paths (ADR-0026,
  `check-drivecode-done.ts`).
- Prefer relative links inside the nest; use absolute `docs/drivecode/...` in
  handoffs and cross-repo callouts. After a move, grep for the old path and fix
  links — do not leave stubs.
- Mintlify user docs (`docs/sdk/`, `docs/cli/`, `docs/features/`, …) stay
  **outside** the nest. Repo-root `assets/drive/` is brand source, not docs.

## Conventions

- **Biome** is the formatter/linter (`biome.json`, plus `sdk/biome.json` and
  `apps/biome.json`). Indent style is **tabs**; `apps/vscode` overrides to width
  4 / line width 130 / semicolons as-needed. Run `bun run fix`, don't hand-format.
- **Avoid provider-specific string matching.** No `providerId === "..."` branches
  when fixing provider/config plumbing — use provider metadata, the shared
  catalog/defaults, declared capabilities, or centralized normalization by data
  shape. If an exception seems necessary, stop and explain instead.
- **Config files users edit** are read with `readFileStrippingUtf8Bom` /
  `readFileSyncStrippingUtf8Bom` / `stripUtf8Bom` from `@cline/shared/node`.
  Never strip BOMs from user files handed to tools or models.
- **Search hygiene.** `out/`, `dist/`, `dist-standalone/`, `src/generated/`, and
  `src/shared/proto/` are build output or codegen. Point searches at `src/` and
  filter by extension, or grep with
  `--exclude-dir={out,dist,node_modules,generated}`.
- **Proto changes** (`apps/vscode/proto/`) require `bun run protos`; `dev`,
  `build:webview`, and `check-types` already run it. Adding an RPC means a
  handler in `src/core/controller/<domain>/` plus a generated-client call from
  the webview; adding an enum value means updating
  `src/shared/proto-conversions/cline-message.ts`.
- **New global state keys** need the type in
  `src/shared/storage/state-keys.ts`, reads/writes through `StateManager`, and —
  if user-toggleable — **both** `updateSettings.ts` and `updateSettingsCli.ts`,
  plus the webview round-trip (`UpdateSettingsRequest` in `state.proto`,
  `getStateToPostToWebview()`, `ExtensionState`, `ExtensionStateContext`).
  Missing one path makes a toggle silently not stick.
- **Changesets**: contributors do not add changelog entries; maintainers curate
  them at release.
- Prefer shipping Drive agent capabilities as **Cline skills** in this repo
  (`.agents` / `.cline` / package skills) over Claude-only skills.

## Gotchas

- **`bun run build:sdk` after every SDK edit.** Repeated here because it is the
  single most common wasted hour.
- **`apps/drive-ios/` is a legacy fixture.** The native App Store candidate is
  the standalone [`drive-ios`](https://github.com/drive-mode/drive-ios) repo.
  `drive-ios.yml` still builds the in-tree fixture; don't mistake a green run
  there for iOS product coverage.
- **Remote vs. docs.** `git remote` points at `drive-mode/cline-drivecode`, and
  recent handoffs reference PRs there, but `README.md`, the site, and
  `AGENTS.md`'s "Learned Workspace Facts" still say `hhalperin/cline-drivecode`.
  Check the remote before quoting a clone URL.
- **Hub is the only writer** for shared state. Clients publish facts and render
  projections; they never keep an authoritative copy. Do not add a second daemon
  and do not default anything to `:7891`.
- **Privacy-strict defaults.** Do not persist audio or transcripts without an
  explicit, visible debug setting. Build the stage from typed events first;
  WebRTC and remote media come later. Pixel sharing is not a host capability.
- **Domain graph logic belongs in `@cline/shared`** (`buildDependencyMap`), and
  the codebase-map skill is explain/showcase only — it must not write agent
  portfolio knowledge or Status Hub task deps (ADR-0025 firewall).
- **Merge authority:** never `gh pr merge` a PR that another open PR is based on.
  `AGENTS.md` has the full rule and the `.claude/hooks/guard-pr-merge.py`
  PreToolUse hook that enforces it (it fails *open*, so the written rule still
  binds when `gh` is unavailable).
- The desktop app needs **Rust ≥ 1.85** (`edition2024`); a `libEGL: DRI3 error`
  from the Tauri window is benign software rendering.

## Before you push

```bash
bun run build:sdk
bun run check                  # or the focused Drive parity block above
bun run check:drivecode-docs   # if you touched docs/drivecode/
```

Then: does this diff need a matching change in `collaboration-harness` or
`drivemode-mcp` (room fold semantics), or in `sdk/ARCHITECTURE.md` (hub,
bootstrap, session, or title flows)?
