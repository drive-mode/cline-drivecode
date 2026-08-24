# ADR-0051 · Cross-session chat catalog authority

**Status:** Proposed

**Date:** 2026-08-14

**Owner:** Harrison / Cline runtime owner

**Related:** [research](../research/29-cross-session-chat-management.md),
[initiative](../initiatives/cross-session-chat-management/),
[ADR-0025](ADR-0025-enforced-authority.md),
[ADR-0046](ADR-0046-adr-planner-plugin-boundary.md),
[ADR-0050](ADR-0050-adr-planner-host-attested-workflow-authority.md),
[ADR-0052](ADR-0052-managed-session-reconnect-authority.md),
[ADR-0053](ADR-0053-trusted-managed-manual-compaction.md), and
[ADR-0055](ADR-0055-fresh-process-managed-session-reattach.md)

## Context

Cline persists sessions, transcript files, manifests, runtime state, and
connector bindings, but has no authoritative user-facing chat lifecycle.
Execution statuses cannot express whether a chat is still part of the user's
active work or has been intentionally archived.

The current split already causes contradictory behavior. Interactive reset
preserves the old transcript; connector reset deletes it. Read-only history is
a best-effort merge of SQLite and manifests. CLI mutations force a local
backend even when a hub may own the running session. Connector mappings can be
written in more than one place without cross-process compare-and-swap.

The ADR Planner plugin needs bounded cross-session context eventually, but a
plugin-local catalog would duplicate host lifecycle state and would give plugin
or model code authority over user history.

## Decision

### 1. Chat is a first-class core entity

A chat is a durable organizational continuity object. A session remains an
execution/transcript unit. One chat may own multiple sessions created by
recovery or runtime restart; forks and checkpoint restores create new chats
with structural lineage.

Core will own a `ChatCatalogService` backed by versioned tables in the session
SQLite database:

- `chats` for lifecycle, title, workspace, head session, activity, and revision;
- `chat_sessions` for ordered membership and queryable lineage;
- `chat_bindings` for surface/thread ownership with CAS;
- `chat_events` for mutation provenance and replay audit; and
- `session_leases` for single-writer transcript ownership.

### 2. Tenant ownership is enforced at the SQLite boundary

One session/catalog SQLite database belongs to exactly one tenant. The shared
database opener persists a single `database_tenant` owner before any session or
catalog schema migration. Every `SqliteSessionStore` and
`SqliteChatCatalogService` open validates that owner before exposing a handle,
including raw session-store query methods.

- Historical unmarked databases may migrate only to the `local` tenant.
- A nonlocal tenant must provide an explicit data directory and may provision
  only a logically empty database.
- First assignment uses an immediate transaction and rechecks ownership after
  acquiring the write lock.
- A mismatched or malformed owner fails closed without publishing or caching
  the candidate database handle.

This preserves the existing globally unique session and catalog identifiers
inside one database while preventing invocation, binding, purge-attempt, and
tombstone collisions across tenants. Per-row multi-tenancy is deferred; a
future hosted deployment may revisit that choice behind the same port.

### 3. Lifecycle is orthogonal to execution and binding

Public catalog lifecycle is `active | archived`. `deleting` is an internal,
retryable purge state. Existing execution status and `bound | unbound` remain
separate axes. No status, age, missing process, or unbound surface implies
archive.

### 4. Core is the single lifecycle writer

Catalog mutations use a sibling local/hub port rather than `RuntimeHost`
execution methods. Every mutation carries:

- expected catalog or binding revision;
- invocation/idempotency identifier;
- host-authenticated actor and source provenance; and
- deterministic conflict/error codes.

Local and hub implementations must pass one conformance suite. A backend that
cannot perform catalog mutation fails with an unsupported-capability result; it
must not silently mutate local files.

### 5. Reset preserves by default

Plain `/new` stops the old execution, unbinds it, and defers creating a new chat
until the next real prompt. It does not silently archive or delete the old chat.
An explicit `/new --archive-current` may atomically stop, archive, and unbind.
Interactive and connector surfaces use identical semantics.

### 6. Resume, fork, and purge are explicit transitions

- Resuming archived work explicitly activates it and acquires its writer lease.
- Concurrent resume has exactly one lease winner.
- If an acquire reply is lost, the owner reconciles sanitized lease state,
  explicitly confirms a revision-bound revocation, and then reacquires. Core
  never persists recoverable plaintext lease tokens.
- Fork and checkpoint restore create new active chats with durable source
  chat/session lineage; source lifecycle is unchanged.
- Archive while running rejects unless the human requests stop-and-archive.
- Purge requires archived, non-running state. It writes a deleting tombstone,
  removes bindings, retries artifact cleanup idempotently, and only then
  finalizes deletion. A leftover manifest cannot resurrect a tombstoned chat.

### 7. Plugin access is bounded and read-first

Plugins receive no catalog database handle and no general chat mutation tool.
A trusted plugin may consume a bounded read-only `ChatSummary` supplied by the
host. A narrow action request must be re-authorized and confirmed by the host.
Model-facing tool input alone cannot archive, activate, bind, lease, or purge.

ADR Planner remains a planning consumer, not the chat lifecycle owner.

### 8. Hub workspace authority uses trusted enrollment and opaque selection

Filesystem workspace selection and capability minting are separate trust
boundaries. Only trusted in-process host composition may enroll a workspace
path. Enrollment requires an existing directory, resolves symlinks to one
canonical real path, and binds that path to tenant and principal. The registry
returns a CSPRNG 256-bit opaque workspace ID and never includes the path in its
sanitized list or mint contract.

An owner control plane may eventually list and select those opaque IDs. It may
not submit a filesystem path, tenant, or principal while minting. The registry
resolves the selected ID under the already-authenticated principal/tenant and
asks the private capability authority for a short-lived, digest-only,
one-time credential. Unknown, cross-principal, and cross-tenant IDs return one
generic failure.

Every WebSocket receives a distinct server-owned transport handle. Public
client registration, update, unregister, commands, subscriptions, and
disconnect cleanup are bound to that handle. Only a handle opened with an
immutable identity issued by the same private authority may dispatch catalog
commands. Origin- or daemon-token-authenticated compatibility sockets remain
explicitly unscoped.

Registry state is initially process-local. Restart invalidates opaque IDs and
all pending/active capabilities; trusted startup composition re-enrolls
workspaces and clients re-enumerate. Persisting registry IDs is deferred until
multi-process or remote reconnect requirements justify the additional secret
rotation and stale-path lifecycle.

Each physical workspace-scoped WebSocket obtains a new one-time credential
through an injected client provider. Concurrent callers share one pending
acquisition, explicit close cancels it before socket construction, provider
failures are sanitized, and workspace credentials are neither cached nor
combined with daemon-token authentication. The process-local adapter mints by
opaque workspace ID; an external provider must preserve the same contract.

Catalog confirmation is a second, narrower in-process coordinator shared by
direct catalog grants and managed-Core requests. For a managed request, strict
wire validation creates one responder bound to the active connection, command,
operation, aggregate, observed revision, and normalized effects; a mismatched
Core target rejects before the human callback, and command completion retires
the responder. The owner surface receives only a frozen action, aggregate,
revision, effects, and abort signal. Hidden invocation, connection, workspace,
profile, and credential correlation stays server-side. Prompt timeout,
connection close, workspace revoke, unregister, command completion, and
shutdown abort pending work and revoke unconsumed grants. Callback failures
are sanitized. The target revision is re-read after the human await; the same
identity and command-lifetime mutation fence are rechecked before catalog
entry, so stale or late approval cannot mutate. Prompt work is bounded globally
and per connection, confirmation credentials remain digest-only and bounded,
and connection IDs are never reused within the authority process.

### 9. Production profiles are server-issued execution authority

Opaque profile IDs are selectors inside an immutable server-issued connection
policy, not credentials and not caller authority. Each connection is bound to
one authority class, one policy epoch, and closed start/binding profile sets.
The selector-free public owner endpoint issues only the interactive-owner
class; connector, ACP, Zen, and automation classes require trusted in-process
issuance.

The daemon owns ten versioned profiles: interactive, six connector namespaces,
ACP, Zen, and automation. It resolves persisted/environment credentials,
builds the system prompt, fixes runtime and tool policy, constrains mode and
interactivity, and derives connector transport. Managed payloads cannot submit
credentials, headers, source authority, tool policy, session IDs, canonical
paths, or workspace roots. Managed-Core pool identity includes authority class
and policy epoch plus the full normalized claim-set digest. A class/epoch pair
cannot identify conflicting claims during one authority-process lifetime.

Tool policy is closed-world: the wildcard denies by default and each permitted
built-in tool is named explicitly. Future built-in, plugin, MCP, spawn, or team
tools remain disabled until a new daemon-owned profile revision names them.
Resolved profile data is cloned and recursively frozen before Core receives it.

Every admitted managed session stores a reserved writer-fenced authority stamp
containing profile ID, profile revision, authority class, policy epoch, and
allowed modes. Resume, lost-lease recovery, fork, checkpoint restore, and
recovery compare the requested profile to that persisted stamp before lease
acquisition or catalog mutation. Only an explicit revision-CAS
`config_restart` successor may revise revision, epoch, and effective policy
within the same profile ID and authority class; cross-profile/class transitions
and removal of managed authority fail. The stamp also binds full connection and
execution-policy digests plus effective interactivity. Turn-level mode
selection is bounded by the persisted stamp, and a missing stamp on a resident
managed session is an integrity failure.

### 10. Caller target authority and lifecycle hydration are bounded

Workspace authentication and profile continuity do not authorize every chat in
that workspace. Root admission persists an immutable server-derived target
`audienceId` on the chat, and every event preserves its event-time target
audience. The opaque ID remains stable across ordinary profile revision, policy
epoch, and connection replacement; it is distinct from broad authority class.
Connector audiences bind installed instances as well as transport kind.
Projection reads, lifecycle delivery and mutation, binding, continuity,
recovery, and runtime routes authorize the active connection against that
target before revealing whether it exists. Forks inherit the audience or use
one explicit server-owned delegation recorded in lineage. Principal/workspace
equality and caller-selected profile IDs never grant cross-audience access.

Existing rows gain an audience only when an immutable writer-fenced profile
stamp maps exactly through server policy. Missing or ambiguous rows are
quarantined as non-runnable `audience_unassigned` records for explicit owner
assignment; mutable metadata and connector JSON cannot infer authority.
Historical events without complete audience scope remain audit-only, and the
migration/assignment event establishes the first projectable cut.

Production caller sockets expose neither `HubChatCatalogPort` nor raw
`chat_catalog.*`. History hydration uses a strict bounded audience-filtered
projection with an audience/query-bound snapshot identity and authoritative
snapshot sequence across every page. Lifecycle events carry a durable catalog
sequence and listener-relative prior-delivery chain; reconnect replays the
exact authorized suffix after that snapshot and reports a fenced
processed-through sequence, or replaces local state from a new authoritative
snapshot before reporting ready. Joining silently at the current event head or
mixing pagination cuts is rejected.

The interactive owner may receive one explicit workspace-wide administrative
policy so Harrison retains a unified Active/Archived view. No connector, ACP,
Zen, automation, or Drive-worker audience inherits that privilege from the
common workspace principal, and destructive operations retain revision and
confirmation requirements.

The gate-off CA-1 checkpoint grants no such cross-audience policy. The ordinary
interactive-owner audience remains confined like every other audience. Broad
owner administration requires a later explicit ratification and cannot be
inferred from this ADR's proposed option.

A fresh caller process uses an audience-authorized continuity lookup that
distinguishes nonresident, live-owned, and orphaned resident state. It resumes
only the nonresident case, refuses a live owner, and durably reclaims only the
orphaned case before bounded hydration, replay, and ready. Client caches,
process IDs, and raw connection IDs are never ownership evidence. Drive room
links convey no authority. Managed Drive work uses the closed profile and
server-owned coordinator only as an authority substrate beneath ADR-0014:
hard-boundary `SeedPacket` admission, `PromotePacket`/audit retention, bounded
fenced parent summary, and path/worktree isolation; director ticks never fork.
Otherwise it rejects before legacy host access.

### 11. Runtime delivery compresses only declared additive continuity

`chat.runtime` keeps one monotonic session sequence and one opaque stream ID per
resident managed-session event authority. A resume cursor is the pair of stream
ID and last accepted session sequence. The epoch remains stable across durable
writer rekey, but unregister/recreate, adapter restart, or safe sequence
rollover must create a new stream ID. `sessionSequence` is the inclusive end of
the event's coverage.
Singleton events omit `sessionSequenceStart`; only the trusted WebSocket
delivery layer may add a lower start to represent a contiguous range, and only
for adjacent `assistant.delta` events. One range covers at most 256 source
events. The endpoint event ID, timestamp, process sequence, session sequence,
stream ID, and run ID remain authoritative.

Under soft byte pressure, the transport may merge only the globally newest
queued entry with the exact same subscription, session, run, and kind. It edits
that entry in place and requires the incoming range to begin immediately after
the queued range. Tool, approval, callback, prompt, compaction, reply,
run-terminal, cross-run, and subscription boundaries prevent a merge. Reaching
the text/range limit begins a new singleton. Required output that cannot enter
the hard bound closes the socket rather than disappearing.

Strict runtime subscriptions are transport-fenced. Each physical subscription
and reconnect receives a fresh opaque subscription ID captured by that exact
server listener and echoed outside the event envelope. The Node client exposes
fenced output only to the matching live listener; tokenless, stale, and
mismatched frames are ignored. A socket-local epoch alone is insufficient
because it cannot fence already queued or in-flight frames.
Strict runtime subscriptions are session-scoped; an unfiltered managed
subscription is valid only on the explicit lifecycle-reconciliation cursor
lane, is lifecycle-only, and never becomes a wildcard runtime feed. A managed
subscription with neither lane rejects before source/Core construction.
The WebSocket resource policy admits at most 256 active or in-flight source
subscriptions per connection. Exact duplicate fenced intent is idempotent and
does not consume another slot; new intent is rejected before source creation
when the bound is full. The socket adapter maintains a bounded desired set and
one coalescing reconciliation runner rather than an append-only control queue.
Every physical source retains its exact admission generation; ingress changes
across source setup force another cleanup sweep, and callbacks from a
superseded source are dropped before they can cross a reused subscription
fence.

The process-local event authority deep-freezes and records every validated
singleton in a sanitized journal before delivery, bounded per session (512
events / 2 MiB), per workspace runtime (2,048 events / 8 MiB), and to 1,024
resident-session metadata entries. A normal live join has no recovery cursor,
but receives an atomic ready baseline including sequence zero. A resume
subscription presents the last accepted epoch-bearing cursor; while retained,
the authority catches up to a stable head, installs the live listener, enqueues
exactly the contiguous suffix, and only then acknowledges the fenced
subscription with its accepted cursor. Failed outbound admission never yields
ready. Because newer contiguous live events may arrive before the ready frame,
the accepted cutoff is valid only on the requested stream and within the
inclusive interval from the requested cursor through the already delivered
cursor. Epoch mismatch, cursor ahead of the stream, eviction-floor mismatch,
replay discontinuity, cutoff outside that interval, acknowledgement timeout,
cancellation, or a repeated gap fails terminally. The first genuine
same-connection forward gap may trigger only one automatic recovery. No
provider execution, transcript reconstruction, or persistence replay is
permitted.

The 1,024-session journal metadata bound is also an admission bound. Lifecycle
start, related start, checkpoint restore, resume, and lost-lease recovery
reserve a reference-counted session slot before invoking the durable Core
mutation. Capacity failure therefore happens before a resident session or
writer lease can be created without runtime recovery authority.

A physical reconnect is an authority transition, not a transport retry. The
Node transport reports `session_reclaim_required` instead of sending a cursor
subscription from the replacement socket. The caller must register, durably
reclaim the resident writer generation, and then create a fresh cursor-bearing
subscription. Journal entries survive that in-process writer rekey, including
sanitized terminal/cancellation events emitted while the prior owner is
orphaned, but live fanout remains current-owner-only.

## Initial API shape

```ts
interface ChatCatalogPort {
  listChats(input: ChatListInput): Promise<ChatPage>;
  getChat(chatId: string): Promise<ChatDetail | undefined>;
  archiveChat(input: ArchiveChatInput): Promise<ChatMutationResult>;
  activateChat(input: ActivateChatInput): Promise<ChatMutationResult>;
  bindChat(input: BindChatInput): Promise<ChatMutationResult>;
  unbindChat(input: UnbindChatInput): Promise<ChatMutationResult>;
  getSessionLease(sessionId: string): Promise<SessionLease | undefined>;
  verifySessionLease(input: VerifyLeaseInput): Promise<SessionLease>;
  acquireSessionLease(input: AcquireLeaseInput): Promise<LeaseResult>;
  renewSessionLease(input: RenewLeaseInput): Promise<ChatMutationResult>;
  releaseSessionLease(input: ReleaseLeaseInput): Promise<ChatMutationResult>;
  revokeSessionLease(input: RevokeLeaseInput): Promise<ChatMutationResult>;
  purgeChat(input: PurgeChatInput): Promise<ChatMutationResult>;
}
```

## Consequences

### Positive

- Active/archive becomes intentional and queryable across every surface.
- Reset no longer has transport-dependent data-loss semantics.
- Resume and connector recovery gain an enforceable single-writer boundary.
- Lineage becomes queryable instead of mutable metadata.
- History/TUI can become a projection over one authority.
- Handoff and reversible context-swapping can later use stable chat/session
  identifiers without owning lifecycle.
- Session and catalog reads cannot cross a misrouted tenant database boundary.

### Costs

- Requires migrations, backfill/adoption policy, local/hub ports, and a new
  contract suite.
- Existing history, connector binding, reset, restore, and delete paths must be
  migrated carefully.
- Transcript write leasing exposes previously hidden concurrency failures.
- Tombstoned deletion is more operationally complex than best-effort removal.
- Nonlocal tenants require explicit database provisioning; a future hosted
  multi-tenant database would require a deliberate row-key migration.

## Alternatives

| Alternative | Decision |
|---|---|
| Free-form `metadata.archived` | Rejected: replaceable JSON is not a lifecycle invariant and is inefficient to query. |
| Add archive columns directly to `sessions` | Rejected: it keeps organizational chat identity coupled to one execution unit. |
| Make history command the writer | Rejected: history is a synthesized projection and currently forces local behavior. |
| Store catalog in ADR Planner/plugin state | Rejected: wrong owner, incomplete visibility, and unsafe mutation authority. |
| Infer archive from terminal status or age | Rejected: execution completion does not mean the user is done with the work. |
| Keep connector JSON authoritative | Rejected: duplicates database/session truth and lacks cross-process CAS. |
| Mint directly from a caller-supplied workspace path | Rejected: broadens the shared daemon credential into arbitrary-filesystem workspace authority. |
| Derive opaque IDs deterministically from paths | Rejected initially: stable hashes leak equality and create a persistent identifier without solving rename, symlink, or revocation lifecycle. |
| Persist the workspace registry in M0 | Deferred: process-local enrollment fails closed on restart and avoids stale path/identity recovery before a remote requirement exists. |
| Replace one delta with a later concatenated delta | Rejected: it manufactures a sequence gap for a correct client. |
| Remove and append a merged delta | Rejected: it can reorder assistant text behind a semantic event. |
| Fence subscriptions only with a mutable socket epoch | Rejected: queued and in-flight frames can outlive the logical listener. |
| Read state and then open an unanchored recovery subscription | Rejected: events can land between the read and subscribe boundaries. |
| Rebuild one replacement snapshot from independent runtime reads | Rejected: partial deltas, tool transitions, approvals, and callbacks do not share an atomic through-sequence. |
| Resume from a sequence without a stream epoch | Rejected: process restart can reuse the number and manufacture false continuity. |

## Migration and compatibility

- `cline history` and `/history` remain compatibility aliases while the TUI
  moves to Active, Archived, and Legacy views.
- Existing sessions are not heuristically archived. The production adoption
  policy is an owner decision and a release gate.
- Connector JSON may temporarily be a generated cache, never a second writer.
- Manifest fallback may enrich a cataloged chat during migration, but may not
  create or resurrect one after cutover.

## Acceptance evidence

Do not accept this ADR until:

1. versioned schema and idempotent adoption tests pass;
2. local and hub ports pass one lifecycle conformance suite;
3. workspace filtering and activity ordering are proven;
4. interactive and connector reset both preserve transcripts;
5. CAS protects archive/activation and stale binding clear;
6. concurrent resume yields one lease winner without transcript loss;
7. fork/checkpoint/recovery lineage is structural and queryable;
8. purge failure leaves a retryable tombstone and manifests cannot resurrect it;
9. unsupported backends fail closed; and
10. plugin/model surfaces cannot directly mutate lifecycle; and
11. session and catalog stores reject cross-tenant database opens before any
    schema or data mutation; and
12. lost lease acquire/revoke replies recover through sanitized reads,
    owner-only human-confirmed revocation, immutable replay receipts, and a new
    token that cannot be affected by the superseded token; and
13. every internal Hub catalog command validates a strict shared v1 request and
    result schema at both server and internal adapter boundaries before data
    crosses or leaves the transport boundary; production caller sockets expose
    none of those commands.
14. a resumed writer verifies before guarded work, schedules renewal from the
    authority-issued expiry, and has an independent fail-closed expiry
    watchdog; and
15. lease credentials never traverse generic hub/plugin payloads, every
    session-mutating commit uses a monotonic durable fence or shared write
    gate, renewal serializes with writes, direct paths cannot bypass managed
    authority, and release follows proven runtime quiescence.
16. hub workspace paths enter only through trusted in-process enrollment;
    minting accepts only a server-generated opaque ID bound to the
    authenticated tenant/principal, and sanitized registry surfaces expose no
    path; and
17. registration, update, unregister, commands, subscriptions, disconnect,
    revocation, and catalog authorization all retain the same server-owned
    connection identity, while contextless and origin-only catalog dispatch
    fails closed; and
18. additive runtime delivery declares exact bounded sequence coverage, merges
    only adjacent same-subscription/session/run assistant deltas in place,
    preserves endpoint metadata and every semantic boundary, fences stale
    physical subscription output, and recovers from a real gap through one
    authoritative cursor-anchored bounded coordinator; and
19. every managed chat/event has immutable target-audience scope, every target
    route proves audience authorization before existence disclosure, raw
    `chat_catalog.*` is denied on production caller sockets, and only the
    ratified interactive-owner policy can administer across audiences; exact
    immutable-stamp migration or non-runnable quarantine handles every older
    row without projecting unscoped historical events; and
20. bounded projection snapshot identity/sequence, durable chained lifecycle
    event sequence, exact authorized replay, fenced ready, and authoritative
    snapshot replacement close every reconnect and pagination gap; and
21. accepted ADR-0055 fresh-process nonresident/live-owner/orphan reattach and
    ADR-0014-conformant managed Drive room/fork/wave policy pass physical
    negative-fallback conformance.

## Authority-kernel implementation evidence (2026-08-14)

The local managed-runtime proof now satisfies the technical portions of item
15:

- lease renewal revision and monotonic writer generation are separate fields;
- active token, expiry, and exact writer generation are checked in the same
  immediate SQLite transaction as every managed row/head commit;
- immutable transcript, compaction, and manifest candidates are selected by a
  durable `session_writer_heads` record and commit sequence;
- metadata/status and generic create/replace/delete paths cannot bypass managed
  authority;
- host startup registers a lifecycle epoch before awaiting external work;
- renewal and persistence share one ordered host gate; and
- managed stop releases only after a producer-drained, terminal-persistence
  quiescence receipt. Receipt failure retains authority.

The implementation choice for the former durable-fencing open decision is
therefore immutable generation files plus a transactionally selected
authoritative head, backed by a generation-fenced SQLite row mutation gate.
ADR acceptance still waits on authenticated hub scope, command-path
convergence, and the owner decisions below.

The first Hub authority checkpoint now implements the internal portions of
items 16 and 17: one-time capability storage/consume, immutable identity,
workspace epoch revocation, canonical-directory registry enrollment, opaque-ID
minting, anti-enumeration workspace authorization, explicit scoped/unscoped
transport handles, server-owned public-client and subscription lifecycle, exact
workspace catalog-authority matching, contextless denial, dedicated WebSocket
upgrade consume,
replay rejection, revocation-driven socket close, and fresh per-physical-socket
client acquisition. A selector-free owner-authenticated control endpoint now
mints that capability cross-process only when exactly one trusted startup
enrollment exists; a strict client adapter validates lifecycle requests,
results, and events. The trusted in-process confirmation coordinator now also
owns the complete gate-off CA-3 authority kernel: managed Core has no static
confirmation callback; one exact invocation-scoped responder routes through
the same bounded target-only owner seam as direct grants; command completion,
physical disconnect, epoch revoke, and shutdown retire prompts; and the final
mutation fence carries the invocation token. Physical approve/decline and
disconnect/shutdown tests, stale-revision and exact-replay tests, mixed direct/
managed bounds, retained-callback denial, and caller-payload injection proof
pass. Multi-workspace owner selection is explicitly deferred beyond singleton
M0; selection and composition of the production owner responder remain a
release gate. A
private authority-keyed managed-Core pool now single-flights construction,
fences asynchronous creation against revocation, retires epochs, and disposes
on revoke/unregister/shutdown through bounded abortable waits. Tuple keys are
unambiguous. The current inert scoped seam admits exact client
register/update/unregister bookkeeping, authenticated catalog dispatch, and
sanitized managed protocols. Raw catalog dispatch is now explicitly a release
blocker rather than a production caller surface; global client listing, legacy event
subscription, and every other generic command route fail closed. Factory
presence and gate-off connections remain inert, and unscoped consumers retain
an explicit tested compatibility lane during migration. A strict shared v1
lifecycle wire now covers all 14 managed
commands. It accepts only opaque runtime/binding profiles and workspace-relative
working-directory hints, omits canonical workspace paths and credentials from
results, and validates both sides of dispatch. Authenticated invocation receives
only the server identity, its abort signal, the command, and a frozen normalized
payload. A concrete local ClineCore factory now binds one Core to the
authority-issued scope, resolves opaque runtime and binding profiles, strips
resolver-supplied path/session authority, binds confirmation to the active
invocation, sanitizes results, and conforms all 14 commands. Its strict
event projection now reads committed catalog metadata rather than command
results. Schema v4 atomically appends an immutable delivery sidecar with
canonical workspace and event-time session membership; legacy unscoped rows
remain audit-only. A tenant-global high-water cursor reads only a payload-free
allowlist for the prebound workspace, preserves exact durable event metadata,
and advances across foreign rows. Per-listener live cuts, strict event-time
session filters, and one bounded immediate/background pump prevent replay,
duplicates, and dynamic-scope reconstruction after purge or chat-ID reuse.
Every authoritative row validates before listener filtering; projection/source
failure is health-reported without changing a committed command result, while
invalid metadata disables the pump instead of being acknowledged or retried
forever. The final event-source re-review returned **Approved — no remaining
concrete P0/P1 findings**.
The final commit-boundary cancellation fence is now implemented as
host-private authority state: the local port reasserts it immediately before
synchronous SQLite entry, purge carries it across cleanup and every terminal
write, and the managed factory isolates trusted pool retirement with
invocation-local context. Ordinary callers remain revoked during retirement,
and disposal completion aborts descendant retirement work. Six focused suites
pass 70 tests; an adversarial review returned **Approve — no P0/P1** and its
defense-in-depth retirement-abort recommendation was applied. Production
runtime parity, owner-responder product wiring, and caller cutover remain
release gates.
Daemon composition, production profile continuity, immutable target audiences,
raw-catalog denial, bounded projection, and retained lifecycle replay are now
implemented but inert behind the disabled release gate. Schema v5 migration
uses a committed evidence/quarantine phase followed by restartable exact
reconciliation; old unscoped events remain audit-only, and explicit human
assignment creates the first scoped event without reviving the writer. Strict
`chat.changed` replay carries durable catalog and prior-delivery sequence,
advances across hidden foreign/legacy gaps, and acknowledges ready only after
downstream admission. Successful starts return a strict descriptive profile
authority without credentials or policy digests. `chat_catalog.v1` remains
unavailable to managed caller sockets; `chat_lifecycle.v1`, `chat_runtime.v1`,
and the bounded projection stay unadvertised until atomic cutover.

The PC-3 profile-authority adversarial review found and closed cross-authority
`config_restart`, wildcard future-tool widening, forced headless interactivity,
missing-stamp turn downgrade, optional profile security fields, incomplete
claim identity, and shallow profile immutability. The final independent
re-review returned **Approve for inert gate-off integration — no P0/P1**. This
approval does not authorize capability advertisement or caller cutover.

The later production-caller architecture review found four gaps: raw catalog
and cross-audience known-ID authority, lifecycle snapshot/replay continuity,
fresh-process reattach, and Drive room/fork/wave access to legacy authority.
CA-1 closes the first two behind the disabled gate with copied-database,
known-ID, snapshot, replay, and readiness evidence. The CA-2 checkpoint now
closes fresh-process reattach behind that same gate with audience-authorized
continuity, installation-bound connector audiences, unchanged ADR-0052 rekey,
bounded hydration/replay, exact initial-reclaim lost-reply reconciliation, a
physical fresh-facade WebSocket proof, and an actual Hub restart/new-stream
proof. ADR-0055 still awaits explicit owner acceptance; trusted connector
launcher delivery, Drive, and production caller convergence remain pre-release
work. No production routing or capability advertisement changed.

A configured factory is not itself permission to route lifecycle traffic. One
explicit server release gate controls production caller selection; projection,
lifecycle, and runtime command/event routing and subscriptions; and every
managed capability advertisement together. Compatibility target isolation and
raw-catalog denial must already pass before that switch. With the gate off,
direct managed commands fail before adapter entry and existing subscriptions
retain compatibility behavior. With the gate on, managed routing requires an
authenticated scoped connection; unscoped traffic never acquires managed
authority by factory presence alone.
Late Core construction also remains pool-owned after revocation so rejected or
hung disposal is observed and bounded rather than detached.

## Open decisions

1. Existing-session adoption/triage policy.
2. Workspace identity across local clones, renames, and hosted operation.
3. The initial kernel uses a 60-second lease and 20-second renewal cadence;
   revisit those values after runtime latency/failure telemetry. Whether a
   separately authorized operator override is ever needed beyond owner
   revocation remains open.
4. Retention and privacy purge defaults.
5. Production owner-responder surface and UX for stop-and-archive,
   activate-and-resume, lease revocation, and purge. Its target-only authority
   contract is fixed; the CLI/TUI, desktop Hub, connector, or owner-console
   product surface is not yet selected.
6. Multi-workspace owner enumeration and selection UX. M0 intentionally mints
   only for one startup enrollment and accepts no selector; expanding that
   control plane requires a separate decision.
7. Whether the interactive-owner audience receives explicit workspace-wide
   administration; all headless and worker audiences remain closed by default.
8. Drive coordinator ownership, worker profile, retention behavior, and fenced
   parent-summary operation.

## Runtime authority boundary refinement

The lease credential is a trusted-core capability, not a generic transport
field. `session.create`, runtime metadata, plugin contributions, and client
events must not carry it. A server-side managed-session operation will acquire
catalog authority, arm the write gate, start the co-located runtime, renew and
rotate inside the same gate, drain it on stop, and return only sanitized state.
The shared daemon must not expose this operation until tenant, workspace,
principal, and human-confirmation scope are derived from authenticated
connection state.
