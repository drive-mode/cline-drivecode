# Multi-device feature list

Canonical list of **consumer jobs** and which devices must support them.
Detail and scoring still live in
[mobile-consumer/FEATURES.md](../mobile-consumer/FEATURES.md) — this file is the
**cross-device contract**. Status per cell → [MATRIX.md](MATRIX.md).

## Tier 1 — every primary device

| ID | Feature | Job | hub | pwa | ios | tui |
|---|---|---|---|---|---|---|
| F01 | Live glance home | Ping | yes | yes | yes | lite |
| F02 | Full-bleed Spotlight | Ping / steer | yes | yes | yes | stage strip |
| F03 | Approval sheet / gate | Gate | yes | yes | yes | prompt |
| F04 | Hold-to-talk / steer input | Corridor | speech | speech | speech | text |
| F05 | Captions when muted | Quiet | yes | yes | yes | n/a |
| F06 | Raise hand finish | Steer | yes | yes | yes | interrupt |
| F07 | Leave without loss | Safe exit | yes | yes | yes | yes |
| F08 | Honest Preview / demo chip | Trust | yes | yes | yes | banner |
| F09 | Install / re-entry habit | Habit | bookmark | PWA | App icon | alias |

## Tier 2

| ID | Feature | hub | pwa | ios | tui |
|---|---|---|---|---|---|
| F10 | Deep link / invite join | yes | yes | yes | `call_join` |
| F11 | Blocked-on-you badge | yes | yes | yes | status |
| F12 | Dead-air activity line | yes | yes | yes | spinner |
| F13 | Session return / Recent | yes | yes | yes | history |
| F14 | Handoff one-liner on leave | yes | yes | yes | print |
| F15 | Voice & devices mini-settings | yes | yes | yes | config |
| F16 | Browse lite (rooms / tasks / artifacts / status) | yes | yes | yes | lite |
| F17 | Viewport-aware diagrams (tap-to-render / stack) | yes | yes | yes | n/a |

## Device-only (explicit)

| ID | Feature | Device | Why allowed |
|---|---|---|---|
| D01 | Live Activity / lock screen | ios | Platform API; port as rich notification on pwa later |
| D02 | Apple / Google SSO buttons | ios / pwa | Platform auth; hub may use other providers |
| D03 | Dynamic Island / liquid glass | ios | Platform chrome; pwa approximates |

## Non-goals (all devices)

See mobile-consumer FEATURES Tier 4 — Advanced hub sprawl, pixel share, social
stranger feed, offline full agent.
