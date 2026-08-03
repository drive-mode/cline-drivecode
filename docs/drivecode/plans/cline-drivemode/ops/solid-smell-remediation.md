# SOLID smell remediation — graphify + ponytail

Scoped notes for the stacked PRs under `refactor/core-leaf-barrel-imports` …
`refactor/core-types-entrypoints`. Baseline graph: `graphify-out/GRAPH_REPORT.md` @ `f94c7c7c`.

## Baseline (Pass 0)

| Signal | Pre-cut |
|--------|---------|
| `core/index` ↔ `provider-settings-manager` | 2-cycle |
| `core/index` ↔ `FeatureFlagsService` | 2-cycle |
| `history` ↔ `host` ↔ `local-runtime-host` | 3-cycle |
| `core/src/types.ts` on FeatureFlags cycle path | yes (via index) |
| Ponytail mode | `/ponytail full` (Pass 1 ultra-lazy) |

## Cuts landed

| Pass | Change |
|------|--------|
| 0 | Ponytail rule + skills; AGENTS leaf-must-not-import-index |
| 1 | Deep-import `core-events` + `provider-defaults` |
| 2 | `history` takes `SessionBackend` from `local/session-record` |
| 3a | Pure join/error/guards → `driveSessionPolicy.ts` |
| 3b | Deferred — voice markers on `useDriveSession` |
| 4 | Deferred — `types.ts` aggregator kept; AGENTS deep-import note |
| 5 | Debt ledger; `reduceRoom` untouched |

## Post-cut graphify spot-check

Target cycles **GONE** from `GRAPH_REPORT.md`:

- `index ↔ provider-settings-manager`
- `index ↔ FeatureFlagsService`
- `history → host → local-runtime-host → history`

## Ponytail debt ledger (`/ponytail-debt`)

| Location | Ceiling / trigger |
|----------|-------------------|
| `sdk/packages/core/src/runtime/host/history.ts` | Host triangle broken via SessionBackend leaf; revisit if graphify re-lists history↔host↔local-runtime-host |
| `sdk/packages/core/src/types.ts` | Aggregator kept; split when a second public surface needs isolation |
| `apps/cline-hub/.../useDriveSession.ts` | Voice still in hook after policy extract; split when Chat/DriveRoomChrome need independent voice lifecycle |
| `apps/cline-hub/.../useDriveSession.ts` | Full host-message dispatcher move deferred; trigger when chrome needs independent dispatch |

## Pass 3b — voice hook (YAGNI skip)

Not extracted. Markers on `useDriveSession.ts` (see debt ledger). Upgrade when chrome needs an independent voice lifecycle — not before.

## Verify

- `bun -F @cline/core test:unit` (focused host/flags/settings): pass
- `bun test .../useDriveSession.test.ts`: 23 pass
- `sdk/packages/drive/src/reduceRoom.ts`: unchanged
