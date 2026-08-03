# hub-drive-ia-analytics · Overview

**Status:** active
**Feature:** [DRV-ANALYTICS](../../features/DRV-ANALYTICS.md)
**Amends:** [ADR-0007](../../adr/ADR-0007-drive-as-cline-mode.md)
**Related:** [ADR-0015](../../adr/ADR-0015-task-session-observability.md), [DRV-STATUS-SESSIONS](../../features/DRV-STATUS-SESSIONS.md), [DRV-SHIPPED-DIGEST](../../features/DRV-SHIPPED-DIGEST.md)

## Context

Hub Chat was a separate product page (`/chat`) while Drive was only a lobby. Sessions lived at the top of the rail and highlighted during Drive calls. Status Hub grew a fourth **sessions** lens that is retrospective satisfaction, not live agent ops.

## Target

1. **Drive owns the work surface.** Lobby, in-call workbench (`Chat.tsx` module), and session history share one Drive home under `/drive`.
2. **No Chat page.** `/chat` redirects into `/drive`. Top-level Sessions is removed; history is a Drive mode.
3. **Status vs Analytics.** Status Hub stays live ops (Board, Changelog, Dependency map). Analytics owns retrospective rollups and shipped digests.

## Drive shell modes

`DriveShellMode = "lobby" | "call" | "history"`

| Mode | UI | Route |
|---|---|---|
| lobby | `DriveView` | `/drive` |
| call | `Chat` workbench | `/drive` or `/drive?id=<sessionId>` |
| history | former `SessionsView` | `/drive` with history mode |

## Analytics

Reuses `StatusSessionRollupSource`, `SessionRollup` / `StatusSessionRow`, and `buildShippedDigest`. No parallel metric store. Local-first; no phone-home Drive telemetry.

## Phases

| Phase | Goal |
|---|---|
| 0 | ADR amend + this initiative + DRV-ANALYTICS |
| 1 | Call mounts under `/drive`; `/chat` redirects |
| 2 | Sessions history under Drive; drop top-level Sessions |
| 3 | Drop `chat` view leftovers; demo rail |
| 4 | `/analytics` shell + nav |
| 5 | Move sessions lens off Status |
| 6 | Full rollup chips + digest on Analytics |
| 7 | Verify + cite live code |

## Verification

Hub smoke: lobby → join stays under Drive; history opens sessions under Drive; Status has no sessions tab; Analytics loads rollups (`?demoSessions=1`). Docs: `bun run check:drivecode-docs`.
