# ADR-0008: Task bank is Drive’s execution primitive

## Status

Accepted

## Metadata

- Date: 2026-07-27
- Amended: 2026-08-02 (workspace scope + completion / covered-check honesty — see [ADR-0018](ADR-0018-agent-runtime-contract.md))
- Deciders: Drivecode planning (cline-drivemode)
- Related: PRD 9, DRV-TASK-BANK, DRV-MODE-OVERLAY, DRV-NOWNEXT, DRV-EVENTS, ADR-0018

## Context

Drive postures are user-picked today. Plans in Cline are chat prose. Cursor-drive embeds todos inside plan files and archives whole plans. Cline already claims Focus Chain checklists and `TeamTask`. None of those give Drive a durable, editable-sequencer / immutable-work-unit split.

## Decision

1. **Drive owns a workspace bank** at `.drive/bank/` with `tasks/`, `plans/`, `archive/tasks/`, and `archive/plans/`. The **canonical bank and active plan are workspace-backed** (one bank per workspace root). Room/call ids may annotate bank events; they are not a second bank authority until a later accepted change. *(Amends the earlier “one active plan per room” wording — tip code stores a single `activePlanId` on the workspace `BankSnapshot`.)*
2. **`DriveTask` is the implementable unit.** Detail lives in the task file. Completed tasks move to archive (read-only in MVP).
3. **`DrivePlan` is an ordered list of task ids.** Plans are ephemeral and editable. Drained or closed plans archive. Plan edits never rewrite archived task files.
4. **At most one active plan per workspace bank.** Other plans may exist as drafts.
5. **Posture derives from bank state** while Drive is on: empty or no open tasks → Plan; open tasks → Agent bound to now task. Ask and Debug are explicit user overrides cleared only by explicit clear.
6. **Covered-check is the intended policy.** An Agent turn should bind a `taskId`. Unbound Agent mutation tools should be refused into Plan at the policy layer. **Impl note (2026-08-02):** `allowWorkspaceMutation` in `driveLoop` is still **advisory** (UI/prompt/tests). Tool-boundary enforcement and WorkLease binding are owned by [ADR-0018](ADR-0018-agent-runtime-contract.md) follow-ons — do not treat this bullet as shipped enforcement.
7. **Partial failure leaves the task open** with `lastFailure`. The partner may propose a sibling fix-up task.
8. **Completion / archive.** Tip `completeTask` may still archive without a receipt. When task policy demands proof, archival requires a recorded verification decision per [ADR-0018](ADR-0018-agent-runtime-contract.md). **Kanban Done / trash never archives a DriveTask.**
9. **Non-bridges for MVP.** Do not reuse or sync Focus Chain or `team_task`. No `Team*` identifiers under Drive bank code.
10. **Persistence is not inside the pure kernel.** `@cline/drive` exposes pure path helpers, snapshot derivation, loop policy, and a bank store over an injected `BankFs`. Hub/core supplies the filesystem adapter and remains the single writer.
11. **Override clear is explicit only.** Setting Ask/Debug does not auto-clear on the next bank-driven turn.

## Consequences

**Positive**

- Continuous work bank; posture auto-selection removes routine mode switching.
- Completed work survives plan rewrites.
- Now/next has a typed source (`BankSnapshot`).
- Scope matches shipped workspace bank; completion/covered-check honesty points to ADR-0018.

**Negative**

- New on-disk layout and event family to maintain.
- Strict covered-check (when enforced) can feel rigid for one-shot work (mitigation: Ask override).
- Until ADR-0018 tools/guards land, Accepteds above include aspirational enforcement language that must be read with the Impl notes.

## Alternatives considered

- **Port cursor-drive `.cursor/plans`.** Rejected. Embedded todos invert the desired immutability split.
- **Reuse `team_task`.** Rejected. `Team` is banned in Drive identifiers; different lifecycle.
- **Focus Chain as sole cursor.** Rejected. Extension-local; no shared archive semantics.
- **Room-scoped bank as authority.** Rejected for tip truth; room ids annotate events only (ADR-0018 §2.1).

## References

- [PRD 9](../prd/prd-task-bank-drive-loop.md)
- [DRV-TASK-BANK](../features/DRV-TASK-BANK.md)
- [DRV-MODE-OVERLAY](../features/DRV-MODE-OVERLAY.md)
- [DRV-NOWNEXT](../features/DRV-NOWNEXT.md)
- [DRV-EVENTS](../features/DRV-EVENTS.md)
- [ADR-0018](ADR-0018-agent-runtime-contract.md)
- [research/19 ADR validation audit](../research/19-adr-validation-audit.md)
