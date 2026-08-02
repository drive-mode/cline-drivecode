# ADR-0024 · Drive web runtime — a conformant browser host behind a transport port

**Status:** Proposed (2026-08-02)
**Owner:** Drivecode SE lead
**Constrained by:** [ADR-0013](ADR-0013-state-partition.md) (three-lane state),
[ADR-0016](ADR-0016-distribution-and-positioning.md) (public **self-hosted**
beta — this hosts a page, not a hub).
**Detail:** [drive-web/architecture.md](../initiatives/drive-web/architecture.md).

## Context

`cline.drivemode.ai` needs the Drive UI to run in a browser tab with no hub
daemon. The question is what stands in for the daemon.

The webview's transport is one branch in one file — `new WebSocket` appears
exactly once in the app (`vscode.ts:51`), behind `getVsCodeApi()`
(`vscode.ts:114-124`). Components use two functions and never import the
socket. So the substitution point is not in dispute; **what gets substituted
in** is the decision.

Three facts make the good option available:

- `@cline/drive` has **zero runtime dependencies** — the import boundary
  type-erases `@cline/shared` (`import-boundary.test.ts:33-47`) — and ships a
  `browser` export.
- The webview **already runs that kernel client-side** (`foldRoomSnapshot.ts:6`,
  `stageReducer.ts:8-13`, `routeSuggest.ts:7`).
- **`memoryDriveHost` already exists** — 186 lines implementing `DriveHostPort`,
  exported at `index.ts:16-19`, sitting beside `runHostConformance`.

## Decision

**1. Extract the transport as a named port; select the implementation at a
composition root.**

`getVsCodeApi()` becomes the root. The outbound half is already typed
(`VsCodeApi`, `vscode.ts:6-10`) but unexported; the inbound half
(`dispatchHostMessage`, `vscode.ts:23-25`) is module-private and unnamed —
naming it is the whole structural change. `subscribeToHostMessages` listens on
`window`, so **no component changes.**

This generalises a pattern already chosen deliberately here:
`StatusTeamsSource` and `StatusSessionRollupSource` are ports with live and
demo implementations selected from query flags (`App.tsx:1272-1290`).

**2. The web build runs a real Drive host in the browser, not a mock.**

Built on `memoryDriveHost`, seeded from a fixture event log, driving the same
`reduceRoom` fold the daemon uses.

**3. The browser host must pass `runHostConformance`.**

This is the load-bearing clause. A host that passes the same suite as the
daemon is a second implementation of a contract; one that does not is a mock,
and mocks drift. This repo has paid for drift twice — the demo canvas giving
the stage 370 px while the app gave 9 px, and fourteen fabricated rooms
listed as live sessions. Both were plausible, silent and wrong. Conformance is
the mechanism that makes a third instance unlikely rather than merely
undesired.

**4. No new message types for the browser host.**

If the local host needs a message the protocol lacks, the seam is wrong. Fix
the seam.

**5. A capability that cannot work must fail visibly.**

Four correlators (`bankSession.ts`, `requestDriveagentHome.ts`,
`planImproveResolve.ts`, `sessionRollupsDump.ts`) currently time out at 3 s and
degrade to local-memory fallbacks, producing a UI that looks fine and is
lying. `/drive` without the demo flag already hangs on "Checking…" forever
(`drive-view.tsx:271`). Silent degradation is banned in the web build, and the
existing hang is a bug to fix regardless.

## Consequences

- The port makes the webview testable without a socket — a benefit that
  outlives this initiative.
- **The conformance suite becomes load-bearing CI.** If it is weak, this
  decision is weaker than it reads. Its coverage should be assessed before
  relying on it, not assumed.
- `base: "./"` must become `"/"` for the web target
  (`vite.config.ts:39`); the hub rewrites this at serve time
  (`server/http.ts:86-89`) and a static host will not.
- The theme bootstrap is server-injected and must move into the HTML.
- One external URL leaves the bundle: `models.dev` provider logos
  (`model-selector.tsx:186`).
- Mobile weight is a real constraint — 6.5 MB JS, mermaid ~1.5 MB.
- Fixtures are now a maintained artifact. Stale fixtures are how a preview
  starts lying; they need an owner and a refresh path.

## Alternatives rejected

- **A message-shaped mock.** Cheapest today, drifts silently, no conformance.
- **A separate demo app.** A third implementation of the UI; the 9 px stage is
  what the second one already cost.
- **Recording and replaying real hub traffic.** Brittle against protocol
  change and unverifiable.
- **Hosting a real hub.** A different product — contradicts ADR-0016 and
  inherits every ADR-0021 credential finding.

## Open

1. **How strong is `runHostConformance` actually?** Decision 3 leans on it
   entirely. Assess before building.
2. **Does the web build ship Door B (`desktopCommand`, ~40 commands) or hide
   settings?** Hiding is honest and less work; stubbing shows more product.
3. **Where fixtures live and who owns refreshing them.**
4. **Does mermaid ship to phones at all**, or does the mobile build degrade
   diagrams to a static image?
