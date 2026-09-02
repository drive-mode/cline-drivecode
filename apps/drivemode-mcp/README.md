# Drive Mode MCP

**Agent → stage write path** for live multi-agent presence with visuals. The
writer turns MCP tool calls from any host (Cursor, Claude Desktop, Claude Code,
an SDK agent) into typed room events folded by the Drive kernel
(`@cline/drive`, schemas in `@cline/shared`), and serves them to viewers so a
human sees a live, shared Spotlight of what several agents are doing.

This is the standalone profile for hosts without a Cline Hub. When a Hub is
live for the same room, Hub is the writer.

```text
Agent host(s) --MCP stdio--> mcp-stdio proxy --HTTP /rpc--> Writer (single)
                                                              |  events + seq
                                                              v
                                                          Viewer(s)  (SSE)
```

## Run

From the monorepo root, after `bun install --frozen-lockfile && bun run build:sdk`:

```bash
bun -F @cline/drivemode-mcp writer      # prints an ephemeral URL; read it from the terminal
DRIVEMODE_WRITER_URL=http://127.0.0.1:<printed-port> bun -F @cline/drivemode-mcp viewer
DRIVEMODE_WRITER_URL=http://127.0.0.1:<printed-port> bun -F @cline/drivemode-mcp mcp
```

The writer also writes `~/.drivemode/writer.json` (`url`, `port`, `roomId`,
`pid`, `startedAt`) so clients such as the Drive iOS app can discover it.
Sample host configs are in `examples/`.

## Verify

```bash
bun -F @cline/drivemode-mcp check       # typecheck (writer, packs, tests, viewer) + tests
node demo/demo.mjs doctor               # what the recorded demo still needs
node demo/demo.mjs record               # film the reference viewer beside the phone recreation
```

## Layout

| Path | What |
|---|---|
| `apps/writer/` | The single-room writer: store, room service, HTTP + SSE, MCP tool definitions, stdio proxy |
| `apps/viewer/` | React + Vite reference viewer (roster, Spotlight, feed) |
| `packages/packs-*/` | Zod validators for `work.*` payloads: coding, demo-ops, tasks, artifacts, direction |
| `tests/` | Acceptance, pack and subscriber-isolation tests (`bun:test`) |
| `demo/` | The end-to-end demo and its recorder ([demo/README.md](demo/README.md)) |
| `examples/` | MCP host configs for Cursor and Claude Desktop |

See [CLAUDE.md](CLAUDE.md) for the tools, packs, conventions and hard rules,
and [AGENTS.md](AGENTS.md) for the short contract.

## History

This app was the standalone repository
[`drive-mode/drivemode-mcp`](https://github.com/drive-mode/drivemode-mcp)
until September 2026. It moved in-tree so it could depend on the kernel as a
workspace package instead of a generated bundle of a sibling checkout. The
standalone repository is frozen and public under the Apache License 2.0.
