# CLAUDE.md — apps/drivemode-mcp

Guidance for Claude Code (and other coding agents) working in this app.

`AGENTS.md` is the short mission/do/don't contract; this file is the longer
orientation. Read both. Where they disagree, `AGENTS.md` wins. The monorepo's
root `CLAUDE.md` and `AGENTS.md` apply on top of both.

@AGENTS.md

---

## What this app is

Drive Mode MCP is the **agent → stage write path**. It turns MCP tool calls from
any host (Cursor, Claude Desktop, Claude Code, an SDK agent) into typed room
events, and serves those events to viewers so a human sees a live, shared
Spotlight of what several agents are doing.

```text
Agent host(s) --MCP stdio--> mcp-stdio proxy --HTTP /rpc--> Writer (single)
                                                              |  events + seq
                                                              v
                                                          Viewer(s)  (SSE)
```

All room semantics — schemas, the fold, policies — live in the monorepo's
kernel: the Drive schemas in `@cline/shared` (`sdk/packages/shared/src/drive`)
and the room kernel in `@cline/drive` (`sdk/packages/drive`). This app is the
**host**: transport, a single-writer store (no-Hub profile), pack validation,
and a reference UI. **Do not re-implement `reduceRoom` here.**

When a Cline Hub is live for the same room, Hub is the writer (ADR-0057). This
MCP writer is the standalone profile for hosts without Hub.

### History

This app was the standalone repository `drive-mode/drivemode-mcp` until
September 2026, when it moved in-tree so it could depend on the kernel as a
workspace package instead of a generated `file:` bundle of a sibling checkout.
The standalone repository is frozen and public (Apache-2.0); its history is
the history of this directory.

## Setup

Nothing beyond the monorepo's setup. The kernel resolves through the built
workspace packages, so run the SDK build first:

```bash
bun install --frozen-lockfile
bun run build:sdk
```

## Commands

From the monorepo root:

```bash
bun -F @cline/drivemode-mcp typecheck   # writer + packs + tests, then the viewer
bun -F @cline/drivemode-mcp test        # tests/ (bun:test)
bun -F @cline/drivemode-mcp check       # both
bun -F @cline/drivemode-mcp writer      # start the single-room writer (prints live URLs)
bun -F @cline/drivemode-mcp viewer      # Vite dev server for the reference viewer
bun -F @cline/drivemode-mcp mcp         # MCP stdio proxy -> DRIVEMODE_WRITER_URL
```

From this directory the same scripts run with `bun run <script>`, and the
demo harness lives here too:

```bash
node demo/demo.mjs doctor       # demo prerequisites, with the fix for each
node demo/demo.mjs record       # start the stack, film the demo, encode an MP4
node demo/demo.mjs down         # stop whatever the demo started
```

Typical three-terminal loop:

```bash
# 1) writer — prints an ephemeral port; read the URL from the terminal
bun run writer

# 2) viewer
DRIVEMODE_WRITER_URL=http://127.0.0.1:<printed-port> bun run viewer

# 3) MCP stdio for Cursor / Claude Desktop
DRIVEMODE_WRITER_URL=http://127.0.0.1:<printed-port> bun run mcp
```

Sample host configs: `examples/cursor-mcp.json`, `examples/claude-desktop.json`.
On start the writer also drops a discovery file at `~/.drivemode/writer.json`
(`url`, `port`, `roomId`, `pid`, `startedAt`).

## Layout

```text
apps/writer/src/
  cli.ts          # process entry: build store -> service -> HTTP, write discovery file, print URLs
  store.ts        # WriterStore — append-only log, seq counter, snapshot via reduceRoom
  roomService.ts  # the real API surface; pack registry + work-event mapping (largest file)
  http.ts         # Bun.serve: /health /snapshot /rpc /events (SSE) /api/raise-hand
  mcpServer.ts    # MCP tool definitions (in-process server)
  mcp-stdio.ts    # stdio façade that proxies every tool to a running writer's /rpc
apps/viewer/src/  # React 19 + Vite reference UI (roster + Spotlight + feed)
packages/packs-*/ # per-domain Zod validators for work payloads
tests/            # acceptance.test.ts, packs-fleet.test.ts, subscriber-isolation.test.ts
demo/             # end-to-end demo: scenario, iPhone recreation, recorder
examples/         # MCP host configs
```

Workspace members: `@cline/drivemode-mcp` (this directory), `@drivemode/writer`,
`@drivemode/viewer`, and the five `@drivemode/packs-*` packages. They are
private; nothing here is published.

### The single writer

`createWriterStore` owns one room (`roomId: "default"`). `append(event)`:
assigns the next `seq`, pushes a room `DriveLogEnvelope`, folds it with the
kernel's `reduceRoom`, and notifies subscribers. `seq` is the resume cursor —
clients call `events_since` / `GET /events?since=N` and never guess from a wall
clock.

`control.end` is **idempotent** until a successful `control.join` reopens the
room; that mirrors the Cline coordinator so folds agree across hosts. Keep it
that way — configuration calls and rejected ops must not authorize a second
`control.end` append.

Conversation bodies live in an in-memory feed capped at 200 entries and are never
written to the log's durable payloads.

### Packs

A pack is a Zod validator for `work.*` payloads, registered in `roomService.ts`'s
`packs` map. `stage_publish_work` validates against the active pack (or an
explicit `packId`) and then maps the result onto kernel events. Coding pack
`work.plan` / `work.test` become `work.plan_step` / `work.test_result`. The
kernel never special-cases a pack — fleet packs ride `work.generic`.

| Pack id | Work types |
|---|---|
| `coding` | `work.edit` `work.command` `work.test` `work.plan` `work.decision` `work.generic` |
| `demo-ops` | `work.ops.alert` `work.ops.runbook_step` |
| `tasks` | `work.task.created` `work.task.state` `work.task.progress` |
| `artifacts` | `work.artifact.created` `work.artifact.lifecycle` `work.artifact.superseded` |
| `direction` | `work.direction.beat` |

Adding a pack: new `packages/packs-<name>/` (mirror an existing one's
`package.json`/`tsconfig.json`), export `{ id, schemaVersion, validate }`, add it
to `apps/writer/package.json` dependencies and the `packs` map, add the
`packId` branch that maps validated payloads to events, and cover it in
`tests/packs-fleet.test.ts`. Packs use the same `zod` major as `@cline/shared`
(v4): `z.record` takes the key schema first.

### MCP tools

Grouped by primitive; defined in `mcpServer.ts`, dispatched in `http.ts`, and
implemented in `roomService.ts`.

| Primitive | Tools |
|---|---|
| Presence | `room_join` `room_leave` `room_snapshot` `room_end` |
| Roster | `roster_list` `roster_set_profile` |
| Address | `address_set` |
| Spotlight | `stage_publish_work` `stage_set_sharer` |
| Titles | `title_grant` `title_transfer` `title_revoke` |
| Control | `mode_set` `mode_get` |
| Interrupt | `interrupt_raise` `interrupt_ack` |
| Narration | `conversation_publish` |
| Sessions | `room_invite` `session_create` `session_schedule` `session_start` `session_end` |
| Resume | `events_since` |
| Packs | `pack_set` `pack_list` |

A new tool touches four places: `mcpServer.ts` (definition + input schema),
`http.ts` `dispatchRpc` (the `/rpc` case), `roomService.ts` (behavior), and
`mcp-stdio.ts` (the proxied tool). Miss one and the tool works over HTTP but not
over stdio, or vice versa.

## The demo

`demo/` is the end-to-end demo and its recorder. It exercises every MCP
primitive and all five packs against a running writer, and films the reference
viewer beside a web recreation of the SwiftUI phone client — both folding the
same event log. Nothing is seeded into a UI; the harness only makes `/rpc`
calls, so if it works in the demo it works from an MCP host.

`node demo/demo.mjs` is the single entry point (`doctor`, `up`, `status`,
`play`, `record`, `down`). A scenario is a plain module exporting `chapters`
(and optionally `phoneSurface`); the contract is in [`demo/README.md`](demo/README.md).

The phone is a **web recreation**, labelled as such on screen: `drive-ios` is
SwiftUI and lives in its own repository. `demo/ios/fold.js` is a 1:1 port of
`apply(wireEvent:)` from that repo's `WriterClient.swift`, so it is evidence
the wire carries what the phone needs. If the fold there drifts from the Swift
one, the demo stops being evidence of anything.

## Conventions

- **Bun-first**, ESM, TypeScript `strict`. Biome from the monorepo root
  (tabs, double quotes, semicolons); `bun run fix` rather than hand-formatting.
- Exhaustive `switch` with a `never` default; imports at the top of the file only.
- Validate before appending. A pack payload that does not parse must throw
  rather than reach the log.
- The writer is the single room truth. MCP is a **façade** (`/rpc` + stdio
  proxy) — it must not accumulate its own state.
- Errors cross `/rpc` as `{ ok: false, error }` with HTTP 400; the stdio proxy
  turns that into an MCP `isError` result. Keep both paths.

## Hard rules

- **One writer per room.** Do not add a second authority or a client-side cache
  that can disagree with the log.
- **Tools append events, never HTML/UI blobs.** The stage is typed events; the
  viewer renders them.
- **No prompts, tool allowlists, API keys, endpoints, or model IDs through MCP.**
  Profiles carry appearance plus a sanitized runtime badge only.
- **Privacy-strict.** Conversation bodies stay in memory; no transcript or audio
  persistence without an explicit debug flag.
- **No magic ports as identity.** The HTTP port is ephemeral by default
  (`DRIVEMODE_HTTP_PORT` overrides). Always use the printed URL or
  `~/.drivemode/writer.json`. Never hardcode `:7891`.
- **Depend on the kernel, do not copy it.** Import `reduceRoom` and friends
  from `@cline/drive` and the schemas from `@cline/shared`; never re-implement
  the fold here.

## Gotchas

- **`bun run build:sdk` after a kernel edit.** The workspace packages resolve
  through `dist/`, so a change in `sdk/packages/drive` or `sdk/packages/shared`
  is invisible here until the SDK is rebuilt.
- **zod is v4 here.** It has to match the major `@cline/shared` uses, or the MCP
  SDK's tool typings compare two zod instances and TypeScript never finishes
  (`Type instantiation is excessively deep`).
- **The writer is in-memory.** It resets on restart; there is no SQLite log.
  Cross-restart durability is not a v0 goal.
- `bun test` from this directory runs `tests/` only. The viewer has no test
  suite — its typecheck is part of `bun run typecheck`.
- README examples show an ephemeral port placeholder; do not copy a literal port
  into code or docs.

## Non-goals (v0)

Multi-room, auth, a durable SQLite log, voice/WebRTC, and a Cline hub bridge are
deliberately out of scope. If a change needs one of these, raise it rather than
sneaking it in.

## Before you push

```bash
bun run build:sdk                      # if the kernel changed
bun -F @cline/drivemode-mcp check      # typecheck + test
```

`drive-ci` runs the same two commands as the `MCP writer` job whenever this
directory, the kernel, or the shared schemas change.
