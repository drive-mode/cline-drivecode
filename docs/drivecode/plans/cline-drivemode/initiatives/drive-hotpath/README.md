# drive-hotpath · room wire performance and hydrate correctness

**Status:** active  
**ADR:** [ADR-0029](../../adr/ADR-0029-room-hotpath-redesign.md)  
**Why:** Long-session hydrate is wrong after retention trim; call UX pays extra hops and fat snapshots under tool storms. Same wire must serve hub, PWA, and iOS.

## Keep

- Single-writer hub
- Pure `reduceRoom`
- Events-first stage
- No MCP room daemon

## Slices

| # | Work | Gate | Status |
|---|---|---|---|
| 1 | Fold checkpoint on JSONL trim; hydrate from checkpoint + tail | Cold restart after trim keeps seated humans | **done** (this branch) |
| 2 | Delta `room.event` publish; full snapshot on join/gap/coalesce | Tool-storm WS payload shrinks; clients still catch up | **done** (this branch) — `publishRoomEvent` is event+seq; webview folds without snapshot; seq gap → `refreshDriveRoom` |
| 3 | In-process agent→stage projector (drop critical-path `call_record_work` RTT) | Daemon `session-event-projector` calls `handleDriveRoomCommand(call_record_work)` after `tool.finished`; remove Hub Chat `recordDriveWorkFromTool` hop atomically | **done** (this branch) — teammates skipped; public `call_record_work` kept |
| 4 | Layout contract: Spotlight + strip + sheets only | Visible stage ≥320px at 1280×640 (measure clipped rects, not CSS min-height); `?app=1` drops hub nav | **done** (this branch) — `?app=1` omits nav; Plan / audit / captions → strip sheets; keep `min-h-[22rem]` |
| 5 | Cloud signaling profile (same wire, hosted writer) | Phone real turns without local daemon — owner ADR-0016 | **blocked** — do not start without owner accept on path H |

## Evidence

- Retention vs fold: [24-scale-and-context](../../research/24-scale-and-context.md)
- Why edge-cache ladders do not apply to loopback hub: [26-request-latency-playbook](../../research/26-request-latency-playbook.md)
- Stage 9 px history: [drive-web](../drive-web/), [21-operator-experience](../../research/21-operator-experience.md)

## Hand back

Ship slice 1 first (correctness). Do not start slice 5 without owner accept on hosted hub. MCP stays an agent tool plane, not the phone session bus.
