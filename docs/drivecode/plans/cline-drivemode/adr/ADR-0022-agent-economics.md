# ADR-0022 · Agent economics — context, model and spend per agent

**Status:** Proposed (2026-08-02)
**Owner:** Drivecode SE lead
**Constrained by:** [ADR-0010](ADR-0010-provider-harness-byok.md) (the LLM is
not a Drive provider slot), [ADR-0015](ADR-0015-task-session-observability.md)
(the satisfaction unit is the task, not tokens),
[ADR-0021](ADR-0021-drive-credential-onboarding.md) (credentials live in
Cline's provider settings).
**Evidence:** [research/21-operator-experience.md](../research/21-operator-experience.md).

## Context

A user running a Drive call cannot see what it costs, how much context is
left, or which model any agent is using — and cannot set a budget or pick a
model per agent. This ADR is about closing that, without duplicating what the
SDK already does well.

### What already exists (do not rebuild)

Measurement is real and good:

- Per-request cost from a per-model price table —
  `sdk/packages/llms/src/providers/ai-sdk.ts:645-670`, totalled at `:741-825`.
- A generated catalog carrying `contextWindow` per model —
  `sdk/packages/llms/src/catalog/catalog.generated.ts`.
- **Per-message** usage deltas — `inputTokens`, `outputTokens`, `cacheRead`,
  `cacheWrite`, `reasoningTokenCount`, `cost` —
  `sdk/packages/agents/src/agent-runtime.ts:309-354`.
- Session accumulation — `sdk/packages/core/src/services/usage.ts:14-43`.
- Current context size — `usage.ts:75-87`.

Display exists in two places: the Hub **session list** shows Tokens in / out /
Cost (`App.tsx:1033-1035`), and the **CLI status bar** shows a context fill bar
plus tokens and cost (`status-bar.tsx:187-209`).

### The three real gaps

**1. None of it reaches a Drive surface.** `status-view.tsx` has zero
references to token, cost, model or context. `DriveRoomChrome` receives a
single scalar `providerId` for the whole room. Usage is never correlated with
`callSessionId`.

**2. Context is silently rewritten.** Hub sessions auto-compact by default
(`apps/cline-hub/src/server/compaction.ts:14-20`). `getCurrentContextSize` has
exactly one consumer and it is the CLI. In a Drive room the user gets no
percentage, no warning, and no notice when compaction fires.

**3. The per-agent vocabulary was designed and never connected.**
`.driveagent/<slug>/agent.yaml` already accepts `providerId`, `modelId` and
`maxIterations` (`sdk/packages/shared/src/drive/home/schemas.ts:32-34`) and
`compile.ts:146-150` carries them through — but the only consumer is a
read-only inspection handler
(`drive-home-handlers.ts:57-62`). Nothing feeds them into session start.
`AgentParticipantSchema` is `.strict()` and has no model field, so **two
agents in one room cannot run different models today.** ADR-0018 lists
`budget` on `WorkLease`; `run.ts` has no such field.

The only shipped cost control is `CLINE_MAX_SESSION_COST` — a process-global
env var, per session, off by default, with no UI and **no warning before it
aborts**.

## Decision

**1. Usage becomes a first-class Drive event, keyed by participant.**

Per-message deltas already exist; attribute them to the participant that
caused them and fold them into room state, so the room can answer "what has
this agent cost" without a second accounting system. This is additive to the
existing measurement — we are correlating, not re-measuring.

Per ADR-0015, this does **not** change the satisfaction unit. Tasks remain the
unit of *success*; this is the unit of *resource*. Both can be true.

**2. The call surfaces a session meter: spend, context, model.**

Per the [operator-experience](../research/21-operator-experience.md) trust
ladder, this is rung 2 and it unblocks everything above it. Context is shown
as *remaining*, not consumed, and **compaction is announced** rather than
silent — a user whose context was just rewritten must be told.

**3. Model and budget become per-agent, using the vocabulary that already
exists.**

`agent.yaml`'s `providerId` / `modelId` / `maxIterations` get connected to
session start rather than dead-ending in an inspection handler. This is
consistent with ADR-0010: the *keys* stay in Cline's provider settings; only
the *selection* is per agent. `AgentParticipantSchema` gains the resolved
model for display — a schema rev, so it needs a version bump and a migration
note.

**4. Budgets warn before they act, and are scoped, not global.**

`CLINE_MAX_SESSION_COST` aborting with no warning is the wrong shape for an
interactive product. A budget must surface as it is approached, name what will
happen, and be attributable to an agent or a call rather than the whole hub
process.

## Consequences

- Room state grows a per-participant usage projection. It must be **derived**,
  not a fourth store (ADR-0013).
- A schema rev on `AgentParticipantSchema` ripples to every consumer of the
  room snapshot.
- Showing cost invites a currency and rounding conversation, and prices in the
  catalog drift. Displayed cost is an estimate and should be labelled as one.
- Per-agent models multiply the provider-configuration surface: an agent can
  now be configured for a provider the user has no credential for. That
  failure has to be legible, which ties to
  [ADR-0021](ADR-0021-drive-credential-onboarding.md)'s readiness gate.
- **Instrumentation is chrome, and chrome competes with the stage.** The
  Spotlight already lost that fight once (#130). Where the meter lives is a
  real design decision, not a detail.

## Alternatives rejected

- **Reuse the Hub session list.** It exists and is per session, not per agent,
  and it is a different page from the one where the spending is watched.
- **Build a second accounting system in Drive.** The SDK's numbers are the
  real ones; a parallel count would drift and be wrong in a way nobody notices.
- **Budgets as hard aborts only.** That is `CLINE_MAX_SESSION_COST` today, and
  an abort with no warning reads as a crash.
- **Per-room model instead of per-agent.** Simpler, but the point of a
  multi-agent room is that a cheap model can triage and an expensive one can
  reason. Per-room throws that away.

## Open

1. **Where the meter lives** — in the call chrome, a drawer, or the Status
   Hub. Chrome in the call is the most useful and the most expensive in stage
   height.
2. **Whether budgets are advisory or enforcing** in the beta. Advisory is
   honest while estimates are estimates; enforcing is what makes autonomy
   safe.
3. **Whether spend is per call session or per room across restarts.** Rooms
   are durable now, so "this room has cost you $X" is expressible and possibly
   more useful than per-session.
