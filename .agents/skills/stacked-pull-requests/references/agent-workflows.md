# Agent workflows for stacked PRs

## End-to-end create

```bash
git config rerere.enabled true
git config remote.pushDefault origin

gh stack init feat/layer-a
# implement; stage deliberately
git add path/to/files
git commit -m "Layer A: foundation"

gh stack add feat/layer-b
git add path/to/files
git commit -m "Layer B: consumers"

gh stack submit --auto
gh stack view --json
```

## Fix a lower layer while building higher

```bash
gh stack checkout feat/layer-a
# edit + commit
gh stack rebase --upstack
gh stack push
gh stack top
```

## Review feedback on any layer

Same as mid-stack fix: land the fix on the owning branch, rebase upstack, push. CI re-runs on affected PRs.

## After bottom merges

```bash
gh stack sync --prune
gh stack view --json
```

Squash-merges are handled via `rebase --onto` inside sync/rebase.

## Rebase conflicts

1. `gh stack rebase` exits **3**
2. Resolve `<<<<<<<` markers; `git add` resolved files
3. `gh stack rebase --continue`
4. Or `gh stack rebase --abort` to restore pre-rebase state

## Restructure without interactive modify

```bash
gh stack unstack                 # dissolve GitHub grouping; keep PRs/branches
# git branch -m / reorder list as needed
gh stack init --base main a b c
gh stack submit --auto
```

## External tools (jj / Sapling)

Manage branches elsewhere, then:

```bash
gh stack link --open branch-a branch-b branch-c
```

No local stack tracking required.

## Merge

```bash
# Entire stack
gh stack merge --yes --squash

# Through a PR (includes everything below)
gh stack merge 42 --yes --squash
```

Do **not** use `gh pr merge` or legacy merge API endpoints for stacked PRs.

## Cline monorepo notes

- Prefer trunk `main` unless targeting a release branch (`gh stack init --base release/…`).
- Shared package layers: commit under `sdk/packages/*`, run `bun run build:sdk`, then stack consumer apps (`apps/cli`, `apps/cline-hub`, …).
- Cloud agents: branch names must match `cursor/<name>-9a43` when this environment requires it — apply that convention to **each** stack layer branch, or use a shared prefix like `cursor/feat-foo-models-9a43` / `cursor/feat-foo-cli-9a43`.
- Prefer `gh stack submit --auto` then `ManagePullRequest` / repo PR tooling only for non-stack PRs; for stacks, CLI owns linking.
- Do not hardcode hub ports in stacked demo commits; use printed URLs / discovery.
