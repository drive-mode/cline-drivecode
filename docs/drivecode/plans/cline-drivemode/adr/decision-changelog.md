# Decision changelog

**Purpose.** Chronology for ADRs and DECs — kept **out** of the decision files
so that passing an ADR into a context window loads only current truth.

**How to use.** When you rewrite-in-place an ADR/DEC, append one line under that
record’s heading here (newest last). Do not put `## Changelog` inside the ADR.

**Index.** Live status stays on [ADR-0000](ADR-0000-status-board.md).

---

## ADR-0000 · Decision status board

- 2026-07-29 — Board opened; ADR-0000…0013 + DEC bundle Accepted.
- 2026-08-08 — Cleanup wave indexed; clusters + coverage gaps; current-truth hygiene.
- 2026-08-08 — Chronology extracted here (no Changelog inside ADR bodies).

## ADR-0013 · Three-lane state partition

- 2026-07-29 — Accepted (three lanes: event log / live room / facets).
- 2026-08-08 — Live-room hydrate via fold checkpoint (ADR-0029 H1) folded into Decision.

## ADR-0016 · Distribution & positioning

- 2026-08-02 — Accepted Route B (standalone fork); self-hosted beta.
- 2026-08-07 — Path H + freemium owner defaults (DEC-mobile-consumer-owner).
- 2026-08-08 — Status rewritten as singular dual-path distribution.

## ADR-0023 · Agent spawn governance

- 2026-08-02 — Proposed (consult vs delegate; bound fork depth; hub enforcement).
- 2026-08-08 — Finding 2 rewritten for tip (#146 depth guard); Accepted; Impl partial.

## ADR-0025 · Enforced authority

- 2026-08-03 — Accepted (declared authority needs enforcement-path consumer).
- 2026-08-08 — Twin link to ADR-0026; context note that ADR-0023 is Accepted.

## ADR-0026 · Evidence-backed Done

- 2026-08-03 — Accepted (evidence-backed Done refusal path).
- 2026-08-08 — Twin link to ADR-0025.

## ADR-0027 · Role tiers

- 2026-08-04 — Proposed (tier waits on live `capPreset`; depth stays 1; three role vocabularies named).
- 2026-08-08 — Accepted as binding guard; ADR-0023 marked reconciled.

## ADR-0028 · ADLC control plane

- 2026-08-04 — Proposed (Drive = ADLC control plane; no second workflow runtime).
- 2026-08-08 — Accepted (decision-level).

## ADR-0029 · Room hot-path redesign

- 2026-08-06 — Proposed; H1 fold checkpoint designed (slice 1).
- 2026-08-08 — Accepted; slices renamed H1–H5; H1–H4 marked shipped, H5 open.

## DEC-mobile-consumer-owner

- 2026-08-07 — Accepted (path H, muted mic, Cline Drive name, MC3, freemium).
- 2026-08-08 — Slice refs renamed to ADR-0029 H5; portfolio-now links dropped for main.
