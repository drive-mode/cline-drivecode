# Delivery — shipping the last ten `PLANNED` badges

**Status:** plan (2026-08-02)
**Goal:** every beat in [drive-product-demo.html](../../../design/canvases/drive-product-demo.html)
badged `SHIPPED`, honestly.
**Context:** five badges flipped in #148 once the features landed. Ten remain,
across **six distinct features**.

## The correction this plan starts from

I had recorded S9 (`walkthrough.animation` renderer) as **blocked on
ADR-0017**. That is backwards. The status board reads *"Narration-bound
presentation cues · Proposed — deferred · Demo canvas only; **behind S9**"* —
ADR-0017 waits on S9, not the reverse.

S9's own spec asks only to render the artifact inside the frame reusing the
demo's before/after composition, and present one on a live room through the
existing dev controls. The schema member already ships
(`shared/src/drive/director.ts:9`, `:175`). **S9 is unblocked and always was.**

That matters because S9 is described in its own initiative as *"the demo's
biggest emotional peak"* and *"the first slice that makes a demo peak
reproducible live"* — and it was sitting behind an imaginary gate.

## The six features

| # | Feature | Badges | State |
|---|---|---|---|
| 1 | **`walkthrough.animation` renderer** (spotlight S9) | `ART_ANIM`, `SHOW_ANIM`, `a3-bug` | Schema + ops ship; **no renderer**. Unblocked |
| 2 | **`capture.screenshot` feed UI** | `ART_CAPTURE`, `SHOW_CAPTURE`, `a3-demo` | Beat says "metadata in events, bytes out-of-band. Feed UI planned" |
| 3 | **PiP companion** | `a6-status` | ADR-0006 Accepted, impl `decision` — no PipPartner UI exists |
| 4 | **Artifacts page** | `a6-artifacts` | Director backlog engine ships; no page |
| 5 | **Agents / Teams surface** | `a10-agents` | DRV-TEAM-OPT specifies it; spawn side unbuilt |
| 6 | **Tasks as a first-class page** | `a10-tasks` | Lens ships inside Status Hub (`dependency-map.tsx`); no page |

Also outstanding though not badge-visible: **spotlight S8** (demo fixture
parity). Worth folding in — it is the last unbuilt slice of that initiative.

## Two things that decide the order

### Three of them fight over the same file

Features 4, 5 and 6 each add a page: a `View` union entry (`App.tsx:107`) plus
an entry in the three hardcoded nav arrays (`App.tsx:393-441`). Concurrently
that is a guaranteed conflict in one file, so **they serialise** — the same
lesson as the `.strict()` schema contention in the last batch.

### Feature 5 must not ship before its governance

The Agents/Teams surface is a **spawn** surface. ADR-0023 exists precisely
because agents can already cause forks with no depth bound and no permission
ceiling. #146 bounded the depth; the **`capPreset` ceiling (D1) is still
unshipped**, and `.driveagent/permissions.yaml` still says *"Intent only. Hub
policy owns enforcement"* — that policy does not exist.

Shipping a UI that lets a partner seat specialists before the ceiling is
enforced would hand users a spawn button governed by nothing. **Feature 5 is
gated on D1 landing with a real enforcement point**, not merely a schema field.

## Waves

| Wave | Ships | Why here |
|---|---|---|
| **1** | 1 (S9), 2 (capture feed), 3 (PiP) | None touches `App.tsx` nav. 1 and 2 both touch the artifact renderers, so they serialise *with each other* — run 1 first, it is the higher-value one |
| **2** | 6 (Tasks page) | First page. Cheapest of the three: the lens already exists and is being promoted, not written |
| **3** | 4 (Artifacts page) | Second page. Reuses the director backlog the Spotlight rail already reads |
| **4** | 5 (Agents/Teams) | Last, and only after D1 ships enforcement |
| any | S8 (fixture parity) | Independent — touches only `demoFixture.ts` + `ShareScreenSpotlightDemo.tsx` |

Wave 1's three can run in parallel **if** 1 and 2 are given to one worker, or
sequenced. `ScreenArtifact.tsx` and `artifactBody.ts` are shared between them.

## Per-feature notes

**1 — S9.** Reuse the demo's before/after composition as the reference; do not
invent a second animation grammar. Proof shape is S7's: present one on a live
room via the existing dev controls. Expect the frame's clip rule to matter —
an animation that outgrows the screen must cap itself.

**2 — capture feed.** The honest constraint is already in the beat's caption:
metadata rides the event, **bytes do not**. A feed card must not smuggle image
bytes into the event log — `DRIVE_EVENT_FORBIDDEN_KEYS` exists for this.

**3 — PiP.** ADR-0006 says PiP is a *companion* surface, not primary IA. The
risk is scope: a PiP that grows a second copy of the call chrome is a
maintenance trap. Keep it to mute, hand, leave, expand.

**4 — Artifacts.** The MVP cut it with a stated reason: *"a tester reaches the
same information via Spotlight and Status Hub."* That reason has not changed.
Build it because we want every badge honest, but if it earns nothing in use,
the right answer may be to **retire the beat rather than build the page** —
that is a legitimate way to reach all-shipped.

**5 — Agents/Teams.** DRV-TEAM-OPT already draws the distinction that matters:
a Cline `Team` is a runtime execution group, a **RosterPack** is a curated
human-authored preset, and a **spawned specialist** names its parent and
cascade-dismisses. Cascade dismiss is already built
(`room/seatSources.ts:111-170`). Do not blur the three.

**6 — Tasks page.** Promotion, not construction: `dependency-map.tsx` and its
model already exist inside Status Hub. The work is a page shell, a nav entry,
and deciding what the page adds over the lens.

## What "all shipped" should not mean

Two of these badges may be more honest to **remove than to build**. The MVP
deliberately cut Artifacts and Tasks-as-a-page with a reason that still holds,
and a demo that shows a surface nobody uses is its own kind of lie — just a
slower one than a stale badge.

Deciding that per beat is part of this plan, not a deviation from it.

## Verification

Per feature: the canvas battery (`bun verify.js`) stays green and the beat's
claim must be true of the shipped product, not merely of the demo. Any feature
whose beat asserts a live-room behaviour needs the S7/S9 proof shape —
presented on a real room, not a fixture.

Badge flips land in the same PR as the feature, so the canvas can never claim
something main does not do.
