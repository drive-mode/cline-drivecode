# Drive mark — official logo + motion strategy

**Status.** Accepted and implemented from `assets/drive/source.png`.
**Locked by.** [DEC-drive-mark-official.md](../../plans/cline-drivemode/decisions/DEC-drive-mark-official.md)
**Ship today.** [`DriveMarkIcon`](../../../../apps/cline-hub/src/webview/src/components/icons/drive-mark.tsx)
(static nav) · [`DriveMarkMotion`](../../../../apps/cline-hub/src/webview/src/components/icons/drive-mark-motion.tsx)
(loading / peek) · wireframe [`drive-mark-motion.html`](../wireframes/drive-mark-motion.html)

## Official mark

The **Drive feature mark** is the Cline robot as the hub of a steering wheel —
not the Cline app wordmark. Hub chrome keeps Cline’s own favicon; Drive uses
this mark in nav, headers, empty states, and wait affordances.

### Light / dark

| Mode | Presentation | Rule |
|---|---|---|
| **Light** | Solid dark mark on light / transparent | `#000000` (or `currentColor` on light chrome) |
| **Dark** | Solid light mark on dark / transparent | `#FFFFFF` (or `currentColor` on dark chrome) |

Do **not** invent a third “brand purple” fill for the mark. Violet stays for
selection, CTAs, and live accents — the mark itself is monochrome silhouette
so it reads at 16–24px next to lucide icons.

### Geometry that matters for motion

The official pair is a **bold solid silhouette**: thick D-leaning rim (clear
up/down from the flat bottom), two horizontal spokes into the head, Cline head
with antenna nub and two vertical pill eyes as **negative space**.

That geometry gates animation choices:

| Constraint | Consequence |
|---|---|
| Flat bottom = oriented object | Continuous 360° spin of the **whole** mark reads as “tumbling logo,” not “wheel turning.” |
| Eyes are cutouts in one fill | True blink needs lids / mask layers — not free with a single path. |
| Head is the hub | Wheel/rim can turn while the head stays upright — the readable Drive metaphor. |
| Tiny sizes (≤24px) | Prefer whole-mark opacity or a short rock; layered spin is for ≥32px wait states. |

`generate-assets.py` separates the source contour tree into the exact
`.dm-wheel` and `.dm-head` layers. `generate-icon.py` emits the same compact
paths for the static and motion React components.

## Two decision axes for wait motion

Every loading / transition use of the mark should pick **one primary axis**.
Mixing both without a rule produces competing spinners.

### Event-oriented

**Question:** *What unfinished work is the system doing?*

Bind `motion` (or equivalent) to a **boolean / phase from the domain event**:
hydrate, stream, tool gate wait, call join, reconnect. Same event → same motion
**wherever** that wait is shown (chat chrome, conversation panel, toast).

| Good fit | Why |
|---|---|
| Conversation history hydrate | Clear start/end (`isHydrating`) |
| Agent turn / tool round-trip | Event completes; user stays in place |
| Call join / room snapshot catch-up | Network lifecycle |
| Reconnect / hub discovery | Background job with a done signal |

**Rules**

1. Start on the event; **stop on the event** (or fail). Do not leave spin after paint.
2. Prefer one shared `DriveMarkMotion` kind per event class (`loading` for
   indeterminate I/O; `peek` for “agent looking / thinking”).
3. Text label next to the mark carries the event name (“Loading history”) —
   the mark stays decorative (`aria-hidden`) when the label exists.
4. Reduced motion → opacity pulse only; never rely on rotation alone.

### Location-oriented

**Question:** *Where is the user going / where will content land?*

Bind motion to **chrome that owns the destination**: full-page boot, tab swap,
drawer open, Spotlight vs feed rail, first paint of Drive lobby. Completion is
**layout** (route mounted, panel open, first contentful paint) — not a named
backend event.

| Good fit | Why |
|---|---|
| App / Drive shell first paint | User landed in a place; wait is spatial |
| Tab or mode transition (Chat → Drive) | Orientation change, short |
| Panel / rail expand-collapse | Local chrome, not network |
| Empty-state → populated stage | Destination-shaped hold |

**Rules**

1. Motion lives **in the destination**, not in a global overlay (unless the
   whole shell is blank).
2. Keep it **short and finite** (one cycle or ≤~1.2s), then idle — location
   waits that never end feel broken.
3. Prefer rock / scale / opacity over continuous spin — the place is settling,
   not “working.”
4. Do not also attach an event spinner in the same viewport unless the event
   outlives the transition (then switch: location intro → event `loading`).

## Recommended motion vocabulary

Keep the existing prop surface small. Extend kinds only when a surface cannot
reuse these.

| Kind | Feel | Primary axis | Use |
|---|---|---|---|
| `idle` | Static official silhouette | — | Nav, headers, favicons |
| `loading` | Rim/spokes turn **or** short rock if whole-mark only; head upright | **Event** | Hydrate, network catch-up |
| `peek` | Head tips L/R (blind spot) | Event *or* soft location | Thinking, “checking,” gentle empty-state life |
| `drive` | Slow wheel + soft peek | Ambient (rare) | Marketing / wireframe demo only — not chat chrome |
| *(reduced)* | Opacity 1 → 0.45 → 1 | Both | `prefers-reduced-motion` |

### Geometry-aware `loading`

When the official D-rim is layered:

1. **Preferred:** `.dm-wheel` rotates; `.dm-head` fixed upright (classic
   steering). Flat bottom on the rim is fine — it spins as a wheel.
2. **Fallback (single path):** rock ±12–18° — do **not** full-spin the
   combined silhouette.
3. **Avoid:** spinning the head with the rim (Cline upside-down).

Eyes: ship **without** blink until mask layers exist. Optional later:
event-oriented “attention” = one peek cycle on message receive — cheaper than
eye lids.

## Surface map (default picks)

| Surface | Axis | Kind | Notes |
|---|---|---|---|
| Chat “Loading history” | Event | `loading` | Already wired |
| Conversation panel hydrate | Event | `loading` | Already wired |
| Drive tab first open (cold) | Location | short `peek` or opacity | Then idle; if snapshot still loading → switch to event `loading` |
| Call join / roster catch-up | Event | `loading` | In call chrome, not a full-page veil |
| Agent thinking (no tokens yet) | Event | `peek` | Distinct from hydrate spin |
| Route / lobby ↔ call | Location | 1× scale or opacity | No second spinner in Spotlight |
| Full-page boot / PWA splash | Location | large idle mark + opacity | Brand hold, not a working spinner |
| Nav icon | — | `idle` | Never animate the activity rail |

## Implementation notes (lazy)

1. **One component** for motion (`DriveMarkMotion`); static nav stays
   `DriveMarkIcon` (tiny single path).
2. **CSS keyframes** over JS timelines — already in `index.css`; keep
   `transform-box: fill-box` + `transform-origin: center`.
3. **Theme:** `fill="currentColor"` — light/dark come from chrome, not duplicate
   SVG files in the webview bundle. Raster/SVG files under `assets/drive/` stay
   for docs, favicon, and `/cline-drive-logo.svg`.
4. **Regenerate** via `assets/drive/generate-assets.py` +
   `generate-icon.py`; the scripts cut rim/head layers from the contour tree.
5. **No new animation library.**

## Asset handoff checklist

- [x] Drop official light+dark (or single black-on-transparent master) as
      `assets/drive/source.png`
- [x] Regenerate SVGs / ICOs / 512s; copy dark-on-transparent →
      `apps/cline-hub/src/webview/public/cline-drive-logo.svg`
- [x] Rebuild `DriveMarkIcon` path + layered `DriveMarkMotion` groups
- [x] Update docs logos under `docs/drivecode/assets/logos/`
- [x] Re-capture `drive-mark-motion` wireframe screenshot
- [x] Confirm 16px and 24px legibility in light and dark hub themes
