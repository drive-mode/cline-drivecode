# multi-device · one Drive product across hosts

**Status:** active (opened 2026-08-06)  
**Why:** Native iOS is the first store-style client, but Drive must stay great on
hub web, PWA/phone browser, CLI/TUI, and later Android — not an iOS-only fork.  
**Skill:** [`.agents/skills/multi-device-backlog/`](../../../../../../.agents/skills/multi-device-backlog/)  
**Related:** [mobile-consumer](../mobile-consumer/), [drive-web](../drive-web/),
[ux-quality](../ux-quality/), [ios-native-client](../ios-native-client/),
[FEATURES.md](../mobile-consumer/FEATURES.md)

## Devices (columns)

| ID | Surface | Code / SoT today |
|---|---|---|
| `hub` | Hub webview (desktop / wide) | `apps/cline-hub` |
| `pwa` | Phone browser / Add to Home Screen | drive-web + hosted-preview (planned) |
| `ios` | Native SwiftUI app | standalone [`drive-ios`](https://github.com/drive-mode/drive-ios) is the product source; in-tree [`apps/drive-ios`](../../../../../../apps/drive-ios/) is a legacy fixture; [live-client plan](../ios-native-client/) defines the least-authority Cline gateway |
| `tui` | CLI OpenTUI | `apps/cli` |
| `android` | Native later | **YAGNI** until ios + pwa prove retention |

## Source of truth files

| File | Job |
|---|---|
| [FEATURES.md](FEATURES.md) | Canonical feature list (jobs × devices) |
| [BACKLOG.md](BACKLOG.md) | Work queue — gaps, owners, status |
| [MATRIX.md](MATRIX.md) | Compact status grid (feature × device) |

Wireframe visual SoT for phone chrome remains
[`mobile-drive-ios.html`](../../../../design/wireframes/mobile-drive-ios.html).
Brand: [`MOBILE-BRAND-STYLING.md`](../../../../design/brand/MOBILE-BRAND-STYLING.md).

The standalone repository is authoritative for native product status,
implementation, privacy policy, and App Store readiness. This initiative owns
only the cross-device contract and parity queue. Its iOS matrix cells therefore
mean preview behavior exists in the standalone app; they do not mean the open
PR stack is merged or that a store build is ready.

## Rules

1. **No silent device forks.** A behavior that only exists on one device is a
   tracked row in BACKLOG with either a port plan or an explicit “device-only”
   rationale (e.g. Live Activity = ios-only).
2. **Jobs first.** Features must clear the mobile-consumer job test (*Would
   someone open for this alone?*) before they enter FEATURES.
3. **Shared contracts.** Room events, approval gates, honest Preview chip, green
   Live — same semantics everywhere; chrome may differ.
4. **Agents maintain the backlog** via the **multi-device-backlog** skill whenever
   they add/change a consumer surface.

## Hand back

Start from [MATRIX.md](MATRIX.md). The standalone iOS stack is landed; next wire
its managed gateway, account, target, and call adapters while keeping pwa/tui
rows honest. Do not invent Android until the matrix says ios+pwa are green on
Tier 1 jobs.

The iOS live path uses the least-authority Mobile Drive Gateway in
[ios-native-client](../ios-native-client/); it does not expose the core Hub or
model endpoints to a phone.
