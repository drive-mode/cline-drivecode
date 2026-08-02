# Research 19 · ADR validation audit (multi-pass)

**Date:** 2026-08-02
**Spelling:** Architecture Decision Record = **ADR** in prose. On-disk nest is `adr/ADR-*` (PR #103).
**Canvas:** `adr-validation-audit.canvas.tsx` (workspace canvases)
**Fix pass:** Completed on branch `docs/adr-validation-fixes` (sync to `adr/`, amend 0008/0018, soft ship claims, status-board **Impl** column, vision Variant C, wire glossary/HANDOFF/TASK-GRAPH/initiative).

## Method

| Pass | Focus |
|---|---|
| 1 | Inventory 0000–0018 + status board + PR #103 hygiene |
| 2 | Structure (Context / Decision / Consequences) |
| 3 | Material claims vs tip code (parallel agents) |
| 4 | Cross-ADR conflicts + glossary |
| 5 | Severity report + fix order |
| 6 | **Fix pass** — apply recommended order; re-verify docs gate |

**Rule:** Accepted = binding decision, not “shipped.” Evidence or UNVERIFIED.

## Blockers (resolved in fix pass)

1. ~~**Path hygiene.**~~ Synced to `adr/`; ADR-0018 + runtime docs restored onto that nest.
2. ~~**ADR-0008 completion / covered-check.**~~ Decision text amended; enforcement honesty → ADR-0018 Impl notes (still not shipped enforcement).

## High (doctrine / overclaim) — post-fix status

| ID | Issue | Fix pass |
|---|---|---|
| 0008 vs 0018 | Workspace bank + completion honesty | Amended; Impl notes point to 0018 |
| 0018 | `DriveRunWorkItem` naming | Body + schemas aligned |
| 0016 | Body leftovers vs Accepted Route B | Recommendation/Decision-required cleaned |
| 0007 / 0009 / 0011 | Present-tense ship claims | Softened with Impl notes |
| 0001–0004, 0006 | Aspirational ship language | Tracked via status-board **Impl** = decision/partial |
| Vision Variant C | Conflicted with ADR-0006 companion | Aligned: primary IA rejected; companion in scope |

## Medium / low

- 0013 “not a second Map” soft (still true enough for board)
- 0015 Proposed + partial impl; Context refreshed
- 0005 mostly true; citation/SQL sketch drift deferred
- 0010 Drive provider drop-in OK; general `cline plugin install` still remote
- 0017 deferred correctly (demo cues only)
- 0012 / 0014 closest to Accepted truth

## Ship matrix (one line)

Only **ADR-0005** is honestly end-to-end implemented. **0018** first slice: schemas + projection stub + Kanban `externalRef` landed; tools + completion guard remain follow-on. Board **Impl** column is the living matrix.

## Recommended fix order (done)

1. ~~Sync to `origin/main` (`adr/`), re-apply local runtime/0018 diffs~~
2. ~~Amend ADR-0008 (workspace bank; completion amended by 0018)~~
3. ~~Fix ADR-0018 naming + ADR-0016 body leftovers~~
4. ~~Soften 0007 / 0009 / 0011 present-tense ship claims~~
5. ~~Status board: add **Impl** column~~
6. ~~Resolve 0006 vs `00-vision` Variant C language~~
7. ~~Keep 0015 Proposed; refresh Context~~

## Next iterative pass

Pick one ADR with **Impl** = `partial` and close a single enforcement or UI gap (start with ADR-0018 Agent Control tools or completion guard), or leadership-accept ADR-0015 when ready.
