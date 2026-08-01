# gh stack CLI cheat sheet

Requires `gh extension install github/gh-stack`. Agents: always non-interactive (see parent SKILL.md).

Full upstream reference: [Stacked PRs CLI commands](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands).

## Command map

| Task | Command |
|------|---------|
| Init stack | `gh stack init feat/a` |
| Init multi / adopt | `gh stack init feat/a feat/b feat/c` |
| Custom trunk | `gh stack init --base develop feat/a` |
| Add layer | `gh stack add feat/b` |
| Add + commit shortcut | `gh stack add -Am "msg" feat/b` |
| Push branches only | `gh stack push` |
| Push + create/update PRs | `gh stack submit --auto` |
| Ready (not draft) | `gh stack submit --auto --open` |
| View (agents) | `gh stack view --json` |
| Sync | `gh stack sync` / `gh stack sync --prune` |
| Rebase all | `gh stack rebase` |
| Rebase up / down | `gh stack rebase --upstack` / `--downstack` |
| Rebase no trunk | `gh stack rebase --no-trunk` |
| Continue / abort rebase | `gh stack rebase --continue` / `--abort` |
| Navigate | `gh stack up [n]` / `down [n]` / `top` / `bottom` / `trunk` |
| Checkout | `gh stack checkout 7` \| `42` \| `branch` \| URL |
| Link without local tracking | `gh stack link a b c` |
| Append to stack N | `gh stack link 7 new-branch` |
| Unstack | `gh stack unstack` / `unstack 7` / `unstack --local` |
| Merge | `gh stack merge --yes --squash` |

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Generic error |
| 2 | Not in a stack / not found |
| 3 | Rebase conflict |
| 4 | GitHub API failure |
| 5 | Invalid args |
| 6 | Branch in multiple stacks — disambiguate |
| 7 | Rebase already in progress |
| 8 | Stack locked by another process |
| 9 | Stacked PRs not enabled for repo |
| 10 | Modify session needs recovery |

## JSON view (agent parsing)

```bash
out=$(gh stack view --json)
echo "$out" | jq -r '.currentBranch'
echo "$out" | jq -r '.branches[] | select(.pr.state == "OPEN") | .pr.url'
echo "$out" | jq '[.branches[] | select(.needsRebase == true)] | length'
echo "$out" | jq '[.branches[] | .isMerged] | all'
```

## Interactive-only (humans)

Avoid in agents: `gh stack modify`, `gh stack switch`, bare `submit` / `view` / `checkout` / `init` / `add`.

Humans can use `gh stack modify` (drop/fold/insert/reorder/rename) then `gh stack submit`. Server-side **Rebase stack** on the website is unsigned — use CLI rebase when signed commits are required.

## Env

| Variable | Values |
|----------|--------|
| `GH_STACK_THEME` | `auto` (default), `light`, `dark` |
