# spotlight-screen-share · Initiative index

**Status:** planned — slices S1–S9 sequenced, none started; design proven in the
demo canvas (PR #91, extended by PR #94)
**Design source of truth:** [drive-product-demo.html](../../../../design/canvases/drive-product-demo.html)
(canvas wins on look/feel; shipped schemas win on data)
**Positioning context:** [ARD-0016](../../ard/ARD-0016-distribution-and-positioning.md) (Proposed)

Ship the Spotlight as a literal shared screen — the agent's monitor — with the
feed as a fold-away drawer, icon call chrome, and director artifacts presented
inside the frame. Joining a Drive call should feel like joining a screen share,
not opening a dashboard.

| File | What |
|---|---|
| [overview.md](overview.md) | North star, existing machinery, slices S1–S9, Addendum (post-demo learnings), constraints, verification |

### Slices at a glance

S1 stage-first split → S2 ScreenFrame → S3 backlog rail / S4 icon chrome /
S5 rail fold (parallel) → S6 real renderers → S7 `arch.cline-drive` template →
S8 fixture parity → S9 `walkthrough.animation` renderer (first slice that makes
a demo peak reproducible on a live room).

### Feature ids

Builds on shipped director machinery rather than new DRV specs:
`sdk/packages/shared/src/drive/director.ts` (DirectorScript, ShowBacklogItem,
ShowArtifactKind), `StickyStagePane.tsx`, `Spotlight.tsx`,
`DriveCallChrome.tsx`. Narration pacing gate shared with
[drive-audio](../drive-audio/) (DRV-NARRATION).
