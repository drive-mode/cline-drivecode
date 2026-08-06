# Drive · iOS (SwiftUI)

Native consumer shell for on-device development. Visual direction matches
[`docs/drivecode/design/wireframes/mobile-drive-ios.html`](../../docs/drivecode/design/wireframes/mobile-drive-ios.html)
and brand locks in
[`docs/drivecode/design/brand/MOBILE-BRAND-STYLING.md`](../../docs/drivecode/design/brand/MOBILE-BRAND-STYLING.md).

**Not** a second product. Surfaces are the same Drive jobs (glance / decide /
speak). Demo fixtures only — no hub transport yet.

## Requirements

- macOS with **Xcode 15+** (Swift 5.9+, iOS 17 SDK)
- Apple ID for signing; physical device or simulator
- Set **Signing Team** on the `Drive` target (bundle id `ai.cline.drive`)

This Linux cloud environment cannot build or deploy the app. Open the project on a Mac.

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

## What’s in v0.1

| Screen | Behavior |
|---|---|
| Open | Brand mark, Preview chip, Watch live / Continue |
| Home | Large title, Live hero (green), Recent, glass tab bar |
| Call | Full-bleed Spotlight + captions/activity + Hold strip |
| Approval | Sheet · Deny / Allow |
| Settings | Grouped Appearance / Voice / Trust |

Navigation is local `@State` with `DemoData` fixtures.

## Multi-device

Feature parity across hub / PWA / iOS / TUI is maintained by the
**multi-device-backlog** skill and
[`docs/drivecode/plans/cline-drivemode/initiatives/multi-device/`](../../docs/drivecode/plans/cline-drivemode/initiatives/multi-device/).

When you add an iOS-only affordance, update the matrix — do not silently fork the product.

## Layout

```text
apps/drive-ios/
├── Drive.xcodeproj
├── README.md
└── Drive/
    ├── DriveApp.swift
    ├── ContentView.swift
    ├── Theme/DriveTheme.swift
    ├── Models/DemoModels.swift
    ├── Views/{Open,Home,Call,Approval,Settings}View.swift
    ├── Views/Components/DriveComponents.swift
    └── Resources/Assets.xcassets
```
