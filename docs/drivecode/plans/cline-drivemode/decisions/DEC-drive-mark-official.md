# DEC · Official Drive mark (light / dark) + motion axes

**Status.** Accepted  
**Date.** 2026-08-06  
**Deciders.** Drive product / brand  
**Aligns with.** [DRIVE-MARK.md](../../../design/brand/DRIVE-MARK.md),
`assets/drive/README.md`, hub `DriveMarkIcon` / `DriveMarkMotion`

## Context

Drive already ships a traced steering-wheel + Cline hub mark and a layered
motion component (wheel spin / head peek) for conversation hydrate. A refined
**light-mode (dark ink) / dark-mode (light ink)** pair is now the intended
official feature logo. Without a clear rule, wait states grow competing
spinners — some tied to network events, some to page chrome.

## Decision

1. **Official Drive feature logo** is the monochrome Cline-in-wheel silhouette
   in the light/dark pair (dark mark on light; light mark on dark). Not a
   purple fill; not the Cline app wordmark.
2. **Wait motion picks one primary axis:**
   - **Event-oriented** — bind to unfinished work (`isHydrating`, join,
     reconnect). Same motion wherever that event shows. Stop when the event
     ends.
   - **Location-oriented** — bind to destination chrome (shell boot, tab
     swap, panel settle). Short, finite; prefer rock/opacity over continuous
     spin.
3. **`loading` geometry:** rim/spokes may spin; head stays upright. Do not
   full-spin a single-path combined mark (flat bottom reads as tumbling).
4. **Product code** keeps `currentColor` icons; static and motion paths are
   generated from the official `assets/drive/source.png`.

## Consequences

**Positive**

- One brand mark across hub, docs, and mobile wireframes.
- Clear rule for where spinners live (no double wait in Spotlight + chat).
- Motion stays CSS + two React icons — no animation framework.

**Negative**

- Eyes stay cutouts until mask layers exist.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Animate every wait the same | Collapses hydrate vs tab transition into one noisy spin |
| Full-mark 360° spinner | Fights D-orientation; upside-down Cline |
| Purple filled logo | Competes with accent; fails next to lucide at 16px |
| JS timeline / Lottie pack | Heavier than CSS keyframes for two transforms |

## Follow-up

See the verification checklist in
[DRIVE-MARK.md](../../../design/brand/DRIVE-MARK.md).
