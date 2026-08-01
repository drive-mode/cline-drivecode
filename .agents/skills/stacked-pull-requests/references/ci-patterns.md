# Stack-aware CI patterns

## How Actions behave

GitHub runs `pull_request` workflows that target the **stack base** (e.g. `main`) for **every** PR in the stack — including mid-stack PRs whose git base is another feature branch. Existing `on.pull_request.branches: [main]` workflows do not need a trigger change.

Branch protection, required checks, and CODEOWNERS are evaluated against the stack base for every layer. Merging requires linear history and that the target PR **and all below it** meet those rules.

Docs: [Optimizing CI for stacked PRs](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/optimizing-ci-for-stacked-pull-requests) · [Rules reference](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests)

## Metadata (`github.event.pull_request.stack`)

Present only when the PR is in a stack (`null` otherwise). Always null-check.

| Field | Description |
|-------|-------------|
| `number` | Stack number (repo-scoped) |
| `size` | Total PRs in the stack |
| `position` | 1-based index (`1` = original bottom) |
| `base.ref` | Trunk branch name |
| `base.sha` | Trunk HEAD SHA |

### Useful predicates

```yaml
# Any stacked PR
if: github.event.pull_request.stack != null

# Lowest unmerged (git base == stack base)
if: >
  github.event.pull_request.stack != null &&
  github.event.pull_request.stack.base.ref == github.event.pull_request.base.ref

# Top of stack (full cumulative change)
if: >
  github.event.pull_request.stack != null &&
  github.event.pull_request.stack.position == github.event.pull_request.stack.size

# Standalone OR lowest unmerged (good default for expensive jobs)
if: >
  github.event.pull_request.stack == null ||
  github.event.pull_request.stack.base.ref == github.event.pull_request.base.ref
```

As lower PRs merge, the next PR is retargeted onto the trunk and becomes the new lowest-unmerged.

## Repo helpers

### Composite action: `stack-context`

Path: `.github/actions/stack-context`

```yaml
- uses: ./.github/actions/stack-context
  id: stack

# outputs:
#   is_stacked, stack_number, stack_size, stack_position
#   stack_base_ref, is_lowest_unmerged, is_top, run_expensive
```

`run_expensive` is `true` for non-stacked PRs, lowest-unmerged stacked PRs, and top-of-stack PRs (full integration surface).

### Annotation workflow: `repo-stacked-prs.yml`

On `pull_request` (and `stacked` when available):

- Applies labels `stack` and `stack/N-of-M`
- Upserts a sticky comment with stack map metadata
- No-ops cleanly on non-stacked PRs (removes stale stack labels)

Does not replace product CI; safe to require or leave optional.

## Recommended gating strategy (Cline)

Keep the **gatekeeper / required check** green on every layer. Put cost inside optional or path-filtered jobs:

| Job class | Stack policy |
|-----------|----------------|
| Lint / typecheck / unit (cheap) | Every layer |
| Integration / e2e / full matrix (expensive) | `run_expensive` only |
| Publish / deploy | Never on mid-stack; trunk only |

Example job:

```yaml
jobs:
  context:
    runs-on: ubuntu-latest
    outputs:
      run_expensive: ${{ steps.s.outputs.run_expensive }}
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/stack-context
        id: s

  unit:
    runs-on: ubuntu-latest
    steps:
      - run: bun test   # always

  e2e:
    needs: context
    if: needs.context.outputs.run_expensive == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: bun run test:e2e
```

If a required check wraps expensive work, split into:

1. Always-run lightweight job that reports the required check name, and
2. Expensive job that is non-required or only required on `main` pushes.

Skipping a required job entirely leaves it **Pending** on GitHub — prefer job-level success via a thin always-run gate (same pattern as `drive-ci`).

## Webhooks / API

- `pull_request` payloads include `stack` when applicable.
- Dedicated `stacked` action fires when a PR is first added to a stack.
- REST: stack object on PRs + Stacks API (`GET /repos/{owner}/{repo}/stacks`, create/extend/dissolve).
- GraphQL: read-only `stack` / `stackEntry` on `PullRequest`.
- Programmatic merge must use the **stack-aware merge API** (async merge for stacks).

## Rollout gotchas

- Forks cannot join stacks.
- Reorder needs CLI (`modify` or unstack+re-init); website Unstack dissolves open/draft/closed links but keeps merged/queued members.
- Completed (fully merged) stacks cannot be extended.
- Server-side website rebase commits are unsigned.
