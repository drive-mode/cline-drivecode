# ADR-0052 · Durable managed-session reconnect authority

**Status:** Accepted

**Date:** 2026-08-15

**Owner:** Harrison / Cline runtime owner
**Related:** [ADR-0051](ADR-0051-cross-session-chat-catalog-authority.md), [ADR-0055](ADR-0055-fresh-process-managed-session-reattach.md), [runtime parity companion](../initiatives/cross-session-chat-management/runtime-parity-companion-design.md), [requirements](../initiatives/cross-session-chat-management/requirements.md), REL-034

## Context

A managed Core session may remain resident after its physical Hub socket
disconnects. The catalog lease guard, runtime host, pending prompts, transcript
writer, and background producers can still be live while the connection-scoped
runtime and lifecycle owner is unreachable. A replacement socket needs a
bounded way to continue that resident session without creating a second writer.

The current implementation correctly fails closed. It records one in-process
connection owner for each admitted managed session, aborts an active run when
that connection is revoked, and rejects every other connection. That prevents
confused-deputy access, but leaves an idle resident session attached to a dead
connection until Core is retired.

The durable lease has two counters with different meaning:

- `leaseRevision` advances on renewal, so a client cannot retain it safely
  across an ordinary connection interruption; and
- `writerGeneration` advances only when a new writer credential is issued and
  is already enforced by transcript persistence as the writer epoch.

A map-only replacement could verify the old generation and change an in-memory
connection ID, but would not durably invalidate the former writer credential or
prove a complete authority transition. Stop-then-resume is not atomic either:
it destroys resident state and introduces a release/acquire gap.

## Decision

### 1. Reconnect is a durable writer rekey, not a map takeover

The replacement connection must perform one explicit ownership-transition
protocol. The protocol reuses the existing session lease as the only durable
write authority. It rotates the private lease token and increments both lease
revision and `writerGeneration`; it does not add a second durable connection-
ownership table.

The strict request contains only a stable operation ID, session ID, and
expected writer generation. Lease tokens, connection IDs, paths, and catalog
provenance never cross the managed wire. The sanitized result identifies the
committed authority generation and whether that exact physical caller received
ownership; it never contains the replacement credential.

### 2. A nonterminal host write barrier surrounds the rekey

Before SQLite authority changes, one per-session transition gate must:

1. verify the incoming workspace, tenant, principal, authority class,
   workspace epoch, and policy epoch;
2. prove the prior connection signal is aborted;
3. reject an active run and cancel orphaned approval state;
4. deny new runtime and lifecycle command admission;
5. serialize against lease renew, stop, and concurrent reclaim; and
6. close and drain host operation admission, background producers, and the
   persistent writer queue without terminating the resident session.

An exact transition cancellation signal may interrupt renewal, startup, and
host-drain waits only before the durable callback begins. That pre-durable
path reopens the unchanged writer lease. Once durable work begins, cancellation
cannot roll authority back; the transition finishes installation and the
connection owner is then orphaned.

`activeRuns` alone is not a sufficient barrier because prompt and persistence
producers may outlive the turn wrapper.

### 3. SQLite rekey is the durable linearization point

One immediate transaction, proven by the resident guard's private lease token,
must compare the current owner, active/unexpired lease, exact current revision,
and expected writer generation. It then:

- creates a new CSPRNG lease token and stores only its digest;
- increments lease revision and `writerGeneration`;
- extends expiry;
- updates the writer-head fence;
- records a reconnect/rekey audit event; and
- records replay intent and result for the stable operation ID.

The new plaintext token returns only to the resident guard. The guard and host
install the new writer credential before write admission reopens.

### 4. Runtime and lifecycle share one transition coordinator

After durable rekey and host installation, the coordinator rechecks incoming
connection liveness and the exact transition record, then synchronously changes
the shared runtime/lifecycle owner to the new connection. This owner CAS is the
connection-authority linearization point.

Turn, bind, reset, stop, resume/recovery, related start, checkpoint restore,
and stop-and-archive must consult the same owner and transition gate. Chat-wide
stop-and-archive remains unsupported until all resident sessions can be checked
and drained by that coordinator.

### 5. Failure after rekey is orphaned, never rolled back

If the incoming connection disappears after SQLite rekey, the session enters a
token-free `orphaned` connection-owner state at the new writer generation. The
old owner is never restored. A later authenticated reconnect may begin a new
transition from that generation. If the failed caller's durable reply is
uncertain, the replacement connection first reconciles the original operation
receipt, then begins that new transition only after learning the committed
generation.

If the managed authority/daemon process dies, the resident host and plaintext
token disappear. In-process reclaim is no longer possible; ordinary lease
expiry/resume or the confirmed lost-lease recovery path is the fallback.

A fresh CLI, connector, or UI process while that daemon and resident host
survive is a different failure domain. This accepted ADR does not itself
authorize a new caller to discover the current generation or cursor. ADR-0055
defines that separate target-authorized continuity lookup and now has a complete
gate-off implementation, but remains Proposed pending explicit owner
acceptance. Its implementation invokes this unchanged durable transition;
production callers still fail closed to expiry/resume or confirmed recovery.

Explicit controller disposal follows the same rule without closing the shared
transport. The controller sends
`chat_runtime.session.reclaim.cancel` with the original operation, session,
expected generation, and exact physical-generation transport fence. The server
accepts it only from that transition's target connection. Before the durable
callback it aborts bounded guard/host waits; after commit it converts the exact
installed owner to `orphaned`. A lost cancel frame implies physical loss and
therefore the connection signal supplies the same orphan fence.

The current owned or orphaned generation retains that exact reclaim intent until
another durable transition supersedes it. A bounded replay-receipt cache may
evict an old response, but eviction must never remove the current owner's
post-commit cancellation authority.

### 6. Lost replies replay; changed intent conflicts

Identical in-flight requests coalesce by operation ID. After commit, the same
operation, session, expected generation, and target connection returns the
recorded sanitized receipt without a second rekey. Its result has
`ownerTransferred: true` only while that target is still the exact current
owner at the committed writer generation.

A replacement physical connection may reconcile that same operation only when
the original target is inactive and the shared owner is already `orphaned` at
the receipt's exact committed generation. This replay returns the same
authority with `ownerTransferred: false`; it is observation, not a map takeover.
The replacement must generate a new operation ID, use the committed generation
as its expectation, and complete another durable rekey before subscribing.
The server records this reconciliation receipt even when rekey committed but
the original caller disappeared before owner installation or reply delivery.

An active foreign owner, a newer generation, a changed target while the first
transition is in flight, or any changed session/operation/generation intent
fails closed. Reusing an operation ID with different intent also fails closed.
Cancellation of an in-flight or completed operation is idempotent for the
exact target and conflicts for a foreign target or changed intent.

SQLite replay cannot reconstruct a plaintext token from its hash. That is
acceptable while the resident guard survives because it owns the replacement
token; after process loss, confirmed recovery is required.

### 7. No partial wire promise

`chat_runtime.session.reclaim` and its exact-operation `.cancel` companion are
not advertised until the rekey mutation, guard serialization, host barrier,
shared transition coordinator, lifecycle enforcement, and adversarial tests
land together. The managed release gate remains hard off.

## Options considered

| Option | Trade-off | Decision |
|---|---|---|
| Replace the owner map after checking that the old socket is inactive | Small change and preserves resident Core, but has no durable authority transition, write drain, or replay receipt | Rejected |
| Stop, release, and resume on the new connection | Uses existing APIs, but destroys resident state and creates a release/acquire gap | Rejected for direct reconnect; selected crash fallback |
| Rotate lease token and writer generation behind a host write barrier | Reuses the existing persistence fence and invalidates stale credentials; requires guard serialization, host drain/install APIs, and orphan recovery | Selected |
| Persist a second durable delegated-connection record | Models sockets separately, but creates dual authority/reconciliation and restart cleanup for ephemeral connection IDs | Rejected |
| Disable resident reclaim permanently | Safest short-term posture but fails reconnect parity and REL-034 | Current fail-closed interim only |

## Consequences

### Positive

- Reconnect reuses one durable authority model already enforced by persistence.
- Every stale writer credential is invalidated at the SQLite boundary.
- Runtime and lifecycle command admission cannot diverge during transfer.
- Lost replies have deterministic replay behavior without exposing secrets.
- Process crash has a simple fail-closed recovery path.

### Costs and risks

- RuntimeHost needs a nonterminal block/drain/install/reopen primitive covering
  background producers and persistence, not just the active turn.
- `CatalogLeaseGuard` needs one exclusive mutation gate shared by renew, stop,
  and rekey.
- A post-rekey incoming disconnect leaves an orphaned resident session and
  needs explicit subsequent reclaim behavior.
- Lease expiry during drain must fail closed; implementations may renew before
  entering the barrier when remaining TTL is below a conservative threshold.
- Stop-and-archive needs multi-session owner enumeration and draining before it
  can be enabled on the managed wire.

## Required implementation and proof

1. Add catalog service/port/coordinator rekey with token rotation, writer-head
   update, audit event, replay receipt, and local/hub conformance.
2. Add an exclusive guard transition shared by renewal, stop, and rekey.
3. Add the nonterminal host write barrier and prove no writer or producer crosses
   it with the stale credential.
4. Add one shared runtime/lifecycle owner and transition coordinator.
5. Add strict reclaim and exact-operation cancellation request/results with
   their end-to-end handlers.
6. Prove active-old-connection rejection, active-run rejection, stale
   generation, renewal race, lifecycle race, concurrent reclaim, lost reply,
   incoming disconnect after rekey, orphan reclaim, lease expiry while draining,
   wrong scope/epoch/policy, daemon restart, old-owner denial, pre-durable
   cancellation, cancellation immediately after commit, and cancellation after
   the corresponding replay receipt has been evicted.
7. Keep `managedChatLifecycleEnabled: false` until PC-4 and later release gates
   are complete.

## Implementation evidence

Accepted on 2026-08-15 after the durable rekey, guard reservation, nonterminal
host barrier, shared runtime/lifecycle owner transition, orphan handling, and
strict `chat_runtime.session.reclaim` wire landed together. The wire request is
limited to operation ID, session ID, and expected writer generation; its result
is token-free. The daemon-level `managedChatLifecycleEnabled` gate remains
`false`, so accepting this ADR does not enable the broader managed-chat release.

Focused conformance passes Shared runtime wire **1 file/8 tests** and Core
reclaim/storage/guard/host/owner/gate **9 files/200 tests**. Full regression
passes Shared **54 files/501 tests** and Core **212 files/2,210 tests**, with one
Core file/14 tests intentionally skipped. Shared and Core typechecks pass.

An independent post-implementation review found two P1 races and no P0: an
aborted connection between successful start and owner registration, and a
producer descendant created after barrier closure. Both are closed by orphan
registration and producer fixed-point admission regressions; narrow re-review
found no residual P0/P1.

The 2026-08-17 replacement-socket hardening adds immediate physical-loss
handoff, exact registered-generation fences for both reclaim send and cursor
subscription, retired-socket frame rejection, and
`chat_runtime.session.reclaim.cancel`. Cancellation is threaded through guard
renewal and host pre-durable drains; a post-commit cancel preserves the durable
successor and orphan-fences its process owner. The current owner retains the
exact cancellation intent independently of the bounded response-replay cache,
so receipt eviction cannot strand a live controller-owned successor. Shared
**54 files/503 tests**,
focused Core **9 files/236 tests**, both package typechecks/builds, scoped
Biome, Drivecode document checks, and Mermaid validation pass. The production
gate remains hard off.

The replacement-socket review found four P1 races; its narrow follow-up found
the bounded-receipt-eviction P1. After all five fixes and regressions, an
independent final re-review found no actionable P1/P2. Remaining proof expansion
was then closed with controller timeout-to-cancel **5/5**, real-adapter physical
WebSocket **14/14**, and host **84/84** suites. The host now isolates
verification, producer, and writer-tail cancellation; startup settlement is a
documented defensive invariant because public transition admission cannot
observe `active` before that promise settles. None broadens the authority
contract accepted here.

## Rollback

The reclaim command can be withdrawn while retaining rekey audit rows. With the
release gate off, the safe fallback is current behavior: reject replacement
connections and use normal Core retirement, lease expiry, resume, or confirmed
lost-lease recovery. Rollback never restores an invalidated token or interprets
a session ID as reconnect authority.
