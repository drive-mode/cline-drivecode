# Scheduling and Automation

Cline has **two scheduling paths**. Product hosts use Hub `schedule.*`; embedders that need in-process file/event automation use `cline.automation`.

| Path | Canonical for | Surface |
|------|---------------|---------|
| Hub `schedule.*` | CLI, Hub UI, Desktop routines | Hub WebSocket commands / `HubSessionClient` |
| `cline.automation` | SDK embedders (local CronService) | `ClineCore.create({ automation: true })` + Markdown specs |

Do **not** replace Hub product schedules with `cline.automation` (integration decision **D2**).

## Product path: CLI + Hub schedules

```bash
# Create a recurring schedule
cline schedule create "Daily standup" \
  --cron "0 9 * * MON-FRI" \
  --prompt "Summarize open PRs and blockers" \
  --workspace /path/to/project \
  --model anthropic/claude-sonnet-4-6

# List schedules
cline schedule list

# Trigger a schedule immediately
cline schedule trigger <schedule-id>

# Pause/resume (maps to schedule.disable / schedule.enable)
cline schedule pause <schedule-id>
cline schedule resume <schedule-id>

# Delete
cline schedule delete <schedule-id>

# View past executions
cline schedule executions <schedule-id>
```

The CLI ensures a hub daemon and issues Hub commands (`schedule.create`, `schedule.list`, …). Desktop and Hub dashboard use the same command surface.

### Programmatic Hub API

```typescript
import {
  ensureDetachedHubServer,
  HubSessionClient,
} from "@cline/sdk"

const hub = await ensureDetachedHubServer(process.cwd())
const client = new HubSessionClient({
  address: hub.url,
  authToken: hub.authToken,
  clientId: "my-scheduler",
  workspaceRoot: process.cwd(),
})

try {
  await client.createSchedule({
    name: "Daily standup",
    cronPattern: "0 9 * * MON-FRI",
    prompt: "Summarize open PRs and blockers",
    workspaceRoot: process.cwd(),
    mode: "yolo",
  })
  await client.listSchedules()
} finally {
  client.close()
}
```

| Method | Hub command |
|--------|-------------|
| `createSchedule` | `schedule.create` |
| `listSchedules` | `schedule.list` |
| `getSchedule` | `schedule.get` |
| `updateSchedule` | `schedule.update` |
| `pauseSchedule` | `schedule.disable` |
| `resumeSchedule` | `schedule.enable` |
| `deleteSchedule` | `schedule.delete` |
| `triggerScheduleNow` | `schedule.trigger` |
| `listScheduleExecutions` | `schedule.list_executions` |

Create input shape: `HubScheduleCreateInput` in `@cline/shared`.

## Cron Expressions

| Expression | Meaning |
|-----------|---------|
| `0 9 * * MON-FRI` | 9 AM weekdays |
| `0 */6 * * *` | Every 6 hours |
| `0 8 * * MON` | Mondays at 8 AM |
| `*/30 * * * *` | Every 30 minutes |
| `0 0 1 * *` | First of every month |

## Embedder path: file-based specs + `cline.automation`

Create Markdown files in `~/.cline/cron/` (global) or `.cline/cron/` (workspace). These feed `CronService` / `cline.automation`, **not** the Hub `schedule.*` table.

### Trigger types

| Trigger | Description |
|---------|-------------|
| `schedule` | Recurring jobs via cron expressions |
| `one_off` | Single execution tasks |
| `event` | Triggered by external events (GitHub, Linear, custom) |

### Recurring Schedule

```markdown
---
trigger: schedule
schedule: "0 9 * * MON-FRI"
timezone: America/New_York
mode: exclusive
prompt: "Check for dependency updates and create PRs for any outdated packages."
modelSelection:
  providerId: anthropic
  modelId: claude-sonnet-4-6
tools:
  enabled: true
---

Additional context or instructions for the agent go in the body.
```

### One-Off Task

```markdown
---
trigger: one_off
prompt: "Generate a comprehensive test coverage report."
modelSelection:
  providerId: anthropic
  modelId: claude-sonnet-4-6
---
```

### Event-Driven

```markdown
---
trigger: event
eventType: github.pull_request.opened
filters:
  repository: myorg/myrepo
debounceMs: 5000
cooldownMs: 60000
prompt: "Review the PR for security issues and code quality."
modelSelection:
  providerId: anthropic
  modelId: claude-sonnet-4-6
---
```

## CronSpec Types

```typescript
interface CronScheduleSpec {
  trigger: "schedule"
  schedule: string              // cron expression
  timezone?: string
  mode?: "exclusive" | "concurrent"
  prompt: string
  modelSelection?: { providerId: string; modelId?: string }
  extensionLoading?: "isolated" | "direct"
  configExtensions?: RuntimeConfigExtensionKind[]
  tools?: { enabled?: boolean; names?: string[] }
}

interface CronOneOffSpec {
  trigger: "one_off"
  prompt: string
  modelSelection?: { providerId: string; modelId?: string }
}

interface CronEventSpec {
  trigger: "event"
  eventType: string             // e.g., "github.pull_request.opened"
  filters?: Record<string, unknown>
  debounceMs?: number
  cooldownMs?: number
  prompt: string
  modelSelection?: { providerId: string; modelId?: string }
}
```

## Programmatic Automation API

```typescript
const cline = await ClineCore.create({
  clientName: "my-app",
  automation: true,
})

await cline.automation.start()
await cline.automation.reconcileNow()

cline.automation.ingestEvent({
  eventId: "evt-123",
  eventType: "github.pull_request.opened",
  source: "github",
  timestamp: Date.now(),
  payload: { pr: { number: 42, title: "..." } },
})

const specs = cline.automation.listSpecs()
const runs = cline.automation.listRuns()
const events = cline.automation.listEvents()

await cline.automation.stop()
await cline.dispose()
```

`ClineCoreAutomationApi`: `start`, `stop`, `reconcileNow`, `ingestEvent`, `listEvents`, `getEvent`, `listSpecs`, `listRuns`. There is no `reconcile(directory)` — reconciliation uses the configured cron scope/directory from automation options.

## Event Ingestion from Plugins

Plugins can declare and emit automation events:

```typescript
const webhookPlugin: AgentPlugin = {
  name: "webhook-events",
  manifest: { capabilities: ["automationEvents"] },
  setup(api) {
    api.registerAutomationEventType({
      type: "webhook.received",
      description: "External webhook received",
    })
  },
}
```

Submit events via the plugin context:

```typescript
ctx.automation.ingestEvent({
  eventId: "evt-456",
  eventType: "webhook.received",
  source: "custom",
  timestamp: Date.now(),
  payload: { ... },
})
```

## Concurrency Control (automation specs)

| Mode | Behavior |
|------|----------|
| `"exclusive"` | Skip if previous run still active |
| `"concurrent"` | Allow overlapping runs |

Hub product schedules use `maxParallel` / runtime options on `HubScheduleCreateInput` instead.

## Run Reports (automation)

Each completed automation run writes a Markdown report to `.cline/cron/reports/<run-id>.md` with:
- Run metadata (spec, trigger, timing)
- Summary of agent output
- Usage (tokens, cost)
- Tool calls made
- Trigger event context (for event-driven runs)

## Use Cases

- Daily standup summaries (prefer CLI / Hub schedules in product)
- Automated dependency update checks
- PR review on open (automation event specs or connectors)
- Codebase health reports
- Scheduled security scans
- Event-driven CI/CD workflows (embedder automation)

## See Also

- Public guide: `docs/sdk/guides/scheduled-agents.mdx`
- `../clinecore/REFERENCE.md` - ClineCore runtime
- `../clinecore/api.md` - Automation API details
- `../plugins/REFERENCE.md` - Plugin events
- `../production/REFERENCE.md` - Production deployment
