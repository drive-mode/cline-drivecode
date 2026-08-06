---
name: multi-device-backlog
description: >
  Maintain Drive's multi-device feature list and work backlog so hub, PWA,
  iOS, and TUI stay one product. Use when adding or changing consumer surfaces,
  shipping mobile/iOS/PWA/TUI UX, reviewing device parity, or when the user
  mentions multi-device, device matrix, platform backlog, or cross-device
  features. Updates docs under
  docs/drivecode/plans/cline-drivemode/initiatives/multi-device/.
---

# Multi-device backlog

Drive is one product on many devices. **iOS is not the source of truth for the
product** — jobs and contracts are. iOS wireframes / SwiftUI are one chrome.

## When to load

- Adding or changing Open / Home / Call / Approval / Settings / Spotlight
- Shipping anything under `apps/drive-ios`, drive-web `?app=1`, hub call shell, CLI call
- User asks for backlog, feature list, parity, or “does X work on phone?”
- After a PR that only touches one device’s consumer UX

## Source of truth (edit these)

| File | Edit when |
|---|---|
| [FEATURES.md](../../../docs/drivecode/plans/cline-drivemode/initiatives/multi-device/FEATURES.md) | New job/feature or device-only exception |
| [MATRIX.md](../../../docs/drivecode/plans/cline-drivemode/initiatives/multi-device/MATRIX.md) | Status change (`todo`/`wip`/`done`/`n/a`/`yagni`) |
| [BACKLOG.md](../../../docs/drivecode/plans/cline-drivemode/initiatives/multi-device/BACKLOG.md) | New work item or status move |
| [README.md](../../../docs/drivecode/plans/cline-drivemode/initiatives/multi-device/README.md) | Device column set or initiative rules |

Schema notes: [references/matrix-schema.md](references/matrix-schema.md).

Visual phone SoT (look, not backlog): `docs/drivecode/design/wireframes/mobile-drive-ios.html`.  
Brand: `docs/drivecode/design/brand/MOBILE-BRAND-STYLING.md`.  
Job scoring detail: `…/mobile-consumer/FEATURES.md`.

## Procedure (every consumer surface change)

1. **Name the job** (glance / decide / speak / join / return). If none → cut or bury.
2. **Find or add FEATURES row** with an `F##` / `D##` id.
3. **Update MATRIX** for every device column the change touches — and mark
   siblings `todo` if you shipped only one device (honest gap, not silence).
4. **Update BACKLOG** — close the slice or add port work for other devices.
5. **Refuse silent forks** — platform-only APIs go in FEATURES “Device-only”
   with a port or yagni gate.

## Status vocabulary

Use exactly: `done` · `wip` · `todo` · `n/a` · `yagni` · `lite` (reduced but intentional).

## Anti-patterns

- Shipping ios polish without a MATRIX note when hub/pwa lack the same job
- Duplicating the full mobile-consumer FEATURES prose into MATRIX (ids + status only)
- Inventing Android rows before ios+pwa Tier 1 is green
- Calendar estimates in BACKLOG (repo rule: no timeframes)

## Deliverable check

After edits, confirm:

- [ ] FEATURES id exists for the behavior
- [ ] MATRIX row updated for **all** relevant devices
- [ ] BACKLOG reflects remaining ports or marks device-only
- [ ] Links stay under `docs/drivecode/` (no revived `docs/plans/` trees)

Optional: `bun run check:drivecode-docs` if the nest structure changed.
