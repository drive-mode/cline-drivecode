# Multi-Agent Coordination

The Cline SDK supports two models for multi-agent work: sub-agents (parent-child) and teams (peer-to-peer).

## Sub-Agents vs Teams

| Feature | Sub-Agents | Teams |
|---------|-----------|-------|
| Enable with | `enableSpawnAgent: true` | `enableAgentTeams: true` |
| Persistence | Session-scoped only | Across sessions |
| Coordination | Parent-child hierarchy | Peer-to-peer |
| Shared state | None | Task board, mailbox, mission log |
| Best for | One-off delegation | Complex multi-session projects |

## Sub-Agents

Sub-agents are spawned by a parent agent during a run. They execute independently and report results back.

### Enabling Sub-Agents

```typescript
const cline = await ClineCore.create({ clientName: "my-app" })

await cline.start({
  prompt: "Refactor the auth module and update tests",
  config: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    enableSpawnAgent: true,
    enableTools: true,
  },
})
```

When `enableSpawnAgent` is true, the agent gets the core sub-agent tool:

| Tool | Description |
|------|-------------|
| `spawn_agent` | Run a delegated sub-agent with `systemPrompt` + `task` and return its result |

> Plugin examples (e.g. `sdk/examples/plugins/agents-squad`) may add richer tools like `start_subagent` / `message_subagent`. Those are **plugin** tools, not Core builtins.

### How Sub-Agents Work

1. The parent agent decides a subtask can be delegated
2. It calls `spawn_agent` with a system prompt and task description
3. The sub-agent runs to completion (or failure) under the parent's tool call
4. The parent receives the sub-agent output and continues

## Teams

Teams provide persistent, cross-session coordination between agents.

### Enabling Teams

```typescript
await cline.start({
  config: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    enableAgentTeams: true,
    teamName: "auth-sprint",
    enableTools: true,
  },
})
```

### Team Tools

When `enableAgentTeams` is true, the coordinator agent gets Core team tools (`TEAM_TOOL_NAMES`), including:

| Tool | Description |
|------|-------------|
| `team_spawn_teammate` | Create a new agent with a role |
| `team_task` / `team_run_task` | Assign / run a task for a teammate |
| `team_status` | Check teammate / run status |
| `team_send_message` / `team_broadcast` | Inter-agent messaging |
| `team_await_runs` / `team_list_runs` | Wait for or list run results |
| `team_mission_log` | Read the coordination log |

See `TEAM_TOOL_NAMES` in `@cline/core` for the full inventory.

### Team Persistence

Teams store shared state in:

```
~/.cline/data/teams/[team-name]/
  task-board.json    # task assignments and status
  mailbox.json       # inter-agent messages
  mission-log.json   # coordination log
```

This state persists across sessions, so team members can pick up where they left off.

### CLI Team Access

```bash
cline --team-name auth-sprint "Continue the auth refactor"
```

## Choosing Between Sub-Agents and Teams

Use sub-agents when:
- You need one-off parallel execution within a single session
- Tasks are independent and don't need to communicate with each other
- Results only matter to the parent agent

Use teams when:
- Work spans multiple sessions over time
- Agents need to coordinate and share progress
- Tasks have dependencies between them
- You want a persistent record of multi-agent collaboration

## Patterns

### Parallel Research with Sub-Agents

A parent agent spawns multiple sub-agents to research different topics simultaneously:

```typescript
await cline.start({
  prompt: `Research these three topics in parallel:
    1. Current best practices for JWT auth
    2. OAuth 2.0 provider comparison
    3. Session management patterns
    Spawn a sub-agent for each topic, then synthesize the results.`,
  config: {
    enableSpawnAgent: true,
    enableTools: true,
    // ...
  },
})
```

### Team Sprint

A coordinator manages a multi-session project:

```typescript
await cline.start({
  prompt: `You are the coordinator for the auth-sprint team.
    Review the task board and delegate the next highest-priority task
    to a teammate. Check status on any in-progress tasks.`,
  config: {
    enableAgentTeams: true,
    teamName: "auth-sprint",
    enableTools: true,
    // ...
  },
})
```

## See Also

- `../clinecore/REFERENCE.md` - ClineCore runtime
- `../clinecore/api.md` - Session config for teams
- `../tools/REFERENCE.md` - Tool system
- `../plugins/REFERENCE.md` - Plugin system
