# ADR-0016: Drive mode distribution & positioning

## Status

**Accepted 2026-08-02 — Route B (standalone fork product), for now.**

Harrison's call: keep Drive mode in the `hhalperin/cline-drivecode` fork and
merge nothing upstream to `cline/cline` for now.

**Beta shape (decided 2026-08-02):** public, **self-hosted** — anyone can clone
the fork and run it. Not a hosted service: the hub remains a locally-spawned
single-writer daemon and multi-human rooms stay an explicit non-goal (see
[spotlight-screen-share](../initiatives/spotlight-screen-share/overview.md)
non-goals). This obliges the packaging work in the MVP plan — a tagged release
artifact, install docs proven by a clean clone on a second machine, a preflight
check, and a support path.

**What this defers rather than closes.** Route C (upstream the protocol, keep
the hub as the product) remains the recommendation in the analysis below and is
revisitable once the beta produces evidence. Nothing in the MVP forecloses it:
the schemas stay clean and the fork's divergence stays confined to Drive
surfaces. The rebase-treadmill cost named under Consequences is accepted
knowingly for the beta window.

## Metadata

- Date: 2026-08-01
- Deciders: Harrison (owner); drafted by Drivecode planning
- Related: ADR-0005, ADR-0007, ADR-0011, ADR-0013, DEC-package-location, DEC-open-product-forks, [spotlight-screen-share](../initiatives/spotlight-screen-share/overview.md), [drive-audio](../initiatives/drive-audio/overview.md)

## Context

Nothing in the plan set states who installs Drive or why this work is a fork of
`cline/cline` rather than a PR into it. ADR-0007 settled in-product IA — Drive
is a Cline mode, not a separate product — but is silent on distribution: it
answers "what is Drive inside the app," not "how does Drive reach anyone."
Distribution today is `git clone` of this fork; the public face is the demo
canvas (PR #91, evolving in PR #94), the README, and two initiative plans. Upstream `cline/cline`
moves fast, and every periodic sync (`chore/sync-upstream` merges) is recurring
merge debt.

### What the wedge actually is

Stated honestly: the wedge is **not** "watch an agent on a call." Devin ships a
live workspace view; Cursor or Copilot could bolt an activity feed onto their
agents. What none of them ship — and what this repo has actually built — is the
**event-sourced, replayable, director-curated presentation protocol**:
events-not-pixels, a single-writer hub, typed show artifacts
(`ShowArtifactKindSchema`, `sdk/packages/shared/src/drive/director.ts`),
late-join snapshot catch-up by sequence cursor, and privacy-clean by
construction (metadata-only events; the `buildDrivePersistPayload` hard-delete
pattern). A route that loses the protocol loses the differentiation; a route
that preserves only the UI preserves the copyable part.

## Routes

Three routes. Each is scored on target user, install path, what stays
defensible if upstream absorbs the ideas, maintenance cost, and how it
re-orders the spotlight S1–S9 / drive-audio slice priorities.

### Route A — upstream contribution into `cline/cline`

- **Target user.** Existing Cline users; Drive arrives as a Cline feature.
- **Install path.** Inherited — Cline releases (VS Code Marketplace,
  `npm i -g cline`). Zero new distribution to build.
- **If upstream absorbs the ideas.** Absorption *is* the goal; nothing is
  "lost," but the brand evaporates. What remains is a contribution record and
  protocol authorship, not a product.
- **Maintenance.** Cheapest long-run — no rebase treadmill — but pace and shape
  are governed by upstream review; features can be reshaped or declined.
- **Slice re-ordering.** Protocol hardening first: wire schemas, conformance
  kit, `reduceRoom` / `projectStage` (the direction DEC-package-location
  already grows `@cline/drive`). Pure webview polish (S1, S4, S5) drops in
  priority — a contribution leads with the hub protocol and director, not
  chrome.

### Route B — standalone fork product

- **Target user.** Developers who install "Drive" as its own product.
- **Install path.** This repo's own releases (fork CLI + hub). Zero
  distribution today; every user must be won from scratch.
- **If upstream absorbs the ideas.** What stays defensible is brand,
  integration quality, and velocity — thin, because the protocol ideas are
  visible in this public repo and re-implementable by a funded team.
- **Maintenance.** The rebase treadmill: upstream moves fast and every sync is
  merge debt across `sdk/` and `apps/`, carried indefinitely by a solo
  maintainer.
- **Slice re-ordering.** As currently written — demo-led surface work
  (S1 → S9, drive-audio 1–6) is the product.

### Route C — hybrid (protocol upstream, product here)

- **Shape.** Upstream the wire-schema / protocol pieces — room + drive event
  schemas, director/show schemas, the conformance kit; the Status Hub is
  already SDK-scope (ADR-0005). Keep the hub composition and the Drive
  surfaces as the product.
- **Target user.** Cline users who add the Drive hub on top of stock Cline.
- **Install path.** Fork hub app consuming upstream SDK packages: the protocol
  ships with Cline, the experience ships here.
- **If upstream absorbs the ideas.** The schemas becoming upstream's is the
  point — the hub here becomes the reference implementation of a standard it
  authored; the curated surfaces remain the product.
- **Maintenance.** Middle: upstreamed protocol pieces stop diverging; the hub
  and webview still track upstream, but across a narrower seam.
- **Slice re-ordering.** Schema freeze + conformance first (the contribution
  package), then S2 (ScreenFrame) and S6 (real renderers) as the visible
  product; S7/S8/S9 demo parity stays; S1/S4/S5 polish floats.

## Recommendation (historical draft — superseded by Accepted Route B)

The analysis below originally recommended Route C. **Accepted decision is Route B
(standalone fork product) for now** — see Status. Route C remains revisitable after
the beta produces evidence; nothing in the MVP forecloses it.

## Decision required (closed 2026-08-02)

Owner answered via Status: Route B + public self-hosted beta. The numbered
questions below are retained as historical framing for a future Route C revisit;
they do **not** keep this record in Proposed status.

1. Who is the first external user, and how do they install? ("Clone this repo"
   is not an answer for a product route.)
2. What is the goal of the work — upstream credibility, a product with a
   brand, or both, staged?
3. How many hours per week of upstream-sync maintenance are acceptable, and
   for how long?
4. Open the conversation with Cline maintainers (issue/RFC for the drive
   protocol) before more surface slices land — yes or no?
5. Which slices ship publicly next: protocol conformance (routes A/C) or
   demo-parity surfaces (route B)?
6. Does the "Drive" name survive route A, and is that acceptable?

## Consequences

**Positive**

- Distribution and positioning stop being implicit; slice priorities gain an
  explicit ordering principle.
- The differentiation claim is written down in its honest form: the protocol,
  not "watch an agent on a call."

**Negative**

- Route C depends on upstream engagement — people outside this repo.
- Until decided, S1–S9 and drive-audio priorities carry a known question mark.

## Alternatives considered

- **Decide by default (keep building the fork)** — Rejected as a non-decision;
  it is Route B chosen silently, with its costs unexamined.
- **Position the wedge as "watch an agent on a call"** — Rejected; Devin ships
  a live workspace view and activity feeds are boltable. The protocol is the
  wedge.
- **Separate SDK repo now** — Already rejected ([DEC-package-location](../decisions/DEC-package-location.md)).

## References

- [ADR-0005](ADR-0005-status-hub.md), [ADR-0007](ADR-0007-drive-as-cline-mode.md), [ADR-0011](ADR-0011-demo-share-track.md), [ADR-0013](ADR-0013-state-partition.md)
- [DEC-package-location](../decisions/DEC-package-location.md), [DEC-open-product-forks](../decisions/DEC-open-product-forks.md)
- [spotlight-screen-share/overview.md](../initiatives/spotlight-screen-share/overview.md), [drive-audio/overview.md](../initiatives/drive-audio/overview.md)
- `sdk/packages/shared/src/drive/director.ts` (typed show artifacts), `sdk/packages/shared/src/drive/room.ts` (room schemas)
