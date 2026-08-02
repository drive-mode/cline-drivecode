# drive-web · architecture

**Status:** design (2026-08-02) · **Plan:** [README.md](README.md) ·
**Hosting:** [hosted-preview](../hosted-preview/README.md) ·
**Decision:** [ADR-0024](../../adr/ADR-0024-drive-web-runtime.md)

Every claim here is cited to code read on `main`. Where something already
works, that is stated — most of this design is *connecting* things that exist,
not building them.

## The one-line summary

**Run a real Drive host in the browser, behind a transport port.** Not a mock
of the hub — an implementation of the same port contract, provable by the
conformance suite that already ships.

## Why not a mock

A mock is a lookup table of message shapes. It drifts the moment the protocol
moves, and nothing catches the drift. This repo has already paid for exactly
that failure mode twice: the demo canvas gave the stage 370 px while the app
gave it 9 px, and the Rooms page listed fourteen fabricated sessions. Both were
plausible, silent and wrong.

The alternative is available because of three facts:

1. **`@cline/drive` is dependency-free and browser-safe.**
   `sdk/packages/drive/package.json:31-33` declares exactly one dependency
   (`@cline/shared`), and the enforced import boundary
   (`import-boundary.test.ts:33-47`) permits only *type* imports of it — so the
   built kernel has **zero runtime dependencies**. It ships a `browser` export
   condition (`package.json:15`).
2. **The webview already runs that kernel client-side.** `foldRoomSnapshot.ts:6`,
   `stageReducer.ts:8-13`, `routeSuggest.ts:7`, `bankSession.ts:2-9`. Running
   Drive state in a browser is the *existing* architecture, not a new one.
3. **A conformant in-memory host already exists.** `memoryDriveHost`
   (`sdk/packages/drive/src/conformance/memoryHost.ts`, 186 lines) implements
   `DriveHostPort` (`hostPort.ts`, 178 lines) and is exported from the package
   index (`index.ts:16-19`). `runHostConformance` sits beside it.

So the browser host can be held to the **same contract as the daemon**, by the
same suite. That is a guarantee a mock cannot offer.

## Layer 1 — the transport port

### What is there now

The entire transport is one file. `new WebSocket` appears **once in the whole
app** (`vscode.ts:51`). `getVsCodeApi()` (`vscode.ts:114-124`) branches once:
VS Code panel, else `createBrowserApi()` → socket to
`${ws|wss}://${location.host}/browser?roomSecret=…`.

The interface every component uses is **two functions**:

| | Signature | State |
|---|---|---|
| outbound | `postToHost(m: WebviewInboundMessage): void` (`vscode.ts:126`) | typed as `VsCodeApi.postMessage` (`vscode.ts:6-10`), **not exported** |
| inbound | `dispatchHostMessage(m: WebviewOutboundMessage): void` (`vscode.ts:23-25`) | module-private, **unnamed as a concept** |

`subscribeToHostMessages` listens on `window`, not on a transport object
(`host-message-gateway.ts:35-72`), so a substitute **does not implement it**.

### The change

Name the port and make `getVsCodeApi()` a composition root that selects an
implementation. **Zero component changes.**

The precedent is in-repo and deliberate: `StatusTeamsSource`
(`status/status-teams-source.ts:4-6`) and `StatusSessionRollupSource`
(`status/status-session-rollup-source.ts:8-13`) are explicit ports with live
*and* demo implementations, chosen at a composition root
(`App.tsx:1272-1290`) from query flags. This generalises that decision one
level down, to the transport.

### The message surface

45 inbound / 46 outbound (`webview-protocol.ts`), across two doors:

- **Door A** — typed frames via `postToHost`. Used by everything Drive, chat, status.
- **Door B** — `desktopClient.invoke()` → one `{type:"desktopCommand", id, command, args}` frame (`desktop-client.ts:123-142`), ~40 command names. Used by *all* settings views.

Door B is one frame type with a wide vocabulary — cheap to stub, and every
settings view is dark without it.

## Layer 2 — the browser host

`memoryDriveHost` speaks `DriveHostPort`. The webview speaks the message
protocol. The adapter between them is the real new code, and it is small
because both sides already exist.

**Read path — already works.** Dispatch
`{type:"drive_event", roomId, event, snapshot}` and it flows through
`foldIncomingDriveEvent` (`foldRoomSnapshot.ts:18`, called at
`useDriveSession.ts:1086`) → `applyRoomSnapshot` (`types.ts:267`) →
`DriveUiState`. That legitimately drives roster, spotlight, stage cards, pins,
mute/deafen, raised hands, sub-mode, addressSet, and the join/leave/end
lifecycle.

**Write path — the actual gap.** `stripHandlers`
(`useDriveSession.ts:1442-1570`) are `postToHost`-only. Mute and hand-raise
flip optimistically (`:1470`, `:1485`); **spotlight (`:1543`) and sub-mode
(`:1561`) wait for a hub echo that never arrives.** The browser host closes
this by turning outbound commands into `DriveEvent`s and feeding them back
through the same channel.

**Statefulness is mandatory, not optional.** Drive's `call_*` surface carries
**no `requestId`** (`webview-protocol.ts:301-386`); replies are matched by
roomId against a mutable ref (`useDriveSession.ts:1072-1079`) with a monotonic
`seq`. A stateless responder leaves the Drive view stuck in "joining" forever.
PR #123's `call_end` correlation finding was the *design of the whole call
surface*, not an outlier.

## Layer 3 — the honesty boundary

**This is the layer most likely to be got wrong, and the most important.**

Four hand-rolled correlators — `bankSession.ts:214-350`,
`requestDriveagentHome.ts:131-173`, `planImproveResolve.ts:61-108`,
`sessionRollupsDump.ts:49-84` — each time out at 3 s and **degrade silently to
local-memory fallbacks** (`bankSession.ts:383-385`). The result is a UI that
looks fine and is lying. That is the same failure class as the 9 px stage and
the fabricated Rooms list.

There is already one instance shipping: `/drive` **without** the demo flag
shows "Checking…" **forever** with no hub, because plain `error` is not in that
view's subscribed types (`drive-view.tsx:271`, `:168`, `:179`, `:202`). That is
a silent hang in the product today, independent of this work.

**Design rule:** in the web build, a capability that cannot work must fail
**visibly**. Never a plausible-looking local fallback. Concretely:

| Capability | Today with no hub | Web build |
|---|---|---|
| LLM turns | honest error (`vscode.ts:76-82` → `Chat.tsx:923`) | keep — say why |
| File edits / terminal / git | **silent** — events never arrive | must announce |
| STT via loopback whisper | honest `stt_unreachable` (`transcribeAudioBlob.ts:78`) | mixed-content blocked anyway; use Web Speech (`speech-input.tsx:155-169`) |
| TTS | browser `speechSynthesis` works | keep |
| Bank ops | 3 s → memory fallback | must not pretend |
| `/drive` preview | **hangs forever** | fix regardless |

Three exact failure *sentences* are pattern-matched to reject in-flight
promises (`desktop-client.ts:21-25`). A host that words errors differently
leaks hung promises.

## Layer 4 — the static build

`bun -F @cline/cline-hub build:webview` → `tsc -b && vite build` →
`apps/cline-hub/dist/webview` (133 files, 6.9 MB).

**Hard blocker: `base: "./"`** (`vite.config.ts:39`). The hub rewrites `./` → `/`
at serve time (`server/http.ts:86-89`); Cloudflare Pages will not. Served at
`/settings/account`, `./assets/…` resolves to `/settings/assets/…` → 404 white
screen. Needs `base: "/"` for the web target.

**The theme bootstrap is server-injected** (`server/http.ts:25-35`) and absent
from the built HTML — without it you lose the pre-paint flash guard, and an
inline script fights the site's strict CSP.

**Routing is History API** (`App.tsx:1366`, `popstate` at `:1314`) over ~25
deep-linkable paths (`VIEW_PATHS`, `App.tsx:130-148`). A static host needs
`_redirects` → `/* /index.html 200`. Unknown paths already fall through to
`home` (`App.tsx:216`), so a blanket fallback is safe — and the
`isWebviewRoute` allowlist problem that bit PR #123 **disappears entirely**.
Note `/rooms` is not in the route tree yet.

**Nothing is build-time configurable.** Zero `import.meta.env`, zero
`process.env`, zero `window.__*` anywhere in the webview. All config arrives
over the wire. Demo bootstrap flags are read from `location.search`
(`drivecode-demo/src/hub-query.ts:31-48`) — that is the existing static path.

**One external URL in the shipped bundle**: `https://models.dev/logos/*.svg`
(`model-selector.tsx:186`). Under the site's CSP this is the only `img-src`
violation and must go. Rive hardcodes six `.riv` files on Vercel blob storage
(`persona.tsx:54-91`) but is **dead code, absent from the bundle** — keep it
unimported.

**Mobile weight is the real constraint.** 6.5 MB JS uncompressed. Mermaid is
~1.5 MB across four chunks; shiki grammars ~170 KB each; `@xyflow/react`,
`recharts`, `media-chrome` and `motion` are eagerly loaded. Mermaid already
lazy-loads (`streamdown.tsx:130`) — the win is making sure the *first paint* on
a phone does not pull it.

No service worker, no SharedArrayBuffer, no COOP/COEP requirement, no
`new Worker`. Good.

## Layer 5 — responsive and the tour

Phase 1 of the plan is done: the stage now measures 352 px at 1280×640
(#130). Remaining is real mobile — touch targets, safe areas, no-hover paths,
`prefers-color-scheme` (the app reads `localStorage` then falls back to a
VS Code signal that never exists in a browser, `lib/theme.ts`).

The 47-beat script becomes a tour **over the real UI**, driven by the same
event replay. The canvas stays the design source of truth until the
[retirement gate](../hosted-preview/README.md) is met.

## Build order

| # | Ships | Gate |
|---|---|---|
| 1 | Name the port; extract `dispatchHostMessage`; composition root | live behaviour byte-identical; zero component changes |
| 2 | Browser host adapter over `memoryDriveHost` | **passes `runHostConformance`** |
| 3 | Honesty boundary — kill silent fallbacks, fix the `/drive` hang | every dead capability states why |
| 4 | Static target — `base`, `_redirects`, theme bootstrap, drop `models.dev` | deep links work on Pages; zero external requests |
| 5 | Mobile shell | usable at 360×640 |
| 6 | Guided tour | runs end to end on a phone |

Gate 2 is the one that matters. If the browser host passes the same
conformance suite as the daemon, this is a second implementation of a
contract. If it does not, it is a mock, and it will drift.

## Rejected

- **A separate demo app.** A third implementation, and the 9 px stage is what
  the second one cost us.
- **Recording and replaying real hub traffic.** Brittle against protocol
  change, and no conformance guarantee.
- **Hosting a real hub.** A different product; see
  [hosted-preview](../hosted-preview/README.md) tier 4 and ADR-0016.
- **Adding message types for the browser host.** If the local host needs a
  message the protocol lacks, the seam is wrong — fix the seam.
