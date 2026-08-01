# Spotlight screen-share — initiative overview

Ship the product experience prototyped in the demo canvas
([drive-product-demo.html](../../../../design/canvases/drive-product-demo.html),
PR #91): the Spotlight rendered as a literal shared screen — the agent's
monitor — with the feed as a fold-away drawer, icon call chrome, and the
director's show artifacts presented inside the frame.

**North star.** Joining a Drive call should feel like joining a screen share,
not opening a dashboard. One dominant framed display holds what the sharer is
presenting; everything else (chat, roster, controls, queue) is quiet chrome
that folds away. Voice-first: the room works with every panel closed.

The design source of truth is the canvas. Where the canvas and this doc
disagree, the canvas wins on look/feel; the shipped schemas win on data.

## What already exists (do not rebuild)

| Piece | Where |
|---|---|
| Director state, Show backlog, DirectorScript, sticky policies | `sdk/packages/shared/src/drive/director.ts` |
| Rank/advance kernel, show templates (arch/flow/sec/walk/plan/capture) | `sdk/packages/drive/src/director/` |
| Materialize + present ops (mermaid/plan/walkthrough SVG producers) | `sdk/packages/core/src/hub/driveShowRuntime.ts`, `driveDirectorOps.ts` |
| Presented-show pane in the webview | `apps/cline-hub/src/webview/src/drive/StickyStagePane.tsx` |
| Spotlight card renderers (CodeBlock/Terminal/TestResults), human pin | `apps/cline-hub/src/webview/src/drive/Spotlight.tsx` |
| Call strip, narration banner, header controls | `apps/cline-hub/src/webview/src/drive/DriveCallChrome.tsx` |
| Director broadcasts into webview state | `apps/cline-hub/src/webview/src/drive/useDriveSession.ts` |
| Client-side mermaid rendering (lazy plugin) | `apps/cline-hub/src/webview/src/components/ai-elements/streamdown.tsx` |
| Scripted share-screen demo fixture + route | `drive/demoFixture.ts`, `drive/ShareScreenSpotlightDemo.tsx` (`/drive?demoShareScreen=1`) |

This initiative is UI recomposition plus one template addition. **No wire or
schema changes** (StageState/StagePin/StageCard and hub op names are locked;
surfaces say "Spotlight", the wire stays `stage`).

## Slices

Each slice is one PR against `main`, independently shippable, keeping
`/drive?demoShareScreen=1` green.

### S1 — Stage-first split + feed drawer
Invert the in-call layout in `Chat.tsx` (call region ~1885–1959): Spotlight
primary (`flex-1`, left), feed becomes a 340px right column that folds to the
edge. `feedCollapsed` is webview-local UI state (persisted, per-room key);
panel toggle lives in the Spotlight header. Roster stays with the feed column.
Gate unchanged: only when `drive.active && drive.stageLayout`.

### S2 — ScreenFrame
Refactor `Spotlight.tsx` around a `ScreenFrame` component: a fixed-dark
surface in both themes (locally scoped tokens, same trick as the canvas) with
- **presenter bar**: live dot + sharer (from stage authority) + artifact kind
  + sticky chip; amber frame + "You are presenting" when a human pin holds it,
- **StickyStagePane content rendered inside the frame** (today it's a sibling),
- **narration as a subtitle overlay** on the frame (replaces the banner
  placement in `DriveCallChrome.tsx:419` for in-call view),
- **idle state** ("`<sharer>` is sharing · workspace") when nothing is staged,
- human pin fills the frame; agent deck dims below (existing behavior kept).
Deck cards become a compact strip under the frame; Now/Next collapses to one
line. Card renderers are reused as-is (ai-elements rule).

### S3 — Show-backlog rail
Render the director's queue under the frame as status chips
(`planned | ready | showing | shown`) from `room.director` (already broadcast
into `useDriveSession`). Read-only in this slice; clicking a `ready` chip to
present is a stretch goal behind the existing dev controls.

### S4 — Icon call chrome
Align the call strip (`DriveCallChrome.tsx:221–348`) with the canvas: 30px
icon buttons only — mic (default-muted, red crossed state; matches
`DriveMicBar` default), raise hand, settings (opens the existing
`DriveSettingsPanel`), hang-up leave. Mode pill stays as the single text
status. Tooltips + aria-labels on everything; no text buttons.

### S5 — Hub rail fold
Collapse toggle on the hub nav rail (`App.tsx` nav, ~418): full ↔ icon sliver,
persisted UI state. Pure webview concern.

### S6 — Real renderers inside the frame
- **Mermaid live re-render**: when a presented artifact carries embedded
  mermaid source, re-render client-side via the existing streamdown mermaid
  plugin instead of the `<img>` SVG stub (`produceMermaid.ts` explicitly
  sanctions "Webview may re-render from embedded source").
- **Plan artifact** renders with the unused `ai-elements/plan.tsx`.
- **walkthrough.code** renders as file+range panels with highlighted lines
  (the canvas's stage-walk look; "rubber-duck slides" per share-and-router
  PLAN.md).

### S7 — `arch.cline-drive` show template
Add one template to `SHOW_TEMPLATE_KIT` (`showTemplates.ts`) whose mermaid
source is the real cline-drive architecture (clients / hub single-writer /
agents / director path — the diagram the canvas ships as SVG). Producer and
schema already exist (`diagram.architecture`); this makes "agent presents the
system architecture" a one-call demo on live rooms.

### S8 — Demo fixture parity
Extend `SHARE_SCREEN_DEMO_FIXTURE` and `ShareScreenSpotlightDemo` to the
canvas arc: plan → architecture (sticky **hold** across work beats) →
edit/command/test → walkthrough → human pin. Demo flags stay at composition
roots only; the fixture never becomes a production gate.

**Order**: S1 → S2, then S3/S4/S5 in parallel, then S6 → S7 → S8.

## Addendum (2026-07-31, post-demo learnings)

The demo canvas (PR #91) evolved past this plan's original scope; the build-out
should absorb these decisions:

- **The screen is a VS Code window.** The demo's `composeScreen` precedence —
  VS Code base ⊕ amber artifact overlay (StickyStagePane model) ⊕ walkthroughs
  rendered IN the editor at absolute line numbers — is the shape `Spotlight.tsx`
  + `StickyStagePane.tsx` should converge on in S2/S6. Cline purple appears only
  on Cline items (activity-bar mark, status-bar `Cline: on call`).
- **Pacing**: DirectorScript `advance: auto_after_say` is proven in the demo
  (a voiced beat holds until its audio ends). The Narrator slice in the
  drive-audio initiative (PR #93) should reuse that gate.
- **New surfaces demoed** (all `planned`): customizable rail (resize / reorder /
  add-remove), Rooms (durable sessions via ARD-0013), Agents & teams
  ("call a team once"), Tasks (first-class dependency map), Artifacts gallery,
  member-status sidebar in the drawer, CC transcript. Each needs its own
  initiative slice before product work; they are NOT in S1–S8.
- **Voice**: Kokoro-82M decision + clips live in the drive-audio plan and
  `docs/drivecode/assets/demos/voice/`.

## Constraints (unchanged, load-bearing)

- Events, not pixels; human share is a structured pin. No WebRTC.
- The hub is the single writer; clients render projections, never invent
  room authority locally.
- Locked schemas and op names; UI says Spotlight, wire says `stage`.
- Privacy: events carry metadata only; forbidden keys stay banned.
- Reuse ai-elements; no parallel component kit.
- Last-event-wins deck: one card per category.

## Non-goals

WebRTC/pixel share, multi-human rooms, `capture.demo_clip` (phase after
frames), `doc.review` renderer, TUI spotlight rendering.

## Verification

- Per slice: webview tests (`bun -F @cline/hub-webview test` or repo
  equivalent), typecheck, `/drive?demoShareScreen=1` walkthrough.
- Visual parity check against the canvas at 1280×640, light + dark.
- S7: enqueue + present `arch.cline-drive` on a live room via the Settings
  dev controls; diagram renders inside the frame.
