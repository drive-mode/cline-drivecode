# Multi-device backlog

Work queue for parity. Prefer small vertical slices that move a MATRIX cell
`todo` → `wip` → `done` on **more than one** device when possible.

## Now

| ID | Work | Devices | Status | Notes |
|---|---|---|---|---|
| B01 | SwiftUI demo shell Open→Home→Call→Approval→Settings | ios | **done** | [`apps/drive-ios`](../../../../../../apps/drive-ios/) · [DEMO.md](../../../../../../apps/drive-ios/DEMO.md) |
| B12 | Establish full-Xcode build, unit/UI targets, and pinned Simulator CI | ios | todo | [iOS native delivery X0](../ios-native-client/delivery.md#x0--reproducible-xcode-baseline) |
| B14 | Decide least-authority Mobile Drive Gateway, pairing, and local TLS | ios, hub | todo | ADR slice [G0](../ios-native-client/delivery.md#g0--decide-the-mobile-drive-gateway) |
| B13 | Publish typed room directory + TypeScript↔Swift golden wire fixtures | ios, hub | todo | After B14; [iOS native delivery C1](../ios-native-client/delivery.md#c1--canonical-mobile-wire-contract) |
| B17 | Add loopback read-only mobile profile: rooms:list/get/watch | ios, hub | todo | After B13; no direct `/hub` or `/browser`; [G1](../ios-native-client/delivery.md#g1--read-only-development-gateway) |
| B02 | Wire iOS to live gateway room directory + snapshot (read-only glance) | ios, hub | todo | Depends B12–B14 + B17; [I2–I3](../ios-native-client/delivery.md#i2--native-live-transport) |
| B15 | Stream invalidations; recover gaps, reconnect, and app lifecycle | ios, hub | todo | Authoritative snapshot replacement; [I4](../ios-native-client/delivery.md#i4--reconnect-gaps-and-app-lifecycle) |
| B03 | PWA / `?app=1` composition matching ios IA | pwa, hub | **wip** | hub Join/Continue + Browse tabs; Now sequencer: [portfolio-now](../portfolio-now/); PWA = MC3 |
| B05 | Shared Preview/demo honesty component contract | all | todo | Same chip semantics |
| B10 | Browse lite rooms/tasks/artifacts/status | hub, pwa, ios | **wip** | ios fixtures done; hub `DriveBrowseLite` + `?browse=`; live sources later (B02) |
| B11 | Diagram viewport contract (tap / stack / ultrawide) | hub, pwa, ios | **wip** | `visualEngine.ts` measures Spotlight frame; feeds Mermaid/animation; ios fixture |

## Next

| ID | Work | Devices | Status |
|---|---|---|---|
| B16 | Pair physical iPhone with scoped Keychain credential over WSS | ios, hub | todo |
| B06 | Approval gate parity (sheet vs hub modal vs TUI prompt) | all | todo |
| B04 | Hold-to-talk + STT on ios + Safari | ios, pwa | todo |
| B07 | Captions sticky preference | hub, pwa, ios | todo |
| B08 | Invite deep link `…/r/:id` | pwa, ios | todo |
| B09 | Official Drive mark asset in ios (layered SVG → PDF/SVG) | ios | todo |

## Later / YAGNI

| ID | Work | Gate |
|---|---|---|
| B20 | Android Kotlin shell | ios + pwa Tier 1 green |
| B21 | Live Activities | ios retention evidence |
| B22 | App Store / Play listing | MC3–4 / owner opt-in |

## Done

| ID | Work | Evidence |
|---|---|---|
| — | Initiative + skill + matrix created | [README.md](README.md) |

## How to add work

1. Confirm the feature is in [FEATURES.md](FEATURES.md) (or add it).
2. Add/adjust a MATRIX row.
3. Add a BACKLOG row with device columns touched.
4. Link PR / commit in Notes when shipping.

Fixture UI proves design and navigation, not live parity. Keep the corresponding
iOS MATRIX cell `wip` until the live gateway/client gate is attached.
