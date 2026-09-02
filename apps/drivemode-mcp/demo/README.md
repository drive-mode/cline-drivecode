# The end-to-end Drive Mode demo

A single narrative — a human steering four agents through one change — played
through **every client at once**, and recorded.

Everything on screen is produced by MCP tool calls against a running writer.
There are no fixtures, no seeded UI state and no scripted animation: the clients
render whatever the writer's append-only log says, and the log is built only by
the calls in `scenario.mjs`.

## What it shows

| Surface | What it is | Status |
|---|---|---|
| Reference viewer | `apps/viewer` — React + SSE | the real app, running |
| Drive for iPhone | `ios/` in this folder | **web recreation** — see below |
| Cline hub dashboard | `cline-drivecode` `apps/cline-hub` | the real app, running |

### About the iPhone surface

`drive-ios` is a SwiftUI app. Building or booting it needs Xcode and macOS, so
on Linux it cannot run at all. Rather than skip the phone, `ios/` is a web
recreation of the client:

- `ios/fold.js` is a deliberate 1:1 port of `apply(wireEvent:)` from
  `drive-ios/Sources/WriterClient.swift` — the same event names, guards, TTL
  arithmetic and working-set caps.
- It polls `POST /rpc { tool: "events_since" }` with a strictly-after cursor and
  resyncs from zero when `latestSeq` goes backwards, exactly as `pollWire()`
  does, on the same adaptive cadence tiers.
- Styling uses the `DT` tokens from `drive-ios/Sources/Theme.swift`.

It is labelled as a recreation on screen and in the video. It is evidence that
the wire carries what the phone needs; it is **not** evidence that the shipping
Swift app builds.

## Run it

Recording needs **Playwright** and a **full ffmpeg** — Playwright bundles a
VP8-only build that cannot write MP4 — plus the built SDK packages the writer
resolves the kernel through (`bun run build:sdk` at the monorepo root).
`doctor` checks all of it and prints the fix for whatever is missing, so start
there rather than reading a setup list.

One entry point. It knows the start order, the pinned ports, the identity
checks and the clean-writer reset, so you do not have to.

```bash
node demo/demo.mjs doctor    # what is missing before you can record
node demo/demo.mjs up        # start the stack, in order, verified
node demo/demo.mjs status    # what is actually running right now
node demo/demo.mjs play      # run the scenario against the live stack
node demo/demo.mjs record    # up (if needed) -> film -> encode -> MP4
node demo/demo.mjs down      # stop everything it started
```

Options: `--scenario <path>`, `--chapter <id>`, `--out <dir>`, `--pace <ms>`,
`--no-hub`, `--keep-writer`.

`play` and `record` restart the writer first, so they are repeatable rather than
once-per-boot: the writer is in-memory and the scenario reuses fixed grant ids,
so replaying onto a writer that already holds a run makes the Presenter guard
reject the handoff — correctly. `--keep-writer` opts out when you want to stack
a second story onto a live room.

### What `up` is protecting you from

Three traps, each of which cost a recording before it was automated:

- **The hub starts first.** It announces its webview port *before* binding it,
  so if something else wins that bind the hub keeps proxying the port it
  announced and serves the other app's bundle inside its own shell — right
  title, right chrome, wrong app.
- **The viewer gets a pinned port** well away from 5173 for the same reason.
- **Both browser surfaces are identity-checked by page title** before anything
  is filmed. A three-minute recording of the wrong app looks completely fine.

`down` only stops what `demo.mjs` started. If a previous hand-rolled run left
something holding a port, `doctor` will not see it but the hub will say
`preferred port ... is busy` — free it yourself (`fuser -n tcp 5173`) and run
`up` again.

Running the pieces by hand is still possible — `serve.mjs`, `run-scenario.mjs`
and `record.mjs` all work standalone, and `make-video.sh` re-encodes segments
that are already filmed — but the ordering rules above are then yours to
remember.

## Writing a new demo

A scenario is a plain module. To tell a different story, copy `scenario.mjs`,
edit it, and point the rig at it:

```bash
node demo/demo.mjs record --scenario ./my-story.mjs
```

It must export:

```js
export const chapters = [
  {
    id: "lobby",                  // stable id; --chapter refers to it
    title: "The room opens",      // the caption headline
    blurb: "One line of why...",  // the caption body
    async run() { /* MCP calls */ },
  },
];

// Optional: which phone surface each chapter is about. The recorder presses
// the phone's tab bar to bring it up before the chapter runs.
export const phoneSurface = { lobby: "agents" };
```

Rules worth knowing before you write one:

- **Chapters are ordered and cumulative.** Later ones act on room state earlier
  ones built. That is why `--chapter` replays a prefix rather than one chapter.
- **Everything goes through `rpc()`** from `rpc.mjs` — the same `/rpc` surface an
  MCP host uses. If it does not work there, it does not belong in a demo.
- **The writer enforces its own rules.** An agent cannot take the stage without
  an active Presenter grant, and pack payloads are validated before they are
  appended. A scenario that cheats simply fails, which is the point.
- **Pace with `beat()`**, not fixed sleeps, so `--pace` still controls the whole
  story.

## The scenario

Eleven chapters, chosen to cover every MCP primitive and all five packs.

| Chapter | Covers |
|---|---|
| `lobby` | `room_join`, `roster_set_profile` |
| `session` | `mode_set`, `session_create` / `_schedule` / `_start` |
| `presenter` | `title_grant`, `stage_set_sharer` |
| `taskgraph` | tasks pack — identity, state, dependency edges |
| `coding` | coding pack — plan, decision, edit, command |
| `interrupt` | `interrupt_raise`, `interrupt_ack` |
| `handoff` | `address_set`, `title_transfer` (atomic) |
| `tests` | coding pack test results — one red, one fix, one green |
| `artifacts` | artifacts pack — permanent vs TTL, superseded, archived |
| `ops` | demo-ops pack, `room_invite` — a different pack, same stage |
| `close` | `title_revoke`, `session_end` |

Direction beats (`direction` pack) are published throughout; they are what the
phone's Spotlight renders as a replayable program.

### Presenter is enforced, not decorative

The scenario cannot cheat the Presenter rule. `stage_set_sharer` for an agent is
rejected outright unless that agent holds an **active** grant, so the title has
to be chained through the fleet — granted to Atlas, then transferred Atlas →
Beacon → Cinder → Delta, then revoked. An early draft of this scenario tried to
put an agent on the stage without a grant and the writer refused it.

## Four bugs this demo surfaced

All were found by running the real clients against the real writer. The fixes
themselves live in a separate change against `apps/writer` and `apps/viewer` —
this folder adds no product code — but they are recorded here because the demo
is what surfaced them, and because the demo does not work without them.

1. **The reference viewer could not reach its own writer.** The writer sent no
   CORS headers, and the viewer is a browser app documented to be pointed at the
   writer by URL — so every fetch was a blocked cross-origin request and the
   viewer sat empty forever. `apps/writer/src/http.ts` now answers preflights
   and sets the headers on every response.

2. **The SSE `hello` message had a different shape than every message after
   it.** `hello` carried the `/snapshot` envelope (`{ seq, room, … }`) while the
   per-event messages carried a bare `RoomSnapshot`. The viewer assigned both to
   the same state, so the first message crashed it with
   `Cannot read properties of undefined (reading 'find')`. `hello` now sends
   `.room`, matching the stream's own contract.

3. **Every SSE stream died after about ten seconds of quiet.** The server closes
   a connection that carries no traffic, and the writer sent nothing between
   events — so a viewer left open on a quiet room lost its stream and
   reconnected in a loop. Measured before the fix: an idle stream was torn down
   at 12s. `/events` now sends a `: ping` comment every 5s, which EventSource
   ignores, so it keeps the connection warm without ever reaching `onmessage`.
   The same stream now survives indefinitely.

4. **A dead SSE stream could fail an unrelated write.** `store.append` fans out
   to subscribers *after* it has already pushed the entry and folded the
   snapshot, and it did so with no guard. A closed stream's `enqueue` throws, so
   one abandoned viewer could make a later `append` report failure for a write
   that had in fact landed — and every subscriber after it in the set silently
   missed that event. A throwing subscriber is now dropped and the append
   carries on, and the stream itself has one idempotent teardown that
   unsubscribes rather than only clearing its heartbeat.

A fifth, smaller fix: the viewer left a stale "SSE disconnected" banner up
after the stream recovered, because nothing cleared the error when messages
resumed.
