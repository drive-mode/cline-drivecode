# Multi-device matrix

Status legend: `done` · `wip` · `todo` · `n/a` · `yagni`

Update this file whenever a consumer surface ships or regresses on any device.
The **multi-device-backlog** skill owns the edit discipline.

The `ios` column now follows the standalone
[`drive-ios`](https://github.com/drive-mode/drive-ios) app. `wip` means an open
preview implementation exists but its production service/release boundary is
not complete.

| ID | Feature | hub | pwa | ios | tui | Notes |
|---|---|---|---|---|---|---|
| F01 | Live glance home | wip | todo | wip | lite | standalone iOS surface exists; live aggregates/inbox remain open |
| F02 | Full-bleed Spotlight | wip | todo | wip | lite | preview stage exists; managed room/call connection remains open |
| F03 | Approval gate | wip | todo | wip | wip | iOS UI exists; host policy sync and end-to-end approval remain open |
| F04 | Hold-to-talk | done | wip | wip | n/a | hub `?app=1` hold; ios toggle fixture (STT later) |
| F05 | Captions muted | wip | todo | wip | n/a | ios: fixture CC toggle on Call |
| F06 | Raise hand | done | wip | wip | wip | hub behavior exists; standalone iOS still needs managed call integration |
| F07 | Leave without loss | done | wip | wip | wip | iOS local state exists; persistence/resume against host remains open |
| F08 | Preview honesty | done | wip | done | todo | shared `Preview · demo call` chip |
| F09 | Install habit | n/a | wip | wip | n/a | hub manifest **Cline Drive**; install UX polish left |
| F10 | Invite deep link | todo | todo | todo | wip | |
| F11 | Blocked-on-you | todo | todo | todo | todo | |
| F12 | Dead-air activity | wip | todo | wip | todo | ios: activity row |
| F13 | Recent / return | wip | todo | wip | todo | |
| F14 | Leave handoff line | wip | todo | todo | todo | light keep-running line with F07 |
| F15 | Voice mini-settings | wip | todo | wip | todo | ios: Settings toggles |
| F16 | Browse lite | wip | wip | wip | lite | standalone iOS surfaces exist; live source/target resolution remains open |
| F17 | Viewport diagrams | wip | wip | wip | n/a | preview behavior exists; physical-device and accessibility validation remain open |
| D01 | Live Activity | n/a | n/a | yagni | n/a | after Tier 1 |

Evidence rule: fixture/screenshots keep iOS at `wip`; `done` requires the live
adapter plus the device and workflow gate in
[ios-native-client/testing.md](../ios-native-client/testing.md).

Last maintained: 2026-08-18 (standalone iOS authority + release/integration truth).
