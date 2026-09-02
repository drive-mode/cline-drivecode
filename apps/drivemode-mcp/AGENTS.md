# AGENTS.md — apps/drivemode-mcp

## Mission

Ship the **feeling** of live reacting agents on a shared Spotlight for any MCP host. Depend on `@cline/drive` (kernel) and `@cline/shared` (schemas) for protocol and fold. Do not re-implement `reduceRoom` here.

## Do

- Keep the writer the single room truth **in the no-Hub profile**. When a Cline Hub is live for the same room, Hub wins (ADR-0057).
- Validate pack payloads before appending work events.
- Prefer ephemeral ports + printed URLs / `~/.drivemode/writer.json`.
- Exhaustive switches with `never`; imports at top of file.
- Keep `zod` on the same major as `@cline/shared`.

## Do not

- Copy kernel code into this app; import it.
- Hardcode `:7891` or other magic ports as identity.
- Accept prompts, API keys, or model IDs via MCP tools.
- Persist transcripts/audio without an explicit debug flag.

## Verify

```bash
bun run build:sdk                     # after a kernel or schema change
bun -F @cline/drivemode-mcp check     # typecheck + test
```

To see it rather than test it: `node demo/demo.mjs record` films the whole
thing. `node demo/demo.mjs doctor` says what is missing first. Details in
`demo/README.md`.
