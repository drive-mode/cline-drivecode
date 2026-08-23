# Cross-session chat management requirements

**Status:** draft contract for ADR-0041
**Scope:** Milestone 0 authority plus interfaces required by M1/M2

## Terms

- **chat:** durable organizational continuity object.
- **session:** execution/transcript unit attached to one chat.
- **active:** intentionally retained in the user's current body of work.
- **archived:** intentionally hidden from the default active view; recoverable.
- **binding:** mapping from a surface/thread to a chat and head session.
- **lease:** exclusive time-bounded authority to append to a session transcript.
- **purge:** destructive deletion workflow, distinct from archive.

## Functional requirements

### Catalog

- **FR-001** Core shall create exactly one chat for the first persisted root
  session, atomically and idempotently.
- **FR-002** Core shall list chats by workspace, lifecycle, source, cursor, and
  bounded page size.
- **FR-003** Default ordering shall use `last_activity_at`, with deterministic
  tie-breaking, not original session start time.
- **FR-004** Core shall return chat details with head session, ordered attached
  sessions, lineage, bindings, execution status, lifecycle, and revision.
- **FR-005** Active/archive lifecycle shall be independent of execution status
  and binding state.
- **FR-006** Titles may be derived for display, but title source and lifecycle
  authority shall remain distinguishable.

### Lifecycle

- **FR-010** Archive and activate shall require expected revision and an
  idempotency/invocation identifier.
- **FR-011** Archive shall preserve transcripts, manifests, compaction state,
  checkpoints, lineage, and audit events.
- **FR-012** Archive of a running chat shall fail unless stop-and-archive was
  explicitly requested by a human-authorized surface.
- **FR-013** Resume of an archived chat shall explicitly activate it before a
  writer lease is granted.
- **FR-014** Plain reset/new shall stop and unbind without archiving or deleting.
- **FR-015** A combined reset-and-archive operation shall be atomic from the
  catalog observer's perspective.
- **FR-016** Switching selected chats shall not alter lifecycle.
- **FR-017** Human rename shall update the catalog title and manual-title
  provenance under expected revision and stable invocation identity. It shall
  not change lifecycle, lineage, workspace identity, or activity ordering.

### Resume, fork, restore, and recovery

- **FR-020** A session shall have at most one valid writer lease.
- **FR-021** Concurrent resume attempts shall produce exactly one winner and a
  deterministic conflict for every loser.
- **FR-022** A fork shall create a new active chat and structurally record its
  source chat and source session.
- **FR-023** Checkpoint restore shall create a new active chat with explicit
  restore lineage unless a separately accepted policy defines in-place rewind.
- **FR-024** Missing-session connector recovery shall record recovery lineage
  and shall not claim transcript continuity that was not recovered.
- **FR-025** If an acquire reply is lost and its plaintext token is therefore
  inaccessible, the owning human shall be able to read sanitized lease state,
  confirm a revision-bound revocation, and reacquire with a new token.
- **FR-026** A resumed writer shall renew from the authority-issued expiry,
  verify before guarded work begins, and close its write boundary immediately
  when renewal, verification, or the independent expiry watchdog fails.
- **FR-027** Lease credentials shall remain inside trusted core composition.
  Generic hub create/update payloads, plugin APIs, logs, metadata, events, and
  managed-session results shall never carry the credential.
- **FR-028** Every catalog-managed session mutation—including transcript,
  compaction, manifest, metadata, and status writes—shall commit through one
  monotonic fence or server-owned write gate. A check followed by an
  independently committed write is insufficient.
- **FR-029** Renewal shall serialize with protected writes. Normal stop shall
  keep renewal active until writers and callbacks are drained; failure paths
  shall release only after the runtime proves quiescence, otherwise authority
  shall expire or enter confirmed recovery.

### Bindings

- **FR-030** Binding changes shall use CAS and one core writer.
- **FR-031** A stale clear/reset shall not remove a newer binding.
- **FR-032** Connector thread state and JSON files may cache catalog bindings
  during migration but shall not remain writable authorities after cutover.
- **FR-033** Interactive and connector reset shall share the same lifecycle
  contract and preserve history.

### Purge

- **FR-040** Purge shall require archived, non-running state and explicit human
  confirmation.
- **FR-041** Purge shall write a deleting tombstone before removing bindings or
  artifacts.
- **FR-042** Artifact cleanup shall be idempotent and retryable, honor purge
  claim cancellation before every destructive effect, and report success only
  after deletion can be verified.
- **FR-043** Cleanup failure shall retain the tombstone and error evidence; the
  chat shall not return to active/archive listings.
- **FR-044** Manifest or file fallback shall never resurrect a tombstoned or
  purged chat.

### Compatibility and migration

- **FR-050** `cline history` and `/history` shall remain aliases during M1.
- **FR-051** Unsupported remote/file backends shall fail closed for mutation.
- **FR-052** Legacy sessions shall not be heuristically archived from age or
  execution status.
- **FR-053** Migration shall be restartable and shall never expose two writable
  lifecycle authorities.
- **FR-054** The production managed protocol shall preserve streaming output,
  tool-status events, approvals, abort, bounded attachments, pending-prompt
  mutation, messages/checkpoint/usage reads, and compaction controls required by
  current interactive and connector callers. A final-response-only downgrade
  shall not be enabled silently.
- **FR-055** Audience-schema migration shall derive a target audience only from
  an immutable writer-fenced profile stamp and a server-owned exact mapping.
  Missing or ambiguous rows shall become non-runnable `audience_unassigned`
  records, remain absent from ordinary managed projection/event delivery, and
  appear only in a bounded privileged migration inventory. Assignment shall be
  an explicit revisioned owner action with an audit event; mutable metadata,
  connector JSON, age, current binding, or session path shall never infer it.
  Historical events without complete audience scope remain audit-only; a
  migration snapshot/event establishes the first projectable cut.
- **FR-056** Managed runtime commands and callback responses shall be bound to
  the authenticated connection, one managed session, the current run or pending
  request where applicable, and a stable operation/request ID. Cross-session,
  replayed, late, and wrong-connection responses shall fail closed.
- **FR-057** Managed runtime projections shall exclude canonical paths,
  filesystem attachment paths, provider-native messages, raw tool input/output,
  hidden reasoning unless explicitly display-authorized, checkpoint refs,
  compaction messages/system prompts, credentials, and arbitrary metadata.
- **FR-058** Managed file attachments shall carry bounded inline content and a
  path-safe display name. The daemon shall never interpret a managed attachment
  name as a host filesystem path.
- **FR-059** Runtime event envelopes shall carry monotonic process and session
  sequence numbers plus an opaque resident-session stream ID. A recovery cursor
  shall bind the stream ID and last accepted session sequence. The stream epoch
  shall survive durable writer rekey but change on unregister/recreate, adapter
  restart, or safe sequence rollover. A fresh scoped subscription shall receive
  an atomic baseline cursor, including sequence zero for a quiet session.
  `sessionSequence` shall be the inclusive end; a singleton shall omit its
  start, while only the delivery layer may declare a bounded contiguous
  multi-sequence range for adjacent assistant deltas in the same fenced
  subscription/session/run/stream. Clients shall reject gaps, overlaps,
  regressions, epoch mismatches, malformed ranges, and stale subscription
  fences. Reasoning projection/coalescing requires separate profile
  authorization. Terminal, tool, approval, callback, prompt mutation, reply,
  and compaction events shall not be silently dropped or crossed under
  backpressure. Strict runtime subscriptions shall name exactly one session;
  an unfiltered managed lifecycle subscription shall present an explicit
  lifecycle-reconciliation cursor and carry lifecycle events only. A managed
  subscription with neither that cursor nor one session shall reject before
  source/Core construction.
- **FR-060** Managed manual compaction shall execute only inside the trusted
  resident host using the server-selected profile, full canonical transcript,
  and current writer authority. The client shall not provide messages,
  summaries, sidecars, provider configuration, writer credentials, or a
  compactor callback. Compaction shall preserve canonical messages and mutate
  only the writer-fenced working-context sidecar.
- **FR-061** Runtime callback grants shall be immutable, closed-world, and
  selected only by the server production profile. Each named callback shall
  validate an exact bounded request and result schema before Core invocation;
  profile, workspace, or command payloads shall not add names. The first
  supported grant is `tool_executor.askQuestion` with request
  `{ question, options }` and result `{ answer }`. `AgentToolContext`, paths,
  metadata, functions, and credentials shall never enter its wire projection.
- **FR-062** Callback response expiry shall be authoritative from the recorded
  timestamp, independent of timer scheduling. Timeout, abort, disconnect,
  revocation, run end, session stop, owner transition, writer renewal/fence
  loss, and daemon disposal shall consume or cancel a pending request exactly
  once; a later response shall fail closed. Stop shall cancel callback-blocked
  work before awaiting Core stop.
- **FR-063** Managed lifecycle admission shall register runtime ownership and
  the profile capability manifest before any turn executes. Managed start and
  resume profiles shall reject a prompt; `chat_lifecycle.run_turn` is the only
  callback-capable turn-start authority.
- **FR-064** On one physical WebSocket, an earlier runtime subscription-control
  frame shall complete before a later command dispatches. This ordering shall
  not globally serialize commands: callback response and abort commands must be
  able to resolve a still-running turn.
- **FR-065** Interactive start, resume, config restart, reset, turn, fork,
  checkpoint restore, abort, shutdown, archive, activate, rename, purge, and
  history mutation shall cut over through one managed facade. The six shared
  connector adapters shall cut over through their common host in one release.
- **FR-066** A managed session handle shall expose one local observation seam
  for already validated strict runtime events. Core shall update internal
  run/approval/capability correlation before delivering a frozen sanitized
  event. The observer shall expose no raw transport or subscription control,
  consume no additional server source, bound independent registrations,
  contain listener and error-observer failure, support idempotent
  unsubscription, preserve event order per listener without awaiting another
  listener, and retain no more than one in-flight callback plus one bounded
  queue per listener. The first listener shall receive bounded ordered events
  accepted before registration. Observer overflow shall retire that observer;
  initial replay overflow shall reject readiness or first registration. Handle
  disposal shall retire queued and future delivery before controller release;
  an already executing listener is not awaited and retains no authority.
- **FR-067** Interactive and history UI shall use an authority-tagged target.
  A managed target shall carry `chatId`, projected head session ID, catalog
  lifecycle state, and expected revision from rendering through command
  admission; a Legacy target shall carry only its compatibility session ID.
  String-only callbacks and type coercion to `SessionHistoryRecord` shall not
  discard managed authority or invent provider, prompt, cost, or artifact
  fields.
- **FR-068** Managed display messages and turn summaries shall not be cast to
  provider-native `Message` arrays. Interactive rendering, checkpoint display,
  context/usage display, resume hydration, and export shall consume explicit
  bounded app-domain projections. Any operation that requires canonical raw
  messages or local artifacts shall be Legacy-only or fail explicitly without
  fallback.
- **FR-069** Interactive config changes shall create a revision-bound
  `config_restart` successor; forks and checkpoint restores shall use their
  structural managed lifecycle operations. The CLI shall not preserve the old
  session ID, clone transcripts, author lineage in mutable metadata, or patch
  provider/model connection labels after managed admission.
- **FR-070** In managed mode, runtime hooks, provider resolution, credentials,
  tool policy, and manual compaction inputs shall remain owned by the trusted
  daemon profile. The CLI shall not forward arbitrary generic hook payloads,
  invoke a local compaction provider, mutate the compaction sidecar, or use
  generic session-connection update as a managed substitute.
- **FR-071** Managed history actions shall distinguish archive, activate,
  rename, and purge. Prompt/arbitrary metadata update is not catalog rename;
  local delete is not purge. Legacy rows shall remain visibly Legacy and
  read-only until an explicit adoption policy is accepted. Managed export, if
  offered, shall be labeled as a bounded sanitized display export and shall not
  read local session artifacts.
- **FR-072** The managed interactive app adapter shall own at most one current
  structural session handle and expose only frozen app-domain identities,
  projections, and action results. Its start profile shall use a closed
  property allowlist and reject credential, absolute-path, and parent-traversal
  smuggling before managed admission. It shall expose no generic Core, raw Hub
  command, provider-native message, local artifact, or transport handle. Fresh-
  process `resume`, `reattach`, and recovery methods shall remain absent until
  ADR-0045 is accepted. Malformed or stale admission results shall be stopped,
  released, and fenced from app event delivery; an adapter-wide failure shall
  also retire and release any predecessor context.

## Authority and security requirements

- **AUTH-001** Only core catalog ports may mutate lifecycle, bindings, leases,
  lineage, or purge state.
- **AUTH-002** Every mutation event shall record host-observed actor, source,
  invocation, previous revision, resulting revision, and time.
- **AUTH-003** Model-facing tool input shall not be sufficient authority for a
  lifecycle mutation.
- **AUTH-004** Plugins shall receive no database handle or raw global catalog.
- **AUTH-005** Read projections supplied to plugins shall be bounded by current
  workspace, task, keys, count, and serialized size.
- **AUTH-006** Local and hub modes shall authenticate/authorize actor identity
  before mutating another chat's lifecycle or binding.
- **AUTH-007** Archive shall not be presented as satisfying privacy deletion.
- **AUTH-008** Tokenless lease revocation shall require a host-issued,
  expiring, one-time human confirmation bound to operation, invocation, lease
  aggregate, session ID, and expected lease revision.
- **AUTH-009** Tokenless lease revocation shall reject system actors and human
  principals other than the persisted lease owner.
- **AUTH-010** Hub workspace paths shall enter authority only through trusted
  in-process enrollment. Enrollment shall require an existing directory,
  resolve symlinks to a canonical real path, and bind tenant and principal.
- **AUTH-011** A workspace capability mint request shall accept only a
  server-generated opaque workspace ID and bounded TTL. It shall not accept a
  path, tenant, principal, actor, or transport claim.
- **AUTH-012** Unknown, cross-principal, and cross-tenant workspace IDs shall
  return one non-enumerating failure. Sanitized registry listings shall not
  contain filesystem paths.
- **AUTH-013** Every Hub socket shall own one server-side connection handle.
  Client registration, update, unregister, commands, subscriptions, and
  disconnect cleanup shall remain bound to that handle; public client IDs are
  routing labels, not authority.
- **AUTH-014** Contextless, origin-only, revoked, foreign-authority, and closed
  connections shall not dispatch internal catalog commands. Host-issued
  catalog authority shall exactly match the server identity's principal,
  tenant, canonical workspace, connection ID, and transport. This internal
  authority does not expose raw catalog dispatch to a production caller socket.
- **AUTH-015** A workspace-scoped physical WebSocket shall use only a fresh
  one-time workspace credential obtained from an injected provider. The client
  shall not cache or reuse that credential, combine it with the daemon token,
  or expose provider secrets through connection errors.
- **AUTH-016** Hub catalog confirmation shall be issued only through a trusted
  in-process human callback for an active authority-issued connection. Core
  shall derive the exact normalized target, while the server retains every
  connection, workspace, command, operation, and invocation correlation. The
  human prompt shall contain only the frozen action, aggregate, observed
  revision, and normalized effects: no path, invocation ID, capability,
  confirmation credential, daemon token, public-client authority claim, or
  workspace/connection descriptor.
- **AUTH-017** Close, epoch revoke, unregister, failed upgrade, and server stop
  shall abort in-flight prompts and revoke every unconsumed confirmation for
  that connection. Command completion shall also retire its managed
  confirmation responder. A late callback result or retained Core callback
  shall not recreate authority.
- **AUTH-018** Hub managed-Core scope shall be derived only from an active
  authority-issued connection's tenant, principal, canonical workspace, and
  workspace epoch. Command payloads, public client IDs, registration metadata,
  daemon cwd, and loopback origin shall not select or widen runtime scope.
- **AUTH-019** Managed Hub composition shall expose neither global client
  listings nor legacy wildcard event subscriptions. Client metadata, workspace
  paths, prompts, attached files, assistant text, reasoning, and session state
  shall not cross its workspace-bound sanitized lifecycle projection.
- **AUTH-020** Managed lifecycle requests shall select only opaque host profiles
  and optional workspace-relative working directories. They shall not carry a
  workspace path, provider credential, principal, tenant, connection, source,
  or connector authority claim. The trusted adapter shall derive those values
  from the active server identity and host configuration.
- **AUTH-021** The concrete managed-Core factory shall bind each Core to the
  authority-issued tenant, principal, canonical workspace, and epoch; reject
  invocation identities outside that scope; and override any resolver-supplied
  session ID, working directory, or workspace root. Human confirmation shall
  execute only inside the authenticated invocation context that requested the
  operation and shall fail closed when either connection or workspace scope is
  aborted. Its command-lifetime signal shall remain in the final catalog
  mutation fence through synchronous commit entry.
- **AUTH-022** A configured managed-Core factory shall remain inert unless one
  explicit server-owned release gate is enabled. The same gate shall control
  production caller selection; projection, lifecycle, and runtime command
  routing; projection/lifecycle/runtime event routing and subscriptions; and
  advertisement of every managed protocol capability. Compatibility target
  isolation and raw-catalog denial shall already be proven before this switch.
  No caller or managed protocol family may enter production independently.
- **AUTH-023** Until durable catalog ownership or access grants include a
  principal dimension, tenant plus canonical workspace is the persistent
  authorization domain. The production owner control plane shall not enroll
  that same domain for principals that are not intended to share its catalog;
  a process-local managed-Core pool key is not durable principal isolation.
- **AUTH-024** The M0 cross-process owner control plane shall accept no
  workspace path or workspace ID. An authenticated POST may mint a one-time
  capability only when exactly one trusted startup enrollment exists; zero or
  multiple registrations shall fail closed. Its response shall contain only
  credential and expiry and shall be marked `no-store`.
- **AUTH-025** Managed clients shall never submit a self-attested confirmation
  boolean or reusable confirmation credential. The trusted host shall bind a
  human decision to the active connection, operation, aggregate, observed
  revision, normalized effects, and bounded expiry. Strict request validation
  shall reject caller-supplied confirmation state before Core dispatch. The
  server shall install a responder only for the exact confirmation-capable
  command and operation, reject a mismatched Core target before prompting, and
  make the responder unusable when that invocation settles.
- **AUTH-026** Every managed connection shall carry immutable server-issued
  profile policy claims: one authority class, policy epoch, allowed start
  profiles, and allowed binding profiles. The public selector-free owner
  endpoint shall mint only the default interactive-owner class; registration
  metadata and lifecycle payloads shall not select or widen these claims.
- **AUTH-027** Production start profiles shall be closed, versioned,
  daemon-owned definitions. Workspace files and managed requests shall not
  supply provider credentials, headers, runtime callbacks, tool policies,
  source authority, session IDs, canonical paths, or workspace roots. Missing
  credentials and unauthorized profiles shall fail before Core admission.
- **AUTH-028** Every admitted managed session shall persist a writer-fenced
  authority stamp containing profile ID, profile revision, authority class,
  policy epoch, and allowed modes. Resume, lost-lease recovery, fork,
  checkpoint restore, and recovery successors shall match it exactly before
  lease acquisition or catalog mutation; only a revision-CAS `config_restart`
  successor may revise policy within the same profile ID and authority class.
  Cross-profile/class transitions and removal of managed authority shall fail.
- **AUTH-029** A managed turn may omit a mode or select only a mode present in
  the persisted authority stamp. A turn-level mode change shall reject before
  runtime invocation when it exceeds that ceiling.
- **AUTH-030** Connector binding profiles shall derive transport from the
  server-authorized profile and normalize instance, channel, and thread into
  that namespace. Missing dimensions and any explicit foreign connector
  namespace shall fail before binding lookup or mutation.
- **AUTH-031** Managed-Core pool identity shall include authority class and
  policy epoch plus a digest of the complete normalized claim set. One
  class/epoch pair shall identify exactly one claim set for the lifetime of the
  authority process. A Core created for one effective policy shall never be
  reused for another, even when tenant, principal, and workspace match.
- **AUTH-032** Production tool policy shall begin with an explicit deny-all
  wildcard and enumerate every enabled built-in tool. New built-in, plugin,
  MCP, spawn, or team tools shall remain disabled until a daemon-owned profile
  revision explicitly names them. The persisted authority stamp shall include
  a digest of effective model/runtime/tool/interactivity policy.
- **AUTH-033** Effective interactivity shall be profile-owned, included in the
  persisted authority stamp, recorded in catalog admission, and passed
  unchanged to host startup. Headless connector, Zen, and automation profiles
  shall never be promoted to interactive execution by the managed runtime.
- **AUTH-034** Once the production managed release gate is enabled, an unscoped
  compatibility connection shall not discover, read, attach to, subscribe to,
  resume, execute, abort, compact, update, detach, restore, or delete a
  catalog-managed session. Legacy list and wildcard event projections shall
  omit managed targets; direct lookup shall return a non-enumerating rejection
  before host execution. Isolation shall derive from durable catalog/writer
  enrollment, not mutable session metadata or only the process-local resident
  map. Schedule administration may remain unscoped but shall not address
  managed execution sessions. Gate-off composition shall remain inert.
- **AUTH-035** Every managed chat and lifecycle event shall persist an immutable
  server-derived opaque `audienceId`. It shall be stable across ordinary profile
  revision, policy epoch, and connection replacement and shall remain distinct
  from broad authority class; connector audiences shall bind the installed
  connector instance as well as transport kind. A binding-capable template
  shall never be issued directly: only a trusted in-process issuer may derive
  its opaque audience and server-only instance claim, and the binding profile
  shall require the requested coordinate to match that claim. Projection list/get, lifecycle
  delivery and mutation, binding, continuity, recovery, and runtime operations
  shall authorize the current connection against that audience before revealing
  whether a target exists. Principal/workspace equality shall not grant
  cross-audience access. Production caller sockets shall reject every raw
  `chat_catalog.*` command; only a separately ratified interactive-owner policy
  may administer multiple audiences, without bypassing revision, confirmation,
  lineage, or writer fences. Fork audience inheritance or delegation shall be
  server-owned and durably recorded.
- **AUTH-036** A Drive room relationship shall convey no chat authority. Linking
  a managed session shall require an audience-authorized projection result, and
  Drive fork/tick/wave execution for a managed parent shall use a reviewed
  server-owned coordinator and closed worker profile while preserving accepted
  ADR-0014. Only Do-item claim, wave-item start, or review-gate boundaries may
  admit a clean related worker with structural lineage and bounded `SeedPacket`;
  director ticks shall never fork. Terminal work shall retain an auditable
  `PromotePacket`, send only its bounded summary to the parent through a fenced
  operation, enforce path/worktree isolation, and follow archive-then-drop
  retention rather than raw delete. Until that path passes conformance, Drive
  shall reject a managed target before room mutation or legacy host execution;
  it shall never fall back to raw create, turn, delete, or parent-input
  operations.
- **AUTH-037** Production caller selection shall consume the same explicit
  managed-release expectation as server protocol routing and advertisement.
  Disabled selection shall construct only the compatibility authority; enabled
  selection shall require complete managed preflight and readiness. A missing
  daemon, capability, credential, socket, projection, replay, or session shall
  not be interpreted as a disabled gate and shall never authorize per-operation
  generic Core, raw Hub, force-local, or artifact fallback.

## Reliability requirements

- **REL-001** Row, catalog, binding, and lease mutations shall use transactions
  and optimistic revision checks.
- **REL-002** Invocation replay with identical intent shall be idempotent;
  changed intent under the same invocation shall fail.
- **REL-003** Transcript append shall verify a valid lease and revision.
- **REL-004** Crash recovery shall not infer ownership from PID alone.
- **REL-005** List pagination and ordering shall be deterministic across local
  and hub implementations.
- **REL-006** Activity updates shall not silently change lifecycle.
- **REL-007** Lease tokens shall be returned only on a fresh successful
  acquisition; persisted and read projections shall contain only sanitized
  lease state and a one-way token digest.
- **REL-008** Lost acquire and revoke replies shall be reconcilable through
  sanitized state plus immutable invocation receipts. An old token shall not
  release or otherwise mutate a replacement lease.
- **REL-009** Schema acceptance shall verify required columns, indexes, foreign
  keys, CHECK expressions, and UNIQUE column order. Concurrent migration shall
  serialize, and concurrent first-tenant provisioning shall durably select no
  more than one tenant owner.
- **REL-010** A live long-running purge cleanup shall renew its claim before
  the stale threshold using attempt revision CAS. Receipt/failure persistence
  shall stop renewal and use the latest owned revision; claim loss shall fail
  closed while cleanup remains idempotent by attempt ID.
- **REL-011** Every internal Hub catalog command shall have a strict versioned
  request and result schema shared by client and server. The server shall validate
  normalized input before dispatch and validate output before transmission;
  clients shall reject malformed or version-drifted replies before exposure.
- **REL-012** Lease renewal shall retain the opaque credential, advance the
  lease revision with CAS, and extend expiry from the authority clock. A
  runtime guard shall serialize renewals, expose the current revision, and
  abort on fence loss; stopped guards shall not renew.
- **REL-013** Managed runtime start shall return only after successful session
  registration or complete rollback. Its operation intent, acquire invocation,
  expected revision, cleanup, and release identifiers shall survive retry.
- **REL-014** Generic direct runtime paths shall reject resume or mutation of a
  catalog-managed session. Only a narrowed trusted managed-session facade may
  hold the raw runtime host and writer-gate capability.
- **REL-015** Workspace unregister shall remove enrollment before advancing the
  workspace epoch. Epoch advancement shall invalidate pending capabilities and
  active identities before best-effort socket-close callbacks execute.
- **REL-016** M0 registry state may be process-local. Restart shall fail closed
  by invalidating opaque IDs and capabilities; trusted startup composition
  shall re-enroll and clients shall re-enumerate rather than recovering stale
  path-derived identifiers.
- **REL-017** Concurrent requests for one physical Hub connection shall share
  one workspace-capability acquisition. Closing the client while acquisition
  is pending shall prevent a socket from opening; a later reconnect shall ask
  the provider for a new credential.
- **REL-018** Human confirmation prompts shall have a bounded lifetime and
  shared global and per-connection concurrency limits across direct catalog
  grants and managed-Core requests. Missing, declined, throwing, timed-out, or
  aborted callbacks shall issue no grant and expose only a stable sanitized
  failure. The prompt signal shall be aborted after every terminal outcome so
  a UI cannot retain a live decision handle.
- **REL-019** Internal Hub catalog dispatch shall reassert the same unforgeable
  active connection after every external authorization await and immediately
  before entering the catalog port. Epoch revocation before that boundary shall
  prevent mutation.
- **REL-020** Pending Hub confirmation credentials shall be stored by digest,
  swept after expiry, bounded globally and per connection, generated with
  bounded collision attempts, and bound to a connection ID that is never
  reused during the authority process lifetime.
- **REL-021** Concurrent requests for the same authenticated tenant/principal/
  workspace epoch shall single-flight one managed Core. Authority shall be
  rechecked after asynchronous construction; revocation during construction,
  epoch replacement, unregister, and server shutdown shall retire and dispose
  each resulting Core at most once. Factory scope shall carry an abort signal,
  and factory, retirement, and disposal waits shall be bounded. A Core that
  finishes construction after scope abort shall still return through the pool's
  ownership path; its disposal failure shall be observed and its non-settling
  disposal shall be bounded.
- **REL-022** Configuring a Hub managed-Core factory without workspace
  authority shall fail startup. Factory presence alone shall remain inert.
  While the release gate is off, scoped and unscoped connections retain legacy
  behavior. With the gate on, authenticated scoped connections shall admit only
  exact client register/update/unregister bookkeeping, the bounded read
  projection, and sanitized lifecycle/runtime protocols after target
  authorization. Raw `chat_catalog.*`, all legacy commands, and all legacy
  subscriptions on that scoped connection shall fail before catalog mutation,
  runtime, schedule, global session state, or listener access. Unscoped
  compatibility consumers remain explicit and tested until separately retired.
- **REL-023** Every managed lifecycle command shall have an exhaustive strict v1
  request/result schema. The server shall normalize and freeze input before
  adapter dispatch, pass the active connection abort signal, reassert authority
  after asynchronous work, validate output before transmission, and sanitize
  adapter failures. Empty successful turn or binding results shall be explicit
  `null`, not omitted transport fields.
- **REL-024** Managed event subscription shall require a successfully registered
  client owned by the same authenticated connection. Every adapter emission
  shall pass one strict `chat.changed` schema and the server's session filter
  before listener delivery. Malformed, foreign-session, closed, or revoked
  emissions shall be suppressed, and connection close shall release the source
  subscription exactly once.
- **REL-025** A lifecycle adapter shall not derive `chat.changed` from command
  results or fabricate event IDs, event types, aggregate identity, occurrence
  time, or revisions. Every notification shall project an authoritative
  committed catalog event; read-only and idempotent no-write operations emit
  nothing.
- **REL-026** Workspace or connection revocation observed before a lifecycle
  mutation's final commit boundary shall prevent that mutation. A cancellation
  check only before and after an asynchronous Core call does not satisfy this
  requirement; the abort/epoch fence must participate in or immediately guard
  the authoritative commit boundary.
- **REL-027** Every newly appended catalog event shall atomically persist an
  immutable delivery scope containing canonical workspace identity, target
  audience, and the event-time chat membership snapshot. Delivery shall never
  reconstruct scope from current chats, bindings, sessions, profile state, or
  purge tombstones. Legacy audit rows without complete immutable scope remain
  audit-only and shall not be projected.
- **REL-028** A workspace event source shall read only an explicit metadata
  allowlist and shall never select or return event payload, invocation, actor,
  source, transport, channel, thread, path, prompt, transcript, artifact, or
  credential fields. It shall preserve durable event ID, type, aggregate,
  revisions, and occurrence time exactly.
- **REL-029** Live event subscriptions shall capture an independent
  tenant-global sequence cut per listener, advance across foreign,
  audience-unauthorized, and legacy rows even when no local event matches, page
  in strict sequence order, and use one non-overlapping bounded pump for
  command-triggered and background events. Audience and session filters use
  immutable event-time scope; unfiltered events omit session identity. Abort,
  revocation, unsubscribe, and Core disposal stop polling and suppress late
  delivery.
- **REL-030** A managed client shall validate every lifecycle request before
  transport and every result/event before exposure. Malformed event output
  shall permanently release that subscription and report only a fixed pathless
  error.
- **REL-031** A production managed client shall first probe the public pathless
  `/version` endpoint, then obtain a fresh one-time workspace capability for
  every physical socket and reconnect from the active Hub URL. Before
  capability issuance or transport construction it shall require independent
  `chat_projection.v1`, `chat_lifecycle.v1`, and `chat_runtime.v1`
  advertisement. Generic protocol compatibility or one companion capability
  shall not imply another. After managed authority is selected, the client
  shall never fall back to generic or force-local mutation.
- **REL-032** Caller operation IDs shall be generated once per user intent and
  retained across retry and reconnect. Config restart and recovery shall create
  one structural successor and move bindings with revision CAS; same-ID raw
  restart is not a managed compatibility behavior.
- **REL-033** Pending one-time workspace capabilities shall be bounded globally.
  Issuance shall sweep expired grants before enforcing the bound and shall fail
  closed rather than growing unbounded under an authenticated mint flood.
- **REL-034** Reconnecting clients shall reclaim an idle resident managed
  session only through one explicit atomic ownership-transfer operation. The
  operation shall prove the previous physical connection inactive, compare a
  current writer generation, reject while a run is active, and update runtime
  and lifecycle ownership through one shared coordinator. Behind an exclusive
  guard transition and nonterminal host write barrier, the resident guard's
  private token shall prove one durable lease rekey that rotates the token,
  increments revision and writer generation, updates the writer fence, and
  records replay evidence. Identical operation intent shall replay after a lost
  reply. A replacement physical connection may observe that committed receipt
  only when the prior target is inactive and the shared owner is orphaned at
  the receipt's exact generation; that observation shall report that ownership
  was not transferred. The replacement shall use a new operation ID and that
  committed generation for another durable rekey before subscribing.
  Terminal controller cancellation shall issue an exact-operation
  `chat_runtime.session.reclaim.cancel` command fenced to the same registered
  physical generation. Cancellation before the durable callback begins shall
  abort the guard and host waits and reopen the unchanged writer lease;
  cancellation after durable work begins shall never roll back the successor
  lease and shall instead leave that committed generation orphaned. Only the
  transition's exact target connection may cancel it, and replay shall be
  idempotent. The current owner shall retain that exact cancellation intent
  independently of any bounded response-replay cache; receipt eviction shall
  not weaken post-commit orphan fencing.
  Stop-then-resume, implicit adoption by session ID, and
  process-local connection replacement are not conforming recovery paths. The
  strict reclaim command shall remain unadvertised until the durable mutation
  and conformance suite land together. See [ADR-0042](../../adr/ADR-0042-managed-session-reconnect-authority.md).
- **REL-035** Managed manual compaction shall use one per-session exclusive
  operation bound to session, current writer generation, operation ID, intent
  digest, and server compaction-policy identity. Identical requests shall
  coalesce and terminal replay shall not repeat provider work, persistence, or
  events; changed intent shall conflict. Sidecar-head selection and the
  completed receipt shall commit atomically under the current writer fence. A
  `running` receipt recovered after process loss shall become `indeterminate`
  and shall not execute automatically. See [ADR-0043](../../adr/ADR-0043-trusted-managed-manual-compaction.md).
- **REL-036** Every strict runtime event subscription shall use a fresh opaque
  transport fence captured by that exact server listener and echoed outside the
  runtime event envelope. The client shall deliver fenced output only to the
  matching live listener, shall ignore tokenless or stale output, and shall mint
  a new wire fence for each authorized physical subscription. Subscription
  control shall remain ordered before later commands without serializing
  independent commands. Every physical fence shall have a bounded readiness
  watchdog. Every
  validated singleton shall enter a byte/count-bounded sanitized in-memory
  journal before delivery. A resume shall present the last accepted
  epoch-bearing cursor and receive an exact retained suffix before a fenced
  ready acknowledgement. Failed replay admission shall close the socket and
  shall never yield ready. Recovery shall be single-flight, abortable, limited
  to one genuine same-connection forward-gap attempt, and terminal on stale
  epoch, eviction, cursor mismatch, discontinuity, rejection, timeout,
  cancellation, or a repeated gap. A delayed ready cutoff shall be accepted
  only on the requested stream and when the requested sequence is less than or
  equal to the cutoff and the cutoff is less than or equal to the already
  delivered sequence. A replacement physical connection shall
  not send the cursor subscription until client registration and durable
  resident reclaim complete with ownership transferred to that exact physical
  connection. It shall carry the last accepted cursor into a fresh physical
  fence, accept only the exact retained suffix, and advance reconnect state only
  after the matching ready cutoff. It shall not execute a provider or
  reconstruct persistence. Physical loss shall notify a cursor-bearing strict
  subscription immediately so the shared recovery deadline begins before any
  autonomous reconnect loop. Reclaim command admission and fresh subscription
  admission shall both require the same captured registered-connection
  generation, and a queued frame from a retired socket shall never enter the
  active fence.
- **REL-037** The WebSocket resource policy shall bound active runtime/lifecycle
  source subscriptions per connection, including asynchronous source setup.
  The default shall be 256; both the socket adapter and Hub connection
  transport shall reject new intent before source creation when full. An exact
  duplicate fenced token and intent shall remain idempotent and shall not
  consume another slot. Socket control ingress shall reconcile over bounded
  desired state rather than accumulate an unbounded transition queue. A
  physical source and its callbacks shall remain bound to one admission
  generation; an unsubscribe or replacement shall suppress that source's
  output immediately, and any ingress change observed across asynchronous
  setup shall return through physical cleanup before another admission is
  evaluated.
- **REL-038** Runtime journal session-metadata capacity shall be reserved before
  any durable lifecycle start, related start, checkpoint restore, resume, or
  lost-lease recovery that can create resident state. Reservations shall be
  reference-counted by session and survive an overlapping clear so capacity
  exhaustion cannot leave a committed session or writer lease without runtime
  recovery authority.
- **REL-039** A production managed client shall bound resident session handles
  independently of catalog and binding count and shall reserve capacity for its
  lifecycle subscription within the server source budget. Capacity reclamation
  may quiesce only a session with no run, callback, approval, compaction,
  mutation, or reconnect in flight; it shall preserve chat lifecycle and
  bindings. Active sessions shall never be silently evicted, and an unavailable
  safe slot shall fail with a stable capacity result rather than a global,
  unfenced, or legacy fallback. Connector hosts shall resume bound nonresident
  chats on demand. Transport-unknown operation intents and callback correlation
  state shall also remain bounded; exhaustion shall reject before another
  command is sent rather than evicting an unresolved intent.
- **REL-040** Managed history hydration shall use a strict bounded read-only
  projection, never the mutation-capable catalog port. Each list/get snapshot
  shall return an audience/query-bound snapshot identity and authoritative
  `snapshotSequence`; page cursors shall remain on that cut. Each lifecycle
  event shall carry a durable monotonic `catalogSequence` and a listener-relative
  prior-delivery chain; subscription shall accept an `afterSequence` cursor,
  replay the exact authorized suffix, and emit a fenced ready acknowledgement
  with its processed-through sequence. When retained replay cannot cover the
  cursor, the client shall replace local state from a new authoritative
  snapshot before reporting ready. Joining silently at the current source head
  or mixing pages from different cuts is forbidden. Bounded included session
  and binding summaries shall carry authoritative total counts so callers
  cannot mistake truncation for completeness; any later nested pagination
  shall use a separate audience-filtered contract.
- **REL-041** A fresh caller process reattaching to an established session shall
  use an audience-authorized continuity lookup that returns exactly
  `not_resident`, `owned_elsewhere`, or `orphaned`. A live owner shall fail
  busy; a nonresident session shall use normal resume and existing lease-expiry
  or confirmed-recovery policy; only an orphan may expose sanitized current
  writer generation and bounded runtime baseline for exact durable reclaim.
  After transfer, bounded hydration and event replay shall reach ready before a
  turn. An unknown initial reclaim outcome shall retry the identical operation
  and expected generation, retain exact cancellation through hydration and
  subscription readiness, and never substitute a new takeover intent. A daemon
  restart shall invalidate the resident epoch, and client cursor caches,
  process IDs, or connection IDs shall never become authority. This
  extension shall remain unavailable until proposed
  [ADR-0045](../../adr/ADR-0045-fresh-process-managed-session-reattach.md) is
  accepted; it reuses, and does not alter, ADR-0042's durable rekey.
- **REL-042** Runtime app-observer delivery shall preserve the strict event
  order accepted by the managed controller. A throwing, slow, removed, or
  retained listener shall not corrupt controller correlation, block another
  listener, revive a disposed handle, or receive output from a stale physical
  subscription fence. Each listener shall retain at most one in-flight event
  and a bounded pending queue. The first listener shall receive bounded
  pre-registration replay after internal correlation; queue or replay overflow
  shall produce sanitized fail-closed evidence rather than silently dropping
  an actionable event.
- **REL-043** Interactive abort shall bind to the exact managed turn. If abort
  is requested before the matching `run.started` event reveals its run ID, the
  adapter may retain one bounded abort intent for that turn operation and send
  it immediately after exact correlation. Completion, failure, cancellation,
  disposal, or another turn shall consume the intent without aborting a
  different run.
- **REL-044** One managed history controller shall own initial projection,
  continuation cursors, lifecycle replay, and authoritative replacement.
  Background refresh shall not open an unrelated client, mix snapshot cuts, or
  merge a stale revision over a newer event. Legacy rows may be merged only at
  the app view-model boundary and shall never shadow a managed target.
- **REL-045** Interactive startup, restart, reset, resume, and shutdown shall
  use generation-fenced app state and deterministic disposal. A stale start or
  successor result shall be stopped/released without becoming active; callback
  work owned by the app shall drain before client disposal; Core shall retire
  queued and future event-observer deliveries before controller disposal. An
  observer callback already executing is not awaited and cannot retain session
  authority. Partial construction shall not leak a Core, managed transport,
  session handle, or active listener.

## Privacy and data requirements

- **DATA-001** The catalog shall store metadata and lineage, not duplicate raw
  transcript bodies.
- **DATA-002** Private Claude exports and raw historical chats shall not be test
  fixtures, telemetry, package data, or benchmark gold.
- **DATA-003** Handoff and context-swap artifacts are deferred until retention,
  redaction, provenance, and restore policy are decided.
- **DATA-004** Workspace identity shall be explicit; canonical local paths are
  insufficient for future clone/rename/multi-device equivalence.
- **DATA-005** Opaque workspace registration IDs and capability credentials
  shall contain no reversible or deterministic encoding of filesystem paths.
- **DATA-006** Managed lifecycle results shall omit canonical workspace keys,
  lease credentials, manifest/message paths, raw restored messages, complete
  transcripts, tool calls, and reasoning. Turn output shall be a bounded
  sanitized summary and checkpoint restore shall report only checkpoint metadata
  plus the restored message count.
- **DATA-007** Every schema-valid managed runtime result and event shall fit a
  final UTF-8 serialized-byte budget beneath the default outbound WebSocket hard
  watermark. Variable collections shall paginate, Unicode text shall be
  byte-bounded, and failure to queue a non-replayable runtime reply or event
  shall close the socket so the client cannot mistake loss for completion.

## UX contract for M1

```text
cline chats --state active|archived|all [--workspace <key>]
cline chat show <chat-id>
cline chat archive <chat-id>
cline chat rename <chat-id> <title>
cline chat resume <chat-id>
cline chat fork <chat-id>
cline chat purge <chat-id> --confirm
```

The TUI shall expose Active and Archived views, show execution status as a
separate badge, order by last activity, and show fork/restore/recovery lineage.

## Milestone 0 acceptance matrix

| Case | Required result |
|---|---|
| Other workspace | Excluded by workspace-scoped list |
| Completed active chat | Remains active |
| Failed archived chat | Remains archived |
| Plain interactive `/new` | Stops/unbinds; transcript preserved; lifecycle unchanged |
| Plain connector `/new` | Same result as interactive |
| Archive running | Conflict unless explicit stop-and-archive |
| Two resumes | One lease winner; no transcript overwrite |
| Run versus manual compaction | Exactly one per-session admission winner; loser fails before provider/write |
| Manual compaction replay | Same terminal receipt; no second provider call, write, or event |
| Manual compaction after process loss | Prior running receipt becomes indeterminate; no automatic repeat |
| Manual compaction commit | Canonical messages unchanged; sidecar head and terminal receipt move atomically |
| Ungranted callback | Rejected before a request event or client interaction |
| Callback response mismatch/replay | Wrong connection/session/run/name, malformed result, and duplicate fail without consuming another request |
| Callback expiry/abort race | Timestamp-expired or aborted request cancels once; later response fails |
| Callback stop/reclaim/authority-loss/dispose | Pending callback cancels before stop or reclaim waits; writer loss cancels before the Core run settles; retry/dispose cannot revive it |
| Physical WebSocket callback | Fresh workspace capability → registration → managed start/turn → callback event/response → terminal turn; stop cancels and a late response fails |
| Managed destructive confirmation | Strict command → invocation-scoped Core request → frozen target-only owner prompt → final command-lifetime mutation fence; no caller confirmation field or credential crosses the wire |
| Confirmation decline/throw/timeout | Stable sanitized failure; no grant or catalog mutation; prompt signal retired |
| Confirmation disconnect/revoke/shutdown | Prompt aborts; late approval and retained Core callback cannot mutate or mint authority |
| Confirmation revision race | Revision change while the owner prompt is pending rejects before stop/revoke/cleanup side effects |
| Exact confirmed-operation replay | Fresh bound decision may replay the immutable receipt; no second external side effect or catalog mutation |
| Mixed confirmation flood | Direct and managed prompts consume one per-connection budget; request above the bound rejects before another owner callback |
| Start-time prompt | Rejected by the strict managed start profile |
| Runtime sequence gap | One same-connection gap releases its old fence and replays one exact retained cursor suffix; a repeated/unavailable gap is terminal |
| Delayed runtime readiness | Same-stream cutoff within requested ≤ ready ≤ delivered succeeds; any outside cutoff is terminal |
| Global managed subscription | Lifecycle events only; no wildcard or silently partial runtime feed |
| Runtime journal metadata full | Reservation fails before durable Core start/resume mutation |
| Subscription flood | Active plus pending setup stops at the policy cap before another source is created; release restores capacity |
| Slow runtime subscriber | Adjacent same-subscription/session/run assistant deltas merge in place with exact sequence coverage; loss of required output closes the socket |
| Runtime resubscribe fence | Queued or in-flight output from the released fence is ignored by the replacement listener; reconnect mints a fresh fence |
| Physical runtime loss | Cursor-bearing listener reports reclaim immediately; no unbounded autonomous retry precedes the controller deadline |
| Reclaim generation changes before send | No command is sent on the newer socket; retry captures and uses that registered generation explicitly |
| Reclaim cancel before/after durable callback | Pre-durable waits abort and unchanged authority reopens; post-commit successor remains durable but its process owner becomes orphaned |
| Retired socket queued frame | Dropped before parsing or fence routing |
| Lost lease acquire reply | Sanitized read → owner-confirmed CAS revoke → replacement token |
| Lost lease revoke reply | Fresh confirmation replays immutable applied receipt; no second revoke |
| Superseded lease token | Cannot release or mutate the replacement lease |
| Stale binding clear | Cannot erase newer binding revision |
| Fork/checkpoint | New active chat with queryable lineage |
| Purge cleanup failure | Retryable deleting tombstone |
| Leftover manifest | Cannot resurrect purged chat |
| Local versus hub | Same conformance result |
| Plugin tool mutation attempt | Rejected before catalog write |
| Unsupported backend mutation | Explicit unsupported capability; no local fallback |
| Caller supplies workspace path while minting | Schema rejection; no capability issued |
| Unknown/cross-owner workspace ID | Same generic unauthorized-registration failure |
| Workspace symlink aliases | One canonical enrollment and opaque ID |
| Cross-socket public client spoof | Registration/update/unregister/command/subscription rejection |
| Workspace unregister/revoke | Enrollment removed; pending grants invalid; active identities fenced before close callback |
| Raw catalog on production caller socket | Rejected for every audience, including interactive owner |
| Cross-audience known chat ID | Projection, event, lifecycle, binding, continuity, recovery, and runtime all reject before existence disclosure |
| Two installed instances of one connector transport | Distinct opaque audiences; each rejects the other's binding, projection, event, continuity, and runtime target |
| Interactive cross-audience administration | Allowed only by the ratified owner policy; normal revision, confirmation, lineage, and writer fences still apply |
| Pre-audience row with exact immutable stamp | Restartable migration assigns the server-mapped audience and appends the first scoped migration event |
| Pre-audience row with missing/ambiguous stamp | Quarantined non-runnable; absent from ordinary projection/events; available only in bounded privileged migration inventory |
| Historical event without target audience | Audit-only; never replayed to a production caller |
| Multi-page history snapshot | Every cursor remains bound to one audience/query snapshot identity and sequence; expired or mismatched cursor restarts cleanly |
| Managed runtime app observer | Internal correlation updates first; first listener receives bounded pre-registration replay; later frozen events use one in-flight callback plus a bounded ordered queue; throw/overflow/unsubscribe/dispose/stale-fence cannot corrupt, silently drop actionable replay, or revive delivery |
| Abort before run correlation | One bounded intent waits for the matching `run.started`, aborts only that run, and is consumed by any terminal race |
| Managed profile smuggling | Unknown start-profile fields, credentials, absolute paths, and parent traversal reject before managed admission |
| Malformed managed successor | Successor is stopped/released, predecessor is retired/released on adapter-wide failure, and neither context can deliver another app event |
| Managed reattach before ADR-0045 | Interactive adapter exposes no resume, reattach, or recovery method; no local or ordinary-start substitute is attempted |
| Managed config restart | One revision-bound structural successor; no same-ID restart, transcript clone, mutable-lineage metadata, or connection-label patch |
| Managed history action | Rendered target retains chat/head/state/revision through admission; stale revision refreshes and requires a new destructive action |
| Legacy history action | Visibly Legacy and read-only; no managed mutation and no heuristic adoption |
| Enabled caller with unavailable Hub | Stable managed startup failure; Legacy/Core/local/artifact implementation is never constructed as fallback |
| Lifecycle reconnect after snapshot | Exact authorized chained suffix reaches fenced ready, or local state is replaced from a new authoritative snapshot |
| Fresh process, live resident owner | `owned_elsewhere`; busy without generation, cursor, connection ID, or target leakage |
| Fresh process, orphaned resident owner | Sanitized generation/baseline → exact durable reclaim → bounded replay → ready before turn |
| Daemon restart with durable lease | New resident epoch follows nonresident resume/expiry/confirmed recovery; cached cursor is not authority |
| Managed Drive room link | Audience-authorized projection before relationship mutation; link grants no runtime/lifecycle authority |
| Drive director tick | May advance an existing legal worker; never creates a worker fork |
| Legal Drive worker boundary | Clean related session with structural lineage + bounded SeedPacket; terminal PromotePacket/audit retention; bounded fenced parent summary only |
| Managed Drive fork/tick/wave before coordinator proof | Rejected before room mutation or legacy `sessionHost` execution |
