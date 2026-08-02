# drive-web · `cline.drivemode.ai` responsive prototype

**Status:** plan (opened 2026-08-02)
**Goal:** a working Drive-mode web app prototype that opens on a phone, a
laptop or a desktop and needs no backend and no credentials.
**Hosted at:** `cline.drivemode.ai` — see [hosted-preview](../hosted-preview/README.md).
**Absorbs:** the Phase 1 gate failure (stage renders **624 × 9 px** at the
gate's own 1280×640 viewport) and the missing `prefers-color-scheme` support.

## The decision that shapes everything else

There are two ways to read "build our product demo into a working prototype".

**Reading A — publish the demo canvas.** `drive-product-demo.html` is already
9,088 lines with **27 media queries**, self-contained, network-silent, and
verified by an 824-check battery. It already runs ultrawide → mobile. Hosting
it is nearly free.

**Reading B — the real Drive webview, running without a hub.** More work, but
the prototype *is* the product.

**We take B, and use A as the tour.** The reason is not ambition, it is that
**A has already cost us once**. The demo canvas gets 370 px of stage at
1280×640; the shipped app gets 9 px at the same viewport. The demo solved the
responsive problem and the product never inherited the solution, because they
are two implementations. Building a third would repeat the mistake exactly.

So: the prototype is the **real webview** with a **mock transport**, and the
demo's 47-beat script becomes a guided-tour overlay on top of it. Fixing the
prototype's layout fixes the product's layout, because they are the same code.

## The seam that makes it possible

`/drive?demoShareScreen=1` already ships — a credential-free demo route backed
by `drive/demoFixture.ts` and `ShareScreenSpotlightDemo.tsx`. It proves the
webview can render Drive surfaces with no hub attached. The prototype widens
that seam from one panel to the whole app:

| Layer | Today | Prototype |
|---|---|---|
| Transport | websocket to hub daemon | mock transport over the same message shapes |
| Room state | hub `reduceRoom` fold | same reducer, fed from a fixture event log |
| Credentials | provider settings | none — no real turns |
| Artifacts | hub director | scripted fixtures, real renderers |

The mock speaks the **existing wire shapes**. If it needs new ones, that is a
signal the seam is wrong, not that the mock needs an exception.

## Scope

**In.** Rooms, the Spotlight with real artifact renderers, call chrome,
roster, the show-backlog rail, settings, the CC transcript, theme switching,
and the guided tour. Responsive from ~360 px to ultrawide.

**Out.** Real LLM turns, real STT/TTS credentials, multi-human rooms, anything
needing the daemon. The prototype must be honest that it is a prototype —
surfaces that cannot work without a hub say so rather than faking a result.

## Phases

| # | Phase | Work | Gate |
|---|---|---|---|
| 1 | Layout contract | Fix the vertical budget in the real webview. Extract the rule the canvas follows and the app does not. | **stage ≥ 320 px tall at 1280×640** in both themes, feed open |
| 2 | Mock transport | Widen the demo-route seam to the whole app over existing wire shapes | app runs with no daemon; no console errors |
| 3 | Responsive shell | Real mobile: touch targets, safe areas, no-hover paths, `prefers-color-scheme` | usable at 360×640 portrait through ultrawide |
| 4 | Guided tour | The 47-beat script as an overlay on the real UI | tour runs end to end on phone and desktop |
| 5 | Publish | Static build, host, docs | a stranger opens the URL on a phone and understands the product |

Phase 1 is first because it is the gate failure, and because every later phase
inherits it.

## Why the stage is 9 px, concretely

Measured at 1280×640, feed folded: the mermaid `<svg>` is 646 × **9** px.
Folding the feed recovers *width*, not height — so S5's fold is not the
remedy. The app spends its vertical budget on chrome stacked above and below
the frame: top bar, call strip, two NOW/NEXT cards **above**; backlog rail, a
second NOW/NEXT text row, a task-bank hint, and a ~150 px plan editor
**below**.

The canvas gets 370 px at the same viewport by doing three things the app does
not: the call strip sits **below** the stage, NOW/NEXT is **one line**, and
there is **no plan editor on the call surface**.

That is the layout contract to extract — not a pixel tweak.

## Open questions for the owner

1. **The domain is settled, and it is not `drive.cline.bot`.** That is a
   subdomain of Cline's domain, not ours, and a page there would read as an
   official Cline product. The hostname is **`cline.drivemode.ai`**, on a
   domain we own, with infrastructure in `drive-mode/site` — see
   [hosted-preview](../hosted-preview/README.md).
2. **How honest should the prototype be about being a prototype?** A visible
   "no hub attached" affordance is more trustworthy but less impressive.
   Recommendation: honest, quietly.
3. **Where it is hosted** — GitHub Pages is already half-planned (the README
   CTA points at a future Pages URL) but Pages is not yet enabled.
