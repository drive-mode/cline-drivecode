# Mobile Drive — branding & styling analysis

**Status.** Analysis for [mobile-consumer](../../plans/cline-drivemode/initiatives/mobile-consumer/) MC0–MC1.  
**SoT for hex.** Hub webview [`index.css`](../../../../apps/cline-hub/src/webview/src/index.css) + [CLINE-BRAND-TOKENS.md](CLINE-BRAND-TOKENS.md).  
**Mark.** [DRIVE-MARK.md](DRIVE-MARK.md) (official light/dark silhouette).  
**Wireframes under audit.** [`mobile-drive-ios.html`](../wireframes/mobile-drive-ios.html) · [`mobile-drive-surfaces.html`](../wireframes/mobile-drive-surfaces.html) · [`mobile-drive-app.html`](../wireframes/mobile-drive-app.html)

## Verdict

Treat **`mobile-drive-ios.html` as the visual direction** for the consumer shell:
**light-first**, Hub dark ladder as peer, Schibsted UI type, brand violet CTAs,
official Drive mark via `currentColor`.

Treat **`mobile-drive-app.html` / `mobile-drive-surfaces.html` as IA +
layout inventory**, not as the finished palette. They are dark-only and use
**amber Live** — both diverge from brand and from the iOS light direction.

Do **not** invent a third mobile design system. One token sheet (below) maps
onto Hub CSS variables; MC1 is a composition root (`?app=1`), not a new CSS
package.

## Divergence audit

| Concern | Brand / Hub SoT | iOS wireframe | App + Surfaces | Ship rule |
|---|---|---|---|---|
| Default theme | Hub resolves VS Code / `prefers-color-scheme` | **Light** default + dark toggle | Dark only | **Light-first** for consumer shell; dark peer required |
| Page | `#F8FAFB` / `#0A0A0A` | Matches | `#0a0a0a` / `#070708` | Hub values |
| Card / surface | `#FFFFFF` · `#0D0D10` → `#12131A` | Matches | Matches dark ladder roughly | Hub ladder |
| Accent fill | `#9F58FA` | Matches | Matches | Hub `--primary` |
| Accent on dark text | `#B98AFF` | `--violet-soft` | `--accent-soft` | Hub `--brand-purple-text` |
| Live / OK | `#2BCC28` / `#4ADE80` | `#2BCC28` | **`#f59e0b` amber** | **Brand green** — drop amber |
| Danger | `#F53969` | Matches | Matches | Hub `--destructive` |
| Mark ink | `#000` / `#FFF` silhouette | Official SVG `currentColor` | Older / geometric embeds | Official mark only |
| Borders | `0.8px` hairline | Hairline alphas | `0.8px` | Keep `0.8px` |
| Radius (controls) | Hub `--radius` = `9px` (`0.5625rem`) | Phone CTAs ~`16px`; device chrome large | Pills `999px` | **9px** for product controls; **16px** only for primary hold-to-talk / hero CTA; **999px** for Live/eyebrows only |
| Depth | Brand: flat + surface ladder; “no heavy shadows” | Soft `shadow-sm/md` + glass tab | Flat / gradient wash | **Exception (mobile light only):** soft elevation on device cards + floating tab bar; dark stays ladder + hairline |
| Type UI | Schibsted (Hub) | Schibsted | Schibsted + DM Sans fallback | Schibsted only for product |
| Type display | DM Sans (site) / negative track | Schibsted display `-0.045em` | Schibsted `-0.04em` | Schibsted OK for app chrome; optional DM Sans only on marketing splash |
| Mono / diffs | Hub mono stack | IBM Plex Mono | Space Grotesk “mono” | Real mono for diffs (IBM Plex / Hub mono) |
| Touch | 44px strip (ux-quality) | 52px CTAs | 44–52px | **Min 44px**; primary hold **52px** |
| Live motion | Mark motion axes | Waveform + Live pill | Live pill | Event vs location per [DRIVE-MARK.md](DRIVE-MARK.md) |

### Screenshot read (current assets)

- [`mobile-drive-ios-light.png`](../../assets/hub/mobile-drive-ios-light.png) — Open / Home / Call / Approval on `#F8FAFB`; violet hero CTA; official mark in app tile.
- [`mobile-drive-ios-dark.png`](../../assets/hub/mobile-drive-ios-dark.png) — same IA on Hub dark ladder; mark inverts correctly.
- App / surfaces screenshots remain useful for **page inventory** (splash → PWA, browse, settings) but should be restyled to the token sheet before MC1 demos.

## Locked styling decisions (MC0)

These are branding locks for the consumer shell. Product forks (hosted ADR,
voice default, freemium) stay in the mobile-consumer README.

1. **Light is the default consumer theme.** Dark is a first-class peer, not an
   afterthought. Wireframes that are dark-only get a light pass or defer to iOS.
2. **Live = brand green** (`#2BCC28` light chrome / `#4ADE80` on dark). Amber
   Live in app/surfaces is retired — it reads as “warning,” not “happening.”
3. **Official Drive mark only** — black on light, white on dark; never purple
   fill. Loading uses layered wheel spin / head peek ([DRIVE-MARK.md](DRIVE-MARK.md)).
4. **One accent job for violet** — primary CTA, Live join, selected tab, key
   headline accents. Body chrome stays neutral.
5. **No Discord palette.** No blurple, no Discord status greens/reds.
6. **No third design system.** Tokens alias Hub `--brand-*` / semantic
   `--background` / `--primary`. File-URL wireframes may duplicate hex; product
   CSS must import Hub variables.
7. **Honesty chrome stays visible** on credential-free opens (`Preview` /
   demo chip) — styling must not hide it for “polish.”

## Soft depth exception (documented)

Brand tokens say avoid heavy shadows. Phone consumer UI still needs **one
plane of soft elevation** so white cards separate from `#F8FAFB` and the glass
tab bar reads as iOS chrome:

| Allowed | Forbidden |
|---|---|
| `shadow-sm` / `shadow-md` as in iOS wireframe on light cards & tab bar | Multi-layer glow stacks, neon violet blooms on every control |
| Single violet CTA glow on the **one** hero action | Purple wash behind every list row |
| Dark mode: prefer hairline + surface step; minimal shadow | Copying light-mode soft shadows 1:1 onto `#0A0A0A` |

## Consumer token sheet (alias Hub)

Use these names in mobile wireframes and MC1 CSS. Values match Hub / brand.

```css
:root, [data-theme="light"] {
  --page: #F8FAFB;              /* --background */
  --surface: #FFFFFF;           /* --card */
  --surface-2: #F4F5F7;         /* muted well */
  --ink: #151516;               /* --foreground */
  --ink-78: rgba(21, 21, 22, 0.78);
  --ink-55: rgba(21, 21, 22, 0.55);
  --ink-35: rgba(21, 21, 22, 0.35);
  --hairline: rgba(21, 21, 22, 0.08);
  --violet: #9F58FA;            /* --primary / --brand-purple */
  --violet-text: #7A3FD4;       /* text on light wash */
  --violet-wash: rgba(159, 88, 250, 0.10);
  --live: #2BCC28;              /* --brand-green */
  --danger: #F53969;            /* --destructive */
  --radius: 0.5625rem;          /* 9px */
  --radius-cta: 1rem;           /* 16px — hold-to-talk / hero only */
  --touch: 44px;
  --touch-hero: 52px;
  --font: "Schibsted Grotesk Variable", "Schibsted Grotesk", system-ui, sans-serif;
}

[data-theme="dark"] {
  --page: #0A0A0A;
  --surface: #12131A;           /* elevated panel (call cards) */
  --surface-2: #1B1D24;
  --ink: #FFFFFF;
  --ink-78: rgba(255, 255, 255, 0.78);
  --ink-55: rgba(255, 255, 255, 0.55);
  --ink-35: rgba(255, 255, 255, 0.35);
  --hairline: rgba(255, 255, 255, 0.10);
  --violet-text: #B98AFF;       /* --brand-purple-text */
  --live: #4ADE80;              /* --brand-green-live */
}
```

Hub `.dark` uses `#0D0D10` as `--card`. Consumer dark may use `#12131A` for
**raised** call chrome and `#0D0D10` for page wells — both are on the brand
ladder; pick by elevation, don’t invent new greys.

## Surface styling notes (one job each)

| Surface | Light read | Motion |
|---|---|---|
| **Open / splash** | Brand tile (official mark) + one headline + one CTA | Location settle (opacity/scale); then idle |
| **Home** | Large title, one Live card, short Recent | No spinner in nav; Live pill uses green |
| **Live call** | Spotlight fills; 44px strip + safe-area; hold 52px | Event `loading` only for hydrate/join; waveform ≠ mark spin |
| **Approval sheet** | Bottom sheet; Deny muted / Allow violet | Location sheet enter; no page spinner |
| **Settings** | iOS grouped lists; Advanced collapses hub power | Idle mark; never animate settings chrome |
| **PWA install** | Same Open tokens; honest preview if demo | Location settle |

## Open decisions (styling-adjacent)

Still owner calls in [mobile-consumer README](../../plans/cline-drivemode/initiatives/mobile-consumer/README.md):

| # | Decision | Styling impact |
|---|---|---|
| 3 | Home-screen name **“Drive”** vs **“Cline Drive”** | Icon lockup + splash wordmark |
| 2 | Voice default muted vs hold hot | Teaching chip copy on Open / Call |
| 5 | Force PWA now | Install sheet visual weight |

Not styling blockers: ADR-0016 hosted path, freemium — keep out of the token sheet.

## Implementation checklist

- [ ] Retheme `mobile-drive-app.html` + `mobile-drive-surfaces.html` to the
      token sheet (light default + dark peer; green Live; official mark)
- [ ] Keep `mobile-drive-ios.html` as the visual reference; prune any
      non-token one-offs during MC1
- [ ] MC1 composition root consumes Hub CSS variables — no parallel
      `mobile-tokens.css` package
- [ ] Replace amber Live in any remaining docs/screenshots
- [ ] Capture refreshed app/surfaces screenshots after retheme
- [ ] Confirm AA on `--ink-35` / `--dim` captions (ux-quality phase 5)

## Relationship

| Doc | Job |
|---|---|
| This file | Brand + styling locks for phone consumer |
| [DRIVE-MARK.md](DRIVE-MARK.md) | Mark geometry + wait motion axes |
| [CLINE-BRAND-TOKENS.md](CLINE-BRAND-TOKENS.md) | Measured site/Hub palette |
| [mobile-consumer](../../plans/cline-drivemode/initiatives/mobile-consumer/) | Phases, audience, ADR forks |
| [ux-quality](../../plans/cline-drivemode/initiatives/ux-quality/) | Award bar on existing hub (prereq 0–2 for MC1) |
