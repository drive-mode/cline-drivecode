# ADR-0007: Drive is a Cline mode, not a separate product

## Status

Accepted

## Metadata

- Date: 2026-07-27
- Deciders: Drivecode planning (cline-drivemode)
- Related: PRD 8, DRV-MODE-OVERLAY, DRV-TOGGLE, DRV-DRIVE-TAB, D3 in 01-architecture.md

## Context

Earlier planning treated Drive as a product home (Drive tab first, Chat Join as a shortcut into “Drive”). That produced strong room IA, but it also risked reading as a second app bolted onto Cline.

The product goal is different: **Drive is a mode of Cline**, akin to Plan and Act. Entering Drive enables call/room/stage/PiP/roster features. Leaving Drive returns native Cline. The experience must feel almost seamless inside existing hub Chat and composer chrome—not a brand fork.

## Decision

1. **Drive is a first-class Cline mode (product intent).** Users should enter and exit Drive from the same mode surface family as Plan/Act. Native Cline without Drive remains Plan | Act only.
2. **Mode enables features.** Drive mode on attaches or creates the active room and unlocks Drive affordances (presence, stage, address, PiP, ask/debug postures, interrupt). Drive mode off does not show those affordances.
3. **Postures nest under Drive.** While Drive is active, posture is Plan | Agent | Ask | Debug (existing DRV-MODE-OVERLAY mapping to native plan/act). Ask/Debug are not peer top-level modes next to Drive.
4. **Drive owns the work surface.** Session feed, composer, and (when on) stage split live under the hub **Drive** activity (`/drive`). The former Chat page is not a product destination; `Chat.tsx` remains an implementation module mounted by the Drive shell. Users should not need a separate “Chat” app switch to pair-program.
5. **Drive shell modes.** Drive is one product home with modes `lobby | call | history` (lobby = room preview / join, call = workbench, history = session list). Top-level Sessions is folded into Drive history. Rooms remains multi-room discovery.
6. **Join / Leave language.** Prefer “Drive on / Drive off” or mode selection over a standalone product launch. Join call enters Drive mode + attaches the room under `/drive`.
7. **Amends D3.** Room-first domain stays. Drive mode activation and the Drive hub activity share one home; avoid “leave Cline for Drive” product chrome. See [01-architecture.md](../foundation/01-architecture.md).
8. **Status vs Analytics.** Status Hub stays live agent ops (Board, Changelog, Dependency map). Retrospective session rollups and shipped digests live on **Analytics** ([DRV-ANALYTICS](../features/DRV-ANALYTICS.md)), not as a Status lens.

**Impl note (2026-08-02):** Tip UX enters Drive via **Join/Leave call** (`toggleDrive` → room attach) with nested postures when seated. The composer still exposes native **Plan | Act** as the peer mode pill — Drive is not yet a third peer on that control.

**Impl note (2026-08-03):** Hub IA consolidation ([hub-drive-ia-analytics](../initiatives/hub-drive-ia-analytics/)) makes Drive the call + history home; `/chat` and top-level Sessions redirect into `/drive`. Decision point 4 supersedes the earlier “Chat is the default work surface” wording.

## Consequences

**Positive**

- Matches how Cline users already switch Plan/Act.
- Clear off-switch: native Cline untouched when Drive is off.
- Reduces dual-brand / dual-home confusion.

**Negative**

- Drive tab wireframes must be read as room management, not the sole north star entry.
- Mode pill density increases (Drive + nested postures).

## Alternatives considered

- **Drive tab remains the only entry** — Rejected for seamlessness; forces an app-switch feel.
- **Drive as orthogonal toggle separate from Plan/Act forever** — Weaker “akin to Plan and Act” story; keep nested postures instead.
- **Separate Cline Drive product chrome** — Rejected; conflicts with seamless integration.

## References

- [PRD 8](../prd/prd-drive-as-cline-mode.md)
- [DRV-MODE-OVERLAY](../features/DRV-MODE-OVERLAY.md)
- [DRV-TOGGLE](../features/DRV-TOGGLE.md)
- [00-vision.md](../foundation/00-vision.md)
