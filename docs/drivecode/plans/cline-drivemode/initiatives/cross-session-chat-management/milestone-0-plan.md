# Milestone 0 · Authoritative chat lifecycle

**Objective:** prove one durable catalog, one lifecycle/binding writer, and safe
reset/resume semantics before building Active/Archived UI or semantic memory.

## Non-goals

- No transcript summarization or rewriting.
- No automatic context swapping.
- No semantic search, tags, folders, or recommendation model.
- No import of Anthropic exports.
- No per-file/per-agent knowledge projection.
- No plugin-authorized lifecycle mutation.
- No production migration before legacy adoption policy is approved.

## Work order

### M0.0 · Decision and baseline fixtures

1. Review and amend ADR-0041.
2. Freeze lifecycle vocabulary and error codes.
3. Add fixtures covering interactive root, connector-bound root, fork,
   checkpoint restore, stale binding, concurrent resume, and purge failure.
4. Record current contradictory reset behavior as regression tests before
   replacing it.

Exit: proposed contract is executable and current unsafe behavior is visible.

### M0.1 · Schema and migration harness

Add versioned tables for chats, session membership, bindings, events, and
leases. Add foreign keys/indexes for workspace+state+activity, session lookup,
lineage, binding uniqueness, and lease expiry.

The private proof uses new fixtures and idempotent root adoption only. Do not
bulk-classify real legacy sessions yet.

Exit: repeated migration/adoption yields identical rows and events.

### M0.2 · Pure domain kernel

Implement typed records, transitions, validation, deterministic ordering,
revision conflict codes, and idempotency digest rules without filesystem or
runtime calls.

Exit: transition/property tests prove lifecycle is orthogonal to execution and
binding.

### M0.3 · Local ChatCatalogService

Implement transactional list/get/archive/activate/bind/unbind/lease/lineage and
tombstoned purge orchestration. Keep artifact deletion behind an injected port
so cleanup failure can be tested.

Exit: SQLite contract suite passes against two service instances sharing one
database.

### M0.4 · Hub port and parity

Add sibling catalog commands and client methods. Run the same conformance suite
against local and hub adapters. Explicitly reject unsupported file/remote
backends instead of falling back locally.

Exit: local and hub results, conflicts, and event provenance match.

### M0.5 · Lifecycle path convergence

Prerequisite: the shared daemon must bind catalog authority to a server-owned,
owner-authenticated connection scope. Caller-provided registration workspace,
actor kind, client ID, and the daemon's startup cwd are not catalog authority.
If that scope or trusted human confirmation path is unavailable, hub catalog
capability remains omitted and mutation fails closed.

1. Adopt root sessions transactionally.
2. Replace interactive reset with stop → unbind → preserve.
3. Replace connector reset/config-change deletion with the same operation.
4. Add explicit stop-and-archive path.
5. Acquire lease before resume writes.
6. Record fork/checkpoint/recovery lineage structurally.
7. Route binding changes through catalog CAS.

Exit: no reset path invokes destructive session deletion; concurrency and stale
binding tests pass.

### M0.6 · Compatibility projection

Build an internal history projection over cataloged chats. Keep old history as
a compatibility reader for unadopted legacy records, clearly labeled Legacy.
Manifest data may enrich known records but cannot create lifecycle state.

Exit: workspace filtering and last-activity ordering pass; no leftover artifact
can resurrect a tombstone.

### M0.7 · Adversarial review and evidence

Run authority, concurrency, crash, migration, privacy, and plugin-boundary
reviews. Produce an evidence ledger with exact commands and fresh database
fixtures. Keep ADR-0041 Proposed until owner review and all acceptance evidence
passes.

Current evidence and open findings are maintained in
[m0-evidence-ledger.md](m0-evidence-ledger.md). A green focused suite is not, by
itself, permission to advance the ADR or publish the catalog authority.

## Planned implementation surfaces

| Layer | Expected area |
|---|---|
| Shared types/schema | `sdk/packages/shared/src/session/` and SQLite migrations |
| Domain/service | `sdk/packages/core/src/chat-catalog/` |
| Local backend | core storage/service composition |
| Hub transport | shared hub commands + core hub handlers/client |
| Interactive integration | `apps/cli/src/runtime/interactive/session-runtime.ts` |
| Connector integration | `apps/cli/src/connectors/session-runtime.ts`, bindings, host |
| Compatibility CLI/TUI | history projection and picker |
| Plugin boundary | read-only bounded summary contract; mutation refusal tests |

Paths are planning targets, not permission to force the design into existing
modules if code review identifies a cleaner boundary.

## Test suites

1. Pure transition and deterministic-order tests.
2. SQLite migration, adoption, CAS, replay, and lease tests.
3. Local/hub conformance tests.
4. Interactive/connector reset parity tests.
5. Concurrent resume and transcript lease tests.
6. Fork/checkpoint/recovery lineage tests.
7. Tombstoned purge and resurrection tests.
8. Unsupported backend and force-local bypass refusal tests.
9. Plugin/model mutation authority tests.
10. Existing session/history/fork/connector regression suites.
11. Commit-time stale-generation rejection across transcript, compaction,
    metadata, status, and manifest persistence.
12. Renewal/write serialization, failed-start rollback, callback drain, and
    stop-before-release race suites.
13. Generic create/resume bypass rejection and no-credential transport/log
    assertions.

## Release gates

- Harrison chooses the legacy adoption policy.
- Workspace identity is sufficient for the release topology.
- Connector actor authentication and authorization are explicit.
- Lease crash-recovery policy is reviewed.
- Retention and privacy purge semantics are documented.
- No destructive connector reset remains.
- A fresh local and hub fixture proves identical lifecycle behavior.
- A durable persistence fence rejects a stale writer at commit, not merely at
  a preceding verification check.
- Runtime registration/rollback and quiescence are explicit host contracts.
- Lease credentials remain server-side and generic hub/plugin surfaces cannot
  submit them.

## Implemented authority kernel (2026-08-14)

- Shared `sessions.db` now carries `writer_generation` and
  `session_writer_heads`; acquire/takeover advances generation while renewal
  advances lease revision only.
- Every catalog-managed row/artifact commit validates active token, expiry,
  and exact writer generation in the same immediate SQLite transaction that
  advances the authoritative head/commit sequence.
- Transcripts, compaction, manifests, metadata, status, and generic
  create/replace/delete bypasses fail closed for stale or absent authority.
  The generic SQLite mutation callback is ECMAScript-private, typed operations
  bind the target session structurally, and public query helpers accept only
  `SELECT` statements.
- `LocalRuntimeHost` registers lifecycle before startup awaits, serializes
  renewal with persistence, and issues a quiescence receipt only after startup,
  turns, persistence, agent/runtime/team/plugin producers, and terminal state
  are drained in order.
- `CatalogManagedSessionRuntime` releases only after that receipt. Any startup,
  producer, or terminal-persistence failure retains authority for explicit
  recovery or expiry.
- Brand-new root admission no longer depends on an unfenced generic create.
  One `BEGIN IMMEDIATE` transaction inserts or validates the inert session
  reservation, creates the root chat and membership, installs writer head
  generation 1, and grants the first hash-only lease. A conflict rolls back all
  of those rows; an exact operation replay never reissues the plaintext token.
- Initial root materialization accepts only the admitted writer fence. The
  session upsert preserves foreign-key identity with `ON CONFLICT DO UPDATE`,
  while empty messages and manifest candidates publish through the same
  generation head used by later transcript and compaction commits.
- The trusted managed runtime now has sanitized `startRoot` and `startRelated`
  paths and shares a guard-before-bootstrap execution sequence with resume. UI
  callers receive session/chat/revision/expiry state only; lease credentials
  stay inside core.
- Managed `restoreCheckpoint` now uses a read-only extraction phase followed by
  atomic `checkpoint_restore` branch admission, lease guarding, transactional
  worktree application, fenced host startup, checkpoint-ref retention, and
  worktree commit. Apply/start failure rolls the worktree back while uncertain
  writer authority remains retained. The restore target is pinned to the
  replacement session workspace and the public result remains credential-free.
- `ClineCore.create({ backendMode: "local", chatLifecycle: ... })` now composes
  the exact SQLite session database/tenant, eager catalog schema, local port,
  coordinator, verifier, host, and managed runtime. Managed composition rejects
  auto/hub/remote routing, file fallback, storage mismatch, unresolved or
  cross-workspace starts, and retry-unstable session IDs.
- `ClineCore.chatLifecycle` preserves preparation/bootstrap/telemetry semantics,
  rejects generic start/guarded-stop/guarded-send and checkpoint-restore bypass,
  carries prompt images/files, retains guards after failed start/stop, and
  releases quiescent sessions before host/storage disposal. Managed turns
  require stable operation identity, execute under the resident guard, and
  advance catalog activity from the fenced persisted session timestamp; queued
  turns retain their optional immediate result. Unmanaged Core instances fail
  with `unsupported_capability` rather than inviting an implicit generic
  fallback.
- Applied renewal replies always advance the release handle, including a
  renewal-versus-stop race; lost release replies replay the original operation.
- Coordinator bind, branch, and recovery calls now require stable operation
  identity. Lost successful lineage replies reconcile the already-applied
  structural relationship before attempting another mutation, so a newer chat
  revision does not turn a valid retry into changed-intent replay.
- Managed binding lookup, bind, and reset now cross the sanitized Core facade.
  Lookup is workspace-scoped, bind requires the resident guarded session, and
  reset performs host quiescence before deterministic CAS unbind and exact
  lease release. Reset retry is pinned to its original operation identity;
  client detach and ordinary shutdown remain distinct lifecycle concepts.
- Local managed composition now accepts an explicit host confirmation callback.
  The callback sees only action, aggregate identity, and observed revision;
  hidden invocation identity and the 256-bit one-time grant remain in Core.
  Missing or declined confirmation fails before grant issuance.
- `recoverLostLease` now confirms exact-revision revocation, uses deterministic
  revoke/acquire steps, advances writer generation, installs a replacement
  guard, and starts through the same prepared Core path. Old credentials fail
  the durable fence and sanitized results reveal neither credential.
- Connector reset, config-change reset, and shutdown stop and detach without
  deleting session history. Failed quiescence retains the observed binding,
  and unavailable runtime authority performs no destructive local fallback.
- The compatibility history projection is catalog-first for local SQLite:
  one row per chat head, canonical last-activity ordering, workspace filtering,
  Active/Archived labels, explicit Legacy fallback, structural lineage
  metadata, direct head resolution outside the bounded legacy scan, and
  tombstone/deleting suppression before artifact fallback. Unscoped history
  enumerates catalog workspaces directly, and the reader is bound to the exact
  session backend database and tenant.
- Focused proof: 119 authority tests, 60 connector tests, 33 projection/history
  core tests, 26 CLI history tests, and 110 authenticated-Hub boundary tests.
  The latest full core run passes 2,146 tests (14 skipped); the latest full CLI
  proof passes 1,070 tests.
  Final authority adversarial review returned
  **Approve** with no P0/P1 for the persistence/quiescence slice; the later
  authenticated-Hub confirmation re-review also returned **Approve** with no
  concrete remaining P0/P1. The managed-Core pool/composition review found and
  closed epoch-orphan, tuple-collision, downgrade, shutdown, schedule/runtime,
  global client-list, and wildcard subscription paths; its final re-review
  returned **Approve** with no remaining P0/P1 in the bounded slice.
  The concrete factory review then found and closed two P1s—metadata-only
  capability gating and detached late-Core cleanup—and its re-review returned
  **Approve** with no new P0/P1 in the bounded factory slice. The final
  mutation-boundary review also returned **Approve** with no P0/P1 after the
  host-only fence was carried through synchronous SQLite entry, asynchronous
  purge, and trusted pool retirement. Its defense-in-depth recommendation to
  abort retirement descendants after disposal was applied and retested.
  The event-source architecture review prevented mutable post-purge scope from
  landing; its implementation reviews then found and closed post-commit result
  coupling, poisoned-cursor retry, disposed-source reopen, and released-listener
  batch delivery plus malformed-event acknowledgement and pre-filter validation
  as six P1s, each with a focused regression. The final re-review returned
  **Approved** with no remaining concrete P0/P1.
  The production-convergence foundation review then found and closed scoped
  metadata leakage, registration-retry, malformed outer-frame, callback
  isolation, selector-rejection, and filesystem-evidence gaps. Its re-review
  returned **Approved** with no remaining P0/P1; the release gate remains off
  because daemon composition and caller convergence are still open.
  The inert daemon-composition review then found and closed cross-workspace
  singleton reuse, partial transport-start rollback, and relative-cwd drift.
  Its final re-review returned **Approved** with no remaining P0/P1; PC-2 is
  complete while the release gate remains off.
- PC-3 now composes ten stable daemon-owned start profiles and matching
  server-issued authority classes for interactive, six connectors, ACP, Zen,
  and automation. The default public owner capability can select only the
  interactive profile. Credential lookup, system prompts, runtime/tool policy,
  and connector transport remain host-owned.
- Every managed start now persists a reserved writer-fenced profile authority
  stamp. Resume, lost-lease recovery, fork, checkpoint restore, and recovery
  reject semantic profile drift before acquiring a lease or mutating the
  catalog; `config_restart` may revise policy only within the same profile and
  authority class. Per-turn mode requests are bounded by the persisted stamp,
  headless interactivity is preserved through host startup, tool policy is
  deny-default with explicit names, and managed-Core pooling includes the full
  normalized connection-policy digest.
- The PC-3 adversarial review initially found three P1 authority defects:
  cross-class `config_restart`, wildcard future-tool expansion, and forced
  interactivity for headless profiles. It also identified missing-stamp,
  mandatory-field, claim-identity, and deep-immutability hardening. All were
  fixed with focused regressions; the independent re-review returned
  **Approved for inert gate-off integration — no P0/P1**. The release gate
  remains off for the open PC-3 target-authority work and PC-4 through PC-8.
- A later production-caller audit separated profile continuity from target
  authority. Profiles and writer-fenced continuity are implemented, but a
  scoped socket can still reach raw catalog operations and target a known chat
  from another audience. Immutable chat/event audience scope, server-side
  target authorization, bounded projection reads, and an explicit
  interactive-owner administration policy remain release blockers.
- PC-4 now has an exhaustive `chat_runtime.v1` command/result/event wire and a
  bounded inline-attachment extension on lifecycle turn submission. Scoped Hub
  sockets route and validate runtime commands, multiplex strict lifecycle and
  runtime events, and recognize the runtime family as workspace authority.
- The resident managed adapter admits only sessions successfully started or
  resumed through managed lifecycle. It provides sanitized prompt/message/
  checkpoint/usage/compaction reads, process/session event sequences, assistant
  and tool status streaming, current-run-only abort, connection/run-bound
  one-shot tool approvals, private temporary attachment materialization with
  cleanup, byte-bounded close-on-loss delivery, sequence-gap detection, and a
  strict client adapter. Accepted ADR-0042 also provides durable resident
  reclaim through lease rekey, host drain, and one runtime/lifecycle owner
  transition. Focused Shared and Core matrices pass; the release gate remains
  off.
- PC-4 now includes the second ADR-0043 host-owned manual-compaction checkpoint:
  strict managed dispatch, daemon-owned config/provider selection, per-session
  run exclusion, disconnect cancellation, direct writer-fenced sidecar
  persistence without agent restore, durable
  running/completed/skipped/failed/indeterminate receipts, atomic
  sidecar-head-plus-completed-receipt commit, exact-sidecar replay, rollback
  proof, and replay-safe sanitized terminal events plus a terminal wire result.
  Fenced resident-admission recovery and database-level one-running-per-session
  enforcement and second-store competing-claim proof are complete. Production
  profile authorization and the complete stop/rekey/renew/process-loss matrix
  remain open. Execution-policy digest binding is complete and the host fails closed
  unless the profile explicitly grants manual compaction; current production
  daemon profiles do not.
- PC-4 now has its first capability-specific callback. Interactive profile
  revision 2 / policy epoch 2 grants only
  `tool_executor.askQuestion`; exact bounded request/result schemas, immutable
  manifest/digest binding, one-shot owner/session/run/capability correlation,
  authoritative expiry before timer dispatch, malformed/duplicate fencing, and
  abort/disconnect cancellation are implemented. The production interactive
  resolver now round-trips through a fresh one-time workspace capability and
  physical WebSocket, managed factory, lifecycle wire, callback event, runtime
  response wire, and completed turn without projecting private context. A
  second callback-bearing turn proves stop-time cancellation and late-response
  rejection.
- Callback stop, disconnected-owner reclaim/retry, resident writer-authority
  loss, and disposal races now fail closed. Stop cancels before awaiting Core;
  writer loss rejects the callback while its Core run is still unsettled; a
  late successful run result projects as aborted. The browser socket now orders
  earlier subscription controls before later commands and releases a
  subscription that settles after close, without serializing active commands.
  Shared typecheck plus **2 files/19 tests** and Core typecheck plus **12
  files/147 tests** pass for the consolidated checkpoint.
- PC-4 now has range-aware additive assistant delivery. The strict wire uses a
  canonical singleton or a bounded inclusive session-sequence range; the client
  rejects true gaps, overlaps, and regressions. Under soft pressure, only the
  globally newest adjacent queued delta for the same fenced
  subscription/session/run merges in place. Unicode byte accounting, semantic
  barriers, endpoint metadata, hard-bound closure, stale queued-frame fencing,
  and physical workspace-WebSocket delivery pass focused proof. A
  review-discovered socket-epoch flaw was fixed with a fresh opaque transport
  subscription ID that Node enforces and regenerates on reconnect.
  Shared typecheck plus **1 file/10 tests** and Core typecheck/smoke plus **15
  files/192 tests** pass for this checkpoint; targeted Biome, Drivecode
  document checks, and **2/2** Mermaid parse validation are clean.
- PC-4 now has one-shot cursor-anchored bounded recovery. Each resident session
  owns a stable in-process stream epoch and a bounded immutable sanitized event
  journal. Fresh readiness supplies an atomic sequence-zero-capable baseline;
  one genuine same-connection gap replays an exact retained suffix before a
  matching readiness cutoff. Stale epochs, eviction, duplicate-token intent
  changes, replay admission failure, acknowledgement timeout, cancellation, and
  repeated gaps fail terminally. A physical workspace WebSocket proves exact
  `[1, 2, 3]` delivery after event 2 is withheld from the first fence. Physical
  reconnect remains caller-gated: register, durable reclaim, then create a new
  cursor subscription; automatic transport resubscribe reports
  `session_reclaim_required`.
- PC-4 recovery hardening now requires strict runtime subscriptions to name one
  session, keeps the explicit global lifecycle-cursor lane lifecycle-only,
  rejects unfenced global subscriptions before Core construction, accepts delayed
  readiness only within the same-stream requested-through-delivered interval,
  and reserves runtime-journal metadata before any durable resident admission.
  A central default-256 policy bounds active plus in-flight sources. The socket
  adapter reconciles bounded desired state, generation-fences each physical
  source, restarts cleanup after ingress changes across source setup, and drops
  superseded-source events. Nine reproduced P1s were closed; final independent
  review returned **Ship**. The consolidated Core matrix passes **10 files/218
  tests**, including focused Browser **23/23**.
- PC-4 now has a shared replacement-socket controller in the Core Hub client
  layer. It owns sanitized writer generation, connection generation, and cursor
  continuity; retries one stable reclaim intent across a lost reply; treats an
  orphan reconciliation receipt as non-owning; and completes a new-operation
  durable rekey before a generation-guarded cursor subscription. A real
  three-socket workspace WebSocket proves fresh registration, second socket
  loss during reclaim, exact replay, and readiness. Four independent-review P1
  traces plus one narrow re-review P1 are now covered: immediate loss
  notification, generation-fenced
  reclaim send, retired-socket output rejection, and exact-operation
  cancellation before/after durable commit, including after bounded receipt
  eviction. Shared **54 files/503 tests** and
  the focused Core authority matrix **9 files/236 tests** pass, along with both
  package typechecks and builds. Final independent re-review found no actionable
  P1/P2. Its proof-scope follow-ups now pass controller **5/5**, real-adapter
  physical WebSocket **14/14**, and host **84/84** suites; the startup-settlement
  wait is documented as a defensive, publicly unreachable transition state.
- Managed start/resume profiles are now admission-only. The strict wire rejects
  `start.prompt`, the factory cannot pass an initial prompt into Core, and
  Shared typecheck plus **1 file/10 tests** prove every prompt-bearing turn must
  enter through `chat_lifecycle.run_turn` after resident registration.
- PC-4 is not complete: production callers have not adopted the shared
  reconnect controller; remaining manual-compaction production
  authorization/race proof, reasoning display policy, caller-driven checkpoint
  comparison if required, and all-caller callback/runtime conformance remain.

The remaining release work includes complete interactive/connector command-path
convergence (including config restart, fork, restore, recovery, and shutdown),
catalog-aware destructive history UX, audience-to-target authorization, a
bounded snapshot/replay history projection, fresh-process established-session
reattach, Drive room/fork/wave convergence, and complete authenticated Hub
runtime parity. Inert authenticated-Hub daemon composition and profile
resolution/continuity, target authority, bounded projection/reattach, and the
confirmation-authority kernel are implemented with the release gate off;
production owner-responder wiring, the remaining runtime companion behavior,
and caller cutover remain deliberately fail-closed.
The durable local authority kernel, mandatory-SQLite Core composition,
transactional fresh-start prerequisite, and M0.6 local projection are no
longer blockers.

## Audited all-at-once lifecycle cutover

The 2026-08-14 production call-site audit found no interactive or connector
caller using `ClineCore.chatLifecycle` yet. Enabling the managed composition for
only some calls would break or bypass authority, so the following work is one
ordered cutover program rather than independently releasable toggles.

1. **Atomic derived admission.** The local service, port, coordinator, managed
   runtime, and sanitized Core facade now reserve a new session, attach `fork`,
   `checkpoint_restore`, `config_restart`, or `recovery` lineage, install writer
   head generation 1, and grant the first lease before host startup or artifact
   materialization. Stable operation and session IDs are mandatory and exact
   replay never reissues a lost token. Local managed checkpoint extraction and
   transactional restore now use this boundary. The authenticated Hub
   equivalent remains part of this cutover program.
2. **Complete the sanitized lifecycle facade.** Related start, binding lookup,
   guarded bind, quiescent reset, and checkpoint restore are now exposed
   without credentials. Confirmation-backed lost-lease recovery is also
   exposed locally. Confirmed archive/activate/purge and revisioned rename are
   now exposed locally; stop-and-archive may clear bindings in the same catalog
   transaction, and purge uses strict cancellable artifact cleanup. Production
   owner UI and caller adoption remain. Carry dynamic connector
   provenance per operation only after it is validated by the host.
3. **Build a trusted confirmation bridge.** The gate-off host kernel now binds
   archive/activate/purge/resume-recovery decisions to one authenticated command
   invocation, checks the Core target, and gives the owner callback only frozen
   display data plus an abort signal. Production owner-surface selection and
   wiring remain part of the all-at-once caller cutover.
4. **Converge interactive runtime calls together.** Switch fresh start, resume,
   turns, same-ID config restart, reset, shutdown, fork, restore, missing-session
   recovery, and destructive history actions in one changeset. A managed Core
   must reject every generic operation capable of starting or mutating a
   managed session.
5. **Replace raw Hub session lifecycle.** The daemon must pool managed Core
   instances by authenticated canonical workspace and expose a sanitized
   lifecycle wire. The private pool kernel now keys by authority-issued tenant,
   principal, canonical workspace, and epoch; it single-flights construction,
   fences revoke-during-create, and disposes on epoch replacement, unregister,
   or shutdown. Its server composition seam rejects missing workspace authority
   and currently applies an inert managed-server bootstrap allowlist: client
   register/update/unregister plus authenticated catalog dispatch only. That
   raw catalog route is not a production caller boundary and must be removed
   before the gate can open. Global
   client listing, legacy subscriptions, and every runtime/schedule/drive/
   status/settings route fail closed. Factory/retirement/disposal waits are
   abortable and bounded. The exhaustive strict v1 lifecycle request/result
   wire and authenticated dispatch seam are implemented for all 14 managed
   commands. The strict pathless `chat.changed` event projection and
   authenticated registered-client subscription seam are also implemented. The
   concrete local ClineCore factory now resolves opaque runtime/binding
   profiles, strips resolver path/session overrides, binds confirmation to the
   current authenticated invocation, and maps and validates all 14 commands. A
   host-private final
   mutation fence now reasserts active authority immediately before synchronous
   SQLite entry, follows purge across asynchronous cleanup and terminal writes,
   and isolates trusted retirement through invocation-local context. The
   synthetic command-result notification is now replaced by schema-v4
   authoritative SQLite events with atomic immutable workspace/event-time
   membership scope, tenant-global ordered cursors, per-listener live cuts, a
   metadata-only allowlist, and one bounded immediate/background pump.
   A strict client adapter, selector-free singleton owner capability endpoint,
   and fresh-per-socket cross-process provider now exist. Factory presence is
   inert for legacy traffic: only the release gate plus an authenticated scoped
   connection selects managed routing. Production runtime parity,
   target authorization, bounded projection/reconciliation, the production
   confirmation surface, and caller cutover remain. Profile resolution and
   inert daemon composition are implemented.
   `session.detach` remains client detachment only; quiesce, lease release,
   reset, and process shutdown receive distinct commands.
6. **Authorize targets and reconcile history.** Persist immutable chat/event
   audience scope and authorize every projection, event, lifecycle mutation,
   binding, continuity, recovery, and runtime target before existence is
   disclosed. Production caller sockets reject raw `chat_catalog.*`. Add a
   restartable migration that backfills only an exact immutable profile stamp,
   quarantines every ambiguous row, and keeps historical unscoped events
   audit-only. Add a
   bounded read-only projection with one audience/query-bound snapshot identity
   and sequence across all pages, plus durable chained lifecycle event cursors,
   exact authorized replay, and fenced readiness. Reconnect must replay from
   the snapshot cut or replace local state from a new authoritative snapshot;
   it cannot join silently at the source head.
7. **Make catalog binding authoritative.** Migrate external thread-to-chat
   ownership from the connector JSON sidecar to revisioned catalog bindings.
   Adapter state may remain a delivery cache, but it cannot decide lifecycle.
8. **Preserve restart continuity.** Clean connector shutdown drains/quiesces and
   releases writers without clearing bindings. Restart resolves the binding and
   resumes; config changes create one `config_restart` successor and missing
   runtimes create one `recovery` successor with a CAS binding move. A fresh
   process uses an audience-authorized nonresident/live-owner/orphan continuity
   lookup before ordinary resume or exact durable reclaim, then hydrates and
   replays to ready before accepting a turn.
9. **Cut over all six shared-host adapters together.** Discord, Google Chat,
   Linear, Slack, Telegram, and WhatsApp share the same connector host. Run one
   adapter-to-WebSocket-to-managed-Core conformance suite and retain negative
   assertions against generic start/send/detach-as-stop/delete and direct
   SQLite fallback.
10. **Converge Drive explicitly.** Managed room links resolve through the
    bounded projection. Fork/tick/wave workers use a reviewed server-owned
    Drive coordinator and closed worker profile beneath accepted ADR-0014:
    hard-boundary-only admission, clean related lineage, bounded `SeedPacket`,
    path/worktree isolation, retained `PromotePacket`/audit handle,
    archive-then-drop retention, and fenced bounded parent summary. Director
    ticks never create forks. Until that path passes, reject managed targets
    before room mutation or legacy `sessionHost` access.

The cutover fails closed if authenticated workspace scope, managed authority,
binding CAS, confirmation, or quiescence is unavailable. It does not fall back
to a raw `LocalRuntimeHost`, generic Core lifecycle, `session.delete`, or local
database mutation.

The caller-level design is now expanded in
[caller-adoption-plan.md](caller-adoption-plan.md). It selects a separate
Core-owned managed Hub facade, preserves `HubSessionClient` as an unscoped
compatibility/schedule client, inventories every production caller, and makes
lost lifecycle-admission replies an explicit pre-cutover proof obligation:
exact replay may reveal the sanitized committed generation, but a replacement
socket must still complete durable reclaim before it can subscribe or run a
turn. It also defines the bounded projection, durable lifecycle replay,
audience-to-target policy, fresh-process reattach, and Drive convergence
obligations discovered by the production call-site review.

## Production hub scope design (kernel and profile continuity implemented)

The production daemon must issue a short-lived, one-time, workspace-scoped
connection capability after authenticating the mode-`0600` discovery owner
credential. The WebSocket upgrade atomically consumes that capability and
binds server-created tenant, principal, canonical workspace, epoch, and an
internal connection identity to the socket. Public client IDs and
`client.register` workspace/actor fields remain descriptive only.

Origin-only loopback browser sockets may remain temporarily available for
non-catalog compatibility, but they are unscoped and every raw catalog request
must fail. Raw catalog capability remains unavailable to production callers.
Bounded projection, lifecycle, and runtime capabilities stay unadvertised until
the complete production composition exists: scope registry and issuer, target
authorization, catalog service/port, confirmation broker and trusted human
issuer, catalog-managed runtime, scoped subscriptions, and catalog host.
Revocation fences authorizations after the workspace epoch advances; stronger
cancellation of already-authorized commits is a separate owner decision.

Implemented internal checkpoint: a private Hub-owned authority provides
digest-only one-time capability issuance, atomic consume, immutable
server-minted identities, active-identity proof, release, targeted epoch
revocation, and sanitized inspection. Trusted startup enrollment canonicalizes
existing directories and returns random opaque workspace IDs; list and mint
surfaces contain no path. A dedicated WebSocket subprotocol consumes the
credential before upgrade, rejects replay and downgrade, binds the identity to
one server-owned transport handle, and closes the affected socket after epoch
revocation. Registration, update, unregister, commands, subscriptions, and
disconnect cleanup remain bound to that handle. The later M0 convergence slice
adds one owner-authenticated selector-free endpoint for exactly one trusted
startup enrollment; it accepts no path or workspace ID.

`NodeHubClient` now requests a fresh credential from an injected provider for
every physical socket. It deduplicates concurrent acquisition, opens no socket
after an explicit close during acquisition, sanitizes provider failures, and
never combines the daemon token with workspace authentication. The in-process
provider mints only by opaque workspace ID.

The trusted in-process confirmation coordinator retains the active connection,
opaque workspace registration, command, and operation internally. It displays
only the frozen action, aggregate, observed revision, normalized effects, and
abort signal—never a path, invocation ID, credential, principal, tenant,
workspace/connection descriptor, or profile authority. One command-scoped
responder checks the Core target and expires when dispatch settles. Direct and
managed prompts share global and per-connection bounds. Prompt timeout, close,
epoch revoke, unregister, and shutdown abort the callback and revoke unconsumed
grants; callback errors are sanitized. The command-lifetime signal reaches the
final mutation fence, target revision is re-read after the human await, and a
final identity check prevents late approval or revoke-during-await mutation.
Pending credentials are digest-only and bounded, and process connection IDs
are never reused.

Remaining composition order is strict and is expanded in
[production-convergence-plan.md](production-convergence-plan.md): preserve the
implemented audience-to-target, bounded projection/replay, runtime companion,
and fresh-process reattach kernels behind the disabled gate; wire trusted
installed-instance issuance through connector launchers and the implemented
confirmation coordinator through the selected owner UX; converge Drive and the
remaining callers; then enable capability advertisement.
The final commit-boundary revocation fence and complete event source stay
mandatory in that composition.

The M0 owner-control choice is now fixed narrowly: the mode-`0600` discovery
bearer may POST to a selector-free endpoint that mints only when exactly one
trusted startup enrollment exists. The request accepts neither a path nor an
opaque workspace ID; zero or multiple registrations fail closed. Multi-workspace
enumeration and selection remain deferred.

The recommended registry prerequisite is implemented: trusted in-process
enrollment canonicalizes an existing directory and returns a random opaque ID;
minting by that registry accepts only the ID, authenticated principal/tenant,
and optional TTL. Sanitized listing contains no path, aliases collapse through
realpath, authorization errors do not reveal whether an ID exists, and
unregister removes enrollment before epoch revocation. The unresolved decision
is now limited to which external owner-authenticated control plane may
enumerate and select those IDs—not whether callers may submit paths.

Trusted in-process composition can list IDs, issue a one-time grant, and
consume it through a dedicated WebSocket upgrade protocol. Credential replay
rejects, an invalid presented credential cannot downgrade to ordinary Hub
authentication, and epoch revocation closes the scoped socket. The singleton
owner endpoint and client provider now deliver fresh credentials cross-process;
capability advertisement remains disabled. The strict
authenticated lifecycle route is likewise inert until one explicit server
release gate simultaneously selects production managed callers; enables
projection, lifecycle, and runtime command/event routing and subscriptions; and
advertises every managed protocol capability. Production leaves that gate off
until compatibility isolation, raw-catalog denial, providers, and every caller
are composed. The final mutation fence and complete event source are already
part of the concrete factory and local catalog path.

## M0 deliverable

The authority-kernel checkpoint is complete when the host can prove, with no UI
assumptions, that an active chat can be archived, activated, resumed by one
writer, forked with lineage, reset without deletion, and purged through a
retryable tombstone under one local/hub-conformant authority. That checkpoint
is necessary but is not Milestone 0 completion.

Milestone 0 is complete only when PC-0 through PC-8 also prove target-audience
authorization and migration, bounded projection/lifecycle reconciliation,
runtime parity, fresh-process reattach, confirmation and compaction policy,
interactive/history and connector cutover, ADR-0014-conformant Drive behavior,
compatibility target isolation, and the full physical all-caller matrix. The
single release gate must then select callers, route every managed protocol
family, and advertise their capabilities atomically. Until that point the
catalog/runtime authority kernel remains behind the hard-off production gate.
