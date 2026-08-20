# ADR-0038 · The standard defines how to extend, not the extensions

**Status:** Proposed (2026-08-20)  
**Owner:** Drivecode SE lead / PM  
**Answers:** D1b in the
[repo-ownership initiative](../initiatives/repo-ownership/README.md) — *do the
nine harness-only protocol elements belong in the standard?*  
**Constrained by:** [ADR-0013](ADR-0013-state-partition.md) (state partition;
D2 — the hub is the single writer, **unresolved** for the MCP writer and still
gating the repoint), [ADR-0026](ADR-0026-evidence-backed-done.md)
(evidence-backed done).  
**Wiring:** [repo-ownership](../initiatives/repo-ownership/) finding 1 and
decision D1b.

## Context

`cline-drivecode` is the public repository and carries the open standard;
the product lives in the private repositories. That split makes one question
apply to every symbol: **does the standard own this concept, or does the product
own it?**

Pointing `drivemode-mcp` at the published `@drive-mode/drive-kernel` turned that
abstract question into a concrete list. The compiler produced 26 errors, all in
`roomService.ts`, over seven distinct protocol elements. `store.ts` — the
`LoggedEvent` → `DriveLogEnvelope` migration — already typechecks clean, so the
blockers are entirely protocol-level.

Verified against `sdk/packages/shared/src/drive/` at
[`1d0d001b9`](https://github.com/drive-mode/cline-drivecode/commit/1d0d001b981a04c0678b3be04adba96de1f2dfb7):

- Work kinds are `work.card`, `work.command`, `work.decision`, `work.edit`,
  `work.plan_step`, `work.test_result`. There is **no** `work.generic`.
- Control kinds are `control.address`, `.end`, `.join`, `.leave`, `.mode`,
  `.mute`, `.raise_hand`, `.rename`, `.stage`, `.title_granted`,
  `.title_revoked`, `.title_transferred`. There is **no** `invite`, **no**
  `interrupt_ack`, and **no** session lifecycle.
- `callSession.ts` exists and `callSessionId` already appears on bank events.
- `RoomSnapshotSchema` has no `profilesByParticipantId`, while
  `AgentRuntimeBadgeSchema` is defined and exported one file over — so the badge
  type is currently unreachable from a snapshot.
- There is no vendor, `meta`, or passthrough field anywhere in `events.ts`.

The seven elements do not share an answer, and treating them as one list is what
has kept D1b open. Three complete concepts the kernel already half-carries, one
is a naming mismatch, one is an unfinished port, and two are product concepts
that would damage the standard if admitted.

## Decision

1. **Port the call-session lifecycle.** `control.session_created`,
   `control.session_scheduled`, `control.session_started` and
   `control.session_ended` enter the kernel. The kernel already has a
   `callSession` module and carries `callSessionId` on events; the lifecycle
   that produces those ids is a half-built concept here, not a foreign one. Any
   Drive implementation has sessions.

2. **Port `control.invite`.** The kernel has `control.join` and `control.leave`
   but no way to express that membership was offered rather than taken. Room
   membership is standard by construction.

3. **Port `control.interrupt_ack`.** The kernel defines `control.raise_hand` and
   tracks `raisedHandByParticipantId` on the snapshot, but no participant can
   acknowledge. A handshake with one side specified is an incomplete protocol —
   this is closer to a defect in the standard than to an addition.

4. **Port `profilesByParticipantId` onto `RoomSnapshot`.** This completes a port
   that was left half-done: `AgentRuntimeBadgeSchema` landed in
   `@cline/shared/drive/room.ts` without the field that carries it, so the
   exported type cannot be reached from a snapshot today. The allowlist
   constraint on the badge is unchanged and binding — family and execution
   location only, never model ids, versions, endpoints, keys, or prompts.

5. **Rename in `drivemode-mcp`, not in the kernel.** `work.plan` and `work.test`
   are the kernel's `work.plan_step` and `work.test_result` under different
   names. The standard's spelling wins; the product changes. No kernel change.

6. **`work.generic` does not enter the kernel.** It is the escape hatch every
   pack publishes through, and it is 10 of the 26 errors — the largest single
   group and the strongest pull toward admitting it. Admitting it would mean the
   standard's most-used work event carries an unspecified payload, at which
   point any implementation can claim conformance while emitting arbitrary data
   and no consumer can rely on the vocabulary. A standard whose escape hatch is
   "anything" is not a standard.

7. **`packId` does not enter the kernel.** The packs — `coding`, `tasks`,
   `artifacts`, `direction`, `demo-ops` — are a `drivemode-mcp` product concept.
   Pack attribution is product metadata.

8. **The kernel gains a typed vendor-extension envelope**, and this is what
   makes 6 and 7 affordable rather than merely principled. A namespaced,
   schema-validated field on Drive events lets an implementation carry data the
   standard does not define, without inventing event kinds the standard cannot
   describe. `drivemode-mcp` publishes pack work through it and carries `packId`
   inside it. The precedent is MCP's `_meta` and HTTP's `x-` headers: the spec
   defines the extension mechanism, not the extensions.

9. **Conformance rule: an extension may not be load-bearing for interop.** A
   conforming implementation must remain correct when every extension field is
   dropped. Extensions may enrich a room; they may never be required to
   understand one. Without this, 8 reintroduces `work.generic` by a longer
   route.

## Non-goals

- **This does not answer D2.** Room-state authority between the hub and the MCP
  writer stays open, and the repoint is still gated on it — see
  [ADR-0013](ADR-0013-state-partition.md). D1b decides what the kernel *contains*;
  D2 decides who is allowed to *write* it.
- This does not move `drivemode-mcp` code or archive `collaboration-harness`.
  Those follow the ports landing.
- This does not redesign the packs, and it does not make packs a standard
  concept by giving them a transport.

## Open

1. **Extension namespace format.** Reverse-DNS (`com.drive-mode.packId`), a flat
   prefix (`x-packId`), or a nested object keyed by owner. Needs deciding before
   the envelope ships, because it is not cheaply changed afterward.
2. **Does the session lifecycle need snapshot state**, or do the four events
   suffice? The kernel has no `sessionById` today, and the repoint does not
   require one.
3. **Extension size and retention limits.** An unbounded passthrough field on a
   logged event is a storage and privacy surface; the badge allowlist exists
   precisely because unbounded metadata invites leakage.
4. **D2 still blocks the repoint** even once this lands.

## Alternatives rejected

- **Port all seven.** The fastest unblock, and it makes the standard the shape
  of one product. `packId` in the kernel would oblige every future host to model
  packs it does not have.
- **Port none, and fork the protocol permanently.** Leaves `drivemode-mcp` on
  the retired `collaboration-harness` copy, which is the drift this whole
  initiative exists to end.
- **Admit `work.generic` and defer the extension question.** Cheaper this week
  and the most expensive option later: once the escape hatch is in the standard,
  every consumer must handle it, and removing it is a breaking change.
- **Keep both out with no replacement.** Honest about the boundary but leaves
  `drivemode-mcp` unable to publish pack work at all, so the repoint stays
  blocked on a problem the standard declined to solve.
