# Upstream Cline and SDK sync handoff

Back to [plan index](../README.md). Cold start: [Drivecode handoff](../../../HANDOFF.md).

## Outcome

The active integration is [drive-mode/cline-drivecode PR #23](https://github.com/drive-mode/cline-drivecode/pull/23). It restores real Git ancestry with [`cline/cline`](https://github.com/cline/cline), upgrades the monorepo SDK packages from `0.0.69` to `0.0.75`, and preserves Drive as additive host/product code.

As captured on **2026-08-19**:

| Layer | Integrated baseline | Meaning |
|---|---|---|
| Published SDK line | `0.0.75` | `@cline/sdk`, `@cline/core`, `@cline/agents`, `@cline/llms`, `@cline/shared`, and Drive's workspace package are version-aligned. |
| Official source head | [`98d3e52a0`](https://github.com/cline/cline/commit/98d3e52a028c8b8426852baa4154e4aabf284dab) | PR #23 contains the current fetched `upstream/main`, including the post-`0.0.75` skill-loading and chat-model filtering fixes. |
| Drive fork base | PR #23 branch `codex/sync-upstream-sdk-0.0.75` | The review and CI boundary. Do not land this stack by copying files into `main`. |

“Latest SDK” and “latest source” are two separate checks. A source commit can advance without a package version bump. Never infer one from the other, and never claim the fork is permanently current; record the fetch date and commit.

## Integration boundary

Keep these ownership rules while resolving future upstream merges:

- `cline/cline` owns the general SDK runtime, provider catalog, client behavior, and release versions.
- `@cline/drive` owns the portable Drive domain, policies, reducers, conformance kit, and host port.
- `@cline/core` may bind the Drive host to Cline's hub; apps project typed events. Do not create a second runtime or room writer.
- Drive additions should remain additive and namespaced. Prefer upstream behavior for shared Cline features, then adapt Drive at an explicit host boundary.
- Preserve the signed/non-exportable Director policy, typed Presenter grants, resource policy, project map, task bank, and Drive UI when upstream touches adjacent exports or clients.
- Do not expose Drive-only package internals through `@cline/sdk` merely to avoid a direct `@cline/drive` import.

The 2026-08-19 refresh had one overlapping test file. The resolution retained Drive's desktop plugin/compaction coverage and upstream's session-mode plus skill-command coverage. No production conflict required a Drive-specific fork.

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

The first PR #23 CI pass exposed one five-second timeout in `sdk/packages/llms/src/providers/gateway.test.ts`; the remainder of the SDK package tests passed. Treat it as a flake only after a clean rerun succeeds. If it repeats, isolate that test under the same Node/matrix job and fix its deterministic completion—do not mask a runtime deadlock by widening production timeouts.

## Landing and continuation rules

1. PR #23 must be merged with **Create a merge commit**. Squash or rebase would discard the upstream ancestry this work repairs.
2. All required hosted checks must be green. A mergeable GitHub state is not evidence that integration tests passed.
3. After landing, fetch `upstream/main` again and record any newly arrived right-side commits. They become the next sync input, not a reason to keep the current PR open indefinitely.
4. Keep SDK package versions sourced from upstream. `@cline/drive` stays workspace-compatible; do not independently invent an SDK version.
5. Update this dated baseline and the short entry in [`docs/drivecode/HANDOFF.md`](../../../HANDOFF.md) on each completed sync. Do not create a second backlog or status registry.

## Next maintainer checklist

- [ ] Confirm PR #23 head contains `98d3e52a0` as an ancestor.
- [ ] Confirm official `sdk/CHANGELOG.md` still identifies `0.0.75` as the newest release, or update the package line through an upstream merge.
- [ ] Confirm the full hosted matrix is green, including SDK publish checks and Drive-specific tests.
- [ ] Merge PR #23 with a merge commit.
- [ ] Re-fetch upstream and record post-merge drift in the next integration PR.
