# Research 20 · Session delivery CI/CD design space

**Date:** 2026-08-02  
**Outcome:** Proposed [ADR-0020](../adr/ADR-0020-session-delivery-cicd.md)

## Method

Architect Phase A (how explorers) + arena of three whole-shape candidates, then lead synthesis.

| Pass | Focus |
|---|---|
| Ground | Drive call/fork/isolation; stacked CI helpers; agent git/Kanban binding; Actions scale |
| Arena A | SessionDeliveryUnit — one `gh stack` per delivery |
| Arena B | WorktreeLedger — local ledger authority; GitHub as projection |
| Arena C | TaskAtomicPRs — session as bag of PRs; optional bundle stack |

## Verdict

**Base B + grafts from A.** Reject C as default substrate.

| Keep | Why |
|---|---|
| Local `DeliveryLedger` + coalesce push | Survives thousands of commits/day |
| One `DriveDelivery` stack titled from session title | Matches product ask |
| Hold = focus park | Multi-call without shared worktrees |
| Lease-boundary commits | Honest rewind |
| Wire `run_expensive` + always-green gates | Tip gap today (annotation-only) |

| Reject | Why |
|---|---|
| GitHub as write path on every checkpoint | Actions melt; rebase fan-out |
| Session = bag of PRs as default | Breaks one-stack session story |
| Equating delivery with `callSessionId` | Leave/rejoin remints metrics id |

## Grounding citations

- Drive call/fork tip: `sdk/packages/shared/src/drive/callSession.ts`, ADR-0014, ADR-0018, `hostPort.ts` (`worktreeIsolation: false`)
- Stack CI gap: `.github/actions/stack-context`, `repo-stacked-prs.yml` annotation-only; product suites unwired
- Agent git today: stacked-PR / create-PR skills (contributor); Kanban worktrees in sibling drivekanban; no Drive session↔PR map
- Scale contract: `docs/drivecode/CI.md` (always-green gates; no skip labels)
