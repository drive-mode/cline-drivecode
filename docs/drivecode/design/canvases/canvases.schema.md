# Canvas registry (`canvases.json`)

Design canvases are self-contained HTML prototypes. `canvases.json` declares
each one and how it bundles; `build-artifact.mjs` reads the registry and emits
single-file distributions. **Registering a canvas is the whole integration** —
no code change.

```bash
bun build-artifact.mjs                          # build every registered canvas
bun build-artifact.mjs --canvas drive-product-demo
bun build-artifact.mjs --out ./dist             # default: <os-tmp>/drive-canvas-dist
```

Each canvas produces two files:

| Output | Use |
|---|---|
| `<id>.standalone.html` | Open from `file://`, host anywhere. Zero requests leave the page. |
| `<id>.artifact.html` | Body fragment for publishers that supply their own document shell (e.g. Claude artifacts). |

## Fields

| Field | Where | Meaning |
|---|---|---|
| `defaults.fontsDir` | top level | Path (relative to this directory) holding self-hosted WOFF2. Per-canvas `fontsDir` overrides. |
| `defaults.outDir` | top level | Default output directory name under the OS temp dir. |
| `canvases.<id>.file` | per canvas | The HTML file, relative to this directory. |
| `canvases.<id>.title` | per canvas | Human label; documentation only. |
| `canvases.<id>.media` | per canvas | Present only when the canvas loads media at runtime. |
| `media.dir` / `media.ext` / `media.mime` | media | Directory to inline, extension filter, MIME for the data URI. |
| `media.legacyAudioPatch` | media | Escape hatch for canvases predating the media contract — see below. |

## Recording (`capture`)

`record-canvas.mjs` plays a canvas and cuts a GIF from it:

```bash
bun record-canvas.mjs --canvas drive-product-demo
bun record-canvas.mjs --canvas drive-product-demo --max-seconds 45   # quick check
```

**The cut is declared by beat id, never by frame number.** Frame numbers rot the
moment pacing changes — which happens every time narration is re-recorded — so
a frame-indexed cut silently produces a different story after every re-timing.
Beat ids survive it.

```json
"capture": {
  "width": 1280, "height": 720, "intervalMs": 250,
  "gifWidth": 820, "frameMs": 110,
  "cut": [{ "from": "a2-message", "to": "a2-narration", "step": 2 }]
}
```

| Field | Meaning |
|---|---|
| `width` / `height` | Capture viewport. |
| `intervalMs` | Frame capture period during autoplay. |
| `cut[]` | Ordered `{from, to, step}` beat-id ranges. A range naming an unknown or unplayed beat warns and is skipped — it never fails the run. |
| `gifWidth` / `frameMs` | Output width and per-frame hold. |
| `maxSeconds` | Recording cap (default 240); `--max-seconds` overrides. |

Frames are mapped to beats by the canvas's SayClock beat id when it exposes
one, falling back to matching the caption strip forward (autoplay only moves
forward, so duplicate captions resolve correctly). Assembly uses ffmpeg
`palettegen`. Requires puppeteer-core installed on demand, system Chrome
(`CHROME_PATH` to override), and ffmpeg.

## Media contract

A canvas that needs its media inlined resolves URLs through a lookup the
builder populates:

```js
const mediaUrl = (f) => (window.__CANVAS_MEDIA__ || {})[f] || CLIP_BASE + f;
```

When the builder sees `__CANVAS_MEDIA__` in the source it injects the map and
touches nothing else. This is the preferred path: the builder needs no
knowledge of the canvas's internals, so a canvas cannot drift out of sync with
its bundler.

`media.legacyAudioPatch` is the pre-contract fallback — an explicit, configured
string substitution (`baseDecl`, `call`, `replacement`, `mapName`) for canvases
that build media URLs inline. It fails loudly with an actionable message when
the canvas changes underneath it. Migrate a canvas to the contract and delete
its `legacyAudioPatch` block.

## Invariants the builder enforces

- A referenced font that is missing on disk is a hard failure, not a silent
  system-font fallback.
- A canvas configured for media with neither the contract nor a working legacy
  patch is a hard failure.
- The page's own CSP is rewritten to admit the `data:` URIs that were inlined
  (`font-src` / `media-src` / `img-src` only, and only if already present).

Canvases are expected to be network-silent; `drive-product-demo.html` asserts
this in `verify.js`, and bundles are checked the same way before publishing.
