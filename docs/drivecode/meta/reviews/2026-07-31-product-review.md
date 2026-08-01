# Drive mode — product & technical review

**Date:** 2026-07-31 · **Subject:** the Drive product demo (`docs/drivecode/design/canvases/drive-product-demo.html`, branch `feat/demo-motion` @ `9fa011c52`, PR #94), the README funnel, both initiative plans, and the shipped drive scaffolding.
**Method:** nine independent review lenses (six product, three technical), four of them hands-on driving the demo in headless Chrome. Every high-severity finding was independently re-verified by an adversarial agent instructed to refute it; **all nine highs were confirmed** (some with corrections, noted inline). 18 agents total.

## Scorecard

| Lens | Score | One-line verdict |
|---|---|---|
| Performance & robustness | **9** | Flat heap over a full run, true replay reset, corruption-proof storage — nothing blocks or embarrasses. |
| Code quality | **8** | Unusually well-engineered for a 7,637-line single file; state model and cancellation discipline are the stars. |
| UX / design | **7** | Disciplined at the 1280×640 floor; degrades at the edges of its own responsive envelope. |
| Developer credibility | **7** | Not vaporware — the load-bearing claims verify in git history. The deepest realism moment is the clearest fabrication. |
| Product coherence | **7** | Self-aware artifact set with an explicit arbitration rule — that frays exactly where it's load-bearing (badges, kinds). |
| Security | **7** | Well-hardened canvas; the gaps are at the edges (fonts CDN) and in shipped scaffolding (postMessage, one latent XSS). |
| Accessibility | **6.5** | Exemplary reduced-motion and ARIA; the no-audio viewer — the most relevant audience — gets the worst experience. |
| First impression | **6** | Great raw material; the funnel leaks at the two points a cold visitor touches first (GIF, CTA). |
| Product strategy | **6** | Real mechanism-level wedge (events-not-pixels, replayable rooms) that the pitch undersells; wow beats aren't on the roadmap. |

**Overall: ~7/10.** The engineering is ahead of the packaging. The demo is a genuinely strong artifact whose best qualities — the real reenacted bug, the honesty badges, the self-referential "this page is the page being fixed" hook — are either unreachable (broken funnel), undermined by small fabrications, or invisible to a muted viewer.

---

## Confirmed high-severity findings

All nine were adversarially re-verified against the repo and/or a live headless run.

### 1. The primary CTA is broken for GitHub visitors *(first impression)*
`README.md:23` — "open the interactive demo" — links the raw `.html`, which GitHub renders as a **7,637-line source blob** (verifier reproduced against the live GitHub blob view). There is no hosted URL and no clone-and-open instruction anywhere; the Quickstart (README.md:322+) never mentions the demo. The single best asset the product has is unreachable in one click by exactly the audience the README targets.
**Verifier correction that matters:** the canvas is *not* fully self-contained — it fetches Google Fonts (see finding 9) — so "just host it" needs the font fix first.
**Fix:** inline the fonts, then host via GitHub Pages from `docs/` (zero infra) and point the link at the live URL; add a one-line local-run fallback.

### 2. The sticky-held diagram is cropped, not rescaled, on the proof beat *(UX)*
From `a3-edit` through `a3-test` at the 1280×640 design floor, the deck compresses the screen and the held DIAGRAM.RENDER card **clips instead of shrinking** — verified: only viewBox y 0–134 of 280 (~48%) is visible, cutting off the STATE box, `render()`, and the innerHTML-wipe spine — the entire story of the diagram. This is the beat where Cline says "There we go — green": the demo's proof moment renders a broken visual.
**Fix:** contain-fit held artifacts (`max-height:100%`, SVG scales down inside a flex container).

### 3. At 1920×1080 the "agent's monitor" illusion collapses *(UX)*
The VS Code mock is capped at 980px (`@media (min-width:1800px)`, :3008–3015) while the screen body grows to 1322–1706px — measured 171–363px of near-black void per side, worst at dark-theme `a3-arch` (a ~700px card floating in an enormous empty field). Developers will open this maximized on a desktop monitor; the Spotlight reads as a screenshot pasted onto black rather than a live shared screen — the product's central metaphor.
**Fix:** scale the mock proportionally with the screen body, or cap the main column (~1440px, centered).

### 4. Muted playback is unreadably fast — there is no non-audio pacing path *(accessibility)*
Pacing is stretched only by the audio gate; with voice off, voiced beats last only their authored `dwellMs`. Verified numbers: total authored dwell is **77s vs ~191s voiced**; `a2-narration` requires ~1,026 wpm reading, `a3-bug` ~737 wpm (normal reading is ~250). Reduced-motion additionally caps every beat at 400ms — reduced motion should mean less animation, not less reading time. Most first views of any demo are muted; this is the demo's most relevant audience getting its worst cut.
**Fix:** when voice is off or clips fail, derive dwell from narration length (`max(dwellMs, words × 350ms)`); exempt narration beats from the reduced-motion cap.

### 5. User-opened captions are closed by the very next beat *(accessibility)*
The CC button toggles the panel directly but never writes `state.ccOpen` (:7439–7444 — the comment documents it as intended "preview" behavior), and the CC render signature includes the beat index, so every advance re-asserts scripted state. Verified live: open CC at beat 5 → advance → closed, `aria-pressed` reverted. A viewer who relies on the transcript cannot keep it open during autoplay.
**Fix:** make CC a sticky user preference overlaying beat state (`cc-open = userPref || state.ccOpen`), like theme and volume already are.

### 6. The debug walkthrough shows code that doesn't exist, at line numbers that point at unrelated content — in the very file the viewer has open *(dev credibility)*
`SHOW_WALK` (:3930–3948) claims the guard lives at `drive-product-demo.html` **L4705–4708** with an early-return shape (`if (sig === R.feedSig) return; … rebuildFeed();`). The actual shipped guard is at **:6038–6040** with a different shape, and `rebuildFeed` exists nowhere as real code (a comment at :1874 and a second fictional copy inside beat strings at :4495). The demo's unique credibility asset is that the file being debugged IS the page the engineer is looking at — one Ctrl+F destroys it. Related (medium): the debugger ghost values (`sig = "…9f41"`) are hash-tails of a `JSON.stringify` result — an impossible value, truncated from the wrong end.
**Fix:** point the walkthrough and the EDIT card's diff at the real guard with real line numbers (the real code is just as demo-able), and make the ghost values a head-truncated JSON string.

### 7. Two surfaces are badged "shipped" that the plan-of-record says are planned *(coherence — echoed independently by three lenses)*
`a6-artifacts` (:4682) and `a10-tasks` (:4942) carry `maturity:"shipped"`, and their rail items lack `planned:true` (:6996, :6998) — but the spotlight Addendum explicitly lists the Artifacts gallery and Tasks page among "New surfaces demoed (**all planned**) … NOT in S1–S8", and no such surface exists in `apps/cline-hub` (verified: 5 files match "artifact", none is a gallery). The badge system is the demo's honesty backbone; two overstated beats taint the other 48 — a viewer who opens the hub and finds no Artifacts rail will retroactively distrust every "shipped" badge.
**Fix:** flip both to planned (or introduce a split badge: "engine shipped, surface planned"), and run a full badge-integrity audit of all 46 beats against the Addendum and shipped code.

### 8. The demo's wow beats are exactly the work no slice ships *(strategy)*
The three most persuasive moments — the before/after bug animation (`a3-bug`), the approval gate + sign-off (`a9-gates`/`a9-approved`), live CC captions (`a2-cc`) — are all `planned`, and the epilogue surfaces are explicitly outside S1–S8. Verified: `walkthrough.animation` ships in the schema (`director.ts:9`) and has present ops, **but no build slice in any initiative covers it** — S6 stops at `walkthrough.code`. After all eight slices land, a live session still cannot reproduce a single emotional peak of the demo.
**Fix:** add a slice that lets the real director present `walkthrough.animation` on a live room (the cheapest wow — schema and ops exist), and sequence the roadmap by demo-promise coverage. Then capture an *unscripted* run as the next hero asset.

### 9. Latency truth gap: the demo sells synchronous fluency, and neither plan designs for dead air *(strategy)*
`a2-message` → "Okay, found it" one beat later (1.6s). Real diagnosis is minutes of tool calls, and on a voice call silence is corrosive in a way chat never is — the product's own framing ("what is it doing right now / is anything stuck") concedes exactly this. No slice in either initiative addresses the within-turn waiting experience.
**Verifier correction that matters:** the repo already ships a stall subsystem (`stallClassifier.ts`, `stuckRecovery.ts`, `StuckRecoveryFork.tsx`) — the answer partially exists and is unsold. **Fix:** treat dead air as a first-class design surface (continuous activity line + terminal driven by real tool events, earcon on stall, posture change), wire the existing stall classifier into the call UX, and cut one demo at honest speed with visible timestamps.

---

## Cross-cutting themes

**1. The funnel is broken above a great demo.** Broken CTA (finding 1), a 47s hero GIF that opens on ~10s of empty-hub join plumbing and ends mid-story at act 4/10 with no payoff (its poster frame is an empty app), first captions that read `call_join createOrAttach. Hub is the single writer of room state.` to someone who doesn't yet know what the product is, and a cold demo open with no press-play moment and no explanation that this is a ~3-minute scripted reenactment with sound. None of this touches the demo's substance; all of it decides whether anyone sees it.

**2. The honesty system is the crown jewel, and it has cracks.** The maturity badges, the real PR #91, the real recorded voice — reviewers consistently called these the most credible part of the package. Which is why the cracks cost double: overstated badges (finding 7), two artifact kinds that don't exist in the locked schema (`diagram.render`, `doc.handoff` — the canvas itself brags elsewhere about schema fidelity), fabricated line numbers and impossible debugger values (finding 6), the invented Riley/`verify.js` subplot that contradicts itself on-screen (PR body says "Riley added regression checks in verify.js" while the terminal says "1 file changed"), and the partner being "Adam" in the drive-audio plan and README TUI but "Cline" in the demo and voice manifest. Each is small; together they hand a skeptical engineer a thread to pull. A single **truth pass** closes all of them.

**3. The no-audio path is second-class.** Pacing (finding 4), the CC panel (finding 5), and both caption tracks truncating mid-sentence with single-line ellipsis at the design floor (`a3-bug` narration measures 1090px in a 666px slot). The muted viewer is the majority first-time viewer.

**4. One sizing philosophy fix.** Findings 2 and 3 plus the caption ellipsis share a root cause: content doesn't contain-fit its box. Scale-to-fit for the VS Code mock and held artifacts, two reserved wrapped lines for captions.

**5. Strategy debt is documentation debt.** No positioning statement (upstream contribution vs standalone fork — every slice's priority changes with the answer), a README that promises multi-human consistency while the plan lists multi-human rooms as a non-goal and the hub is a local single-writer daemon, and a first-run gap (the GIF sells voice + a VS Code screen; the installed product opens silent with a card deck until S2/S6 + audio slices 1–2 land). These are ADRs and README edits, not code.

---

## Notable per-lens detail (mediums worth acting on)

**UX (7).** Color semantics dilution: `PLANNED` pills use `--live` amber, so maturity badges share the hue that elsewhere means "is speaking" — worst on the PiP card "Cline [PLANNED]" next to the speaker name; emerald spotlight markers are indistinguishable at pill size from SHIPPED green. Recolor maturity to a neutral. The `a7-end-packet` modal is ~70% empty and reads half-loaded on its own payoff beat.

**Accessibility (6.5).** The `--dim` text tier fails WCAG AA in both themes (3.93–4.10:1) on the smallest text in the UI — and the tokens mirror the shipped hub's `index.css`, so this is a **pattern-level inheritance**, fix it there too. Global Space handler hijacks button activation (Space on a focused button starts playback instead of activating it) — exempt interactive elements. Reduced-motion treatment itself is exemplary; keep it.

**Coherence (7).** README says three Status Hub lenses; shipped code and demo correctly have four (Sessions missing from README — the landing page undersells shipped work). README's "everything under one Drive tab, never scattered" contradicts the demo's seven-surface rail the Addendum endorses. Member-status vocabulary (`blocked`/`needs-you`/`paused` + task line) has no schema backing (`ParticipantStatusSchema` = idle/working/speaking/away) — the future slice must include the schema rev explicitly.

**Code quality (8).** The built-for-testing `__DRIVE_DEMO__` hook surface has **zero consumers** — check in the ~100-line smoke test (all 46 beats, cursor-target resolvability, clip-registry/file agreement); it needs no refactoring, the hooks already exist. Two clocks: CC `[m:ss]` timestamps and the progress bar run on the 77s dwell clock while real playback is ~3 min — a viewer with CC open sees `[1:05]` around minute 2.5; record wall-clock or drop the stamps. Beat audio is scattered across four registries 1,200+ lines apart while the product's own `ScriptBeat` schema carries `say`/`advance` on the beat — consolidate before S1–S8 mines this file. The up-next shimmer depends on undocumented reference identity of `SHOW_*` constants (`nextShow !== state.stage.show`) — compare by stable key or document the invariant; a well-meaning "harden by cloning" refactor silently kills the feature.

**Performance (9).** Clean bill: heap 1.6→2.2 (peak)→1.5MB over 195s, epilogue bit-identical across 30s idle, replay is a true reset, no ghost/animation accumulation after 20× nav abuse, corrupt localStorage in all four keys recovers to defaults with zero console errors. Only note: heavy beats run up to 28 concurrent infinite CSS animations — consider pausing loops while playback is paused.

**Security (7).** The canvas itself is hardened (all ~30 innerHTML sinks escaped, all storage inputs validated/clamped, zero URL/cookie inputs). Three real items: **(a)** the canvas fetches Google Fonts on every open — in all four canvases — directly contradicting its own privacy-strict posture; inline subset WOFF2 + add a meta CSP. **(b)** Shipped webview consumes `postMessage` via type assertion with no runtime validation and no origin check in **five** listeners (`useDriveSession.ts:717-760`, `bankSession.ts`, `planImproveResolve.ts`, `requestDriveagentHome.ts`, `sessionRollupsDump.ts`) — cline-hub is a browser-served Vite app, not a VS Code webview; add a validated message gateway before S1–S8 builds on this. **(c)** Latent XSS in `schema-display.tsx:100-111` (`dangerouslySetInnerHTML` on unescaped path text, with a comment falsely claiming sanitization) — currently unreferenced, exploitability nil today, fix before anything imports it. Also noted: Harrison's real voice ships in a public repo (deliberate, but worth being conscious of), and the recorder page never releases the mic stream.

---

## Recommended action plan

Ordered by leverage; the first three are cheap relative to what they buy.

1. **Truth pass on the canvas** (½ day): real guard code + real line numbers in the walkthrough and EDIT card; plausible ghost values; flip `a6-artifacts`/`a10-tasks` to planned (+ rail `planned:true`); rename `diagram.render` → `diagram.data_flow` and `doc.handoff` → a schema member (or land a schema PR); reconcile the Riley/verify.js self-contradiction (or land a real `verify.js` — it's the smoke test code-quality wants anyway); unify Adam→Cline across drive-audio plan and README.
2. **Funnel pass** (1 day): inline fonts + meta CSP → host on GitHub Pages → fix the README CTA; re-cut the hero GIF to ~20–25s opening on the bug-report message and closing on the PR payoff; plain-language captions for the GIF cut; add a press-play intro card that names the meta twist ("the page you're watching is the page being fixed"); explain the SHIPPED/PLANNED chip in a hover legend + one README sentence.
3. **No-audio pass** (½ day): word-count-derived dwell when muted; sticky CC preference; two-line caption slots; exempt narration beats from the reduced-motion time cap.
4. **Sizing pass** (½ day): contain-fit held artifacts; scale the VS Code mock with the screen body (or cap the column); fix the end-packet modal sizing; neutral maturity-badge color.
5. **Check in the smoke test** (~100 lines) consuming `__DRIVE_DEMO__`, so the 7,637-line hand-edited file finally has a regression net in CI.
6. **Strategy docs** (thinking, not code): positioning ADR (upstream vs fork — decides everything downstream); scope README team claims to solo-dev multi-agent; add a `walkthrough.animation` slice and a dead-air design item (wiring the existing stall classifier into call UX) to the initiative plans; plan the unscripted-run capture as the next hero asset after S2 + audio slices 1–2.
7. **Product-code security** (before S1–S8 builds on it): validated postMessage gateway with origin checks; fix or delete `schema-display.tsx`'s unsanitized `dangerouslySetInnerHTML`.

---

*Full structured lens outputs (verdicts, all 62 findings with evidence, verifier reasoning) are archived in the session workflow journal; this document is the synthesis.*
