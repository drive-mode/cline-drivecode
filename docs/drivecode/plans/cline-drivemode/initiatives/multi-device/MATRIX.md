# Multi-device matrix

Status legend: `done` · `wip` · `todo` · `n/a` · `yagni`

Update this file whenever a consumer surface ships or regresses on any device.
The **multi-device-backlog** skill owns the edit discipline.

| ID | Feature | hub | pwa | ios | tui | Notes |
|---|---|---|---|---|---|---|
| F01 | Live glance home | wip | todo | wip | lite | hub: `?app=1` Join/Continue; ios: `HomeView` fixture, live B02 todo |
| F02 | Full-bleed Spotlight | wip | todo | wip | lite | ios: `CallView` fixture; no live room adapter |
| F03 | Approval gate | wip | todo | wip | wip | ios: static `ApprovalSheet` fixture; authoritative mutation later |
| F04 | Hold-to-talk | done | wip | wip | n/a | hub `?app=1` hold; ios toggle fixture (STT later) |
| F05 | Captions muted | wip | todo | wip | n/a | ios: fixture CC toggle on Call |
| F06 | Raise hand | done | wip | wip | wip | hub live; ios fixture interrupt banner |
| F07 | Leave without loss | done | wip | wip | wip | hub live; ios fixture keep-running note |
| F08 | Preview honesty | done | wip | wip | todo | ios fixture chip exists; live/preview state seam pending |
| F09 | Install habit | n/a | wip | wip | n/a | hub manifest **Cline Drive**; install UX polish left |
| F10 | Invite deep link | todo | todo | todo | wip | |
| F11 | Blocked-on-you | todo | todo | todo | todo | |
| F12 | Dead-air activity | wip | todo | wip | todo | ios: activity row |
| F13 | Recent / return | wip | todo | wip | todo | |
| F14 | Leave handoff line | wip | todo | todo | todo | light keep-running line with F07 |
| F15 | Voice mini-settings | wip | todo | wip | todo | ios: Settings toggles |
| F16 | Browse lite | wip | wip | wip | lite | hub `?app=1&browse=`; ios fixture BrowseViews; live B02 source pending |
| F17 | Viewport diagrams | wip | wip | wip | n/a | ios fixture layout exists; on-device/accessibility gate pending |
| D01 | Live Activity | n/a | n/a | yagni | n/a | after Tier 1 |

Evidence rule: fixture/screenshots keep iOS at `wip`; `done` requires the live
adapter plus the device and workflow gate in
[ios-native-client/testing.md](../ios-native-client/testing.md).
