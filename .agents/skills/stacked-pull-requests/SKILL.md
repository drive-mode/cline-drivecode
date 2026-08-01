---
name: stacked-pull-requests
description: >
  Create and manage GitHub stacked pull requests with gh stack. Use when breaking a large
  change into dependent PRs, stacking agent-generated layers, rebasing mid-stack fixes,
  merging a stack, or wiring stack-aware CI. Prefer this over create-pull-request when the
  work has ordered dependency layers. Triggers on stacked diffs, PR stacks, gh stack,
  dependent PRs, or multi-layer review workflows.
---

# Stacked Pull Requests (Cline)

Break large work into a **linear chain of small PRs**, each targeting the branch below it, landing on a trunk (usually `main`). Reviewers see only that layer's diff. GitHub rebases the rest when lower layers merge.

```
main (trunk)
 └── feat/models      → PR #1 (base: main)           ← bottom
  └── feat/api        → PR #2 (base: feat/models)
   └── feat/cli-tui   → PR #3 (base: feat/api)       ← top
```

**Public preview** (as of 2026-07). Same-repo only — no cross-fork stacks. Not supported in GitHub Desktop.

Official docs: [About stacked PRs](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs) · [Creating](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-stacked-pull-requests) · [CLI reference](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands) · [Optimizing CI](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/optimizing-ci-for-stacked-pull-requests)

Deeper guides in this skill: [references/cli.md](references/cli.md) · [references/agent-workflows.md](references/agent-workflows.md) · [references/ci-patterns.md](references/ci-patterns.md)

## When to use stacks vs a single PR

| Use **stacked PRs** | Use **create-pull-request** (single PR) |
|---|---|
| Multi-concern change with dependency order (shared → consumers) | One focused fix or feature |
| Agent / high-volume code that would make a huge diff | Small bugfix, docs, chore |
| Reviewers need parallel review of layers | No mid-flight dependent follow-ups |
| You must keep shipping while lower PRs wait on review | Single ship unit |

**Key principle:** if layer A depends on layer B, B must be the same branch or *below* A.

## Prerequisites

```bash
gh --version   # need ≥ 2.90.0 (this env often has 2.91+)
gh auth status
gh extension install github/gh-stack

# Avoid interactive prompts in agent / CI shells
git config rerere.enabled true
git config remote.pushDefault origin   # if multiple remotes
```

Optional upstream skill install (Copilot / `gh skill`): `gh skill install github/gh-stack`. This repo skill is the Cline-local source of truth for agents here.

## Agent hard rules (non-interactive)

Every `gh stack` invocation must avoid prompts/TUIs — they hang agents.

1. Always pass **branch names** to `init` / `add` / `checkout`.
2. Always `gh stack submit --auto` (add `--open` when PRs should leave draft).
3. Always `gh stack view --json` — never bare `view` / `--short`.
4. Prefer `git add` + `git commit` over `-Am` so each layer stays deliberate.
5. Fix lower layers in place: checkout → commit → `gh stack rebase --upstack` → `gh stack push`.
6. Merge with `gh stack merge --yes` (optionally `--squash` / `--rebase` / `--merge`). **Do not** use `gh pr merge` for stacks.
7. Pass `--remote origin` when multiple remotes exist (`push`, `submit`, `sync`, `rebase`, `link`).
8. On conflict exit code **3**: resolve markers → `git add` → `gh stack rebase --continue` (or `--abort`).
9. Diverged local/remote stacks: non-interactive `sync` aborts cleanly — unstack and recreate; do not hang on prompts.
10. Never `gh stack checkout` without an arg; if local tracking conflicts with remote, `gh stack unstack --local` then retry.

### Forbidden (will hang)

- `gh stack view` / `view --short`
- `gh stack submit` without `--auto`
- `gh stack init` / `add` / `checkout` without arguments
- Interactive `gh stack modify` / `switch` (use unstack + re-init for agents)

## Plan layers before coding

Own the stack shape. Example for a Cline feature spanning shared + CLI:

```
main
 └── feat/status-types     ← @cline/shared types / buildDependencyMap inputs
  └── feat/hub-adapters    ← hub StatusTeamsSource wiring
   └── feat/cli-status-tui ← CLI StatusSnapshotSource + TUI
    └── feat/tests-docs    ← tests + docs/drivecode notes
```

Branch names are used **exactly** as given (slashes allowed). After shared package edits, remember `bun run build:sdk` before CLI/hub consumers.

Signs to `gh stack add`: new concern, different reviewer audience, or current layer already large.

## Create and submit (happy path)

```bash
gh stack init feat/status-types
# … implement layer …
git add -A && git commit -m "Add status shared types"

gh stack add feat/hub-adapters
# … implement …
git add -A && git commit -m "Wire hub status adapters"

gh stack add feat/cli-status-tui
git add -A && git commit -m "Add CLI status TUI surface"

gh stack submit --auto          # draft PRs, correct bases, linked stack
# or: gh stack submit --auto --open
gh stack view --json
```

Adopt existing branches: `gh stack init --base main branch-a branch-b branch-c`.

Website alternative: open bottom PR → `main`, then each next PR with base = previous head and **Create stack**. Eligible open chains may show a banner to convert into a stack.

## Mid-stack fix (critical)

```bash
gh stack checkout feat/hub-adapters   # or: gh stack down / PR number
# fix + commit on the owning branch
gh stack rebase --upstack
gh stack push
gh stack top   # resume
```

Wrong-layer commits pollute diffs — always move down, don't patch around at the top.

## Sync, restructure, merge

```bash
gh stack sync --prune          # after bottom merges; safe for clean remote-ahead
gh stack rebase && gh stack push   # restore linear history before merge

# Restructure (agents): tear down grouping, rebuild — PRs/branches kept unless you delete them
gh stack unstack
gh stack init --base main new-a new-b new-c
gh stack submit --auto

gh stack merge --yes --squash           # whole current stack
gh stack merge 42 --yes --squash        # through PR #42 (includes below)
gh stack merge 7 --yes                  # by stack number (no local checkout)
```

Merge is **bottom-up** and contiguous. Merging a mid/top PR lands it **and** everything below. Auto-merge is **not** supported for stacks. Merge queue is supported (stack may split across groups if oversized). Completed stacks cannot be extended — next `submit` starts a new stack.

**API bots:** use the stack merge API, not legacy `gh pr merge` / old merge endpoints.

## CI in this repo

Workflows that listen on `pull_request` → `main` run for **every** stack layer (GitHub evaluates them against the stack base). Stack metadata:

| Expression | Meaning |
|---|---|
| `github.event.pull_request.stack` | `null` if not stacked |
| `.number` / `.size` / `.position` | Stack id; size; 1-based position (1 = bottom) |
| `.base.ref` / `.base.sha` | Ultimate trunk |

Helpers:

- Composite action: [`.github/actions/stack-context`](../../../.github/actions/stack-context/action.yml)
- Annotation workflow: [`.github/workflows/repo-stacked-prs.yml`](../../../.github/workflows/repo-stacked-prs.yml) (labels + sticky comment)
- Patterns: [references/ci-patterns.md](references/ci-patterns.md)

Gate **expensive** jobs to lowest-unmerged and/or top PR; keep a cheap always-green path so required checks still pass mid-stack.

## Decision checklist

Before stacking:

- [ ] Layers ordered by dependency (foundation at bottom)
- [ ] Each layer independently reviewable
- [ ] Extension installed; non-interactive flags planned
- [ ] After submit: `gh stack view --json` looks right
- [ ] Shared SDK edits → `bun run build:sdk` before consumer layers
- [ ] Merge plan: bottom-up via `gh stack merge`, not `gh pr merge`

## Related

- Single PR flow: [create-pull-request](../create-pull-request/SKILL.md)
- Upstream agent skill: `gh skill install github/gh-stack` / [github/gh-stack](https://github.com/github/gh-stack)
- Rollout: [Roll out stacked PRs](https://docs.github.com/en/pull-requests/tutorials/roll-out-stacked-prs)
