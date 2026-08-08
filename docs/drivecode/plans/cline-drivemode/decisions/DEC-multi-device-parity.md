# DEC · Multi-device parity contract

**Status.** Proposed (2026-08-08)  
**Deciders.** Drivecode SE lead / PM (draft)  
**Aligns with.** [multi-device](../initiatives/multi-device/),
[ADR-0007](../adr/ADR-0007-drive-as-cline-mode.md),
[ADR-0031](../adr/ADR-0031-visual-layout.md),
[DEC-mobile-consumer-owner](DEC-mobile-consumer-owner.md).

## Context

Hub, PWA, iOS, and TUI share a product. Without a binding definition of
**parity**, agents treat “shipped on hub” as done, or demand pixel-identical UI
on TUI. The multi-device initiative already has FEATURES / MATRIX; this DEC
states the decision rule.

## Decision

1. **Parity means shared semantics, not identical chrome.** Room events,
   approval gates, honest Preview/Live, leave-without-loss, and readiness
   signals mean the same thing on every primary device (`hub`, `pwa`, `ios`,
   `tui`).
2. **Tier 1 jobs are the parity bar.** Rows marked Tier 1 in
   [multi-device/FEATURES.md](../initiatives/multi-device/FEATURES.md) must work
   on every primary device (lite/stage-strip adaptations allowed for TUI).
3. **Device-only is explicit.** Features that cannot port (Live Activity,
   platform SSO chrome) are listed as device-only with rationale — never silent
   forks.
4. **Glance vs workbench.** Phone/PWA may optimize for glance + steer; hub may
   expose deeper sheets. Both must still honor the same gate and Preview/Live
   honesty. “Glance-only” is not an excuse to omit Tier 1 gates.
5. **Android stays YAGNI** until ios + pwa prove retention (initiative rule).
6. **MATRIX is the status grid; this DEC is the rule.** Updating MATRIX does
   not change the parity definition.

## Non-goals

- Pixel-perfect UI across devices.
- Porting Advanced hub sprawl to phone (mobile-consumer Tier 4).

## Open

1. Whether `tui` “lite” cells for F01 require a minimum information set beyond
   MATRIX notes.
2. Deep-link / invite join parity timeline vs path H H5.
