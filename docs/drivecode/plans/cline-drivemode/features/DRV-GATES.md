# DRV-GATES · High-impact approval and policy blocks

Back to [README](../README.md). Phase 1 (taxonomy + events) / Phase 2 (UI) in [TASK-GRAPH](../delivery/TASK-GRAPH.md).
Owns workflows **W-24** (approve high-impact) and **W-25** (policy block).
Closes the top gap previously parked only as platform facet `#26` / `#27`.

## Implementation status

`gates.ts` taxonomy + session-allow helpers landed. Feed UI projects `approval.requested` into room feed cards (approve / deny / allow-for-session).

## Problem / user value

Pair-call agents will eventually touch destructive or sensitive actions. Users need a clear, non-modal-hostile way to approve, deny, or allow-for-session — without inventing a second approval plane beside Cline’s existing `approval.requested` plumbing. Policy blocks must produce a visible reason and a replan path, not a silent stall.

## Decision defaults (v1)

| Topic | Default |
|---|---|
| Plumbing | Reuse hub/`approval.requested` events; Drive projects them into the room feed |
| UI owner | **Feed card** in the active room transcript (not a blocking modal; strip may show badge count) |
| Session allow | **Scoped to the exact tool name, never to the action class.** Expires on leave/end, on chat-session switch, or explicit revoke; never survives process restart without durable opt-in (default: no durable allow) |
| Deny | Partner must replan or ask; do not retry the same gated tool silently. A deny revokes any session allow that tool held |
| Taxonomy source | Facet `gates.highImpact` + this feature’s action classes |

## Action taxonomy (v1)

Classes that **must** emit a gate when Drive is active (unless session-allowed):

| Class | Examples | Default disposition |
|---|---|---|
| `fs.destructive` | delete file/dir, overwrite without backup affordance | approve |
| `git.mutating` | commit, push, reset --hard, force push | approve |
| `net.exfil` | raw HTTP with body to non-allowlisted host | approve |
| `shell.unchecked` | shell without command allowlist match | approve |
| `secrets.read` | read env/secretRef material into prompt | approve |
| `policy.hard` | conflicts with agent `permissions.yaml` / constraints | **block** (no approve path except edit policy) |

Thresholds (starting point, tunable via facet later): after **3 denials** of the same class in one room session, partner must narrate a strategy change; after **5 warnings**, call strip shows a sticky “gates active” hint.

**A class decides whether to gate; it must never decide what an approval covers.** `classifyToolNameForGate` is a best-effort name matcher and its fallback is `shell.unchecked`, so most of the default tool set — `read_files`, `search_codebase`, `editor`, `apply_patch` — shares a bucket with `run_commands`. Scoping a session allow by class therefore grants arbitrary shell from an approval the user gave a read-only tool; it shipped that way once and is pinned against by test. The class is the right key for *counting denials* (a strategy signal, where over-grouping is harmless) and the wrong key for *granting authority*.

## Acceptance criteria

- When Drive is active, tools in the taxonomy emit `approval.requested` (or Drive-equivalent gate event) before execution.
- Feed shows an approve / deny / allow-for-session card bound to the requesting participant.
- Deny yields a room-visible reason and the partner’s next narration acknowledges the block (no silent no-op).
- `policy.hard` blocks cannot be session-allowed from the card; user must change permissions/home policy.
- Session allow clears on leave/end **and on chat-session switch** — the hook being bypassed is ClineCore's global `requestToolApproval`, not a Drive-scoped one, so a grant made in one session would otherwise apply to the next while Drive stayed active. Debug persistence of allows requires the same visible debug flag family as DRV-PRIVACY.
- Unit tests cover taxonomy classification, expiry, “no silent retry after deny,” and that an allow granted to one tool does **not** bypass a sibling tool in the same class.
- Voice path (later): gate cards remain text-first; no modal that steals mic focus (W-34 alignment).

## Dependencies

- DRV-EVENTS, DRV-PRIVACY, DRV-HOOK-POLICY, DRV-PLATFORM-CONFIG (facet `#26`/`#27`).
- DRV-ROOM-MVP / DRV-NARRATION for feed projection.

## Surfaces touched

- `@cline/shared` gate/action enums (or reuse existing approval types with Drive tags)
- `@cline/drive` policy helpers classifying tool calls
- `@cline/core` hub approval handlers / room broadcast
- `apps/cline-hub` feed card UI (Phase 2)

## Agent tasks

- [ ] Freeze v1 taxonomy enums and map onto existing approval plumbing.
  - Owner package: `@cline/shared` / `@cline/drive`
  - Verify: unit tests for classification table above
  - Done when: unknown tools default to `shell.unchecked` or explicit `ungated` allowlist entry — never silent.
- [ ] Add facet fields for taxonomy overrides and session-allow policy; refuse unknown major schemaVersion.
  - Owner package: `@cline/shared` + platform config store
  - Verify: `bun -F @cline/shared test` / platform-config tests
- [ ] Project gate requests into room feed events; implement card actions as hub ops.
  - Owner package: `@cline/core` + hub webview
  - Verify: hub unit test + control-ui smoke
- [ ] Wire deny → partner replan narration expectation into hook/persona policy.
  - Owner package: `@cline/drive`
  - Verify: kernel/hook policy test

## Risks

- Rebuilding a parallel approval system. Mitigation: reuse `approval.requested`; Drive only projects and tags.
- Modal-heavy UX breaking call feel. Mitigation: feed card + strip badge; no hard modal in v1.
- Taxonomy too broad → approval fatigue. Mitigation: start from classes above; measure deny rate (see success metrics).
