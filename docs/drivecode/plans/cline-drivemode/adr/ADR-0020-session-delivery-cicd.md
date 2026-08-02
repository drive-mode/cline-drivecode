# ADR-0020: Session delivery CI/CD (ledger + projected stack)

## Status

**Proposed**

## Metadata

- Date: 2026-08-02
- Deciders: Drivecode planning (cline-drivemode); awaiting leadership accept
- Related: ADR-0008, ADR-0014, ADR-0015, ADR-0016, ADR-0018, [DRV-ISOLATION](../features/DRV-ISOLATION.md), [DRV-CALL-SESSION](../features/DRV-CALL-SESSION.md), [docs/drivecode/CI.md](../../../CI.md), `.agents/skills/stacked-pull-requests/`
- **Numbering note:** ADR-0019 remains reserved for DrivePlan–Kanban Interop wire shapes (see ADR-0018). Do not reuse 0019 for this topic.

## Context

Drive agents will produce high-volume git change. The product intent is clear:

1. A call’s outcome should stay reviewable as **one stacked PR story** whose title matches the **session title**.
2. Rewind / revert must be first-class, which forces **diligent, timely commits** (lease-boundary checkpoints), not sprawling dirty trees.
3. Users will **Hold** one call (background work continues) while focusing another.
4. Many users will drive the **same monorepo** — on the order of thousands of commits per day — without melting GitHub Actions or leaving required checks Pending.

### What exists today (evidence)

| Piece | Tip truth |
|---|---|
| `callSessionId` | Metrics / bank correlation window (`callSession.ts`). Leave→rejoin **mints a new id**. Not a git identity. |
| Room / call title | **Missing** on `RoomSnapshot` / `CallSessionState`. Titles live on bank tasks/plans and Cline `metadata.title`. |
| Hold | **Missing** as call parking. `StickyPolicy.hold` is Show media, not multi-call focus. |
| Git / PR binding on Drive | **Missing** on room/call/bank. Skills (`create-pull-request`, `stacked-pull-requests`) are contributor tooling. Kanban host owns real worktrees today. |
| ADR-0018 | `DriveRun` / `WorkLease` / `Receipt.evidenceRefs` schemas; tools + typed evidence + isolation enforcement follow-on. Host `worktreeIsolation` defaults **false**. |
| Stack CI helpers | `.github/actions/stack-context` exports `run_expensive`. Used for **annotation** (`repo-stacked-prs.yml`) only. Product suites (`drive-ci`, `sdk-test`, vscode, e2e) do **not** gate on it — mid-stack still pays path-matched cost. |
| Required checks | `drive-ci` always-green thin gate + job-level path filters (`CI.md`). Workflow-level `paths` on a required gate → Pending forever. **No skip-CI labels.** |

### Design space explored (architect arena)

Three structurally distinct candidates were sketched:

| Candidate | Core claim |
|---|---|
| **A · SessionDeliveryUnit** | One `gh stack` owned by one delivery; commits at lease boundaries; Hold = UI focus park. |
| **B · WorktreeLedger** | Local append-only ledger + worktree are authority; GitHub stack is a **batched projection**. |
| **C · TaskAtomicPRs** | Session is a bag of independent task PRs; optional temp stack only at bundle-ship. |

## Decision

**Chosen shape: WorktreeLedger authority + SessionDeliveryUnit product identity** (A grafted onto B). Reject C as the default substrate.

### 1. `DriveDelivery` is the durable delivery identity

Introduce `DriveDelivery` (id `dd_…`) as the unit that owns git history for a Drive call outcome.

- **Title.** First-class `title` on the delivery (seeded from DrivePlan title, Cline session title, or explicit user rename). Stack / PR titles sync from this field.
- **Not equal to `callSessionId`.** Presence windows remain metrics correlation (ADR-0015). A delivery **survives** Hold and leave/rejoin; new `callSessionId`s may annotate the same delivery while it is active.
- **1:1 with one isolated worktree** while mutating. Never share a worktree across two deliveries (align ADR-0014 / ADR-0018 isolation).

### 2. Local ledger is source of truth; GitHub is a projection

```text
WorkLease boundary → local commit → DeliveryLedger entry
                 → (coalesced) project → gh stack tip(s)
```

- **`DeliveryLedger`** append-only: `{ sha, parentSha, message, taskId?, runId?, leaseId?, at }`.
- Agents do not ad-hoc `git push` on every commit. The controller **coalesces** projection flushes (time + count thresholds).
- Projection uses same-repo **`gh stack`** (preview): one stack per delivery, non-interactive agent rules from the stacked-PR skill (`submit --auto`, `view --json`, `stack merge` not `pr merge`).
- Stack **layers** are reviewable concerns (typically one layer per admitted `DriveRun` / sealed task boundary), **not** one PR per micro-commit. Cap layers (recommend ≤5). Exceeding the cap means squash into fewer layers or split a new delivery — do not grow unbounded stacks.

### 3. Hold = focus park, not pause

- **Hold** moves UI focus to another delivery; background agents may continue writing the held delivery’s worktree unless the user sets explicit `pauseAgents`.
- Do not overload Show `StickyPolicy.hold`.
- Cross-delivery references are typed only: `{ deliveryId, sha?, prNumber?, taskId? }`. No history merge, no shared cwd.

### 4. Rewind and revert

| Mode | Behavior |
|---|---|
| **Rewind** (pre-merge) | Reset worktree + branch tip to a ledger entry SHA; rewrite projected tips with **`force-with-lease`** only for affected branches. Ledger keeps a tombstone / cursor so UI can name the undo. |
| **Revert** (post-merge or published tip) | Add a revert commit (or close layer PR before merge). Never rewrite `main` history. |
| **Out of scope for soft rewind** | Other deliveries’ ledgers; unrelated open stacks. |

Receipts (ADR-0018) must grow **typed** evidence (`commit:`, `pr:`, `branch:`) rather than free-form strings before archival can depend on delivery proof.

### 5. CI / Actions scale policy (binding for implementers)

These are part of the decision, not a later optimization:

1. **Wire `run_expensive`** into expensive product jobs (at least e2e / heavy matrices; prefer vscode integration too). Mid-stack layers keep **cheap** always-green required names.
2. **Preserve always-reporting required gates** (`drive-ci`, sdk/vscode aggregate `test`). Never put workflow-level `paths` on those required names. Skipping expensive work must still report success on the required check name (same pattern as today’s `drive-ci` gate).
3. **Draft by default** until “ready for review”. Draft WIP avoids merge-queue / reviewer pressure and historically skips most PR suite spend until ready.
4. **No skip-CI labels** (keep `CI.md` force-only `ci/*` vocabulary). Agents must not invent skip escapes that leave Pending traps.
5. **Coalesce projection pushes**; cancel-in-progress stays per-PR. Do not expect per-PR cancel alone to protect the org under many concurrent stacks — coalesce + draft + `run_expensive` are the primary levers.
6. **Document stack gating** in `docs/drivecode/CI.md` when wiring lands (annotation ≠ product gating today).
7. Same-repo stacks only (GitHub constraint). Fork / sandbox lanes are an explicit dual path for experiment noise, not the primary Drive delivery path on the protected repo.

### 6. Ownership

| Concern | Package / surface |
|---|---|
| `DriveDelivery` / `DeliveryLedger` schemas + typed evidence helpers | `@cline/shared` |
| Pure policy (hold, rewind legality, coalesce thresholds) | `@cline/drive` |
| Worktree + git + `gh stack` projection adapter | Host port (`@cline/core` / hub) — requires `worktreeIsolation` |
| Kanban as optional execution host | ADR-0018 / future ADR-0019; seed script remains delivery tooling |
| CI wiring | `.github/workflows/*` + `stack-context` |

### 7. Explicit non-goals

- Treating Kanban Done / trash as archive authority (ADR-0018).
- Board-wide sync / `seed-drive-kanban.mjs` as product bridge.
- Multi-human media rooms (ADR-0016 beta non-goal).
- Making every DriveTask its own long-lived PR as the **default** session model (candidate C). Independent task PRs remain allowed when outcomes are intentionally decoupled; the default call outcome is still one delivery stack.

## Consequences

**Positive**

- Session title ↔ one stack story matches the product ask without making GitHub the write path.
- Diligent lease-boundary commits enable honest rewind.
- Hold / multi-call works because worktrees and ledgers are per delivery.
- CI survival is designed in (coalesce + draft + wire `run_expensive` + always-green gates).
- Aligns ADR-0014 isolation and ADR-0018 lease/receipt direction.

**Negative / tradeoffs**

- Projection lag: GitHub may trail local ledger; Status Hub needs a “projection lag” affordance.
- Soft rewind + human tip pushes can race (`force-with-lease` bounce).
- Requires host worktree isolation (today capability false) before multi-hold mutation is safe.
- Stack rebase fan-out still exists; short stacks and coalesce are mandatory discipline.
- Delivery identity ≠ `callSessionId` adds a concept humans must learn (metrics window vs delivery).

**Risks**

- Shipping stack projection **before** wiring `run_expensive` multiplies Actions minutes (current tip gap).
- Equating delivery with `callSessionId` would break Hold/rejoin — do not.
- Interactive `gh stack` in agents will hang (skill hard rules).

## Alternatives considered

### A · SessionDeliveryUnit alone (GitHub-authoritative)

One stack per session with push on every checkpoint. Strong product identity. **Rejected as sole authority:** at thousands of commits/day, synchronize storms and mid-stack full suites (until `run_expensive` is wired) melt Actions. Grafted: title sync, Hold semantics, lease checkpoints, typed cross-refs.

### C · TaskAtomicPRs (session as bag of PRs)

Best CI isolation and least entanglement. **Rejected as default:** fails the “one stacked PR matching the session title” product story unless every ship is a manual bundle. Grafted: layer discipline; optional independent task PRs when outcomes diverge; temp bundle only as escape hatch.

### Skip-CI labels / per-commit PR spam

**Rejected.** Conflicts with `CI.md` and Pending traps. Coalesce + draft + expensive gating instead.

## Impl note (2026-08-02)

Status **Proposed** / Impl **decision**. No runtime `DriveDelivery` yet. Prerequisites before claiming partial: schemas + ledger; worktree isolation host path; coalesce projector; CI `run_expensive` wiring behind always-green gates.

## Links

- Arena base judgment recorded in this ADR (synthesis of candidates A/B/C).
- Stack skill: `.agents/skills/stacked-pull-requests/`
- CI contract: [docs/drivecode/CI.md](../../../CI.md)
- Runtime chain: [ADR-0018](ADR-0018-agent-runtime-contract.md)
- Forks / isolation: [ADR-0014](ADR-0014-chat-fork-lifecycle.md), [DRV-ISOLATION](../features/DRV-ISOLATION.md)
