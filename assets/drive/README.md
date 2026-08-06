# Cline Drive brand assets

The Drive mark: the Cline robot at the centre of a steering wheel. It identifies
the **Drive feature**, not the application — the Cline Hub keeps Cline's own
wordmark and favicon, because `apps/cline-hub` is upstream Cline and Drive is a
feature inside it.

**Official direction:** light mode = dark silhouette; dark mode = light
silhouette. Motion rules (event- vs location-oriented waits):
[`docs/drivecode/design/brand/DRIVE-MARK.md`](../../docs/drivecode/design/brand/DRIVE-MARK.md).

## Files

| File | Use |
|---|---|
| `source.png` | Original raster. **Source of truth** — regenerate everything else from it rather than editing the derived files. |
| `cline-drive-dark-on-transparent.svg` | The mark in `#000000` on transparent. This is the one served at `/cline-drive-logo.svg`. |
| `cline-drive-light-on-transparent.svg` | The mark in `#FFFFFF` on transparent, for dark surfaces. |
| `cline-drive-light.svg` / `cline-drive-dark.svg` | Same mark on a solid tile. |
| `cline-drive-mark-layers.svg` | **Motion layers** — `.dm-wheel` (rim + spokes) + `.dm-head` (traced from source). Wheel can spin while head peeks. |
| `favicon.svg` | Adaptive favicon — follows `prefers-color-scheme`. |
| `favicon-light.ico` / `favicon-dark.ico` | 16–256px ICO bundles. |
| `cline-drive-*-512.png` | 512px rasters, solid and transparent. |
| `generate-assets.py` | Rebuilds every file above from `source.png`. |
| `generate-icon.py` | Emits the inline React icon component. |
| `validate-assets.py` | Checks inversion, alpha, docs copies, and motion layers. |

## Palette

- Dark `#000000`
- Light `#FFFFFF`

## Where it is used

- **Drive nav item and Drive page header** —
  [`components/icons/drive-mark.tsx`](../../apps/cline-hub/src/webview/src/components/icons/drive-mark.tsx),
  an inline component so it inherits `currentColor` and picks up nav active and
  hover states. An `<img>` cannot do that.
- **Motion (loading / blind-spot peek)** —
  [`drive-mark-motion.tsx`](../../apps/cline-hub/src/webview/src/components/icons/drive-mark-motion.tsx)
  + wireframe [`drive-mark-motion.html`](../../docs/drivecode/design/wireframes/drive-mark-motion.html).
  Props: `motion="idle" | "loading" | "peek" | "drive"`.
- **README hero** — `docs/drivecode/assets/logos/logo-{light,dark}.png`, behind a
  `<picture>` so it adapts to GitHub's theme.
- **Served asset** — `apps/cline-hub/src/webview/public/cline-drive-logo.svg`,
  allowlisted in `apps/cline-hub/src/server.ts`.

## Regenerating

Requires `pillow`, `numpy`, `opencv-python`.

```bash
python assets/drive/generate-assets.py assets/drive/source.png assets/drive
python assets/drive/generate-icon.py assets/drive/source.png \
  apps/cline-hub/src/webview/src/components/icons/drive-mark.tsx

# The served copy is not generated in place -- copy it, or it goes stale silently.
cp assets/drive/cline-drive-dark-on-transparent.svg \
  apps/cline-hub/src/webview/public/cline-drive-logo.svg
cp assets/drive/cline-drive-light-512.png docs/drivecode/assets/logos/logo-light.png
cp assets/drive/cline-drive-dark-512.png docs/drivecode/assets/logos/logo-dark.png
python assets/drive/validate-assets.py
```

Two things the tracing does that a naive threshold-and-trace does not, both
because the first pass rendered visibly lumpy at logo sizes:

1. **Smooths the boundary before tracing.** The source is anti-aliased, so a
   hard threshold leaves a ragged edge. It supersamples 4x, blurs, then
   re-thresholds.
2. **Fits curves, not polylines.** `approxPolyDP` emits straight segments, which
   made the wheel rim a visible polygon. Contours are resampled at even
   arc-length and fitted with a closed Catmull-Rom spline emitted as cubic
   Beziers.

The icon generator resamples far more coarsely on purpose: ~7.8KB of path
instead of ~25KB, since the extra control points are invisible below 32px and
the component ships in the JS bundle.
