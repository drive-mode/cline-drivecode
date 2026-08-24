# Milestone 0 evidence ledger

**Status:** catalog kernel, atomic root/related admission, managed checkpoint restore, durable writer fence, explicit mandatory-SQLite ClineCore composition, guarded local managed runtime, connector preservation, local catalog-first compatibility history, authenticated-Hub authority/upgrade/reconnect/confirmation/workspace pool, strict lifecycle/event wires, concrete local ClineCore/profile adapter, final commit-boundary revocation fence, authoritative ordered lifecycle event source, strict lifecycle/runtime clients, staged legacy/managed coexistence, singleton owner capability delivery, inert daemon composition, production profile resolution/continuity, accepted resident reconnect, durable manual-compaction receipts with atomic exact-sidecar replay, byte-bounded close-on-loss runtime delivery, admission-only managed starts, profile-gated callback brokerage, fenced additive delivery, bounded cursor recovery, shared replacement-socket orchestration with physical WebSocket/cancellation proof, the inert CA-0 managed caller seam, the gate-off CA-1 immutable audience/migration/projection/replay kernel, the gate-off CA-2 installation-bound audience/admission/fresh-process reattach fault kernel, the gate-off CA-3 invocation-scoped confirmation-authority kernel, the gate-off CA4-A runtime observer, the gate-off CA4-B authority-tagged history contracts, the gate-off CA4-C managed interactive adapter, the gate-off CA4-D0 app-owned runtime contract, and the gate-off CA4-D1a data-projection/Legacy-read checkpoint; ADR-0055 acceptance, D1a event/capability closure, the stateful Legacy adapter, connector-launcher delivery, Drive convergence, production compaction authorization, owner-responder product wiring, caller target cutover, broader operation replay, and app command-path convergence remain open; not release-ready

**Last verified:** 2026-08-18
**Decision:** [ADR-0051](../../adr/ADR-0051-cross-session-chat-catalog-authority.md) remains Proposed

## Current result

The private proof now has a versioned SQLite catalog, shared domain records,
transactional local mutations, deterministic events and cursor order,
structural fork/recovery lineage, binding CAS, service-owned writer leases,
receipt-gated purge orchestration, host-issued authority contexts, immutable
mutation receipts, and an async local/hub port pair. One operation trace now
proves matching local and hub lifecycle results, conflicts, replay semantics,
and event provenance. Destructive lifecycle commands now require a core-owned,
host-minted, operation-bound, client-bound, expiring one-time credential at
both local and hub boundaries. A host-only lifecycle coordinator now proves
idempotent root adoption, reset preservation, archived activation plus a
single-winner resume lease, binding CAS, and structural fork/recovery lineage.
The coordinator now also uses identity-bound unbind CAS, deterministic saga
step IDs, explicit lost-acquire revoke/replacement recovery, and a guarded
lease that renews, verifies token+revision, and aborts on fence loss. Managed
local execution now carries a monotonic writer generation into one ordered
host write gate. SQLite validates the active token and exact generation inside
the same `BEGIN IMMEDIATE` transaction that advances the authoritative
artifact head or session row. Startup registration and quiescence are explicit
host contracts; terminal persistence follows producer drain, and lease release
requires a receipt. Connector reset, config-change reset, and shutdown now stop
and detach without deleting historical sessions; a failed stop retains the
observed binding. Local history now projects one canonical row per catalog chat,
orders by catalog activity, labels Active/Archived/Legacy explicitly, resolves
heads outside the bounded compatibility scan, and suppresses tombstoned or
deleting members before manifest/session fallback. Global history enumerates
catalog workspaces directly, and the catalog reader derives its database and
tenant from the exact session backend. Catalog CAS cutover and the
remaining interactive/resume/fork paths remain open. Shared SQLite ownership
now assigns each session/catalog database to one tenant before migrations or
queries; historical databases remain local-only and nonlocal tenants require
an explicit empty database. Lost lease acquisition is now recoverable without
persisting plaintext tokens: the owner reconciles sanitized state, spends an
aggregate- and revision-bound human confirmation to revoke, and reacquires.

Fresh local roots now cross one stronger boundary before any artifact exists:
`admitRootSession` atomically inserts or validates an inert session row, creates
the root chat and membership, installs writer-head generation 1, and grants the
first lease. Related admission does the same for a new derived chat or a
revision-CAS successor in an existing chat, rolling back the inert reservation
on lineage failure. The managed runtime starts a verified lease guard before
host bootstrap, supplies the credential only to the co-located host, and
returns a sanitized result. Initial messages and manifest candidates then
materialize through that writer fence. `ClineCore.create()` now has an explicit local-only
managed composition that eagerly opens the exact session database and tenant,
rejects file/auto/hub/remote fallback, injects the verifier, exposes a
sanitized always-present `chatLifecycle`, contains generic start/guarded-stop,
guarded-send/checkpoint-restore, and releases managed guards before host/storage disposal. Managed
turns require a stable operation ID, run under the resident lease guard, and
advance chat activity from the authoritative fenced session timestamp before
updating the guard's chat projection. Binding lookup, guarded bind, and reset
also use the facade; reset quiesces before CAS unbind and exact lease release.
Managed checkpoint restore now prepares source state without side effects,
atomically admits and guards the derived writer, applies the worktree inside a
rollback transaction before host startup, and commits only after guarded
startup and checkpoint-ref retention. The target worktree is constrained to
the replacement session workspace, and public results expose no credential.
The managed local composition now has an optional host confirmation bridge
whose callback receives only action, aggregate identity, and revision. Core
retains invocation identity and the random one-time credential. Confirmed
lost-lease recovery deterministically revokes the observed live lease,
reacquires a higher writer generation, installs a new guard, and invalidates
the stale token at the durable fence.
CLI and connector production paths do not select it yet.

The internal Hub checkpoint now separates trusted path enrollment from
capability minting. Startup canonicalizes approved directories into random
opaque workspace IDs; one-time credentials are consumed by a dedicated
WebSocket subprotocol and bound to immutable per-socket authority. Revocation
advances the workspace epoch and closes only affected sockets. `NodeHubClient`
asks an injected provider for a fresh credential before every physical socket,
deduplicates concurrent acquisition, cancels safely during close, sanitizes
provider failures, and never combines workspace and daemon credentials. The
owner control plane exposes only a bearer-authenticated, selector-free,
singleton POST mint; `chat_catalog.v1` remains unadvertised.

The Hub confirmation coordinator now derives the opaque workspace registration
from the active immutable identity and shows the trusted human callback a
frozen pathless target with no invocation ID or credential. Prompt timeout,
close, epoch revoke, unregister, and shutdown abort in-flight work and revoke
all unconsumed grants for that connection. Callback exceptions are sanitized;
late approval cannot recreate a grant. Core reasserts the same identity after
the callback and after asynchronous host authorization immediately before
catalog entry, and a forced revoke-during-authorize test proves no port method
runs. Pending credentials are digest-only, expiry-swept, collision/pending
bounded, and bound to process-unique connection IDs.
The same adversarial reviewer that identified the revoke-during-authorize race
re-reviewed the authoritative implementation and returned **Approve — no
concrete remaining P0/P1** for this confirmation-composition slice.

No Anthropic export, raw historical transcript, or private chat content is used
as a fixture.

The concrete workspace factory now creates the existing mandatory-SQLite local
managed `ClineCore` directly from authority-issued scope. Opaque host resolvers
select runtime and binding profiles; resolver attempts to supply session ID,
cwd, or workspace root are discarded. Exact tenant/principal/workspace/epoch
scope is rechecked at adapter entry, confirmation is bound through
`AsyncLocalStorage` to the current authenticated invocation and abort signal,
late factory results remain pool-owned after revocation, and every one of the 14 v1
commands passes strict result validation. Start/turn/restore/chat/binding
projections omit credentials, artifact paths, raw messages, tool calls, and
workspace keys. Command-result event synthesis is removed. The adapter now
projects only committed SQLite catalog events and uses their durable event ID,
type, aggregate identity, revisions, and occurrence time exactly; read-only and
idempotent no-write commands emit nothing.
Factory presence alone is inert: the implemented gate currently keeps
lifecycle routing, event subscription, and capability advertisement aligned.
Before production cutover, AUTH-022 expands that same atomic gate to caller
selection and every projection/lifecycle/runtime route, subscription, and
capability; no second gate is permitted.
Late construction after revocation returns through pool ownership, where
disposal rejection is reported and non-settling cleanup is time-bounded.
The bounded factory review initially found routable-but-unadvertised lifecycle
traffic and detached late-Core cleanup as two P1s. After the unified release
gate and pool-owned cleanup changes, the same reviewer returned **Approve — both
P1s closed, no new P0/P1**.

The final mutation boundary is now host-owned and nonforgeable. Each issued
catalog authority captures a module-private `ChatCatalogMutationFence`; the
local port reasserts it immediately before every synchronous SQLite mutation,
so revocation cannot interleave between the final check and the
`BEGIN IMMEDIATE`/commit sequence. Purge carries the same fence across cleanup,
heartbeat, failure/success receipt, and finalization boundaries and aborts its
cleanup signal when authority is revoked. The managed workspace factory binds
ordinary fences to the active invocation plus workspace epoch and uses a
separate `AsyncLocalStorage` retirement scope only for pool-owned Core
disposal. The retirement signal is aborted when disposal settles so detached
descendants cannot retain mutation authority. A final adversarial review
returned **Approve — no P0/P1**; its defense-in-depth recommendation to abort
the retirement controller after disposal was applied and retested. The
complete authoritative event source remains outside that verdict.

The catalog schema is now v5. Schema v4 introduced an immutable delivery-scope
sidecar for every new audit event containing canonical workspace identity and
the event-time chat membership snapshot. Schema v5 extends that evidence with
immutable audience and projection scope. Legacy events without a scoped
sidecar remain audit-only. The source captures a tenant-global high-water mark in one
read transaction, reads only its prebound workspace through a metadata
allowlist, advances across foreign/legacy sequence rows, and never selects
payload, invocation, actor, source, transport, connector, path, prompt,
transcript, artifact, or credential fields. This prevents a purged and later
reused chat ID from reattributing old events and preserves final purge/session
scope after live rows are removed. Per-listener live cuts prevent historical
replay; one synchronous bounded pump combines immediate post-command drains
with rescheduled background polling, isolates listener failures, and stops on
unsubscribe, abort, revocation, or Core disposal. Unfiltered projections omit
session identity; filtered projections use immutable event-time membership.
The first architecture review rejected mutable current-state scope because a
purged chat ID can be reused and later membership is not event-time evidence;
that design never reached the authoritative checkout. The implementation
re-review sequence then found six P1s: notification reads could change a
post-commit command result, invalid metadata could poison the cursor, retained
sources could reopen SQLite after disposal, and an already-snapshotted listener
could receive later rows after release; final passes also separated malformed
authoritative projection failures from isolated subscriber callback failures
and moved validation ahead of every listener-specific session filter. Draining
is now isolated and health reported
with fixed pathless errors; invalid authoritative metadata disables the pump
once; composition clears and unregisters the source before close; and
membership/disposal is rechecked before every emission. Dedicated regressions
pass for every path. The final re-review returned **Approved — no remaining
concrete P0/P1 findings**.

The CA-0 caller checkpoint now adds strict Shared projection and chained
lifecycle reconciliation contracts, additive lifecycle cursor/ready transport
plumbing, a pathless public capability probe, and a separate Core-owned
`ManagedHubChatClient`. The facade requires independently advertised
projection/lifecycle/runtime capabilities before authority acquisition,
hydrates a bounded projection cut, reaches lifecycle ready before exposure,
owns a bounded resident registry over one shared runtime adapter, fences every
command to a registered connection generation, retains only bounded token-free
unknown-outcome intent digests, correlates callback responses exactly, and
drains controller cancellation before transport disposal. It exposes no raw
catalog or generic Hub command surface. The production gate remains false and
no managed capability is added to the default advertisement.

The CA-1 server checkpoint now consumes those contracts behind that disabled
gate. Schema v5 persists immutable chat/binding/tombstone/purge-attempt audience
ownership and event-time audience/projection scope. Copied-v4 upgrade freezes
strict writer-fenced profile evidence in a committed first phase, revokes every
legacy writer, then reconciles exact mappings in a restartable second phase;
missing, malformed, and ambiguous evidence remains `audience_unassigned`.
Historical unscoped events remain audit-only. Explicit human assignment is
append-only, idempotent, and creates the first scoped event without reactivating
the lease. Managed sockets deny raw catalog commands before port/Core entry.
Projection list/get and lifecycle replay are audience-bound; snapshot
continuations are query/page-size/connection-bound, replay advances across
hidden global gaps with separate scanned/delivered cursors, and ready is emitted
only after delivery admission. Admissions return only the descriptive profile
authority needed by the session handle. The ordinary interactive owner remains
closed to other audiences pending any later ratified admin policy.

## Executable proof

| Invariant | Evidence | Result |
|---|---|---|
| Workspace/state/source list and stable activity cursor | `sqlite-chat-catalog-service.test.ts` | proven on fresh local SQLite fixtures |
| Root adoption and invocation replay | exact replay, changed-intent, and cross-operation replay cases | proven; invocation IDs are globally content-bound |
| Atomic fresh-root admission | `sqlite-chat-catalog-service.test.ts`, `catalog-session-reservation.test.ts`, `persistence-service-writer-fence.test.ts`, and `catalog-managed-session-runtime.test.ts` | session reservation, root chat/membership, writer head, and lease generation 1 commit together; chat conflict rolls the session row back; exact replay is content-bound and does not reissue a token; guard starts before host bootstrap; initial artifact paths remain empty until fenced materialization |
| Atomic related admission | `sqlite-chat-catalog-service.test.ts`, `catalog-managed-session-runtime.test.ts`, and `ClineCore.test.ts` | fork/checkpoint branches create a derived chat while config-restart/recovery advances the active head under revision CAS; inert session, membership, writer head, and lease generation 1 commit together before guarded host startup; conflicts roll the reservation back; sanitized results expose no credential and replay never reissues one |
| Managed checkpoint restore | `session-versioning-service.test.ts`, `catalog-managed-session-runtime.test.ts`, and `ClineCore.test.ts` | read-only preparation precedes admission; the checkpoint branch and first lease commit atomically; the guard precedes worktree transaction/apply, which precedes host startup; refs and worktree commit follow successful startup; missing checkpoints admit no replacement; bootstrap semantics survive and results expose no credential |
| Managed binding and reset | `catalog-managed-session-runtime.test.ts`, `session-lifecycle-coordinator.test.ts`, `chat-catalog-port.test.ts`, and `ClineCore.test.ts` | binding lookup is hidden outside workspace scope; bind requires a resident guarded writer and expected binding revision; reset quiesces the actual host before deterministic CAS unbind and exact lease release; reset is distinct from client detach and ordinary binding-preserving shutdown |
| Mandatory-SQLite Core composition | `catalog-managed-local-composition.test.ts`, `host.test.ts`, `ClineCore.test.ts`, and `catalog-managed-session-runtime.test.ts` | session/catalog services share one explicit database and tenant; catalog schema initializes before Core returns; auto/hub/remote and file-backed managed modes reject before fallback; writer verification is coordinator-backed; generic start, guarded stop/send, and generic checkpoint restore cannot bypass the facade; managed turns require stable operation identity and record activity from the fenced session row; preparation, images/files, optional queued results, bootstrap cleanup, quiescent release, failed-start/stop guard retention, and disposal ordering are proven without exposing a token |
| Lifecycle is separate from execution and binding | active/archive assertions plus independent binding records | proven in local service |
| Cross-connection relational integrity | independent `SqliteSessionStore` deletion attempt | proven; shared SQLite opener enables foreign keys on every connection |
| Durable tenant boundary | shared `database_tenant` owner checked by session schema, session store, catalog service, and local port | legacy unmarked databases migrate only to `local`; nonlocal provisioning requires an explicit empty database; wrong-tenant opens fail repeatedly before migration/query; identical invocation, binding, purge-attempt, tombstone, chat, and session IDs coexist in separate tenant databases |
| Stale binding clear | bind → unbind → rebind → stale unbind | proven with retained binding revisions |
| One live writer | two service instances share one database | proven with service clock, bounded TTL, generated token, hash-only storage, provenance-bound owner, and stale-release rejection |
| Lost lease credential recovery | local and hub lost-reply traces plus service-level owner checks | acquire and revoke replies may both be lost; sanitized reads expose no token; only the owning human with a one-time lease/revision-bound grant can revoke; immutable replay reports the applied revoke; the old token cannot affect the replacement lease |
| Managed lost-lease recovery | `catalog-managed-session-runtime.test.ts`, `session-lifecycle-coordinator.test.ts`, `host.test.ts`, and `ClineCore.test.ts` | host callback sees only sanitized action/aggregate/revision; decline issues no credential; confirmed exact-revision revoke and deterministic reacquire advance writer generation before guarded startup; old token rejects and public results contain no credential |
| Recovery continuity | successor attachment advances head, ordinal, activity, and revision | proven; recovery stays in one chat |
| Fork continuity | derived chat stores source chat/session structurally | proven; deleting sources reject new forks |
| Archive safety | all attached sessions and all live leases are checked | proven in local transaction tests |
| Atomic reset-and-archive | explicit stop occurs only after host confirmation; archive lifecycle and observed binding clear commit in one catalog transaction | proven through local runtime and raw Hub dispatch regressions; ordinary archive still rejects a running chat |
| Revisioned rename | stable invocation + expected revision updates title and `manual` title provenance without changing lifecycle or activity ordering | proven in service, coordinator, managed runtime, sanitized Core facade, strict wire, and local/Hub parity tests |
| Activity ordering | authoritative session activity advances chat activity without changing lifecycle | proven in local service |
| Purge resurrection boundary | deleting tombstone and binding clear precede injected cleanup; failure evidence survives restart; successful retry returns a content-bound receipt; source lineage survives finalization | proven in fresh local fixtures; Core cleanup checks cancellation before each destructive effect, performs strict checkpoint-ref deletion, verifies filesystem removal, and preserves the tombstoned session row while cleanup is pending |
| Deterministic audit sequence | monotonic SQLite event sequence | proven in fresh fixtures |
| Authoritative ordered lifecycle event source | schema-v4 delivery scope, `listWorkspaceEventsAfter`, internal managed-Core source registry, default factory integration, and Hub strict event wire | event ID/type/aggregate/revisions/time come only from committed SQLite metadata; workspace and event-time sessions are immutable at append; legacy/foreign rows advance but never project; purge survives live-row deletion and chat-ID reuse; independent connections are observed; per-listener cuts, pre-filter validation, session filters, background polling, throwing listeners, revocation, source-health disable/reporting, and missing-source fail-closed behavior pass; final adversarial verdict approved with no P0/P1 |
| Typed audit revision domains | chat, binding, lease, and purge-attempt events name aggregate kind/ID and use that aggregate's revision; connector channel/thread provenance is retained | proven in local fixtures |
| Host-issued authorization | module-private issued-context registry plus tenant/workspace/principal checks | forged structural contexts, cross-workspace access, and model/system confirmation claims reject before writes |
| One-time destructive confirmation | core-owned 256-bit credential broker plus local issued-context consumption | bound to authenticated client, operation, invocation, typed aggregate kind/ID, expected revision, issuance time, and expiry; missing/forged/substituted/reused/concurrent credentials reject; lost-reply recovery requires a fresh grant |
| Final mutation-boundary revocation fence | `chat-catalog-port.test.ts`, `sqlite-chat-catalog-service.test.ts`, `workspace-managed-cline-core-factory.test.ts`, and the six-suite focused fence run | the host-only fence is retained in module-private authority state; ordinary mutations reassert immediately before synchronous SQLite entry; purge reasserts across every async and terminal boundary; outside invocations remain revoked during trusted pool retirement; disposal aborts its retirement signal after settlement; 6 files/70 tests pass and adversarial review reports no P0/P1 |
| Production convergence foundation | lifecycle client, owner capability provider/endpoint, workspace authority, connection scope, lifecycle event, and workspace upgrade suites | strict request/result/event validation; malformed event release; callback isolation; malformed outer-frame retirement/reconnect; fresh-capability retry after registration rejection; bearer-authenticated selector-free singleton mint; body/query selector rejection; mode-0600 discovery; `no-store`; bounded pending grants with expiry sweep; scoped bootstrap metadata scrubbing; factory/gate coexistence; 6 files/52 tests pass; adversarial re-review approved with no P0/P1 while preserving the off release gate |
| CA-0 managed caller seam | Shared projection/lifecycle wire tests; Core projection/lifecycle/runtime/controller/facade, Node transport, and discovery tests | independent three-capability preflight precedes capability issuance/socket construction; projection snapshots, continuations, nested counts, ordering, byte limits, and connection generation fail closed; lifecycle application precedes checkpoint commit and every physical ready is pinned to its sent cursor; handles wait for runtime ready; resident, projection, callback, and unknown-operation state remain bounded; concurrent/session/global disposal drains through one barrier; no raw catalog command is exposed; server routing and advertisement remain unchanged |
| CA-1 audience authority and reconciliation kernel | `sqlite-chat-catalog-service.test.ts`, `chat-catalog-port.test.ts`, `workspace-capability-authority.test.ts`, `workspace-managed-core-pool.test.ts`, `workspace-managed-cline-core-factory.test.ts`, `hub-chat-projection-wire.test.ts`, `hub-chat-lifecycle-events.test.ts`, `browser-websocket.test.ts`, Shared projection/lifecycle schemas, and daemon gate tests | immutable audience ownership; real copied-v4 two-phase restart/idempotency; frozen-evidence exact assignment, ambiguous/malformed quarantine, explicit human assignment, audit-only legacy events, and revoked-writer preservation; audience-before-disclosure list/get/mutation/lease/binding behavior; same-class audience pool isolation; raw-catalog denial before Core use; strict snapshot continuation over one cut; exact audience replay across hidden gaps; replay-before-ready and no-ready-on-delivery-failure; ahead cursor rejection; descriptive non-credential admission authority; production gate and advertisement remain off |
| Inert production daemon composition | daemon composition/entry, singleton discovery, server shutdown, connection scope, direct catalog authority, and workspace upgrade suites | one canonical startup workspace and frozen SQLite identity; pathless HMAC scope binding in mode-0600 discovery and authenticated status; matching detached/in-process reuse and cross-workspace rejection; relative cwd canonicalized once; production profiles composed with an injectable trusted responder that defaults to decline; gate-off catalog/lifecycle dispatch; exact server-issued mutation fence retained through host authority; server-owned idempotent catalog disposal through direct and HTTP shutdown; startup rollback at composition, transport, listen, and discovery boundaries; release gate remains off |
| Production profile resolution and continuity | `chat-management-profiles.test.ts`, `managed-profile-authority.test.ts`, `catalog-managed-session-runtime.test.ts`, workspace authority/registry/pool/factory suites, and Hub scope/upgrade/wire suites | ten versioned profiles and server-issued authority classes; selector-free public owner default; claim checks before credential lookup; daemon-owned model/runtime/tool policy; deny-default explicit tool allowlists; deep immutable profile snapshots; canonical connector namespaces; resolver path/session rejection; reserved writer-fenced profile/revision/class/epoch/claim-digest/execution-digest/interactivity/mode stamp; exact resume/recovery/related continuity; same-profile/class-only `config_restart`; missing-stamp and turn-mode fail-closed behavior; full-claim plus audience pool isolation; successful admission returns only profile ID/revision, class, epoch, and mode ceiling; gate remains off |
| Managed callback broker and cancellation fence | Shared lifecycle/runtime wires; `ClineCore.test.ts`; profile, capability, adapter, factory, browser/WebSocket, runtime wire/event, catalog runtime, lease coordinator, and connection-scope suites | immutable closed-world `tool_executor.askQuestion` grant on interactive profile revision 2 / policy epoch 2; exact bounded request/result schemas; no `AgentToolContext` or private workspace metadata on the wire; exact connection/session/run/request/capability/expiry correlation; malformed, ungranted, wrong-owner/run/name, duplicate, timeout-before-timer, abort, and disconnect fail closed; stop cancels before Core stop; disconnected-owner reclaim cancels before retry; resident writer-authority loss cancels before the Core run settles; disposal and late responses cannot revive work; a fresh one-time workspace capability drives a physical WebSocket profile→start→turn→event→response→terminal round trip plus stop cancellation; subscription setup cannot be overtaken by a following command and late setup releases after close; Shared typecheck + 2 files/19 tests and Core typecheck + 12 files/147 tests pass |
| Immutable replay outcome | frozen receipt carries the original operation/applied/revision while `current` is labeled separately | proven after later activation and after purge deletion |
| Hub parity | one shared operation trace through `LocalChatCatalogPort` and `HubChatCatalogPort` | results, conflict codes, replay receipts, and normalized event provenance match |
| Versioned hub wire contract | exhaustive shared Zod v1 request/result registries for all 18 catalog commands, enforced before server dispatch/transmission and before client exposure | unknown authority fields, malformed projections, command/aggregate/operation receipt mismatch, stale token presence, and protocol drift fail closed; a malicious host result carrying a token hash becomes a sanitized capability error before crossing the server boundary |
| Hub fail-closed behavior | omitted host authority/port or contextless dispatch, including a configured host | `unsupported_capability`; no local fallback and no capability advertisement |
| Hub payload boundary | reserved authority fields reject before the host callback; registered workspace/principal are host-derived | proven with forged workspace/provenance-shaped payload cases |
| Hub authority source | authority provider receives an immutable server-issued connection identity, its connection ID, command, request ID, and only an already-consumed broker grant | core rechecks principal, tenant, canonical workspace, connection ID, and transport; self-attested registration fields cannot substitute authority |
| Hub authority kernel | private Hub-owned `HubWorkspaceCapabilityAuthority` plus bound `HubServerTransport.openConnection(...)` | 256-bit digest-only one-time grant, expiry consumption, forged-identity rejection, duplicate-factory fail-closed behavior, process-lifetime connection-ID non-reuse, exact-workspace epoch revocation, release, contextless catalog rejection, and per-command active proof pass focused tests; the live scoped path remains unadvertised |
| Hub workspace registry | `workspace-capability-registry.test.ts` | trusted enrollment requires an existing canonical directory; symlink aliases converge; random 256-bit opaque IDs are idempotent per tenant/principal/path; listing exposes no path; mint is ID-only; unknown/cross-principal/cross-tenant failures are indistinguishable; unregister removes enrollment before revoking pending and active authority |
| Hub workspace upgrade | `hub-workspace-upgrade.test.ts` | trusted in-process opaque-ID issue and selector-free singleton owner mint each upgrade once through a dedicated subprotocol; replay returns 401, request bodies/selectors reject, malformed/presented credentials cannot downgrade, epoch revoke closes only the scoped socket, and managed capabilities remain unadvertised |
| Hub reconnect capability provider | `hub/client/index.test.ts` | every physical socket obtains a fresh credential; concurrent acquisition is deduplicated; daemon and workspace credentials are not combined; provider errors are sanitized; explicit close during acquisition opens no socket; the in-process adapter mints only by opaque workspace ID |
| Hub trusted confirmation coordinator | `hub-workspace-upgrade.test.ts`, `hub-chat-lifecycle-wire.test.ts`, `workspace-managed-cline-core-factory.test.ts`, `session-lifecycle-coordinator.test.ts`, `chat-management-composition.test.ts`, `hub-server-connection-scope.test.ts`, and `hub-chat-catalog-port.test.ts` | direct and managed requests share one globally/per-connection bounded coordinator; callback sees only a deeply frozen pathless/invocation/authority-free target and abort signal; strict wire rejects caller approval injection; mismatched Core target rejects before prompt; timeout/throw/decline/physical disconnect/epoch revoke/shutdown and retained callback issue no authority or mutation; command-lifetime token reaches the final mutation fence; revision change rejects before external stop; fresh exact retry replays without a second side effect; physical managed approve/decline and mixed-budget proof pass |
| Hub managed-Core ownership kernel | `workspace-managed-core-pool.test.ts`, `workspace-capability-registry.test.ts`, `hub-server-connection-scope.test.ts`, and `hub-workspace-upgrade.test.ts` | unambiguous tuple keys come only from authority-issued tenant/principal/canonical-workspace/epoch; same-scope and concurrent epoch replacement single-flight; foreign identities reject; revoke-during-create preserves pool ownership and disposes the late result; rejected cleanup is reported and non-settling cleanup is bounded; epoch replacement and shutdown dispose once; factory-without-authority and enable-without-factory fail startup; scoped/unscoped/direct runtime, schedule, drive, status, global client-list, and event-subscription paths fail closed without constructing a Core or installing listeners |
| Hub managed lifecycle v1 wire | `chat-lifecycle-wire.test.ts`, `hub-chat-lifecycle-wire.test.ts`, `session-artifacts.test.ts`, `browser-websocket.test.ts`, and `hub-websocket-server.test.ts` | exhaustive strict request/result registries cover all 14 commands; request profiles are opaque and reject path/credential/authority claims, traversal session IDs, lexical cwd escape, and cwd symlink escape; the canonical cwd replaces the wire hint before adapter invocation and artifact sinks independently enforce path-safe IDs/canonical containment; lifecycle chat projections omit canonical workspace keys; turn, restore, and start results exclude raw messages, tool calls, manifest paths, and lease credentials; authenticated registered-client dispatch freezes normalized input, supplies identity plus connection abort signal, rechecks liveness, validates output, sanitizes failures, rejects unscoped/direct/spoofed calls, and withholds late revoked results; one explicit disabled-by-default gate controls routing, event subscription, and `chat_lifecycle.v1` advertisement together |
| Hub managed lifecycle event v1 wire | `chat-lifecycle-event-wire.test.ts`, `hub-chat-lifecycle-events.test.ts`, and `hub-server-connection-scope.test.ts` | one strict `chat.changed` projection contains only aggregate revisions/time, optional path-safe session scope, and an optional sanitized pathless chat snapshot; prompt/text/reasoning/tool/credential/path fields reject; subscription requires same-connection successful registration and authenticated workspace scope; server reapplies session filters, suppresses malformed/foreign/late revoked output, and binds unsubscribe to connection cleanup; generic managed-server subscriptions remain unavailable without the concrete event adapter |
| Concrete workspace ClineCore adapter | `workspace-managed-cline-core-factory.test.ts` | opaque runtime/binding profiles resolve inside exact authority scope; resolver path/session overrides are stripped; all 14 commands dispatch and validate; confirmation exists only in the active command context, combines connection/workspace/command fences, and is unavailable after settlement; results and events are pathless/credential-free; foreign identities reject before resolution; revoke-during-create disposes the late Core; event synthesis skips reads and any mutation without an authoritative result revision |
| Hub connection continuity | explicit server-owned transport handle per browser socket | registration reservation, duplicate-ID conflict, update/unregister/command spoof rejection, subscription ownership, disconnect cleanup, foreign-authority rejection, and epoch-revoked handle fencing pass direct server and browser tests |
| Binding workspace ownership | live chat or retained event/tombstone evidence is checked before and inside bind/unbind transactions | bound and retained-unbound cross-workspace takeover rejects; raced unbind is checked in-transaction |
| Purge cleanup claim | attempt-state/revision claim with compare-and-set heartbeat, receipt, and failure persistence | service-owned renewal advances the claim before staleness; a retry after the original timestamp is stale still returns `chat_deleting` and cleanup runs once; heartbeat loss immediately aborts the cleanup boundary and prevents stale terminal writes; completion uses the latest owned revision and fresh timestamp; idempotent `attemptId` remains defense in depth |
| Schema drift | required columns, indexes, foreign keys, normalized CHECK definitions, and exact UNIQUE column order are inspected after migration | proven fail-closed for malformed/future schemas, removed CHECK and UNIQUE constraints, two-process same-tenant migration, and conflicting first-tenant provisioning; exactly one conflicting tenant wins |
| Host lifecycle orchestration | `session-lifecycle-coordinator.test.ts` | focused tests prove retry-safe adoption, stable bind/branch/recovery/rename operation identity, lost-reply structural lineage reconciliation, archived activation with one lease winner, stop-before-unbind reset preservation, stale/substituted binding rejection, replayable partial reset, lost-acquire recovery, verified guard startup, authoritative-expiry scheduling/watchdog fencing, fork lineage, and recovery lineage |
| Runtime lease fence kernel | renewal/verification service, local+hub ports, strict wire schemas, `CatalogLeaseGuard`, and local persistence hook | guarded renewal retains the credential while advancing revision, stale revisions reject, verification returns only sanitized state, actual short expiry overrides a longer configured cadence, fence loss aborts, and local/hub operation traces match |
| Durable writer-generation fence | `sqlite-session-store-writer-fence.test.ts` and `persistence-service-writer-fence.test.ts` | active token and exact monotonic generation are validated at commit under `BEGIN IMMEDIATE`; the generic mutation callback is ECMAScript-private, public writes are structurally session-bound, query APIs admit only `SELECT`, and transcript, compaction, manifest, metadata, status, upsert, and delete paths reject absent/stale authority; `UPDATE/DELETE ... RETURNING` cannot escape the fence |
| Quiescent managed runtime | `local-runtime-host.test.ts` and `catalog-managed-session-runtime.test.ts` | lifecycle registration precedes the first startup await; stop closes admission, wins a startup race, drains ordered writes, shuts producers before terminal row/manifest commits, and releases only after a receipt; producer rejection—including an undefined rejection reason—and terminal failure withhold the receipt and retain authority |
| Trusted managed-runtime boundary | managed runtime plus local fence regressions | credentials stay in trusted core and out of sanitized results/generic hub payloads; generic credential-free start rejects managed sessions, renewal installs through the ordered gate, and local SQLite resume→quiesce→release passes end to end |
| Reset saga recovery | deterministic per-operation step invocation IDs plus identity-bound unbind | a lost release reply can replay the already-applied unbind and finish release; substituted binding/chat/session identity rejects without clearing the other binding |
| Connector preservation | `session-runtime.test.ts`, `connector-host.test.ts`, and `telegram.test.ts` | reset/config-change/shutdown stop the runtime and clear only the observed binding; no connector production path calls `deleteSession`; stop failure preserves the binding and history; unavailable runtime authority performs no local destructive fallback |
| Catalog-first compatibility history | `chat-history-projection.test.ts`, core history tests, CLI session/history tests | one row per catalog head, direct head resolution outside the bounded compatibility scan, direct global catalog-workspace enumeration, exact backend database/tenant binding, canonical last-activity ordering, workspace isolation, Active/Archived/Legacy display, structural lineage metadata, and suppression of tombstoned or concurrently deleting members; the concrete catalog reader remains core-owned |

## Fresh verification commands

Run from `sdk/` unless a different directory is shown.

### CA-1 audience authority and reconciliation — 2026-08-17

```text
cd packages/shared
mise exec -- bun run typecheck
mise exec -- bun run build
mise exec -- bunx vitest run \
  src/session/chat-lifecycle-wire.test.ts \
  src/session/chat-projection-wire.test.ts \
  src/session/chat-lifecycle-event-wire.test.ts \
  --config vitest.config.ts
  PASS — typecheck, package build; 3 files, 21 tests

mise exec -- bun run test:unit
  PASS — 55 files, 512 tests

cd ../core
mise exec -- bun run typecheck
mise exec -- bun run build
  PASS — development/public smoke typechecks and package build

mise exec -- bunx vitest run \
  src/chat-catalog/sqlite-chat-catalog-service.test.ts \
  src/chat-catalog/chat-catalog-port.test.ts \
  src/hub/server/hub-chat-lifecycle-events.test.ts \
  src/hub/server/hub-chat-lifecycle-wire.test.ts \
  src/hub/server/hub-chat-projection-wire.test.ts \
  src/hub/server/workspace-managed-cline-core-factory.test.ts \
  src/hub/server/browser-websocket.test.ts \
  src/hub/server/workspace-managed-core-pool.test.ts \
  src/hub/server/workspace-capability-authority.test.ts \
  src/hub/daemon/chat-management-composition.test.ts \
  src/hub/daemon/chat-management-profiles.test.ts \
  src/hub/client/chat-lifecycle-client.test.ts \
  src/hub/client/managed-chat-client.test.ts \
  --config vitest.config.ts
  PASS — 13 files, 167 tests

mise exec -- bunx vitest run \
  src/runtime/host/catalog-managed-local-composition.test.ts \
  src/hub/server/hub-chat-runtime-events.test.ts \
  src/hub/server/hub-server-connection-scope.test.ts \
  --config vitest.config.ts
  PASS — 3 files, 14 tests

mise exec -- bunx vitest run --config vitest.config.ts \
  --exclude src/services/plugin-install-transaction.test.ts
  PASS — 218 files passed, 1 skipped; 2,365 tests passed, 14 skipped

mise exec -- bunx vitest run \
  src/services/plugin-install-transaction.test.ts \
  --config vitest.config.ts
  PASS — 1 file, 19 tests

cd ../../..
mise exec -- bun biome check --write <41 explicit CA-1 files>
mise exec -- bun run check:drivecode-docs
git diff --check
  PASS — scoped Biome, structure/Done checks, and whitespace integrity
```

Together, the partitioned Core runs execute all **220 files / 2,398 tests**:
**219 files and 2,384 tests pass; 1 file and 14 tests are skipped**. Two
all-at-once runs each lost one expected child-process `SIGKILL` or exceeded the
default timeout in a different `plugin-install-transaction` crash-injection
case; that complete 19-test file passes in isolation, and all other 219 files
pass together. This is recorded as suite-level process-signal contention, not
silently counted as a default-command pass. No CA-1 focused or integration test
failed in the final state.

The attribution matrix covers immutable audience ownership, copied-v4
phase-one/phase-two restart and idempotency, malformed/ambiguous quarantine,
explicit human assignment, audience-before-disclosure across reads and writes,
same-class audience pool isolation, raw-catalog denial before Core, frozen
projection snapshots, hidden-gap lifecycle replay, replay-before-ready,
delivery-failure ready suppression, strict descriptive admission authority,
schema-v5 composition, and exclusive cursor-fenced lifecycle/runtime lanes.
The production release gate remains `managedChatLifecycleEnabled: false`.

### CA-2 admission and fresh-process reattach — 2026-08-17

The Codex runtime did not expose a `bun` executable, so this checkpoint used
the repository-local TypeScript, Vitest, and Biome entry points under the
bundled Node 24 runtime. No dependency resolution or generated source was
substituted.

```text
cd packages/shared
node ../../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node ../../../node_modules/vitest/vitest.mjs run \
  src/session/chat-lifecycle-wire.test.ts \
  src/session/chat-projection-wire.test.ts \
  src/session/chat-lifecycle-event-wire.test.ts \
  src/session/chat-runtime-wire.test.ts \
  --config vitest.config.ts
  PASS — typecheck; 4 files, 32 tests

cd ../core
node ../../../node_modules/typescript/bin/tsc -p tsconfig.dev.json --noEmit
node ../../../node_modules/typescript/bin/tsc -p tsconfig.smoke.json --noEmit
  PASS — development and public smoke typechecks

node ../../../node_modules/vitest/vitest.mjs run \
  src/hub/client/chat-runtime-client.test.ts \
  src/hub/client/managed-session-controller.test.ts \
  src/hub/client/managed-chat-client.test.ts \
  src/hub/server/hub-chat-runtime-wire.test.ts \
  src/hub/server/workspace-managed-runtime-adapter.test.ts \
  src/hub/server/workspace-managed-cline-core-factory.test.ts \
  src/hub/server/workspace-managed-core-pool.test.ts \
  src/hub/server/workspace-capability-authority.test.ts \
  src/hub/server/hub-workspace-upgrade.test.ts \
  src/hub/server/hub-websocket-server.test.ts \
  src/hub/daemon/chat-management-profiles.test.ts \
  src/hub/daemon/chat-management-composition.test.ts \
  src/chat-catalog/chat-catalog-port.test.ts \
  --config vitest.config.ts
  PASS — 13 files, 197 tests

node ../../../node_modules/vitest/vitest.mjs run \
  src/chat-catalog/sqlite-chat-catalog-service.test.ts \
  --config vitest.config.ts \
  -t "resolves session projections only|grants one live writer lease|revokes a lost lease credential"
  PASS — audience lookup 1/1; lease expiry/confirmed recovery 2/2
```

This matrix proves that binding-capable templates cannot bypass trusted
installed-instance issuance; two installations of one connector receive stable
distinct opaque audiences, separate managed Cores, and known-ID catalog denial.
It also proves strict stale-cache rejection before continuity, fixed live-owner
busy, exact retry after an unknown initial reclaim reply, bounded hydration
before subscription, replay-before-ready, eviction cancellation, and no legacy
fallback. One physical two-socket case commits reclaim and drops its successful
reply while keeping the socket live; the exact retry replays the receipt and
the durable runtime rekey occurs once. A separate physical Hub close/start
constructs a new managed factory, chooses ordinary nonresident resume, creates
a new runtime stream, and rejects the prior cursor. The trusted issuer is not
yet wired into production connector launchers, ADR-0055 remains Proposed, and
the production gate remains `managedChatLifecycleEnabled: false`.

### CA-3 invocation-scoped confirmation authority — 2026-08-17

The gate-off managed path no longer installs a static factory confirmation
callback. After strict wire validation, the Hub creates a responder only for
one confirmation-capable command and stable operation. It rejects a Core target
whose command, aggregate, revision, or effects do not match the invocation,
keeps connection/workspace/operation correlation internal, and presents only a
deeply frozen action/aggregate/revision/effects target plus abort signal to the
trusted owner seam. The responder and its final catalog mutation fence share a
command-lifetime token that is aborted when dispatch settles. Archived resume
first resolves the audience-authorized session projection and binds activation
to that exact chat/revision; its activation invocation is derived from the
stable resume operation rather than random process state.

Direct grant issuance and managed-Core decisions now use one prompt
coordinator with global and per-connection bounds. Every settlement aborts the
UI signal. Physical disconnect, epoch revoke, unregister, and server shutdown
abort pending work; late callback completion and retained Core callbacks cannot
mint or mutate. The lifecycle coordinator re-reads the target revision after
the human await and requires the pre-prompt snapshot to match before any planned
stop side effect. Exact retries require a fresh bound decision but replay the
immutable receipt without repeating the external stop or catalog mutation.
Physical disconnect and epoch-revoke races after approval but before catalog
entry also fail at the command-lifetime mutation fence.

The focused CA-3 matrix passes **5 files / 104 tests**: strict caller-payload and
Core-target rejection, physical managed approve/decline, physical archived
resume resolved from its authoritative session projection, mixed direct/managed
prompt saturation, callback throw/timeout/decline, physical disconnect,
workspace epoch revoke, shutdown, stale-revision approval, exact replay, and
inert daemon responder injection. Development and public-smoke typechecks pass;
the broader confirmation/capability/daemon integration matrix passes
**17 files / 192 tests**. The final independent P0/P1 correctness and security
re-review returned **PASS**. The production composition still defaults to
decline and the release gate remains `managedChatLifecycleEnabled: false`.
Harrison has not yet selected the CLI/TUI, desktop Hub, connector, or local
owner-console responder.

### CA4-A managed runtime observation seam — 2026-08-17

The first interactive/history cutover slice is implemented behind the disabled
gate. `ManagedHubChatSession` now exposes a bounded local observer for strict
runtime events already accepted by its controller. Core updates internal
approval/capability correlation first, deep-clones and freezes the sanitized
event, preserves order independently for each listener, and does not let a slow
async listener block another listener. Each observer retains at most one
in-flight callback plus 256 queued events; overflow retires that observer and
reports sanitized `observer_overflow` evidence. Throwing listeners produce only
a sanitized nonfatal `observer_failed` result. Rejected async error observers
are consumed. The first subscriber receives bounded ordered events accepted
before registration, including reattach replay; overflow before readiness
rejects admission and overflow before first subscription rejects registration.
Unsubscribe is idempotent. Disposal clears queued/future delivery before
controller release; a callback already executing is not awaited and retains no
authority. The observer creates no additional transport subscription and
exposes no fence, cursor, credential, authority claim, or raw transport.

The same slice adds the previously missing strict pending-prompt update and
remove methods to the public managed session handle and exports the observer
types through the Core Hub surface. Focused proof passes **34/34 managed-client
tests**. The client/runtime/controller regression matrix passes **4 files / 94
tests**; scoped Biome, Core development/public-smoke typechecks, and the Core
bundle/declaration build pass. The first independent review found three P1s:
an unbounded promise tail, dropped pre-registration replay, and uncontained
async error-observer rejection. The bounded queue, first-subscriber replay,
admission/registration overflow fences, and async rejection sink close those
findings. Independent re-review returned **PASS with no P0/P1/P2 findings** and
explicitly verified bounded retention, ordered actionable replay, async
rejection containment, disposal semantics, recursively readonly public types,
and the hard-coded off gate. The production CLI still selects generic Core, no
managed capability is advertised, and `managedChatLifecycleEnabled` remains
`false`.

CA4-B is implemented without changing production selection. A new CLI domain
contract maps either a strict managed projection or the explicit local
compatibility discriminant to one frozen authority target carrying
`chatId`/head/state/revision for managed rows or a namespaced session ID for
Legacy. Malformed catalog-shaped input rejects and cannot silently downgrade to
Legacy; managed successor keys remain stable by chat identity. An inert Legacy
adapter now exposes only bounded list/export, excludes managed rows, rejects
malformed catalog rows, terminates raw `SessionHistoryRecord` data inside the
adapter, emits frozen authority-neutral items, and contains no mutation API.
Legacy export re-resolves trusted session authority before artifact access;
missing, changed, and managed identities reject. Managed rows expose no resume
or export action before their reviewed ports exist. The item mapper keeps
catalog lifecycle independent of runtime status, applies read-only Legacy
policy, namespaces keys, and rejects duplicate authority identities. A branded
identity factory covers the closed managed operation set, validates path-safe
session/chat IDs, and documents retain-on-exact-retry semantics. Focused proof
passes **5 files / 58 tests**. Independent review found unsupported managed
capabilities, caller-authored export authority, discriminator downgrade, and
unsafe imported IDs; remediation and re-review returned **PASS with no
P0/P1/P2 findings**.

### CA4-C managed interactive adapter — 2026-08-17

The gate-off CLI adapter now owns one structural managed client port and one
current session port without exposing either to app callers. It adapts root,
config restart, fork, checkpoint restore, turn, exact abort, approval,
`askQuestion`, pending prompts, display messages, checkpoints, usage,
compaction, reset, stop, and deterministic disposal. Fresh-process resume,
reattach, and recovery are absent while ADR-0055 remains Proposed.

Strict Shared schemas validate every request, result, and runtime event at the
app boundary. A bounded acyclic graph check, exact nested projection,
contiguous session-sequence cursor, and iterative deep freeze prevent forged
typed payloads, raw fields, cycles, duplicate delivery, and mutable output.
Every awaited session call is current-context and generation fenced;
structural transitions require zero in-flight calls. Disposal retires the
listener synchronously and installs its transition barrier before dependency
code can reenter. Malformed successor failure retires both successor and
predecessor. Mandatory predecessor cleanup failure cleans the successor and is
propagated through final disposal.

A bounded SHA-256 digest-only journal retains no request body while enforcing
exact retry of transport-unknown admissions, turns, terminal operations,
aborts, callbacks, prompt mutations, compaction, and structural successors. A
bounded active-attempt map records matching operation/run evidence before an
unknown outcome can be retained.
Authoritative rejection, unknown outcome, read failure, cleanup failure, and
client-disposal failure expose only fixed app error codes. Exact run evidence
consumes retained turn/abort state; an unknown early-abort reply does not drop
the correlated run event.

Focused CA4-C proof passes **4 files / 104 tests**. Combined chat-management
proof passes **8 files / 151 tests**; expanded CLI/history proof passes
**11 files / 190 tests**; the complete pinned-PATH CLI unit suite passes
**139 files / 1,221 tests**. CLI typecheck, scoped Biome, strict no-fallback
search, and the hard-coded off gate pass. Successive independent passes found
and closed seven P1 plus three P2 findings, then three narrower P1s, then two
final P1s covering operation-kind collision and callback linearization. Final
read-only re-review returned **PASS with no actionable P0/P1/P2** and confirmed
the journal retains no body or credential material. Caller migration and all
production wiring remain pending.

### CA4-D0 app-owned interactive runtime contract — 2026-08-17

The first caller-migration slice adds a closed `v1` semantic runtime port in
`apps/cli/src/chat-management/interactive-runtime-contract.ts`. The contract
uses only strict Shared wire result/input types plus the already sanitized app
runtime event projection. It exposes authority-tagged session identity,
explicit context availability, bounded turn/prompt/message/checkpoint/usage and
compaction projections, semantic reset/configuration/fork/restore operations,
and deterministic cleanup. It has no generic Core, provider-native message or
event, raw hook, local artifact, connection-patch, local compaction, delete, or
fresh-process resume/reattach/recover surface.

Focused proof passes **1 file / 3 tests**; CLI typecheck and scoped Biome pass.
The contract is intentionally not selected or imported by production callers
yet. Legacy extraction/adaptation, managed bridge composition, TUI cutover, and
negative selector proof remain D1-D6 work. The production lifecycle gate remains
hard-coded off.

### CA4-D1a Legacy data projection and read seams — 2026-08-18

The first Legacy-preservation checkpoint deliberately does not claim a complete
`InteractiveChatRuntime`. Independent compatibility audit showed that hidden
recovery, raw constructor callbacks, fire-and-forget abort, queued action
correlation, file-content materialization, and caller-owned restart mutation
must be made explicit before a stateful adapter can report honest lifecycle
state.

Two app-owned one-way projectors now terminate Legacy data. The message
projector accepts unknown hostile input, reads only own data descriptors,
rejects exotic containers without invoking accessors, bounds block inspection,
UTF-8 text, attachments, page count, and page bytes, and emits
generation-scoped synthetic message/tool IDs. It never reads or emits source
message/tool IDs, paths, file/image bodies, tool inputs/results, signatures,
metadata, hidden reasoning, or redacted payloads. Malformed individual messages
become fixed notices so canonical sequence positions remain stable. Explicit
top-level user/assistant text remains the authorized same-owner display channel
and is not claimed to be a general DLP boundary.

The second projector emits only strict pending-prompt, checkpoint, usage,
compaction, and turn DTOs. It preserves direct versus aggregate usage, drops
checkpoint refs and canonical compaction/transcript state, replaces provider
failure text, validates every result through the Shared command schema and wire
budget, and deep-freezes only newly constructed output. The Legacy kernel now
exposes prompt list/remove, exact usage, compaction, and checkpoint-only read
seams; these are unwired and do not alter current production behavior.

Focused verification passes **4 files / 39 tests**. Integrated chat management
passes **11 files / 173 tests**; the locked session-runtime,
`run-interactive`, and chat-command-runner matrix passes **3 files / 31 tests**;
and the complete pinned-PATH CLI suite passes **142 files / 1,244 tests**. CLI
typecheck, scoped Biome, `git diff --check`, strict wire parsing, the no-caller-
import check, and the exact `managedChatLifecycleEnabled: false` gate pass.
Independent review is pending. Safe notice/team projection, the
authority-neutral approval/question broker, awaited abort, generation/session
transition ingress, queued attachment lifetime, the stateful Legacy adapter,
and caller cutover remain open.

### CA-0 managed caller seam — 2026-08-17

```text
mise exec -- bun -F @cline/shared typecheck
mise exec -- bun -F @cline/shared build
mise exec -- bun -F @cline/shared test
  PASS — 55 files, 511 tests

mise exec -- bun run --cwd packages/core typecheck
mise exec -- bun -F @cline/core build
  PASS — development typecheck, public smoke typecheck, and package build

mise exec -- bun run --cwd packages/core test:unit -- \
  src/hub/client/chat-projection-client.test.ts \
  src/hub/client/chat-lifecycle-client.test.ts \
  src/hub/client/chat-runtime-client.test.ts \
  src/hub/client/managed-session-controller.test.ts \
  src/hub/client/managed-chat-client.test.ts \
  src/hub/client/index.test.ts \
  src/hub/discovery/index.test.ts
  PASS — 7 files, 103 tests

mise exec -- bun -F @cline/core test:unit
  PASS — 218 files passed, 1 skipped; 2,371 tests passed, 14 skipped

mise exec -- bun -F @cline/core test:e2e
  PASS — 5 files, 31 tests

cd ..
mise exec -- bun biome check --diagnostic-level=error <36 touched CA-0 files>
mise exec -- bun run check:drivecode-docs
git diff --check
  PASS — scoped Biome, structure/Done checks, and whitespace integrity
```

The complete Core runs include the physical WebSocket, gate-off daemon, runtime
authority, status-Hub registration, and unrelated package regressions. The
CA-0 focused suite is the narrow attribution set. The status-tag E2E fixture
now registers its authenticated connection before sending commands, preserving
the branch's fail-closed connection-scope contract. No managed route or
capability advertisement was enabled for any run.

Independent CA-0 review found four concurrency defects before this verification:
an admission operation ID could be reused after lifecycle acceptance but before
runtime readiness; facade disposal did not own every in-flight admission; a
failure-launched reclaim cancellation was dropped from `disposeAndWait`; and
two concurrent continuations could consume the same projection cursor. The
client now retains operation ownership through ready, tracks both admission
phases in the global completion barrier, accumulates controller cancellation
work, and leases each snapshot continuation to one request. Dedicated
regressions cover all four defects plus both pre-controller and runtime-starting
global disposal.

Post-fix review then found two P1 ordering edges and two P2 cleanup edges:
reentrant transport behavior could begin disposal before the admission tracker
was registered; projection observers could see an applied event with the prior
checkpoint; initialization cleanup could mask the primary startup error; and a
synchronous transport-disposal throw could skip admission wait and state
cleanup. Admission tracking now precedes all work, projection publication occurs
only after checkpoint advancement, initialization preserves its primary error,
and transport disposal is invoked inside the owned promise barrier. Dedicated
regressions cover each trace. The three directly affected files pass **33/33**
tests, the seven-file attribution suite passes **103/103**, and the complete Core
unit suite passes **2,371** tests with 14 skipped. Closure re-review confirmed
all four post-fix findings with direct regression coverage and reported no
remaining actionable P0/P1/P2 issue.

```text
mise exec -- bun -F @cline/shared typecheck
  PASS

cd sdk/packages/shared
mise exec -- bun run test:unit -- \
  src/session/chat-runtime-wire.test.ts \
  src/session/chat-lifecycle-wire.test.ts
  PASS — 2 files, 19 tests

mise exec -- bun -F @cline/shared test
  PASS — 53 files, 491 tests

mise exec -- bun -F @cline/shared build
  PASS

mise exec -- bun -F @cline/core typecheck
  PASS

cd sdk/packages/core
mise exec -- bun run test:unit -- \
  src/ClineCore.test.ts \
  src/hub/daemon/chat-management-profiles.test.ts \
  src/hub/server/workspace-managed-runtime-capabilities.test.ts \
  src/hub/server/workspace-managed-runtime-adapter.test.ts \
  src/hub/server/workspace-managed-cline-core-factory.test.ts \
  src/hub/server/browser-websocket.test.ts \
  src/hub/server/hub-chat-runtime-events.test.ts \
  src/hub/server/hub-chat-runtime-wire.test.ts \
  src/chat-catalog/catalog-managed-session-runtime.test.ts \
  src/chat-catalog/session-lifecycle-coordinator.test.ts \
  src/hub/server/hub-server-connection-scope.test.ts \
  src/hub/server/hub-websocket-server.test.ts
  PASS — 12 files, 147 tests

mise exec -- bun -F @cline/core test:unit
  PASS — 208 files passed, 1 skipped; 2,165 tests passed, 14 skipped

mise exec -- bun -F @cline/core build
  PASS

mise exec -- bun -F @cline/cli typecheck
  PASS

mise exec -- bun -F @cline/cli test:unit
  PASS — 131 files, 1,070 tests

cd sdk/packages/core
mise exec -- bunx vitest run \
  src/chat-catalog/chat-history-projection.test.ts \
  src/runtime/host/history.test.ts \
  src/session/services/persistence-service.test.ts \
  --config vitest.config.ts
  PASS — 3 files, 33 tests

cd ../../../apps/cli
mise exec -- bunx vitest run \
  src/session/session.test.ts \
  src/commands/history-command.test.ts \
  --config vitest.config.ts
  PASS — 2 files, 26 tests

cd sdk/packages/core
mise exec -- bunx vitest run \
  src/hub/server/browser-websocket.test.ts \
  src/hub/server/workspace-capability-authority.test.ts \
  src/hub/server/workspace-capability-registry.test.ts \
  src/hub/server/workspace-managed-core-pool.test.ts \
  src/hub/server/hub-server-connection-scope.test.ts \
  src/hub/server/hub-workspace-upgrade.test.ts \
  src/hub/server/hub-websocket-server.test.ts \
  src/chat-catalog/hub-chat-catalog-port.test.ts \
  src/hub/server/boundary.test.ts \
  src/hub/client/index.test.ts \
  --config vitest.config.ts
  PASS — 10 files, 110 tests

cd ../../..
mise exec -- bun biome check <scoped catalog/hub/shared files>
  PASS

git diff --check
  PASS
```

The focused 110-test result contains capability/registry security, live upgrade
replay and revocation, fresh reconnect credentials, acquisition
deduplication/cancellation, abortable trusted confirmation, callback
sanitization, revoke-during-authorization fencing, bounded digest-only grants,
authority-keyed managed-Core single-flight/retirement, collision-resistant
tuple scope, concurrent epoch replacement, bounded hung-factory shutdown,
exact scoped/unscoped command allowlisting, global client-list denial, legacy
subscription denial, server-owned client scope, host authority, hub parity, and
general Hub boundary regressions. The full shared and core suites independently
cover adjacent persistence and protocol behavior.

The independent managed-Core adversarial review initially rejected concurrent
epoch replacement, delimiter-based tuple keys, unscoped legacy-runtime
downgrade, and unbounded shutdown. After those fixes it found the broader
schedule/drive runtime escape, then global `client.list` and wildcard event
subscription confidentiality paths. The final exact bootstrap allowlist and
subscription denial closed every finding. Its final disposition was
**Approve — no remaining P0/P1 findings in this bounded slice**.

The first full-core run in this pass lacked `node` and `bun` on child-process
`PATH`, producing five environment-only failures. Re-running with the
repository's Node 22 and Bun directories available passed all tests. The lease
recovery and schema-definition passes used `mise exec` directly and passed all
1,984 core tests. The shared wire-schema pass increased the shared suite to 51
files; the final generation-placement regression brought it to 478 tests.

The lifecycle-coordinator/lease-fence remediation pass additionally ran the
shared wire suite (3/3) and four focused core files (41/41). Shared typecheck,
shared package build, core typecheck, and scoped Biome all pass.

The authoritative-expiry and trusted managed-runtime prototype pass then ran
all core chat-catalog tests (5 files, 45 tests), the complete
`LocalRuntimeHost` suite (71 tests), core typecheck, scoped Biome, and both
Drivecode documentation checks successfully. These tests establish the
internal boundary and fail-closed prototype behavior; at that point the durable
commit-time fence, quiescence, and bypass-closure gates were still open.

The durable-fence/quiescence pass subsequently ran core typecheck plus four
focused files: full `LocalRuntimeHost`, managed runtime, persistence fence, and
SQLite store fence. **4 files and 80 tests passed.** The local runtime suite
includes producer-before-terminal ordering, stop-during-startup, failed
terminal persistence, and post-quiescence admission rejection. The managed
runtime suite includes a real shared-`sessions.db` resume→terminal
commit→receipt→lease-release integration.

After correcting `writerGeneration` placement from the binding wire schema to
the lease wire schema, hub parity passed 10/10 and the complete core unit suite
passed. The final authority/quiescence remediation run is now **191 files
passed, 1 skipped; 2,009 tests passed, 14 skipped.** The
complete shared suite is **51 files and 478 tests passed**, followed by a
fresh shared package build.

The final focused authority run passed 107/107 after adding SELECT-only query
admission and undefined producer-rejection retention. The independent reviewer
then reran six focused files (108 tests) and returned **Approve** with no P0/P1.
Connector convergence passed 60/60 focused tests and the complete CLI suite:
**131 files and 1,059 tests passed**. The subsequent catalog-first history pass
raised the complete results to **192 core files passed plus 1 skipped, 2,017
core tests passed plus 14 skipped**, and **131 CLI files, 1,070 tests passed**.
Its focused projection/history runs passed 33/33 core and 26/26 CLI tests.
An independent projection review initially requested changes for two P1s:
catalog construction was not bound to the supplied backend database/tenant,
and unscoped workspace discovery depended on the bounded legacy scan. Exact
backend identity propagation, direct catalog workspace enumeration, and two
regressions closed both findings. The re-review returned **Approve** with no
remaining P0/P1; the broader focused composition run passes 4 files/49 tests.

## Adversarial review disposition

An independent read-only subagent repeatedly adversarially reviewed this slice.
Its first confirmation pass found a raw hub-command bypass, unbounded issuance
age, and context-local-only consumption. Its second pass found an unreachable
`record_activity` route and a test-only broker. After moving credential minting
and atomic consumption into core, restoring the activity route, and adding
substitution, concurrency, and lost-reply tests, the same reviewer found no
remaining P0/P1 and returned **Ship**. The authoritative checkout passed all
five focused suites, core typechecking, and the full core run. A later tenant
pass first rejected catalog-local ownership because the session store could
bypass it and wrong-tenant opens migrated before rejection. Moving ownership
to the shared SQLite boundary closed those findings; the same reviewer found no
remaining P0/P1 and concluded that the technical tenant blocker is closed. A
fresh bounded review of the lease-recovery pass likewise found no P0/P1 and
returned **Ship**. It retained three P2 coverage improvements: a
revoke-specific cross-aggregate substitution case, an independent-connection
revoke/reacquire race, and hub-level wrong-principal/cross-workspace revocation
cases. Generic broker tests and adjacent service/local authorization tests
cover the underlying controls, so these do not reopen the blocker.
The first schema-definition review then blocked substring-based CHECK matching
because unrelated SQL literals/comments could carry decoy constraint text.
Replacing it with quote/comment-aware balanced CHECK extraction and an exact
normalized-expression set closed the bypass; a decoy regression passes and
the re-review returned **Ship** with no P0/P1. Remaining P2 hardening is direct
line-comment and escaped-identifier fixtures, a process-ready barrier stronger
than the shared future-start synchronization, and documentation that strict
normalization intentionally rejects some semantically equivalent DDL.
The authoritative full-core run subsequently exposed `SQLITE_BUSY` before the
first tenant metadata read had installed its timeout. Moving `busy_timeout`
ahead of that read preserved the `BEGIN IMMEDIATE`/in-transaction recheck and
closed the race; three consecutive forced-overlap runs and the full core suite
pass, and the follow-up review returned **Ship** with no P0/P1.
The first purge-heartbeat review then blocked a latched failure that could let
cleanup continue after renewal stopped. The cleanup port now receives a
mandatory abort signal, heartbeat failure rejects immediately into the cleanup
race, and claim loss clears the timer and prevents stale terminal writes. An
injected fence-loss regression proves signal delivery and timer disposal; the
re-review returned **Ship** with no P0/P1.
The first wire-schema review then found that official clients rejected
malformed results but the server still emitted them to raw hub clients. The
server now validates command-specific results before transmission, dispatches
normalized request payloads, and emits only a sanitized capability error on
schema failure. Receipt operation/aggregate invariants and fresh-acquisition
token presence are schema-bound. A malicious token-hash projection does not
cross the server boundary; the re-review returned **Ship** with no P0/P1.
A runtime-composition review then identified a still-open P1: the shared daemon
has socket-bound client ownership but no per-client authenticated principal and
workspace scope. Registration workspace and actor fields are self-attested,
the daemon token is shared, and local browser-origin sockets may connect
without that token. The default daemon therefore correctly omits catalog host
authority and advertises no catalog capability. Capability advertisement now
remains omitted even when a test catalog host is configured. Production hub
convergence must finish the server-owned connection scope composition and
trusted human confirmation path before the host is exposed; deriving authority
from registration metadata or the daemon's startup cwd is forbidden.
A dedicated production-scope audit then defined the narrow cutover contract:
the owner-authenticated control plane mints a 256-bit, one-time, short-lived
workspace capability; upgrade consumption creates an internal per-connection
identity with server-normalized workspace, tenant, principal, and workspace
epoch. The same connection context must reach registration, every catalog
command on the internal host adapter, confirmation, subscription, unregister,
and disconnect path.
Origin-only sockets remain explicitly unscoped. Revocation advances the
workspace epoch, revokes pending capabilities/confirmations, and closes only
affected sockets. Production caller sockets must keep `chat_catalog.v1`
permanently omitted; bounded projection, lifecycle, and runtime capabilities
remain omitted until the registry, target authorization, managed runtime,
confirmation issuer, scoped event delivery, and catalog host are composed
atomically.
The isolated authority kernel and contextless-dispatch denial are now
implemented: only an identity issued by the same private authority can open a
bound command handle, active proof runs for every command, and host catalog
authority must exactly match that immutable identity. Trusted in-process issue,
upgrade consumption, replay rejection, and revocation-driven socket closure
are complete. Fresh per-physical-socket client acquisition is also complete,
including deduplication, close cancellation, credential separation, and
sanitized failure. The trusted in-process confirmation coordinator, prompt
abort/revocation, invocation-scoped managed responder, target-only UI seam, and
final mutation fence are complete. The selector-free singleton owner endpoint,
fresh-per-socket provider, and managed-runtime pool are also implemented. The
production owner-responder product surface and all-caller composition remain
open.
The HTTP mint endpoint is intentionally narrow: accepting a caller-supplied
filesystem path or workspace selector under the shared daemon token would
broaden that token into arbitrary workspace authority. It mints only when one
trusted startup enrollment exists and returns only a fresh credential and
expiry; multi-workspace selection remains deferred.
The final persistence/quiescence review was intentionally iterative. It first
found migration enrollment, raw CRUD, and invisible asynchronous producers;
then a cross-session callback deputy, ignored producer failures, and an applied
renewal/stop race; finally SQLite `RETURNING` through query APIs and undefined
promise rejection. The implementation now backfills writer heads, exposes only
structurally bound typed mutations, keeps the generic transaction callback
ECMAScript-private, admits only `SELECT` through query methods, separately
tracks producer-failure presence, and installs an applied renewal before
release. Lost release replies replay the original operation. The final
re-review returned **Approve — no remaining P0/P1**.

The PC-3 profile-authority review then found and closed three P1s:
cross-authority `config_restart`, wildcard future-tool widening, and forced
interactive execution for headless profiles. Four accompanying hardening
findings—missing resident stamps, optional profile security fields, incomplete
policy identity, and shallow profile immutability—were also closed. The final
independent re-review returned **Approve for inert, gate-off integration — no
P0/P1** and reconfirmed the hard-coded off release gate.

The first PC-4 checkpoint now defines and implements `chat_runtime.v1` without
re-enabling permissive legacy runtime authority. Shared schemas exhaustively
validate 12 commands, their results, bounded callback JSON, inline image/file
attachments, sanitized message/prompt/checkpoint/usage/compaction projections,
and one sequenced `chat.runtime` event union. Scoped Hub dispatch requires the
registered authenticated connection and delegates only through the pooled
workspace Core. Runtime subscriptions are multiplexed with lifecycle events;
malformed and cross-session adapter output is dropped before client delivery.

The resident adapter tracks only sessions admitted by successful managed
start/resume/restore operations. Reads against unrelated legacy sessions fail
closed. Runtime commands, subscriptions, and projections are connection-owner
checked. The lifecycle operation ID is the run generation: stale-run aborts,
detached Core events/approval callbacks, and wrong-connection responses reject;
disconnect first fences the run and then aborts Core. Timeout, abort, run end,
revocation, and disposal deny pending approvals and clear heartbeat state. Raw
tool input/output, provider messages, checkpoint refs, system prompts,
compaction messages, canonical paths, attachment bodies, and credentials are
omitted from runtime projections. Managed files are schema-validated inline
content, materialized under a private random temporary directory, passed to the
local runtime, and removed after the turn. Runtime results/events enforce a
768 KiB final UTF-8 wire budget; prompt/message reads paginate or byte-bound
their projections, and non-replayable runtime reply/event loss closes the
socket. The production release gate remains hard-coded off.

The first capability-specific callback checkpoint now turns the previously
generic response envelope into closed-world authority. Only the daemon-selected
interactive profile revision 2 / policy epoch 2 grants
`tool_executor.askQuestion`; every other production profile has an empty
manifest. Factory materialization binds that immutable manifest into the
managed execution-policy digest, injects the exact in-process executor, and
registers the same grant with the resident session owner. The broker projects
only bounded `{ question, options }`, accepts only bounded `{ answer }`, strips
`AgentToolContext` and workspace metadata, and correlates one response to exact
connection, session, run, request, capability, and recorded expiry. Unknown or
duplicate grants, extension fields, ungranted resident use, malformed results,
wrong owners/runs/capabilities, duplicate responses, abort/disconnect, timeout,
and a response after `expiresAt` but before timer dispatch all fail closed.
The production interactive resolver also round-trips the grant through the
managed factory, lifecycle `run_turn`, callback event, strict runtime response,
and completed turn without exposing private context. Core typecheck and the
four focused profile/factory/adapter/schema files pass **59/59 tests**. This
proves the first callback shape, not generic callbacks or PC-4 completion.

The physical callback/cancellation checkpoint closes the next callback matrix.
`CatalogManagedSessionRuntime` now exposes its trusted resident guard signal
through `ClineCore`; the adapter binds that exact signal to the registered
owner, preserves it across durable rekey, and releases the listener on stop or
disposal. Authority loss marks an active run aborting and cancels pending
approvals/callbacks before the Core run settles. Stop first calls the adapter's
prepare phase, cancelling callback-blocked work before awaiting Core stop.
Disconnected-owner reclaim cancels and requires retry after run settlement;
old callback responses remain invalid after rekey. Disposal consumes pending
work and late responses see no resident session.

The production profile now crosses an actual loopback WebSocket using a fresh
one-time workspace credential and `NodeHubClient`: register, managed start,
subscribe, turn, `capability.requested`, strict response, and terminal turn all
round-trip. A second turn proves stop cancellation and late-response rejection.
That test exposed a real socket race where a following command could overtake
asynchronous `stream.subscribe`; the browser adapter now uses a per-socket
subscription-control barrier while leaving commands concurrent, and releases a
subscription that settles after close. Shared typecheck plus **2 files/19
tests**, and Core typecheck plus **12 files/147 tests**, pass. The release gate
remains hard off.

Fresh checkpoint proof: Shared focused wire matrix **19/19**, Core focused
managed lifecycle/runtime/factory matrix **41/41**, strict client matrix
**8/8**. After the first independent PC-4 adversarial review and remediation,
the focused Shared wire matrix is **2 files/18 tests** and the focused Core
runtime/factory/channel/client matrix is **5 files/47 tests**. The full Shared
unit suite passes **54 files/501 tests** and the full Core unit suite passes
**212 files/2,190 tests with 1 file/14 tests skipped**. Shared and Core
builds, Shared/Core typechecks (including the Core smoke configuration), the
Drivecode structure/status checks, repository-local link validation, and
`git diff --check` pass.

The first independent PC-4 adversarial review found eight P1 classes and no
P0. Remediation closed unmanaged-session event leakage, stale-run attribution,
disconnect fencing, raw error leakage, inbound attachment/transport mismatch,
heartbeat/correlation omissions, and aggregate/Unicode outbound loss. A narrow
final re-review of the byte-budget/delivery fix returned **no P0/P1**. One
architectural P1 remained explicit in REL-034: a replacement physical
connection needed an atomic, durable-revision-checked reclaim that transfers
resident runtime and lifecycle ownership together. ADR-0052 now closes that
implementation gap while the global managed-chat release gate remains off.

ADR-0052 now implements the selected architecture for that remaining P1. A
map-only swap was rejected during implementation review because durable writer
verification alone neither invalidates the stale credential nor drains
background writers. The selected target rekeys the existing lease token and
increments `writerGeneration` behind an exclusive guard transition and
nonterminal host block/drain/install/reopen barrier, then performs one shared
adapter owner CAS. The start result now projects token-free
`writerGeneration`, resident Core can renew and project token-free authority,
registration records the connection abort signal and writer generation, and
lifecycle operations share the runtime adapter's owner checks. The strict
`chat_runtime.session.reclaim` request exposes only operation ID, session ID,
and expected generation; the token-free receipt is admitted only through the
authenticated workspace scope and existing hard-off daemon release gate.

Focused proof passes Shared runtime wire **1 file/8 tests** and Core
reclaim/storage/guard/host/owner/gate **9 files/200 tests**. Shared and Core
typechecks and targeted Biome pass (two pre-existing optional-chain warnings
only). The full Shared suite remains **54 files/501 tests**; the full Core suite
now passes **212 files/2,210 tests with 1 file/14 tests skipped**.

Independent re-review found no P0 and two P1 race gaps: post-start disconnect
could omit the resident owner record, and a tracked producer could create a
late descendant after the barrier closed. Aborted registration now records an
orphan owner generation for strict reclaim, and producer descendants remain
admitted while any causal producer is tracked. Direct and factory-level orphan
reclaim plus late-producer fixed-point regressions close both findings.

ADR-0053 now records the trusted managed manual-compaction boundary. Its second
hard-off checkpoint routes `chat_runtime.compaction.run` only after exact
connection/session ownership, then delegates through ClineCore to a resident
host operation. The host synchronously reserves per-session exclusivity before
awaiting, rejects turns and active-run compaction races, chooses provider/model,
strategy, system prompt, tools, and transcript from the admitted server profile,
and persists only a compaction sidecar through the current writer fence.
Clients provide no transcript, compactor, provider configuration, sidecar, path,
or writer credential.

The first adversarial audit found one P0 in the initial draft: reusing the
public compaction-state updater could call `agent.restore(...)`. The host now
uses its internal writer-fenced persistence path directly against the exact
source snapshot; a regression proves manual compaction never restores or
replaces canonical live messages. The adapter coalesces identical in-process
operation IDs, conflicts changed intent, cancels on owner disconnect, and
exposes only sanitized state counts/timestamps. A legitimate no-op has the
explicit strict `compaction.skipped` terminal event; failures use one fixed safe
message. The strict command returns a synchronous `completed | skipped`
terminal result.

The second checkpoint moves replay authority into SQLite. Stable operation
identity is session + kind + operation ID, while each receipt binds the
admitting writer generation and policy-derived intent digest. Fresh work commits
`running` before transcript/provider access; process-loss work becomes
`indeterminate`; completed/skipped terminal results replay without provider,
write, or event; and changed intent conflicts across takeover. Completed
sidecar-head selection and the completed receipt share one writer-fenced
transaction. A forced abort trigger proves both roll back, while persistence
tests prove canonical messages remain unchanged and replay reads the exact
receipt sidecar even after the current head advances. The receipt carries a
cryptographic state digest, so same-count/same-timestamp content replacement,
missing files, and malformed sidecars all fail closed.

Resident startup performs fenced orphan recovery before admission. Ordinary
claims return `in_progress` rather than invalidating live work, and a partial
unique SQLite index enforces one running manual compaction per session across
process-local host boundaries. A second independent store connection with the
same valid writer fence observes `in_progress` and cannot create a second
running receipt. Failed finalization is idempotent. Operation
intent now includes the authoritative managed execution-policy digest as well
as the selected compaction settings.

The adapter emits `started` only after durable admission and `failed` only after
durable failed finalization; terminal replay emits no lifecycle events. The
managed execution-policy digest binds explicit permission, strategy, preserve
budget, summarizer provider/model/output identity, and a fixed
`clientCallbackAllowed: false`. The host requires explicit permission; current
production daemon profiles intentionally provide none while the remaining race
matrix and independent review stay open.

Focused checkpoint proof passes Shared SQLite schema **1 file/8 tests** and Core
receipt-store, persistence, managed-adapter, and local-host **4 files/109
tests**. This is
deliberately not ADR-0053 acceptance: production profile authorization, the complete
stop/rekey/renew/process-loss matrix, and later PC release gates remain open.

The final independent re-review approved the remediated checkpoint with no
remaining P0/P1/P2. It explicitly verified stable canonical candidate naming,
typed changed-intent conflicts, upgrade-safe pre-index recovery, legacy
gate-off receipt compatibility, current receipt digest verification, and the
hard-off production gate.

The integration regression passes Shared **54 files/502 tests** and Core **212
files/2,219 tests**, with Core's existing **1 file/14 tests skipped**. Shared
and Core typechecks, targeted Biome, `git diff --check`, and the DriveCode
structure/Done-claim checks pass. The managed chat lifecycle gate remains hard
off.

Managed start profiles now reject `prompt`; Shared typecheck and the strict
lifecycle wire suite **10/10** prove admission-only start/resume, while turn
prompts remain required on `chat_lifecycle.run_turn` after resident ownership
registration.

The range-aware delivery checkpoint now passes strict canonical singleton and
256-event range bounds, client gap/overlap/regression handling, Unicode
additive merge accounting, global-tail in-place ordering, semantic and
subscription barriers, endpoint metadata retention, stale-fence rejection, and
an actual workspace WebSocket that emits one singleton followed by one
compressed range without manufacturing a gap. The adversarial review found a
P0 stale-resubscribe flaw in the first socket-local epoch design. The final
implementation carries a fresh opaque fence on each authorized strict physical
subscription, captures an immutable epoch per server listener,
preserves the fence through coalescing, and makes Node ignore stale, missing, or
mismatched fenced frames. Shared typecheck plus **1 file/10 tests** and Core
typecheck/smoke plus **15 files/192 tests** pass for the final range/fence
matrix. Targeted Biome, Drivecode document checks, `git diff --check`, and
**2/2** Mermaid parse validation also pass.

This is not the PC-4 exit: production manual-compaction authorization and
remaining race proof, physical reconnect/reclaim/resubscribe caller
orchestration, caller-required checkpoint comparison, reasoning-display policy,
and all-caller callback/runtime conformance remain open.

The cursor-recovery checkpoint closes the same-connection delivery gap without
inventing a snapshot authority. Every validated singleton is deep-frozen and
journaled before live fanout under per-session, per-runtime, byte, count, and
resident-metadata bounds. Fresh readiness returns an atomic baseline including
sequence zero. One forward gap releases its old fence and replays exactly the
retained suffix before a matching ready cutoff. Replay admission failure never
produces ready; stale/evicted/ahead/mismatched cursors, duplicate-token intent
changes, acknowledgement timeout, cancellation, epoch change, and a repeated
gap are terminal.

The adversarial review found five P0 and six P1 issues in the first draft:
automatic reconnect raced durable reclaim, quiet sessions lacked a cursor,
physical subscriptions lacked watchdogs, orphan terminals were not journaled,
replay capacity could report partial success, replay was reentrant, listener
sets were mutable during dispatch, token reuse did not bind intent,
installation was nontransactional, metadata was unbounded, and writer-rekey
replay policy was undefined. The remediated boundary reports
`session_reclaim_required` after physical reconnect, preserves the session
stream epoch only across successful durable rekey, journals resident events
independently of live fanout, catches reentrant replay to a stable head, closes
on failed admission, and bounds all metadata. Sequence exhaustion safely
rolls every resident stream epoch instead of silently freezing output.

Fresh verification passes Shared typecheck/build plus **1 file/10 tests**, Core
typecheck/smoke/build plus **15 files/197 tests**, Drivecode structure and Done
checks, scoped Biome, and **3/3** Mermaid parse validation. The physical test
withholds sequence 2 from the first fence, delivers sequence 3, and observes
exact `[1, 2, 3]` output after one cursor retry with no error.

The hardening pass makes strict runtime subscriptions session-only while the
explicit global lifecycle-cursor lane remains lifecycle-only and unfenced
global subscriptions reject before Core construction; accepts a delayed ready cutoff
only inside the requested-through-delivered interval on the same stream;
reserves reference-counted journal metadata before durable admission; and
enforces the central 256-source connection policy before source construction.
The Browser adapter uses one coalescing reconciler over bounded desired state,
binds each source and listener to an exact admission generation, returns to
physical cleanup after ingress changes across an await, settles superseded
admissions, and drops obsolete-source events before they can cross a reused
wire fence.

Nine concrete P1s were reproduced and closed across the iterative hardening
review: delayed-ready rejection, silently partial global runtime recovery,
post-side-effect journal admission, missing subscription bounds, a pre-bound
barrier queue, unsubscribe-crossing duplicate coalescing, unique-intent churn,
post-await stale physical occupancy/generation inheritance, and stale-source
event leakage. The final independent re-review returned **Ship** with no
remaining P0/P1. Shared typecheck/build and **54 files/503 tests** pass. Core
typecheck/smoke/build, the consolidated **10 files/218 tests**, focused Browser
WebSocket **23/23 tests**, scoped Biome, Drivecode structure/Done checks,
`git diff --check`, and **3/3** Mermaid validation pass.

The latest default complete-Core run after the replacement-socket adversarial
remediations reached **215 passing files, 1 failing file, and 1 skipped file;
2,328 passing tests, 1 failing test, and 14 skipped tests**. The failure was
outside this slice in the timing-sensitive child-
process crash fixture in `plugin-install-transaction.test.ts`; this run missed
the expected `SIGKILL`, while the immediately prior complete run timed out at a
different case. Two earlier isolated reruns also passed 18/19 but failed at
different timing assertions. An earlier
clean full run during this same hardening checkpoint passed **215 files with 1
skipped; 2,315 tests with 14 skipped** before the final two Browser-only race
regressions were added. No managed chat capability is advertised; the release
gate remains hard off.

The replacement-socket checkpoint adds one Core Hub
`ManagedSessionController`, an exact registered-connection-generation guard on
reclaim-command and fenced-subscription admission, external
cursor/readiness/reclaim callbacks in the strict runtime client, and an explicit
`ownerTransferred` reclaim result. Node reports physical loss before autonomous
retry and rejects queued frames from retired sockets.
The resident authority records a token-free receipt immediately after a valid
durable rekey. A replacement socket may reconcile that receipt only while the
owner is orphaned at the exact committed generation; the result is non-owning
and forces a new operation plus another durable rekey before subscription.

Component proof covers stable operation reuse across a lost reply,
`ownerTransferred: false` handling, exact +1 generation validation, a socket
change immediately before command send, explicit dispose during an unresolved
reclaim, and suppression of its late completion. The strict
`chat_runtime.session.reclaim.cancel` companion is bound to the original
operation and physical generation. It aborts guard/host waits before the
durable callback; after commit it preserves the successor writer generation and
orphan-fences its process owner. The first independent review found four P1
traces in immediate loss handoff, command-generation fencing, retired-socket
delivery, and controller termination. A narrow re-review found a fifth P1:
bounded response-receipt eviction could make a later exact cancel miss an
otherwise live committed owner. The owner now retains immutable operation,
expected-generation, and target-connection intent independently of that cache.
A forced one-entry cache regression commits two sessions, evicts the first
receipt, cancels the first exact owner, and proves the second owner is unchanged.
Final independent re-review found no actionable P1/P2 and confirmed closure of
all five traces. Its three lower-severity proof-scope observations are now
closed: controller **5/5** directly times out replacement readiness and emits
the exact generation-fenced cancel; physical WebSocket **14/14** drives three
real clients through the real adapter, proves receipt presence then eviction,
cancels the retained exact owner, and leaves the second owner live; host
**84/84** separately cancels unresolved expected-lease verification, the
existing producer drain, and a real queued writer-mutation fixed point with a
same-generation renewal. Startup settlement is explicitly documented as a
defensive invariant because public writer-transition admission cannot observe
`active` until startup has synchronously settled.
An additional narrow review found no actionable P1/P2, no fixture authority
bypass, and no leaked client, timer, or observed race nondeterminism. Its three
focused files passed **103/103 tests**, and the four new proofs passed **20/20**
executions across five concurrent stress runs. The physical receipt-eviction
case is an adapter/transport regression through the real runtime adapter; it is
not represented as a complete lifecycle-start E2E.
The physical workspace-WebSocket proof uses three fresh one-time capabilities
and registrations: the original stream accepts event 1; event 2 is retained
while disconnected; the first replacement commits and loses its reclaim reply;
the second replacement reconciles the same operation, performs a new-operation
rekey, sends a cursor-1 fence, receives replay 2, and reaches ready 2. No generic
runtime/session command or credential-bearing fallback is sent. Verification
passes Shared **54 files/503 tests**, Core **9 files/236 tests**, and the focused
managed adapter **40/40 tests**, plus both package typechecks and builds, scoped
Biome, Drivecode structure/Done checks, `git diff --check`, and Mermaid
validation for this checkpoint. The release gate remains hard off
pending production caller adoption and the remaining PC-4 convergence work.

| Finding | Disposition on 2026-08-14 |
|---|---|
| Foreign keys were connection-local | fixed in the shared SQLite opener; independent-connection regression added |
| Purge could finalize without cleanup | fixed locally: one public orchestrator, injected idempotent cleanup port, durable attempt/failure evidence, private receipt-gated finalization, retry and replay tests |
| Lease clock/token/owner were caller-forgeable | fixed: authority clock, maximum TTL, internal random token, hash-only persistence, sanitized reads, actor-bound release, and host-issued local/hub context |
| Recovery/restart could not stay in one chat | fixed with successor attachment and head/ordinal/revision advancement |
| Lifecycle checked only head and ignored leases | fixed for every attached session and every unexpired lease |
| Activity was adoption-only | fixed with transactional monotonic activity recording |
| Workspace/actor authorization was asserted | fixed for the proof: issued contexts are identity-checked; local/hub tenant, principal, and absolute workspace scope fail closed; hub authority-shaped payload fields reject before authorization |
| Audit used ambiguous revision domains | fixed locally with aggregate kind/ID/revision, purge-driven binding events, purge-attempt revisions, and complete connector source provenance |
| Schema label did not detect drift | fixed: required columns/indexes/foreign keys, normalized CHECK definitions, and exact UNIQUE column order are inspected; malformed/future/constraint-drift schemas fail closed; real concurrent processes prove serialized migration and one durable first-tenant winner |
| Replay returned mutable current state | fixed: persisted outcome becomes a frozen immutable receipt; mutable `current` projection is separate and explicitly labeled |
| Binding identity was inconsistent | partially fixed: scope/binding-ID mismatch rejects; uniqueness errors still need deterministic mapping |
| Binding scope could move across workspaces | fixed for the proof: durable live/event/tombstone ownership is checked before exposure and in the same bind/unbind transaction; takeover regressions cover bound and retained-unbound rows |
| Concurrent purge retries could duplicate cleanup | fixed: a revisioned service-owned heartbeat renews pending cleanup claims; receipt/failure persistence stops renewal and CASes the latest revision; claim loss fails closed; a long-cleanup regression advances past the original stale threshold while a second service remains rejected; idempotent `attemptId` remains defense in depth |
| Hub registration metadata was treated as authority | fixed at the catalog boundary: the provider receives no registration record or operation payload; production still needs a transport-authenticated principal/workspace registry before configuring the host |
| Static capability was advertised without a host | fixed more strictly: raw `chat_catalog.v1` remains omitted from production caller sockets; bounded projection/lifecycle/runtime capabilities remain omitted until authenticated WebSocket, target authorization, managed runtime/adapter, event projection, and caller composition are complete |
| Tenant isolation existed only in memory | fixed with one-database-per-tenant enforcement: shared durable owner, pre-migration validation, explicit empty-database provisioning for nonlocal tenants, local-only legacy migration, tenant-aware session/catalog stores, candidate-handle rollback, and collision tests across invocation/binding/purge/tombstone domains |
| Confirmation context was reusable bearer authority | fixed: core-owned broker mints 256-bit opaque credentials; client/operation/invocation/typed aggregate/revision/issuance/expiry are bound; server consumption is atomic and global to the broker; local contexts are one-time; exact replay requires a fresh grant |
| Lost lease reply stranded the only release token | fixed without recoverable secret storage: sanitized lease read, owner-only human-confirmed CAS revocation, immutable revoke replay, replacement acquisition, and stale-token rejection pass locally and through the hub, including lost acquire and revoke replies |
| Hub responses lacked runtime schemas | fixed with exhaustive strict shared v1 request/result schemas, normalized server dispatch, pre-transmission result validation, client-side reply validation, command-specific receipt invariants, and malformed/version-drift/sensitive-field rejection tests |
| Long cleanup could outlive purge claim | fixed with bounded revision-CAS heartbeat, current heartbeat timestamps/events, latest-revision completion, claim-loss failure, and a cross-service long-cleanup regression |
| Shared hub lacks authenticated per-client workspace scope | advanced partial, still release-blocking: private one-time authority, opaque registry, immutable identity, one-time WebSocket consume, epoch revocation/socket close, bound command handles, server-owned public-client lifecycle, exact authority matching, contextless denial, fresh reconnect acquisition, invocation-scoped target-only confirmation/final mutation fencing, the authority-keyed managed-Core pool, strict 14-command lifecycle and 13-command runtime dispatch, immutable lifecycle/runtime projections, concrete profile-driven adapters, admission-only starts, durable resident reclaim and cancellation, durable manual-compaction receipts, byte-bounded close-on-loss delivery, selector-free owner capability acquisition, inert daemon composition, the first profile-gated callback with physical WebSocket/cancellation-race proof, fenced range-aware assistant delivery, one-shot cursor-anchored same-connection gap recovery, and a shared replacement-socket reclaim controller are complete; production controller adoption, compaction authorization, owner-responder product wiring, and caller cutover remain open; all managed chat capabilities stay unadvertised while the release gate is off |
| Managed factory presence broke staged rollout | fixed: the release gate and authenticated scoped connection now jointly select managed command/event routing; gate-off and unscoped sockets retain the tested legacy compatibility lane, while gated scoped sockets deny generic commands before dispatch |
| Resume lease could expire while runtime kept writing | fixed for the local managed runtime: guard startup verifies, renewal uses actual `expiresAt`, deadline loss aborts, renewal serializes through the host write gate, and every managed commit revalidates active token/generation in SQLite |
| Raw lease propagation through generic hub commands | rejected by design: credentials remain in trusted core; future clients receive only narrow managed-session operations after authenticated connection scope exists |
| Direct runtime bypass of managed authority | fixed for the local/shared SQLite boundary: credential-free managed starts and direct create/replace/delete paths reject; credentials remain absent from generic hub/plugin contracts |
| Verify-then-write race | fixed: `writer_generation` and token are validated in the same immediate transaction as row/head commit; transcript, compaction, metadata, status, and manifest writes share the gate |
| Failed-start/release race | fixed for the managed local runtime: lifecycle epoch registration precedes startup awaits; receipt requires producer and persistence drain; failure retains authority |
| Reset could unbind a substituted session and strand a lease after partial failure | fixed in coordinator: unbind CAS includes binding/chat/session/scope/revision, and deterministic replay IDs let a retry pass completed steps and finish release |
| Lost acquire reply was not recoverable through the coordinator | fixed with caller-stable acquire invocation/revision plus explicit owner-confirmed revoke and fresh replacement acquisition |
| Public persistence helpers could mutate a different managed session | fixed: the unrestricted transaction callback is `#private`; exported mutation methods bind SQL targets to their validated session; query helpers reject non-`SELECT`, including mutation statements with `RETURNING` |
| Producer rejection could still produce a drained receipt | fixed with a dedicated producer set, explicit failure-presence state, rejection inspection, and undefined-reason regression; no terminal write or receipt follows producer failure |
| Stop could release a stale handle after an applied renewal reply race | fixed by retaining the applied authoritative handle before observing stopped state; the real race releases the renewed revision and passes replay tests |
| Connector reset and shutdown deleted history | fixed for current connector paths: stop then observed-binding clear; failed stop retains binding; no local destructive fallback when runtime authority is unavailable |
| Session/manifest history could resurrect catalog lifecycle | fixed for the local compatibility projection: catalog membership collapses to one head row, deleting/tombstoned members are suppressed, and only unattached non-tombstoned rows receive an explicit Legacy label; production hub parity and purge UX remain gated |
| History reader could consult a catalog from another database/tenant | fixed: `CoreSessionService` exposes its exact store directory/tenant identity to the core-owned projection factory; a real custom-directory/custom-tenant integration proves catalog rows are read from that authority |
| Global history inferred catalog workspaces from a bounded session scan | fixed: local catalog authority enumerates distinct non-deleting workspaces directly; unscoped projection unions those with compatibility workspaces before catalog activity ordering |
| Fresh root required a session row before catalog ownership | fixed in the local authority kernel: atomic admission creates the inert session, root chat/membership, writer head, and first lease in one immediate transaction; failed admission rolls every row back |
| Initial root artifacts could be created before writer fencing | fixed: root row materialization preserves FK identity and messages/manifest candidates publish only through the admitted writer generation |
| Managed guard started after host bootstrap | fixed in the trusted managed runtime: both fresh start and resume verify and install the guard first; renewal during bootstrap remains fail-closed at the durable fence |
| Managed Core could silently select hub or file persistence | fixed in the explicit composition: managed mode is local-only, eagerly initializes the catalog over the session service's exact database/tenant, and rejects ambient hub routing or file fallback before host startup |
| Generic Core lifecycle could bypass managed operation identity | fixed for composed sessions: generic start and checkpoint restore reject on a managed Core, generic stop and send reject resident guarded sessions, the public writer-lease updater is removed, and the sanitized facade requires stable operation/session IDs |
| Checkpoint restore could start a replacement through generic host internals | fixed locally: managed restore uses side-effect-free preparation, atomic related admission, guard-before-worktree/bootstrap ordering, rollback, workspace pinning, and the sanitized Core facade; generic managed restore remains rejected |
| Failed managed start or stop discarded resident authority state | fixed: the guard remains registered for explicit stop/release or expiry; Core disposal attempts managed quiescence/release before generic host and SQLite cleanup |
| Managed confirmation could diverge from the direct coordinator or outlive its command | fixed behind the disabled gate: one invocation-scoped responder checks the Core target, exposes only frozen target display data, shares direct/managed prompt bounds and termination, reaches the final mutation fence, and is retired after dispatch; the production owner surface remains an explicit product choice |
| Scoped audiences still share workspace-wide catalog authority | fixed behind the disabled gate: immutable target scope and audience-before-disclosure checks exist, managed sockets deny raw catalog access, installation-bound same-transport audiences use separate Core instances, and the ordinary interactive owner remains closed by default |
| Lifecycle reconnect can join at the current event head | fixed behind the disabled gate: one audience/query snapshot cut feeds exact retained suffix replay with separate scanned/delivered cursors and delivery-admitted ready; unavailable/ahead replay fails closed so the CA-0 client can replace from a fresh snapshot |
| A fresh process cannot safely reattach to an established resident session | fixed behind the disabled gate: audience-authorized nonresident/live-owner/orphan continuity, unchanged ADR-0052 reclaim with exact unknown-reply retry, bounded hydration/replay, and ready-before-turn pass without treating client cache as authority; ADR-0055 acceptance and caller adoption remain |
| Drive room/fork/wave paths can reach legacy session authority | open release blocker: managed links require authorized projection; managed workers require a server-owned coordinator, closed profile, structural lineage, managed stop/retention, and fenced parent injection, otherwise reject before room mutation or legacy host access |

## Release blockers

1. Accept ADR-0055, then adopt the implemented fresh-process reattach atomically
   through production callers. Preserve the proven
   `not_resident`/`owned_elsewhere`/`orphaned` continuity result, exact durable
   reclaim/lost-reply reconciliation, bounded runtime hydration, and
   ready-before-turn. The real connector launcher must request its trusted
   installed-instance capability; daemon restart must create a new resident
   epoch, and cached cursors/generations remain non-authoritative.
2. Converge Drive room linking and fork/tick/wave execution on a reviewed
   coordinator and closed worker profile that preserve ADR-0014 hard-boundary,
   SeedPacket/PromotePacket, path/worktree, audit, and retention semantics, or
   reject managed targets before room mutation and legacy `sessionHost` access.
3. Select and wire a real production human responder for explicit
   archive/activate/purge/recovery UI. Preserve the implemented target-only
   callback: hidden connection/workspace/operation correlation stays in the
   server, all termination remains abortable, and no decision depends on
   `client.register` metadata, public client IDs, loopback Origin, or daemon
   cwd. Rename remains revisioned but non-destructive and does not prompt.
4. Finish PC-4 caller convergence: the shared controller now proves
   replacement-socket order `register → durable resident reclaim → fresh cursor
   subscription → replay → ready`, including lost-reply reconciliation and a
   second durable rekey. Adopt it in every production caller; transport-level
   automatic cursor resubscribe remains forbidden and reports
   `session_reclaim_required`. Decide whether reasoning and checkpoint
   comparison are authorized product behavior before enabling them.
5. Carry the proven callback broker through the caller matrix. The physical
   WebSocket event-response path and stop/rekey/writer-loss/dispose races now
   pass; each interactive/connector consumer must handle request, cancellation,
   late-response rejection, and reconnect without falling back to a legacy
   runtime command. Managed lifecycle starts reject `prompt`, so every
   callback-capable turn runs through `chat_lifecycle.run_turn` after resident
   registration.
6. Authorize trusted manual compaction in an explicit production profile only
   after the remaining stop/rekey/renew/process-loss matrix passes. Durable
   receipts, atomic sidecar-head commit, exact-sidecar replay, and fail-closed
   process-loss recovery already exist and must not be rebuilt in another lane.
7. Converge interactive/history start, reset, resume, same-ID restart, fork,
   restore, recovery, cleanup, and destructive UX on the managed facade. Then
   migrate all connector bindings atomically so catalog state is authoritative
   and JSON is delivery cache only.
8. Classify ACP, Zen, schedules, Agent, Hub UI, examples, and tests as managed
   or explicitly unscoped compatibility consumers. Enforce server-side target
   isolation so an unscoped list, direct read, wildcard subscription, or raw
   mutation/runtime command cannot discover or address a catalog-managed
   session. Only after the complete negative-fallback and all-caller E2E matrix
   passes may command routing, event routing, and capability advertisement
   switch together.

The ordered dependency and conformance matrix now live in
[production-convergence-plan.md](production-convergence-plan.md).

## Decision gate

Do not accept ADR-0051, publish the catalog as production authority, or pin this
plugin commit into `qh2-template` until the release blockers above and the
owner decisions in the M0 plan are resolved.
