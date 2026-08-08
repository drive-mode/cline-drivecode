# Follow-on task plan — after Phase-2 helpers (PR #58)

> **Historical / Done.** F1–F3 landed on merged [#58](https://github.com/hhalperin/cline-drivecode/pull/58). Pack library UI remains out of scope. Prefer nest [HANDOFF.md](../../../HANDOFF.md) and [06-sdk-leverage.md](06-sdk-leverage.md).

Back to [06-sdk-leverage.md](06-sdk-leverage.md). Handoff: [07-agent-handoff.md](07-agent-handoff.md).

**Date:** 2026-07-30  
**Branch:** `cursor/drive-harness-remaining-1929` (merged)  
**Scope:** harness + hub product path only. No webview pack library UI, no `/pack` slash, no Team CI guard.

---

## Already landed (do not redo)

| Item | Where |
|---|---|
| `RosterPack` / `SeatSource` / `PermissionPreset` schemas | `@cline/shared` |
| `expandRosterPack`, `capPreset`, `applySeatSourceDelta`, `resolveAddress` | `@cline/drive` |
| Harness `addRosterPack` via expand + seat-source deltas | `harness.ts` |
| Thin `drive.show.enqueue\|present\|tick` | handlers → `harness.shows` |
| `driveShowRuntime.ts` (no handlers ↔ directorOps cycle) | `@cline/core` hub |

---

## Out of scope (this track)

- Webview `RosterPackLibrary` / `AddPackMenu` / `/pack` composer
- Full `roster.pack*` facet catalog authoring in settings
- Team/team_ CI substring guard (separate DRV-ROSTER-PACK task)
- Dumping `@cline/drive` into `@cline/sdk` root

---

## Slice F1 — Durable registry IO + hub add-pack wire

### Problem (was)

`resolveRosterPack` was required by harness `addRosterPack`, but `getHubDriveHarness` did not inject it. **Resolved on main** — hub can seat packs; library UI still open.

### Tasks

#### F1.1 — `DriveRegistry` schema + path helper

- **Owner:** `@cline/shared`
- **Files:**
  - `sdk/packages/shared/src/drive/facets/registry.ts` (new) — `DriveRegistrySchema` with `schemaVersion`, `packs: Record<string, RosterPack>` (keyed by pack id); optional `profiles` map deferred
  - `sdk/packages/shared/src/drive/paths.ts` — add `resolveDriveRegistryPath(configParent)` → `.cline/drive/registry.v1.json`
  - Export from `drive/index.ts` / facets index
- **Acceptance:**
  - Round-trip parse of a registry with one pack
  - Strict parse rejects prompt-shaped keys on nested packs (inherits RosterPack strict)
  - Path joins `configParent/.cline/drive/registry.v1.json`
- **Verify:** `bun -F @cline/shared test -- registry`

#### F1.2 — Atomic registry store (drive-config)

- **Owner:** `@cline/core`
- **Files:** `sdk/packages/core/src/hub/drive-config/driveRegistryStore.ts` (new)
- **Pattern:** mirror `driveFacetsStore` (`readFileSync` / write tmp + `renameSync`)
- **API:**
  - `readDriveRegistryFile(configParent): DriveRegistry | null`
  - `writeDriveRegistryFile(configParent, registry): void`
  - `lookupRosterPack(registry, packIdOrSlug): RosterPack | null` — match `id` or `slug`
- **Acceptance:** missing file → null; write then read equals; lookup by slug works
- **Verify:** unit test beside the store
- **Constraint:** no second in-memory hub registry — file under existing drive-config tree only

#### F1.3 — Inject `resolveRosterPack` in hub binding

- **Owner:** `@cline/core`
- **Files:** `sdk/packages/core/src/hub/driveHarnessBinding.ts`
- **Change:** `createDriveHarness({ host, resolveRosterPack })` where resolver reads registry from `configParent` (same as host facets parent; default `tmpdir()` today is fine for tests that write a fixture)
- **Acceptance:** harness `addRosterPack` works when registry file has the pack; unknown packId is a no-op snapshot (current empty-members behavior) or clear error — prefer no-op room return matching empty members
- **Verify:** binding/harness test with temp registry file

#### F1.4 — Hub wire `call_add_roster_pack`

- **Owner:** `@cline/core` + `@cline/shared` command name
- **Files:**
  - `sdk/packages/shared/src/hub.ts` — add `call_add_roster_pack` to `HubCommandName`
  - `hub-server-transport.ts` — dispatch with other `call_*`
  - `drive-room-handlers.ts` — handler: parse `{ roomId, packId, workspaceRoot? }` → ensure event log → `getHubDriveHarness({ store, configParent: workspaceRoot })` → `harness.rooms.addRosterPack` → publish room commits (join events may be multiple; publish last snapshot + each commit if available, or at least final snapshot via store)
- **Reply payload:** `{ roomId, snapshot, seq, seated, alreadyPresent, missing, truncated }` — compute from before/after participants + expand metadata when practical; minimum is snapshot + seq like other call_* handlers if expand result is awkward to surface
- **Acceptance:** seating a fixture pack through the command updates store participants with pack seatSources
- **Verify:** `drive-room-handlers.test.ts` case

**Done when F1:** hub can seat a pack from `registry.v1.json` without a stub `resolveRosterPack` in product code.

---

## Slice F2 — Remove-pack refcount (+ spawn cascade helper)

### Problem

Harness can add pack sources but cannot remove them. Overlapping packs / leave-when-empty / spawn cascade are missing.

### Tasks

#### F2.1 — Pure `planRemoveRosterPack` / spawn cascade helper

- **Owner:** `@cline/drive`
- **Files:** `sdk/packages/drive/src/room/seatSources.ts` (extend) or `room/rosterSeating.ts` (new)
- **API sketch:**
  ```ts
  planRemoveRosterPack(participants, packId) → Array<
    | { action: "update"; participantId; seatSources }
    | { action: "leave"; participantId }
  >
  planDismissParticipant(participants, participantId) → same
  ```
  Dismiss: clear target → leave; then repeatedly leave agents whose remaining sources are only `{ kind: "spawn", parentId }` pointing at a leaving id (or whose only source is spawn of dismissed).
- **Acceptance:** table tests for overlap keep / last-source leave / spawn cascade
- **Verify:** `bun -F @cline/drive test -- seatSources` (or rosterSeating)

#### F2.2 — Harness `rooms.removeRosterPack`

- **Owner:** `@cline/drive`
- **Files:** `harness.ts`, `harness.test.ts`
- **Behavior:** apply F2.1 plan via `join` (update sources) / `leave`
- **Acceptance:** add two packs sharing a member → remove one → member stays; remove last → leave; add-twice then remove once leaves one source
- **Verify:** harness tests

#### F2.3 — Hub wire `call_remove_roster_pack`

- **Owner:** `@cline/core` + shared command name
- **Files:** same family as F1.4
- **Pattern:** harness remove → publish commits / final snapshot
- **Acceptance:** hub test with two packs overlapping
- **Verify:** `drive-room-handlers.test.ts`

**Done when F2:** remove-pack is harness-backed and hub-wired; spawn dismiss helper exists with tests (wire `call_dismiss_participant` optional — implement helper always; wire if cheap).

---

## Slice F3 — Script + planner DirectorOps

### Problem

`drive.script.attach|advance` and `runShowPlannerFromWork` still mutate the store inside handlers / room-work path beside the harness commit surface.

### Tasks

#### F3.1 — Extend `DirectorOp` + store mutators

- **Owner:** `@cline/drive` types + `@cline/core` directorOps
- **Files:**
  - `sdk/packages/drive/src/hostPort.ts` — add:
    - `{ type: "attachScript"; roomId; script; showItems? }`
    - `{ type: "advanceScript"; roomId }`
    - `{ type: "planFromWork"; roomId; workKind; ownerParticipantId; nowMs? }`
  - Extend `DirectorOpResult` with optional `beatId`, `say`, `plannedShows`, `reasons` as needed for publish (keep `liveRoom` opaque)
  - `driveDirectorOps.ts` — lift attach/advance/planner from handlers; use `advanceScriptBeat` + `applyPresentedShow` / `runShowDirectorTick` from `driveShowRuntime`
- **Acceptance:** host `commitDirectorOp` exhaustive switch; no handlers import of directorOps
- **Verify:** `clineDriveHost.test.ts`

#### F3.2 — Harness `scripts` (or extend shows)

- **Owner:** `@cline/drive`
- **Files:** `harness.ts`
- **API:** `harness.scripts.attach|advance` + `harness.shows.planFromWork` (or `harness.director.commitPlanFromWork`) calling `commitDirectorOp`
- **Acceptance:** memory host with commitDirectorOp round-trips attach

#### F3.3 — Thin script handlers + planner call site

- **Owner:** `@cline/core`
- **Files:** `drive-handlers.ts`, `drive-room-handlers.ts` (`call_record_work`)
- **Change:** handlers publish only; `runShowPlannerFromWork` moves to runtime or directorOps; room-work calls harness/host commit
- **Acceptance:** existing script + planner tests stay green; event payloads unchanged
- **Verify:** `drive-handlers.test.ts`, room work tests if any

**Done when F3:** script attach/advance and plan-from-work commit through DirectorOp; handlers/publish layer only.

---

## Ordered delivery

```text
F1.1 → F1.2 → F1.3 → F1.4
F2.1 → F2.2 → F2.3   (can start after F1.1 schemas; parallel with F1.2+)
F3.1 → F3.2 → F3.3   (independent of F1/F2)
```

Prefer ship order: **F2.1–F2.2** (pure + harness, no hub enum) → **F3** (DirectorOp thin) → **F1** (registry + hub add) → **F2.3** (hub remove) so hub commands land together.

Revised ship order for one PR track:

1. F2.1 + F2.2 (remove-pack pure + harness)
2. F3.1–F3.3 (script/planner DirectorOp)
3. F1.1–F1.4 (registry + hub add)
4. F2.3 (hub remove)

---

## Verify (whole track)

```bash
bun run build:sdk
bun -F @cline/shared test -- registry rosterPack
bun -F @cline/drive test -- expand seatSources resolveAddress harness
bun -F @cline/core test:unit -- drive-handlers.test.ts drive-room-handlers.test.ts clineDriveHost.test.ts
```

---

## Review notes (fleshed against live code)

Checked 2026-07-30 against `driveHarnessBinding`, `drive-room-handlers` (`call_join` / `call_record_work`), `driveFacetsStore`, `hostPort.DirectorOp`, and `handleScriptAttach`.

| Topic | Decision |
|---|---|
| Hub pack publish | Match `call_join` createOrAttach path: after harness finishes, `publishRoomSnapshot` with final snapshot + `store.lastSeq` (multi-join overwrites `lastCommit`; do not rely on `takeHubRoomCommit` for pack add/remove). |
| Registry path | Add `resolveDriveRegistryPath(configParent)` on `drive/paths.ts` (same shape as facets). Keep storage-scope helper untouched. |
| Empty / missing pack | Harness already returns current room when members empty; unknown packId → null lookup → same. |
| `DirectorOpResult` | Keep show fields; add optional `beatId`, `say`, `showChanged`, `plannedShows`, `plannerReasons`, `errorCode` for script/planner publish without breaking shows. |
| Planner move | Put `runShowPlannerFromWork` in `driveShowRuntime.ts` (pure store fold helpers); `planFromWork` DirectorOp calls it from `driveDirectorOps`. Handlers and `call_record_work` stop owning the fold. |
| Dismiss wire | Ship pure `planDismissParticipant` + tests; skip `call_dismiss_participant` wire unless trivial after remove wire. |
| seatCap on hub | Pass through harness default (`Infinity`) for now; teamOpt gate remains a separate DRV task — do not invent a second gate here. |

Plan was implemented in the revised ship order above.

## Slice status (landed)

| Slice | Status |
|---|---|
| F1 Durable registry + hub add | **Done** |
| F2 Remove-pack plan + harness + hub remove | **Done** (`planDismissParticipant` pure only; no dismiss wire) |
| F3 Script/planner DirectorOps | **Done** |

## Residual audit (2026-08-08)

Re-checked the three out-of-scope items against tip. Two are resolved; one is a real open wire.

| Item | Actual state |
|---|---|
| Team / `team_` guard | **Already enforced** — [`import-boundary.test.ts`](../../../../../sdk/packages/drive/src/import-boundary.test.ts) bans `\bTeam\b\|\bteam_` in kernel source (alongside the type-only `@cline/shared` rule and the `:7891` ban). It landed as a package test, not a CI script, which is why searching `scripts/` and `.github/` finds nothing. Nothing to build |
| Webview pack library | Partially landed — `RosterPackLibrary` / `AddPackMenu` exist (claim:drv-roster-pack-library). Remaining ACs belong to DRV-ROSTER-PACK, not this track |
| `call_dismiss_participant` wire | **Genuinely open.** `planDismissParticipant` is pure, exported (`drive/src/index.ts`), and table-tested (`room/seatSources.test.ts`) — but no hub command exists in `HubCommandName`, `hub-server-transport.ts`, or `drive-room-handlers.ts`. F2.3's remove-pack path is the pattern to mirror |

**Do not wire dismiss from current `main`.** `drive-room-handlers.ts` and `hub-server-transport.ts` are rewritten by PR [#217](https://github.com/hhalperin/cline-drivecode/pull/217), still open ([#216](https://github.com/hhalperin/cline-drivecode/pull/216) merged 2026-08-08). Wiring it now guarantees a conflict. Sequence it after #217 merges — the work is mechanical, and it batches with the [09 host call site](09-next-task-proposer.md), which is blocked on the same files.

`/pack` composer remains out of scope for this track.
