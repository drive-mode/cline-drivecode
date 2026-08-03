# pair-partner — workspace Driveagent home

The live workspace home the hub resolves for `pair-partner`, seeded from
[the docs example](../../docs/drivecode/plans/cline-drivemode/examples/driveagent-pair-partner/).
Without it the Profile sheet's Capabilities section errors out in this
repository, because `resolveDriveagentHomeDir` finds no `agent.yaml` at either
tier.

See [ADR-0001](../../docs/drivecode/plans/cline-drivemode/adr/ADR-0001-driveagent-home.md)
and [ADR-0002](../../docs/drivecode/plans/cline-drivemode/adr/ADR-0002-agent-graph-canonical-derived.md).

## Layout

```text
.driveagent/pair-partner/
  BRIEF.md                 # what recruit/compile agents may read here
  agent.yaml               # canonical definition
  permissions.yaml         # permission intent — a ceiling; capPreset() enforces
  env.yaml                 # non-secret values plus opaque secretRefs
  knowledge/
    catalog.yaml
    nodes/
    edges.yaml
```

`.derived/graph.json` is compile output and is deliberately absent — ADR-0002
makes it a build artifact, not a checked-in input.

## Editing

`agent.yaml` sets `editable: true`, so the Profile sheet's Configuration
section can write description, tools, skills and the permission block back
here. Saves are merged server-side against these files: a field the editor was
never shown — `systemPrompt` above all — keeps its on-disk value rather than
being cleared by its absence from the payload.

Set `editable: false` to make this home read-only; the hub then refuses the
write rather than accepting it silently.
