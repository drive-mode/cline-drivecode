# ADR-0043 · Trusted managed manual compaction authority

**Status:** Proposed

**Date:** 2026-08-15

**Owner:** Harrison / Cline runtime owner
**Related:** [ADR-0041](ADR-0041-cross-session-chat-catalog-authority.md), [ADR-0042](ADR-0042-managed-session-reconnect-authority.md), [runtime parity companion](../initiatives/cross-session-chat-management/runtime-parity-companion-design.md), FR-056, REL-032

## Context

The managed runtime wire already reserves `chat_runtime.compaction.run`, but it
fails closed. Existing CLI and VS Code callers implement manual compaction by
reading a transcript, selecting provider/model configuration, running the
compactor, and writing a compaction sidecar. That is valid for a trusted local
owner, but it is not a safe managed protocol: a remote caller must not receive
raw messages, choose credentials or strategy, upload compaction state, or race
the resident runtime's turn, stop, reconnect, renewal, and writer fences.

Manual compaction can invoke a nondeterministic provider and then select a new
sidecar as the working-context projection for later turns. A lost reply can
therefore duplicate paid work unless the operation ID has authoritative replay
semantics. The selected sidecar becomes authoritative at the SQLite writer-head
commit, not at the later manifest mirror update.

## Constraints

- The managed wire accepts only operation ID, session ID, and bounded audit
  reason; it accepts no transcript, prompt, provider configuration, callback,
  writer credential, summary, or sidecar.
- Production profile and policy epoch choose whether manual compaction is
  allowed and which daemon-owned compactor may run.
- Compaction is per-session exclusive but must not block unrelated sessions.
- Canonical transcript data is unchanged; the committed sidecar only changes
  the next-turn working-context projection.
- No old owner or writer generation may commit after stop or reconnect wins.
- Provider, filesystem, hook, and transcript errors never enter wire events.
- The global managed-chat release gate remains hard off.

## Decision

### 1. Put orchestration inside the resident host

The managed adapter validates connection ownership and stable operation intent,
then invokes one narrow ClineCore facade. The facade delegates to a host-owned
manual-compaction transaction. The adapter never reads raw messages and never
writes compaction state.

The host obtains the canonical transcript, provider/model credentials,
compaction strategy, tools, system prompt, writer lease, and persistence backend
from the already-admitted resident session. Client-contributed compactors and
generic runtime callbacks are forbidden for this slice.

### 2. Use one per-session exclusive admission decision

Manual compaction and turn admission are mutually exclusive:

1. reject if a run, producer, writer transition, stop, quiescence, or another
   compaction is active;
2. reserve one host operation synchronously before any await;
3. drain prior writer mutations before taking the transcript snapshot;
4. reject new turns while compaction is active; and
5. register the operation with the host activity drain so stop and rekey cannot
   remove or replace authority beneath an untracked continuation.

Stop before commit aborts and drains compaction. Rekey closes admission and
waits for compaction to settle. A same-generation renewal may proceed, but the
commit verifies and uses the resident lease current at commit time.

### 3. Never restore or replace the canonical transcript

Manual compaction computes from the full canonical persisted transcript. It
must call the internal writer-fenced sidecar persistence path directly. It must
not call the public `updateSessionCompactionState` orchestration, because that
compatibility API may call `agent.restore(...)` while reconciling an external
state update. A successful manual compaction updates only the resident
compaction state after the authoritative sidecar-head commit.

### 4. Make operation replay durable and commit-coupled

The terminal implementation must persist an operation record whose stable
primary identity is:

`session + operation kind + operation ID`.

The record also binds the writer generation that admitted it and the immutable
intent digest. Writer generation must not be part of the sole primary key:
otherwise the same caller operation could be inserted again after takeover and
repeat provider work.

The intent digest covers the bounded reason and server-selected compaction
policy identity. It excludes credentials, function bodies, and transcript data.

Before provider invocation, the host inserts `running`. Identical concurrent
requests coalesce in process. A completed or skipped replay returns the same
sanitized terminal result without provider work, persistence, or duplicate
events. Changed intent conflicts. A `running` record found after process loss is
changed to `indeterminate`; it is never automatically executed again.

For a completed operation, sidecar-head selection and the terminal operation
receipt commit in the same SQLite transaction under the current writer fence.
Candidate-file creation happens before that transaction. Manifest mirroring is
a repairable projection and cannot turn an authoritative commit into a reported
failure.

### 5. Return a synchronous terminal result

Before the v1 gate opens, change the command result from an ambiguous
`accepted: true` receipt to:

```ts
{
  sessionId: string
  operationId: string
  outcome: "completed" | "skipped"
  state?: SanitizedCompactionSummary
}
```

The initiating connection receives exactly one `compaction.started` and one of
`compaction.completed`, `compaction.skipped`, or `compaction.failed`. Replays do
not emit events. Failure events use a fixed safe message. If callers later need
recovery for failed, cancelled, or indeterminate operations, add an explicit
bounded status read rather than overloading `compaction.get`.

### 6. Bind policy continuity

The daemon execution-policy digest must include manual-compaction permission,
strategy, summarizer identity, and the prohibition on client callbacks. A
policy change requires the existing explicit `config_restart` successor; a
resident session never silently inherits a different compaction authority.

## Options considered

| Option | Complexity | Authority and race properties | Decision |
|---|---:|---|---|
| Adapter reads messages, compacts, then calls public update | Low | Exposes orchestration above the host and can restore live agent state across run/stop races | Rejected |
| Send `/compact` as a synthetic turn | Low | Lets the model improvise text; no sidecar authority or deterministic persistence | Rejected |
| Reuse generic callback transport for a client compactor | Medium | Exports raw transcript context and depends on callback authority not yet implemented | Rejected |
| Host-owned exclusive transaction with durable receipt | High | Keeps secrets local, shares lifecycle/writer barriers, and gives deterministic replay | Selected |
| Keep command unsupported | Low | Safe interim but fails required interactive parity | Current rollback only |

## Consequences

### Positive

- Managed clients request an action without becoming compaction authorities.
- Turns, stop, reconnect, renewal, and compaction share one resident lifecycle.
- Canonical messages remain unchanged and cannot be replaced mid-turn.
- Successful lost replies are recoverable without duplicate provider work.
- Events and results contain only strict sanitized summaries.

### Costs and risks

- Persistence needs a new durable operation record and an atomic
  sidecar-head-plus-receipt transaction.
- Process-loss `running` operations are indeterminate because provider-side
  exactly-once invocation is unavailable.
- The production profile digest and all profile continuity tests must expand.
- Legacy local manual-compaction coordinators remain compatibility callers until
  PC-6/PC-8 cutover; they cannot be used on a scoped managed socket.

## Required implementation and proof

1. Add the host-owned facade and direct internal persistence path.
2. Add per-session compaction admission and run/stop/rekey/renew race tests.
3. Add durable running/completed/skipped/failed/indeterminate receipts.
4. Atomically select the sidecar head and terminal receipt under writer fence.
5. Change the strict result to a terminal outcome and add explicit skipped
   events before the v1 gate opens.
6. Bind compaction authority into production profile policy continuity.
7. Prove wrong-owner denial, changed-intent conflict, lost-reply replay,
   process-loss indeterminate behavior, fixed safe failures, no agent restore,
   no raw event fields, and unrelated-session concurrency.
8. Keep `managedChatLifecycleEnabled: false` until later PC gates pass.

## Implementation checkpoint

The second behind-gate checkpoint implements the narrow ClineCore/RuntimeHost
facade, daemon-owned provider/config selection, per-session in-process
exclusivity, disconnect cancellation, and direct writer-fenced persistence
without `agent.restore`. SQLite now owns durable
`running | completed | skipped | failed | indeterminate` receipts. A fresh
claim commits before transcript/provider work; a process-loss observation
becomes `indeterminate`; terminal replay performs no provider work, write, or
lifecycle event; and changed intent conflicts across writer generations.

Completed sidecar-head selection and the completed receipt now share one
writer-fenced SQLite transaction. Candidate files are removed when that
transaction fails, and manifest mirroring is a repairable projection that
cannot reverse an authoritative success. Replay reads the exact immutable
sidecar named by the receipt and fails closed if it is missing, malformed, or
does not match the receipt's cryptographic state digest. A forced SQLite trigger
regression proves head and receipt rollback together.

Resident startup now performs fenced recovery before operation admission,
changing every orphaned `running` receipt to `indeterminate`. Ordinary claims
never perform recovery: they return `in_progress` when any operation is already
running. A partial unique index enforces one running manual compaction per
session even across host/store instances.

The adapter emits `started` only after a fresh durable claim and emits `failed`
only after the host confirms the failed receipt committed. Completed, skipped,
failed, and indeterminate replays emit no lifecycle events. The managed
execution-policy digest binds explicit permission, strategy, preserve budget,
summarizer identity, and the prohibition on client callbacks.

This ADR remains **Proposed**. Production profile authorization, the complete
stop/rekey/renew/process-loss race matrix remain release blockers. Independent
adversarial re-review of this checkpoint found no remaining P0/P1/P2. The host still
requires explicit `enabled: true`, and production daemon profiles intentionally
omit that grant.

## Rollback

Remove the adapter dispatch and return `unsupported_capability`. Existing local
CLI and VS Code coordinators continue to work. Do not delete committed sidecars
or reinterpret operation IDs. The global gate remains off, so rollback exposes
no partially supported managed protocol.
