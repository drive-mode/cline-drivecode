# Multi-device backlog

Work queue for parity. Prefer small vertical slices that move a MATRIX cell
`todo` → `wip` → `done` on **more than one** device when possible.

## Now

| ID | Work | Devices | Status | Notes |
|---|---|---|---|---|
| B01 | SwiftUI demo shell Open→Home→Call→Approval→Settings | ios | **done** | [`apps/drive-ios`](../../../../../../apps/drive-ios/) · [DEMO.md](../../../../../../apps/drive-ios/DEMO.md) |
| B02 | Wire ios fixtures to hub room snapshot (read-only glance) | ios, hub | todo | After B01 on-device smoke |
| B03 | PWA / `?app=1` composition matching ios IA | pwa, hub | **wip** | hub Join/Continue + Browse tabs; Now sequencer: [portfolio-now](../portfolio-now/); PWA = MC3 |
| B04 | Hold-to-talk + STT on ios + Safari | ios, pwa | todo | Permissions-Policy on hosted |
| B05 | Shared Preview/demo honesty component contract | all | todo | Same chip semantics |
| B10 | Browse lite rooms/tasks/artifacts/status | hub, pwa, ios | **wip** | ios fixtures done; hub `DriveBrowseLite` + `?browse=`; live sources later (B02) |
| B11 | Diagram viewport contract (tap / stack / ultrawide) | hub, pwa, ios | **wip** | `visualEngine.ts` measures Spotlight frame; feeds Mermaid/animation; ios fixture |

## Next

| ID | Work | Devices | Status |
|---|---|---|---|
| B06 | Approval gate parity (sheet vs hub modal vs TUI prompt) | all | todo |
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

| ID | Work | When |
|---|---|---|
| — | Initiative + skill + matrix created | 2026-08-06 |

## How to add work

1. Confirm the feature is in [FEATURES.md](FEATURES.md) (or add it).
2. Add/adjust a MATRIX row.
3. Add a BACKLOG row with device columns touched.
4. Link PR / commit in Notes when shipping.
