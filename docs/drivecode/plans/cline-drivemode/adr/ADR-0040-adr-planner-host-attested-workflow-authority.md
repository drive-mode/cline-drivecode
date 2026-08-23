# ADR-0040 · ADR Planner host-attested workflow authority

**Status:** Proposed — private host-mediated proof; production hardening pending
**Date:** 2026-08-14
**Initiative:** [adr-planner](../initiatives/adr-planner/)
**Plan:** [Milestone 4](../initiatives/adr-planner/milestone-4-implementation-plan.md)
**Depends on:** [ADR-0037](ADR-0037-adr-planner-package-contract.md),
[ADR-0038](ADR-0038-adr-planner-evidence-trust-boundary.md), and
[ADR-0039](ADR-0039-adr-planner-concern-catalog-and-rule-authority.md)

## Context

M3 can derive positive repository facts but cannot safely decide human-owned
facts such as production intent, tenancy, data sensitivity, or external
interfaces. Model-facing tool input cannot supply that authority.

An M4 spike tested `/adr-attest` plus an empty-input compiler. Independent
review found that the current Cline contract does not support the claimed
boundary:

1. the CLI command host and agent runtime load separate plugin instances, so a
   plugin-local store is not shared in the real lifecycle;
2. command handlers receive only a string, with no attributable actor, task,
   thread, or invocation provenance;
3. one command host may serve multiple resets, forks, or connector threads, so
   setup scope is not task scope; and
4. source code bundled with the plugin cannot itself mint a trustworthy
   `host-composed` label when an agent may read and execute that code.

The earlier assumption that “explicit slash command” implied attributable
human authority was false. The spike is retained for deterministic compiler
research but is not registered by the plugin and emits only
`untrusted-command-session` authority internally.

## Proposed decision

Implement a generic, host-owned extension state capability before enabling M4.
The capability is deliberately narrower than a plugin storage API: plugins may
request a mutation or consume a snapshot, but cannot write or label state as
trusted by themselves.

1. The host, not plugin-local memory, owns extension state in SQLite, keyed by
   canonical workspace path, core session/task id, host-derived plugin
   installation id, and state key.
2. A command receives a host-created invocation context containing invocation
   id, source, workspace, session/task id, and actor provenance. Missing session
   identity is fail-closed; a connector command cannot create authoritative
   state before that thread has a core session.
3. A command handler may return a bounded state-mutation *request*. It has no
   state service or database handle. The command host binds the request to the
   registered extension id and real invocation context, validates it, and then
   applies it atomically.
4. Runtime plugin wrappers close over the host session id and registered
   extension id. Immediately before each tool call they read a fresh snapshot,
   discard any caller-supplied extension-state field, and inject the host
   snapshot across the sandbox boundary.
5. Direct package imports bypass both wrappers and therefore receive no
   authoritative state. Serialized artifact labels are never sufficient proof;
   authority is conferred only by the host-mediated execution path.
6. State rows retain bounded provenance metadata and monotonically increasing
   revision. They never store raw command text, briefs, transcripts, actor
   secrets, or arbitrary evidence.
7. Caller JSON cannot supply facts, gates, evidence, policy, decisions, risk
   acceptance, waivers, or readiness state.
8. Host-attested facts may change applicability but never resolve a concern,
   accept an ADR or risk, waive an obligation, or prove implementation.
9. Natural-language briefs and ordinary chat replies remain untrusted context.
10. Contradictory repository and host facts fail closed with no partial plan.
11. Canonical questions, experiments, routed outputs, obligations, next wave,
   JSON, and Markdown remain deterministic and contain no raw transcript or
   volatile execution metadata.
12. Model-facing readiness input can never emit `pass`. A passing gate requires
    a separate host-owned decision/evidence capability that validates identity,
    provenance, freshness, and policy.
13. Until these host contracts and two-load lifecycle tests exist,
    `/adr-attest` and `adr_planner_compile_workflow` remain unregistered.

The private proof now satisfies the two-load boundary and registers those M4
surfaces. Registration remains provisional while this ADR is Proposed.

## Threat model and trust limits

The private proof treats the Cline host and the exact installed plugin entry as
trusted policy code. The model, tool input, natural-language brief, ordinary
chat reply, caller-created tool context, replay with changed content, and other
sessions are untrusted.

The proof protects against model-input forgery, stale concurrent mutation,
cross-session visibility, same-name plugin replacement, and separate-sandbox
state loss. It does **not** claim isolation from malicious code already running
under the user's OS account. A same-user plugin may be able to locate host data
files; SQLite is persistence and coordination, not a security sandbox.

`authority: host-composed` is descriptive output, not a bearer credential.
Downstream systems must trust the host-mediated execution event, not matching
JSON text. Signed result envelopes are required before artifacts cross an
independent trust boundary.

Human invocation proves who invoked a command, not automatically that every
mutation returned by arbitrary plugin code reflects informed consent. For the
private ADR Planner proof, the plugin entry is content-bound by installation
identity and tests prove `/adr-attest` maps exactly the explicit controlled
`key=true|false` arguments. Production-grade third-party plugins require either
a host-owned declarative mutation grammar or a host-rendered diff plus explicit
confirmation.

## Required host contract

```text
AgentExtensionCommandInvocationContext
  invocationId, invokedAt
  workspaceRoot
  task.sessionId
  source.kind: interactive | connector | sdk
  source.transport?, source.threadId?, source.channelId?
  actor.kind: human | model | automation | replay | programmatic
  actor.id?, actor.label?

AgentExtensionStateMutationRequest
  operation: replace | clear
  key
  value?                         # bounded JSON only

AgentExtensionStateSnapshot
  workspaceRoot, sessionId, extensionId
  revision
  entries[key] -> value + bounded provenance receipt

Host execution
  command(input, invocation + current snapshot) -> mutation request
  host.compare_and_swap(installationId, expectedRevision, invocation, request)
  tool(input, host_overwritten_context_with_snapshot) -> output
```

The capability must not be forgeable by importing package source or by
constructing ordinary tool input. The initial implementation uses wrapper
closure ownership plus host persistence rather than a serialized bearer token.
If artifacts later cross a trust boundary, a signed receipt and verifier become
a separate ADR; copied JSON fields are never treated as proof.

## Alternatives considered

| Alternative | Decision |
|---|---|
| Model-facing facts | Rejected; schema validity does not prove origin. |
| Prompt nonce | Rejected; the model can see and replay it. |
| Plugin-local singleton | Rejected; it crosses tasks and still does not bridge separate plugin loads safely. |
| Workspace file | Deferred; it lacks actor provenance and needs write ownership, privacy, locking, and migration policy. |
| Current slash-command handler | Rejected as attestation; it proves only that a string reached a handler. |
| Session metadata snapshot | Rejected for live state; runtime tool metadata is fixed when the agent is built and can become stale after a command mutation. |
| Generic plugin database API | Rejected; it would let plugin code self-assert provenance and creates an unnecessarily broad persistence surface. |
| Host-owned extension state + mediated wrappers | Proposed; separate command/tool loads share SQLite while mutation and injection remain host controlled. |
| In-process plugin state | Rejected for M4; the loader fails closed because it cannot provide the sandbox overwrite boundary. |

## Consequences

- M1–M3 repository-only planning remains available and unknown-preserving.
- The deterministic M4 compiler spike remains testable but explicitly
  untrusted and unregistered.
- Production planning will ask human-owned questions without converting
  ordinary replies into facts until the host capability lands.
- The model-facing readiness tool is diagnostic-only and forced to `blocked`.
- The Cline SDK gains a backward-compatible optional command invocation context
  and state-mutation result field.
- The CLI and runtime gain a small shared persistence dependency and lifecycle
  tests; plugins still receive no database access.
- M4 remains disabled until those tests pass and the spike is reconnected.
- A plugin update that changes its entry bytes receives a new installation id
  and does not inherit prior state without a future explicit migration policy.

## Acceptance conditions

1. A production-lifecycle test loads commands and tools through their real,
   separate hosts and proves they share only the same task-scoped host state.
2. Reset, resume, fork, and two connector threads cannot see one another's
   attestations unless the host explicitly defines them as the same task.
3. Model, automation, replay, and direct tool calls cannot mint human
   attestations or override gate selection.
4. Installed package source imports cannot produce a host-attested artifact
   accepted by the runtime.
5. Invalid batches are atomic; equal replay is idempotent; replacement and
   clear are explicit and audited.
6. Raw command/brief text and actor secrets are absent from canonical output.
7. Attestation changes applicability only; it cannot resolve work or pass a
   gate.
8. Caller-authored readiness, risk acceptance, waiver, and decision evidence
   always fail closed at the model-facing boundary.
9. Determinism, contradiction, privacy, archive, and M1–M3 regression suites
   remain green.

The private proof currently meets conditions 1, 2 for CLI session ids, 3 at the
model/tool boundary, 5, 6, 7, 8, and the scoped regression portions of 9.
Connector-specific authenticated-principal tests, deletion/retention,
host-result signing, and same-user sandbox isolation remain open production
conditions.

## Revisit

- Design the host capability alongside task/thread identity and plugin
  lifecycle ownership.
- Add decision, waiver, risk, and implementation-evidence authority only as
  separate host contracts.
- Add persistence only after artifact-root, locking, generated-region,
  privacy, and migration decisions are accepted.
- Add a declarative host mutation grammar or explicit confirmation UI before
  third-party plugin mutations can claim human consent.
- Add signed host execution receipts before canonical artifacts leave the Cline
  runtime trust boundary.
