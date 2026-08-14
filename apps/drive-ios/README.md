# Drive · iOS (SwiftUI)

Native consumer shell for on-device development. Visual direction matches
[`docs/drivecode/design/wireframes/mobile-drive-ios.html`](../../docs/drivecode/design/wireframes/mobile-drive-ios.html)
and brand locks in
[`docs/drivecode/design/brand/MOBILE-BRAND-STYLING.md`](../../docs/drivecode/design/brand/MOBILE-BRAND-STYLING.md).

**Not** a second product. Surfaces are the same Drive jobs (glance / decide /
speak). Demo fixtures only — no hub transport yet.

**Full demo script:** [DEMO.md](DEMO.md)

## Requirements

- macOS with **Xcode 26.6** (Swift 6.3 compiler; project language-mode upgrade follows in X1)
- Apple ID for signing; physical device or simulator
- Set **Signing Team** on the `Drive` target (bundle id `ai.cline.drive`)

CI uses GitHub's `macos-26` image with Xcode 26.6 and an iPhone 17 Pro
simulator. The app keeps iOS 17 as its deployment floor.

## Open & run on device

```bash
open apps/drive-ios/Drive.xcodeproj
```

1. Select the **Drive** scheme and your iPhone (or simulator).
2. Target → Signing & Capabilities → choose your Team (Automatic signing).
3. Product → Run (`⌘R`).
4. First launch: Trust the developer cert on the device if prompted
   (Settings → General → VPN & Device Management).

Mic permission string is already set for hold-to-talk (STT wiring comes later).

## Build and test from Terminal

The shared `Drive` scheme runs deterministic `DemoSession` unit tests and one
Open → Call → Approval → Leave UI smoke path:

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild \
  -project apps/drive-ios/Drive.xcodeproj \
  -scheme Drive \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO \
  test
```

If Xcode is installed elsewhere, replace the `DEVELOPER_DIR` path with that
bundle's `Contents/Developer` directory.

Use `xcodebuild -project apps/drive-ios/Drive.xcodeproj -scheme Drive
-showdestinations` if that simulator is not installed locally.

## What’s in the full fixture demo

| Screen | Behavior |
|---|---|
| Open | **Cline Drive** mark, Preview chip, Watch live / Continue |
| Home | Live hero, Recent, leave keep-running banner, glass tab bar |
| Browse | Rooms / Tasks / Artifacts / Status lite · tap-to-render phone diagram stack |
| Call | Full-bleed Spotlight · hold-to-talk · raise-hand finishing banner · CC · Leave · Review→approval |
| Approval | Sheet · Deny / Allow |
| Settings | Grouped Appearance / Voice / Trust |

Navigation is local `DemoSession` with `DemoData` fixtures. Leave ≠ End
(room keeps running). Raise-hand mirrors hub interrupt phases.

## Presenter HTML (no Xcode)

```bash
cd docs/drivecode/design/wireframes && python3 -m http.server 8765
# open http://127.0.0.1:8765/mobile-drive-ios-demo.html
```

## Multi-device

Feature parity across hub / PWA / iOS / TUI is maintained by the
**multi-device-backlog** skill and
[`docs/drivecode/plans/cline-drivemode/initiatives/multi-device/`](../../docs/drivecode/plans/cline-drivemode/initiatives/multi-device/).

When you add an iOS-only affordance, update the matrix — do not silently fork the product.

## Layout

```text
apps/drive-ios/
├── Drive.xcodeproj
├── DriveTests/DriveTests.swift
├── DriveUITests/DriveUITests.swift
├── README.md
├── DEMO.md
└── Drive/
    ├── DriveApp.swift
    ├── ContentView.swift
    ├── Theme/DriveTheme.swift
    ├── Models/DemoModels.swift   # DemoSession + fixtures
    ├── Views/{Open,Home,Call,Approval,Settings}View.swift
    ├── Views/Components/DriveComponents.swift
    └── Resources/Assets.xcassets
```
