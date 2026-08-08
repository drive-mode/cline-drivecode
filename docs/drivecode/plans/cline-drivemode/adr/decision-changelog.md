# Decision changelog

**Purpose.** Chronology for ADRs and DECs — kept **out** of decision files so
passing an ADR into a context window loads only current truth.

**How to use.** After a rewrite-in-place, append one line under that record’s
heading (`- YYYY-MM-DD — …`, newest last). Do not put `## Changelog` inside ADRs.

**Companion.** Binding-clause inventory: [decision-coverage.md](decision-coverage.md).  
**Index.** Live status: [ADR-0000](ADR-0000-status-board.md).

---

## Timeline (corpus)

- 2026-07-25 — First Driveagent PRD/ARDs + leadership DEC bundle drafted (`docs/plans/…`).
- 2026-07-27 — Status Hub ADR + SDK status log land.
- 2026-07-28 — BYOK / topology / router / task-bank / Drive-as-mode ARD wave (#23).
- 2026-07-29 — Nest under `docs/drivecode/`; ChatFork + three-lane state; human `accept all` ADR-0000…0013 + DEC bundle; ADR-0014 Accepted on tip.
- 2026-07-30 — Nest role skeleton + CI gate (#61); task-session observability ADR drafted.
- 2026-08-01 — ARD→ADR rename (#103); ADR-0016 Route B accept (#101); ADR-0017 narration cues; ADR-0018 + ADR-0020 (#112).
- 2026-08-02 — ADR-0021 credentials (#127); ADR-0022/0023 (#133); ADR-0024 web runtime (#135); Tracks A–F close (#138); hub Drive owns call/history (#150).
- 2026-08-03 — ADR-0019 Kanban wire (#163); ADR-0025 (#fc9b1e135); ADR-0026 (#192); ADR-0025 E1 consumer (#195); ADR-0027 (#191).
- 2026-08-04 — ADR-0028 ADLC control plane (#200).
- 2026-08-05 — DEC-drive-mark-official (#210).
- 2026-08-06 — ADR-0029 hotpath (H1–H4 impl track on hotpath branch).
- 2026-08-07 — Path H + DEC-mobile-consumer-owner; freemium default.
- 2026-08-08 — ADR cleanup on main: reconcile 0023; Accept 0023/0027/0028/0029; path H fold; current-truth hygiene; chronology extracted to this file.
- 2026-08-08 — Comprehensive git-mined changelog + full binding-clause inventory ([decision-coverage.md](decision-coverage.md)).
- 2026-08-08 — Coverage-hole drafts: ADR-0030…0035 + DEC-multi-device-parity + DEC-codebase-map-firewall (Proposed).

---

## ADR-0000 · Decision status board

- 2026-07-29 — Board opened with accept-all for ADR-0000…0013 + DEC bundle; ADR-0014 indexed Accepted.
- 2026-07-30 — Nest migration; board paths updated under `docs/drivecode/`.
- 2026-08-01 — ARD→ADR rename (#103); ADR honesty / Impl column culture (#112); ADR-0016 Route B closed on board.
- 2026-08-02 — Indexed ADR-0021…0024; ADR-0015 Accepted on board via Tracks A–F.
- 2026-08-03 — Indexed ADR-0025…0027; authority twins Accepted.
- 2026-08-04 — Indexed ADR-0028 (Proposed).
- 2026-08-08 — Cleanup: Accept 0023/0027/0028/0029; path H + DEC-mobile; clusters; coverage gaps; Architecture D3 wording; H1–H5 id hygiene; current-truth singular; chronology extracted here.

## ADR-0001 · `.driveagent/` is the agent home

- 2026-07-25 — Drafted as ARD (Driveagent home vs facet registry).
- 2026-07-29 — Accepted (accept-all); nest path `docs/drivecode/…`.
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0002 · Canonical knowledge YAML → derived graph

- 2026-07-25 — Drafted (canonical YAML + compile).
- 2026-07-29 — Accepted (accept-all).
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0003 · Recruit ranks; RosterPack curated seating

- 2026-07-25 — Drafted (Recruit vs RosterPack).
- 2026-07-29 — Accepted (accept-all).
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0004 · Gated learn; no transcript dump

- 2026-07-25 — Drafted (propose→accept learn).
- 2026-07-29 — Accepted (accept-all).
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0005 · Status Hub SQLite status log

- 2026-07-27 — Landed with Status Hub SDK feature; Accepted — implemented.
- 2026-07-29 — Nest under drivecode.
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0006 · PiP Partner companion surface

- 2026-07-28 — Drafted with BYOK/hub wave (#23); Accepted (accept-all wave).
- 2026-07-30 — Nest skeleton paths.
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0007 · Drive is a Cline mode

- 2026-07-28 — Drafted (#23); Accepted.
- 2026-08-01 — Honesty pass / work-surface ownership clarifications (#112).
- 2026-08-02 — Drive owns call/history shell modes (#150).

## ADR-0008 · Task bank execution primitive

- 2026-07-28 — Drafted (#23); Accepted.
- 2026-07-29 — Bank ship wave (#42).
- 2026-08-01 — Workspace-backed bank wording reconciled toward ADR-0018 (#112).

## ADR-0009 · Runtime topology local / cloud / hybrid

- 2026-07-28 — Drafted (#23); Accepted.
- 2026-08-01 — Honesty / topology notes (#112).

## ADR-0010 · Provider harness (BYOK)

- 2026-07-28 — Drafted (#23); Accepted.
- 2026-07-30 — Nest migration.
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0011 · Demo share track

- 2026-07-28 — Drafted (#23); Accepted.
- 2026-08-01 — Impl honesty note (schemas vs live demo track) (#112).

## ADR-0012 · Agent router

- 2026-07-28 — Drafted (#23); Accepted; shipped `planRoute`.
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0013 · Three-lane state partition

- 2026-07-29 — Accepted with three-lane ship (#35).
- 2026-08-01 — Renamed ARD→ADR (#103).
- 2026-08-08 — Live-room hydrate via fold checkpoint (ADR-0029 H1) folded into Decision (no stacked amendment).

## ADR-0014 · Chat-fork lifecycle

- 2026-07-29 — Wired end-to-end; Accepted on tip same day as accept-all wave.
- 2026-08-01 — Renamed ARD→ADR (#103).

## ADR-0015 · Task-session observability

- 2026-07-30 — Drafted (task as satisfaction unit).
- 2026-07-31 — Implementation backlog slices added.
- 2026-08-01 — Honesty / Accept path (#112).
- 2026-08-02 — Accepted on board via Tracks A–F close (#138).

## ADR-0016 · Distribution & positioning

- 2026-08-01 — Proposed in demo/strategy wave (#94); Accepted Route B + self-hosted beta (#101).
- 2026-08-01 — Honesty pass (#112).
- 2026-08-07 — Path H + freemium owner defaults (DEC-mobile; portfolio/hotpath track).
- 2026-08-08 — Status rewritten as singular dual-path distribution on main.

## ADR-0017 · Narration-bound presentation cues

- 2026-08-01 — Proposed with canvas platform (#100); deferred behind Spotlight S9.

## ADR-0018 · Agent runtime contract

- 2026-08-01 — Accepted (unit hierarchy + research-18 locks) (#112).
- 2026-08-02 — Partial impl via Tracks A–F (#138).

## ADR-0019 · DrivePlan–Kanban Interop wire

- 2026-08-03 — Accepted with `execute` / `collectReceipt` + host port (#163).

## ADR-0020 · Session delivery CI/CD

- 2026-08-01 — Proposed (WorktreeLedger + DriveDelivery) (#112).

## ADR-0021 · Drive credential onboarding

- 2026-08-02 — Proposed (device-code first; Drive never holds keys; three hygiene fixes) (#127).

## ADR-0022 · Agent economics

- 2026-08-02 — Proposed (per-participant usage events; meter; scoped budgets) (#133).

## ADR-0023 · Agent spawn governance

- 2026-08-02 — Proposed (consult vs delegate; bound fork depth; hub enforcement) (#133).
- 2026-08-03 — Depth guard shipped in code (#146 / `c8d2e53`) — ADR body still described pre-fix tip until cleanup.
- 2026-08-08 — Finding 2 rewritten for tip; Accepted; Impl partial (consult/delegate seat path open).

## ADR-0024 · Drive web runtime

- 2026-08-02 — Proposed (transport port; conformant browser host) (#135).

## ADR-0025 · Enforced authority

- 2026-08-03 — Accepted (declared limit needs enforcement-path consumer) (fc9b1e135).
- 2026-08-03 — Plan-preset finding corrected (grant deliberate) (7109b17fb).
- 2026-08-03 — E1 L1 refusal consumer lands (#195).
- 2026-08-08 — Twin link to ADR-0026; context notes ADR-0023 Accepted.

## ADR-0026 · Evidence-backed Done

- 2026-08-03 — Accepted (claims registry + Done refusal checker) (#192).
- 2026-08-08 — Twin link to ADR-0025.

## ADR-0027 · Role tiers

- 2026-08-03 — Proposed (tier = ceiling or prompt; wait on live `capPreset`) (#191).
- 2026-08-08 — Accepted as binding guard; depth stays 1; three role vocabularies named.

## ADR-0028 · ADLC control plane

- 2026-08-04 — Proposed (Drive = ADLC control plane; no second workflow runtime) (#200).
- 2026-08-08 — Accepted (decision-level).

## ADR-0029 · Room hot-path redesign

- 2026-08-06 — Proposed on hotpath track; H1 fold checkpoint lands; H2–H4 follow same day (delta publish, in-process stage projector, layout sheets).
- 2026-08-07 — H5 unblocked by path H accept.
- 2026-08-08 — Accepted on main; slices renamed H1–H5; H1–H4 shipped, H5 open.

## DEC-agent-source-of-truth

- 2026-07-25 — Drafted (author in `.driveagent/`; compile into host).
- 2026-07-29 — Accepted (accept-all).

## DEC-package-location

- 2026-07-25 — Drafted (`@cline/drive` in monorepo phase 1).
- 2026-07-29 — Accepted (accept-all).

## DEC-open-product-forks

- 2026-07-25 — Drafted (focus / streams / share / accent / revise / catch-up / mic⊥TTS).
- 2026-07-29 — Accepted (accept-all).

## DEC-drive-mark-official

- 2026-08-05 — Accepted (official light/dark mark + motion axes) (#210).

## DEC-mobile-consumer-owner

- 2026-08-07 — Accepted (path H, muted mic, “Cline Drive”, MC3, freemium).
- 2026-08-08 — Folded onto main; ADR-0029 H5 refs; portfolio-now links dropped for main tip.

## ADR-0030 · Plane naming

- 2026-08-08 — Proposed (room/show/status; ban Engine ownership nouns; docs-first).

## ADR-0031 · Visual layout

- 2026-08-08 — Proposed (producers viewport-blind; client `visual/layout`).

## ADR-0032 · Path H ops

- 2026-08-08 — Proposed (hosted writer auth/tenancy/residency/freemium failure).

## ADR-0033 · Managed execution boundary

- 2026-08-08 — Proposed (DrivePlan owns truth; Kanban = workbench).

## ADR-0034 · Role vocabulary

- 2026-08-08 — Proposed (converge after live `capPreset`; blocked on D1).

## ADR-0035 · Late-join catch-up

- 2026-08-08 — Proposed (snapshot/delta + one factual catch-up line).

## DEC-multi-device-parity

- 2026-08-08 — Proposed (shared semantics across hub/pwa/ios/tui; Tier 1 bar).

## DEC-codebase-map-firewall

- 2026-08-08 — Proposed (codebase-map explain-only; no portfolio/Status writes).
