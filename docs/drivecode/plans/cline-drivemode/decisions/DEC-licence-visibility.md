# DEC · Licence and visibility pairings

**Status.** Open — inventory recorded; **no visibility or licence moves** until an owner picks a row.  
**Date.** 2026-08-23  
**Closes.** repo-ownership sequence step 7 (record only)  
**Aligns with.** [repo-ownership](../initiatives/repo-ownership/README.md), [DEC-package-location](DEC-package-location.md)

## Context

GitHub Packages `@drive-mode/drive-kernel` does **not** require a public source repo. Public `cline-drivecode` is an ownership choice (Cline host + kernel SoT), not a Packages constraint.

This pass inventories mismatches. It does not `gh repo edit --visibility`, add LICENSE files, or migrate `cursor-drive` / `claude-drive` (D3 parked).

## Inventory (2026-08-23)

| Item | Today | Tension | Recommendation until you pick |
|---|---|---|---|
| `drive-mode/cline-drivecode` | Public, GitHub Apache-2.0 | Apache Cline copyright + Drive product nest | Keep as-is unless you later split docs out |
| `drive-mode/cursor-drive` | Public, GitHub “Other” (proprietary LICENSE) | Public + proprietary | Parked D3 — record, do not migrate |
| `hhalperin/cline-drivecode` | Public fork | Live public parent of the Drive fork | Leave; do not push Drive there |
| `drive-mode/collaboration-harness` | Private, `isArchived: false`, GitHub “Other”; local LICENSE Apache-2.0 | Docs already say archived; MCP `main` still file-depends on it | Merge archive-docs PR, then `gh repo archive` **after** MCP `main` consumes `@drive-mode/drive-kernel` |
| `drive-mode/drivemode-mcp` | Private, GitHub “Other”; `package.json` + LICENSE Apache-2.0 | GH licence metadata ≠ file | Align GitHub `license` with the Apache file; keep private |
| `drive-mode/drive-ios` | Private, no LICENSE, GitHub license null | Private app with no terms on disk | Add a private-repo LICENSE when you next touch the repo |
| `drive-mode/site` | Private, no LICENSE, GitHub license null | Same | Add a private-repo LICENSE when you next touch the repo |
| `drive-mode/claude-drive` | Private, MIT | Parked host | Leave (D3) |

`plugins/adr-planner` on the stacked PRs will land on the **public** Cline-line tree. That is intentional if `cline-drivecode` stays public.

In-tree `apps/drive-ios` remains on public `main` until [#38](https://github.com/drive-mode/cline-drivecode/pull/38) merges.

## Decision

**Not taken.** Step 7 stays open. Owner chooses per row; agents do not silently settle visibility or SPDX metadata.

## Non-decisions

- Making `cursor-drive` private
- Inventing `drive-mode/docs/adr/`
- Rebasing parked `feat/adr-planner-milestone-0` onto `main`

## Verification

- This file exists under `docs/drivecode/plans/cline-drivemode/decisions/`
- `gh repo view` visibility bits match the table until an owner changes them
- No `drive-mode/docs/adr/`
