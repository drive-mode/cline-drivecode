# Upstream Cline and SDK sync handoff

Back to [plan index](../README.md). Cold start: [Drivecode handoff](../../../HANDOFF.md).

## Outcome

[drive-mode/cline-drivecode PR #23](https://github.com/drive-mode/cline-drivecode/pull/23) **landed on `main` 2026-08-19** as merge commit [`dd0e7a06e`](https://github.com/drive-mode/cline-drivecode/commit/dd0e7a06e2b641aa3df0f408498b0db6d8cb20d6). It restored real Git ancestry with [`cline/cline`](https://github.com/cline/cline), upgraded the monorepo SDK packages from `0.0.69` to `0.0.75`, and preserved Drive as additive host/product code.

As captured on **2026-08-19**:

| Layer | Integrated baseline | Meaning |
|---|---|---|
| Published SDK line | `0.0.75` | `@cline/sdk`, `@cline/core`, `@cline/agents`, `@cline/llms`, `@cline/shared`, and Drive's workspace package are version-aligned. |
| Official source head | [`98d3e52a0`](https://github.com/cline/cline/commit/98d3e52a028c8b8426852baa4154e4aabf284dab) | Now an ancestor of `main`, including the post-`0.0.75` skill-loading and chat-model filtering fixes. |
| Drive fork base | `main` at merge commit [`dd0e7a06e`](https://github.com/drive-mode/cline-drivecode/commit/dd0e7a06e2b641aa3df0f408498b0db6d8cb20d6) | The two-parent merge carrying the repaired upstream ancestry. Branch the next sync from here. |

“Latest SDK” and “latest source” are two separate checks. A source commit can advance without a package version bump. Never infer one from the other, and never claim the fork is permanently current; record the fetch date and commit.

## Integration boundary

Keep these ownership rules while resolving future upstream merges:

- `cline/cline` owns the general SDK runtime, provider catalog, client behavior, and release versions.
- `@cline/drive` owns the portable Drive domain, policies, reducers, conformance kit, and host port.
- `@cline/core` may bind the Drive host to Cline's hub; apps project typed events. Do not create a second runtime or room writer.
- Drive additions should remain additive and namespaced. Prefer upstream behavior for shared Cline features, then adapt Drive at an explicit host boundary.
- Preserve the signed/non-exportable Director policy, typed Presenter grants, resource policy, project map, task bank, and Drive UI when upstream touches adjacent exports or clients.
- Do not expose Drive-only package internals through `@cline/sdk` merely to avoid a direct `@cline/drive` import.

The 2026-08-19 refresh had one overlapping test file. The resolution retained Drive's desktop plugin/compaction coverage and upstream's session-mode plus skill-command coverage. Post-merge validation also removed legacy desktop capability flags that could override the current mode preset; Drive's max-iteration, plugin, and compaction behavior remains additive.

## Repeatable sync procedure

Start from a clean worktree based on the current fork `main`; do not operate in a product worktree with uncommitted changes.

```bash
git fetch origin main
git fetch upstream main --tags
git rev-list --left-right --count HEAD...upstream/main
git log --oneline --decorate HEAD..upstream/main
git log --oneline <last-integrated-upstream-commit>..upstream/main -- sdk
```

Inspect package versions independently:

```bash
git show upstream/main:sdk/packages/sdk/package.json
git show upstream/main:sdk/CHANGELOG.md
```

Merge—do not rebase or squash—the official head into a dedicated fork branch:

```bash
git merge --no-ff upstream/main -m "chore: sync current upstream Cline head"
```

For every conflict, compare the merge base, Drive side, and upstream side. Retain both test intents when behavior is compatible. If shared production behavior diverges, stop and document the ownership decision rather than silently choosing one side.

## Required verification

Use the repository-pinned Bun version from `package.json` (`1.3.13`) and Node 22 or newer.

```bash
bun install --frozen-lockfile
bun run build:sdk
bun run check
bun run test
bun run check:drivecode-docs
bun run test:drivecode-docs
bun run check:links
git diff --check
```

Also exercise the changed upstream seams directly:

```bash
bun -F @cline/llms test
bun -F @cline/core test:unit
bun -F @cline/cli test:unit
bun -F @cline/cline-hub test
bun -F @cline/vscode test
bun --cwd apps/examples/desktop-app test
```

The first local PR #23 full-suite pass exposed one five-second timeout in `sdk/packages/llms/src/providers/gateway.test.ts`. Its isolated rerun passed in 4.3 seconds, but the same test later repeated under the hosted parallel package matrix. The suite now warms the lazily imported community-provider test dependency in `beforeAll`, outside any individual assertion's timeout; production provider loading remains lazy and no runtime timeout was widened.

The first hosted E2E passes also exposed a VS Code `1.134` automation change in the code-action widget. PR #23 verifies that the provider exposes the accessible `Add to Cline` option, closes the widget, then executes the same `AddToChat` command through the extension's contributed editor-selection shortcut. That split is intentional: VS Code's pointer-blocking layer intercepts physical clicks, Enter dismissed the widget without invoking the command on macOS, and synthetic row clicks were unreliable across workspace shapes. The workflow artifact path is also fixed so failed recordings are retained. Keep E2E exercising the current stable VS Code rather than hiding compatibility failures behind an old-version pin.

## Configuration sources

Keep mutable toolchain and test selectors in the smallest versioned source that owns them:

- Root [`package.json`](../../../../../package.json) is the single Bun-version and minimum-Node source for local development, CLI preflight diagnostics, the shared workspace setup action, and direct CI setup steps. Workflows use `bun-version-file`; do not copy numeric toolchain versions into runtime code or workflow YAML.
- [`apps/vscode/test-runtime.config.json`](../../../../../apps/vscode/test-runtime.config.json) owns VS Code unit-test, E2E, interactive-test, and debug-harness runtime selectors. Environment variables remain explicit one-run overrides, not a second committed default.
- Package compatibility declarations such as `engines.vscode` and `@types/vscode` stay in the extension package manifest. They describe the supported API floor and are not interchangeable with a test download channel.

Do not move signed Director policy, Presenter authorization, resource grants, secrets, endpoints, or permission decisions into these convenience files. Those remain typed host/security policy (or deployment secret configuration), with validation and auditability at the boundary that enforces them.

## Landing and continuation rules

1. Every upstream integration PR must be merged with **Create a merge commit**. Squash or rebase would discard the repaired upstream ancestry. PR #23 satisfied this in [`dd0e7a06e`](https://github.com/drive-mode/cline-drivecode/commit/dd0e7a06e2b641aa3df0f408498b0db6d8cb20d6).
2. All required hosted checks must be green. A mergeable GitHub state is not evidence that integration tests passed.
3. After landing, fetch `upstream/main` again and record any newly arrived right-side commits. They become the next sync input, not a reason to keep the current PR open indefinitely.
4. Keep SDK package versions sourced from upstream. `@cline/drive` stays workspace-compatible; do not independently invent an SDK version.
5. Update this dated baseline and the short entry in [`docs/drivecode/HANDOFF.md`](../../../HANDOFF.md) on each completed sync. Do not create a second backlog or status registry.

## Completed sync — 2026-08-19 (PR #23)

Closed against the merged result, not against the pre-merge branch:

- [x] PR #23 head contains `98d3e52a0` as an ancestor — verified on `main` via `git merge-base --is-ancestor`.
- [x] Official `sdk/CHANGELOG.md` still identifies `0.0.75` as the newest release; no package-line bump was owed. All six workspace packages report `0.0.75`.
- [x] Full hosted matrix green — 34 check runs on head `066e5d593` completed with no failures (`drive-ci`, Drive kernel, Hub, CLI Drive surfaces, Kanban, VS Code, e2e ubuntu/macOS, TUI e2e + publish check, internal links, docs).
- [x] Merged with a merge commit — [`dd0e7a06e`](https://github.com/drive-mode/cline-drivecode/commit/dd0e7a06e2b641aa3df0f408498b0db6d8cb20d6) has two parents (`2b7a594ae`, `066e5d593`), so the repaired ancestry survives.
- [x] Re-fetched upstream after landing and recorded the drift below.

### Post-merge drift, as fetched 2026-08-19

| Check | Value |
|---|---|
| `cline/cline` `main` head | [`dfa34ecea`](https://github.com/cline/cline/commit/dfa34ecea85b6b2689be37b3480b17678eeed915) |
| Commits ahead of the integrated head | 1 |
| Published SDK line | `0.0.75` — unchanged, no package bump owed |

The single commit is `fix(desktop): strip user_input envelope when copying a user message` ([#13369](https://github.com/cline/cline/pull/13369)), touching two desktop-app files (`message-bubble.tsx` and its `chat-messages` test). It touches no Drive-owned path, so it carries no ownership decision. It is the next sync input, not a regression — this record is the fetch-dated evidence rule 3 asks for, and it does not make the fork current.

## Next maintainer checklist

Carry this forward for the next integration; do not fork it into a second backlog.

- [ ] Re-fetch `upstream/main` and re-measure drift from the merge commit above; the 2026-08-19 record is dated evidence, not a current parity claim.
- [ ] Confirm whether official `sdk/CHANGELOG.md` has advanced past `0.0.75`, and bump the package line only through an upstream merge.
- [ ] Branch the sync from `main` at the recorded merge commit, then `git merge --no-ff upstream/main`.
- [ ] Run the required verification battery above before requesting review.
- [ ] Confirm the full hosted matrix is green, including SDK publish checks and Drive-specific tests.
- [ ] Merge with a merge commit, then update this dated baseline and the [`HANDOFF.md`](../../../HANDOFF.md) entry.
