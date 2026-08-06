# Matrix schema

## Feature ids

- `F01`–`F99` — cross-device consumer features (Tier 1–2)
- `D01`–`D99` — explicit device-only affordances
- `B01`–`B99` — backlog work items (may span features)

## Device columns

| Column | Meaning |
|---|---|
| `hub` | Cline hub webview |
| `pwa` | Phone browser / installed PWA |
| `ios` | `apps/drive-ios` SwiftUI |
| `tui` | CLI OpenTUI |
| `android` | Reserved; omit from MATRIX until un-YAGNI |

## Cell values

| Value | Meaning |
|---|---|
| `done` | Ships for real users on that device |
| `wip` | In tree but fixture / partial / not wired |
| `todo` | Required, not started |
| `n/a` | Not applicable on this device |
| `yagni` | Explicitly deferred with gate |
| `lite` | Intentionally reduced (e.g. TUI stage strip) |

## Edit discipline

One feature = one MATRIX row. Do not split “ios Live card” vs “hub Live card”
into two features unless semantics diverge — then document the contract gap in
BACKLOG.
