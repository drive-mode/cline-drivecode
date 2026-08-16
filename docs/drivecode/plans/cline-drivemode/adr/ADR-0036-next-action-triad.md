# ADR-0036 · Next-action prediction is a three-verb operator triad

**Status:** Proposed (2026-08-11)  
**Owner:** Drivecode SE lead / PM  
**Constrained by:** [ADR-0004](ADR-0004-gated-learn-privacy.md) (gated learn),
[ADR-0013](ADR-0013-state-partition.md) (three-lane state),
[ADR-0015](ADR-0015-task-session-observability.md) (local rollups, no
phone-home), [ADR-0025](ADR-0025-enforced-authority.md) (declared authority
needs a refusal path), [09-next-task-proposer](../../drivecode-sdk/delivery/09-next-task-proposer.md)
rules 1–5, [DRV-EVENTS](../features/DRV-EVENTS.md),
[DRV-PRIVACY](../features/DRV-PRIVACY.md), [DRV-GATES](../features/DRV-GATES.md),
[DEC-open-product-forks](../decisions/DEC-open-product-forks.md) (pixel share
rejected), [DEC-multi-device-parity](../decisions/DEC-multi-device-parity.md).  
**Product:** [PRD 11](../prd/prd-magic-hotkey.md) · **Research:**
[29-large-task-models](../research/29-large-task-models.md).

## Context

Two open threads describe the same missing product from opposite ends.

[21-operator-experience](../research/21-operator-experience.md) named the gap
from the human side: Drive is built around presence, and presence is its best
idea, but it hands the operator "a windscreen with no instrument panel." You can
watch the agent work; acting on what you see costs a mouse trip and a sentence.

[16-task-as-unit-models](../research/16-task-as-unit-models.md) left open
question 3 from the model side — *when, if ever, does a learned proposer graduate
to a default assist?* — and could not answer it, because nothing in the product
records the operator agreeing or disagreeing with a proposal in a form anything
could measure. [09-next-task-proposer](../../drivecode-sdk/delivery/09-next-task-proposer.md)
declined to build a ranker into the bank, correctly, and left the adjacent door
unbuilt.

One interaction closes both: predict the operator's **next action**, show it, and
let one key accept it, one reject it, one revert it. Accepting is the instrument
panel. Rejecting is the label.

The proposal prompting this record arrives as a standalone macOS desktop agent —
Python, Accessibility-API sensors, synthetic keystrokes, a menu-bar HUD, its own
`events.jsonl`. All of that is illegal here (bun-only; hub is the single writer;
no second daemon; privacy-strict defaults). Its own analysis concedes the better
substrate — software work "arrives pre-instrumented" — and this repo already *is*
the instrument. `DriveEvent` is a versioned, `.strict()` zod union persisted as
`{seq, event}` newline records under `.cline/drive/rooms/<roomId>/events.jsonl`;
`work.edit`, `work.command`, and `work.test_result` already carry paths, exit
codes, and pass/fail. What is missing is the interaction contract and the label
economics, not a sensor stack.

## Decision

1. **The codebase is the only signal source.** v0 predicts over work signals this
   repo already emits. No Accessibility API, no synthetic keystrokes, no screen
   capture, no clipboard scraping. The desktop sensor layer in the source
   proposal is a non-goal, not a later phase. Note the source proposal calls its
   sensor layers "providers"; that word is taken here — `.cline/drive/providers/`
   holds STT/TTS manifests ([ADR-0010](ADR-0010-provider-harness-byok.md)) — so
   this record says **signal source** and nothing in this feature may reuse
   `provider`.

   **Amended by [ADR-0037](ADR-0037-invocation-scoped-sensing.md) (Proposed):**
   desktop sensing is permitted when it is *invocation-scoped* — read only
   inside a window bracketing an explicit hotkey press, over a closed fact
   list. Continuous or background sensing, screen and pixel capture, window
   titles, and synthetic keystrokes stay rejected.

2. **v0 predicts over agent-initiated work only.** `work.*` events exist today
   for work *Cline performed*. Operator-initiated saves, commits, and branch
   switches are not observed anywhere, and `apps/vscode` is now a thin SDK shell
   with no editor-observation surface to borrow. v0 ships against the signals
   that exist rather than assuming the ones that do not; widening observation to
   operator-initiated activity is a separate decision with its own consent cost.

3. **Three verbs on one channel.** **DO** executes the ranked-first candidate.
   **SKIP** advances to the next of at most three and executes nothing. **UNDO**
   reverts the last executed candidate and marks it wrong. The list wraps and
   always terminates in `do_nothing`, a first-class prediction rather than a
   failure state.

4. **SKIP is safe at every tier by construction,** not by policy. It advances a
   local index and never reaches the actuator, so no tier check can be wrong
   about it. That is what makes rejection cheap enough to be honest.

5. **The planner proposes; the existing policy disposes.** There is exactly one
   place a tool is stopped in this codebase — the `ToolPolicy` branch in
   `sdk/packages/agents/src/agent-runtime.ts` (`enabled === false` skips;
   `autoApprove === false` requests approval; otherwise it runs). The triad
   reuses **that policy resolution and those host approval callbacks**: one
   policy table, one set of callbacks, one answer to "may this run." **It does
   not build a second approval plane**, which
   [DRV-GATES](../features/DRV-GATES.md) already names as this area's top risk.
   Note the existing branch sits inside an agent turn and gates one
   already-selected tool call; how an operator-initiated DO reaches the same
   policy without paying for a turn is Open 6, and it is a wiring question, not a
   licence to fork the policy. The planner returns structured JSON and holds no
   execution capability ([ADR-0025](ADR-0025-enforced-authority.md): a declared
   limit is only real if some path can refuse).

6. **The triad never widens authority the operator already granted.** A verb's
   tier is capped by the `ToolPolicy` in force: auto-approved today means Tier 1
   here; anything the agent would have had to ask about is at best Tier 2. DO is
   a faster way to say yes to something already allowed — never a second, quieter
   permission system.

7. **Tier is derived from revertibility, not asserted.** Tier 1 executes on DO
   and must be **inert** (changes no durable state — navigation, projection) or
   **mechanically invertible**. Tier 2 arms on the first DO and executes on the
   second. Tier 3 is never executed at any confidence and stays visible as a
   suggestion; note this is *not* `enabled: false`, which would hide it. No
   confidence score may promote a verb across a tier boundary.

8. **Undo granularity is the verb's problem, not the checkpoint's.** The session
   checkpoint is taken **once per user run**, not per action, and restoring it
   is `git reset --hard` + `git clean -fd` + `git stash apply`
   (`sdk/packages/core/src/hooks/checkpoint-hooks.ts`,
   `sdk/packages/core/src/session/checkpoint-restore.ts`). It therefore covers
   tracked and non-ignored-untracked files in one worktree and **nothing else** —
   no terminal, network, browser, or database effect, and never a gitignored file.
   Consequences, binding: an executing verb must carry its own inverse or open
   its own checkpoint via the `createCheckpoint` injection hook core already
   exposes; a verb whose effect escapes the worktree cannot be Tier 1; and UNDO
   must state what it did *not* revert rather than implying a clean rollback. The
   CLI's existing `/undo` is the nearest precedent and has the same coverage
   limit.

9. **Ranking here is orthogonal to the bank cursor.** The vocabulary is *operator
   verbs* — rerun the failed test, open the implicated file, show the diff —
   never `DriveTask` ordering. `nowTaskId` / `nextTaskId` keep coming from
   `deriveBankSnapshot` (09 rule 1); the triad never writes `.drive/bank/` or
   room state (09 rules 3–4) and never lives inside `createDriveHarness` (09
   rule 4). The "no ranker" line in the claims registry is scoped to the harness
   bank slice; 09 rule 3 permits a host-side or out-of-process scorer explicitly.
   This is the carve-out rule 5 already grants `planShowIntents`:
   presentation-side ranking is legal *because* it cannot move the cursor. That
   sentence must stay true of this feature or the feature is wrong.

10. **Predictions get a fourth log family, not a fourth writer.**
    `DriveLogEnvelope` already discriminates `room | bank | artifact`
    (`sdk/packages/shared/src/drive/logEnvelope.ts`). Prediction facts — the
    candidate set offered, and each of do / skip / undo — join as a `predict`
    family with its own retention cap, following the artifact precedent, rather
    than swelling the room union whose oldest-first trim would evict them and
    whose records the stage reducer must read. Writes go through the hub like
    every other event (D2, [ADR-0013](ADR-0013-state-partition.md)). No second
    daemon, no new port, nothing on `:7891`.

11. **This record is the first grant of a training-label corpus, and it is a
    narrow one.** No accepted decision authorizes one today;
    [16](../research/16-task-as-unit-models.md) is research, not binding.
    [ADR-0004](ADR-0004-gated-learn-privacy.md) governs this corpus exactly as it
    governs knowledge. Enforcement is machine, not prose: `.strict()` schemas
    plus `DRIVE_EVENT_FORBIDDEN_KEYS` (`sdk/packages/shared/src/drive/events.ts`)
    already reject `transcript`, `audio`, `image`, `bytes`, `dataUri`, and their
    siblings at parse time. Payloads carry ids, hashes, paths, verb names, and
    outcomes. Storage is local in the
    [ADR-0015](ADR-0015-task-session-observability.md) lane. Nothing phones home,
    and the corpus leaves the machine only through the existing accept gate.

12. **Passive observation mode is rejected here.** Recording the operator's
    unprompted next action is the strongest training signal in the source
    proposal and is structurally indistinguishable from a keylogger. If it is
    ever wanted it needs its own decision and its own consent surface — never a
    settings flag on this feature.

    **Amended by [ADR-0037](ADR-0037-invocation-scoped-sensing.md) (Proposed):**
    that decision and that consent surface now exist. ADR-0037 keeps the
    rejection of *unprompted* observation intact and permits only reads
    bracketed by an operator keypress, gated on a non-empty denylist, a
    visible armed indicator, and a union-wide forbidden-key guard.

13. **v0 ships no student model.** The planner is Claude; training is research
    ([29](../research/29-large-task-models.md)), out-of-process per 09 rule 3.
    This answers [16](../research/16-task-as-unit-models.md) open question 3: **a
    learned proposer graduates on measured replay accuracy against held-out logs
    and a non-regressing kept-rate — and even then it only proposes.** It never
    becomes the cursor and never holds a tier its teacher did not.

14. **One logical triad, host-specific chrome.** Hub webview, VS Code, and TUI
    may bind and render differently, but verb set, tier outcomes, and rank
    semantics are identical on every surface
    ([DEC-multi-device-parity](../decisions/DEC-multi-device-parity.md)).

15. **Kept-rate is the acceptance metric.** "Next *best* action" is
    unfalsifiable; "the action you did not undo" is measurable. Accept this
    record when the triad is on tip **and** a kept-rate is being measured — not
    when the hint renders.

## Non-goals

- Desktop-wide sensing, synthetic keystrokes, screen or pixel capture.
  ([ADR-0037](ADR-0037-invocation-scoped-sensing.md), Proposed, narrows the
  first of these to invocation-scoped reads; the rest stay non-goals.)
- Observing operator-initiated editor, git, or terminal activity (decision 2).
- Multi-step autonomy. One DO is one verb; chains exist only because the operator
  keeps pressing.
- A `DriveTask` ranker, or any second path to the plan cursor.
- A second approval plane parallel to `ToolPolicy`.
- Shipping or training a model as a product surface.
- Voice or chat control of the triad. The interface is a key.

## Open

1. Which host owns the binding, and the default scheme — one anchor key with
   modifiers versus three dedicated keys. Owner: product.
2. Retention cap and trim policy for the `predict` family. Predictions are far
   higher-volume than room events and the corpus is the point, so the room's
   oldest-first cap is the wrong default. Kind spelling is open with it: the repo
   runs two conventions, dotted `track.verb` pinned by a literal `track` field on
   room members, and flat `drive_*` on bank members. A non-room family is not
   bound by the room's `track` literal, so `predict.*` is a placeholder in this
   record, not a decision.
3. Whether operator-initiated signals (decision 2) are ever observed, and at what
   consent cost. Without them the flagship "you saved the file, so rerun that
   test" flow stays agent-initiated only.
4. Whether a stage-and-commit verb is Tier 2 or Tier 3. A commit is revertible; a
   push is not, and the two are one habit apart.
5. Event ontology granularity. Too coarse and a prediction kind stops carrying
   intent; too fine and it becomes a privacy bill. Start narrow and let skip
   statistics show where resolution is missing.
6. How an operator-initiated DO reaches the `ToolPolicy` gate (decision 5)
   without running an agent turn. The existing branch is mid-turn and
   turn-latency would break the 200 ms budget, so this is the load-bearing wiring
   question for M1 — and it must be answered by reaching the policy, never by
   copying it.

## Alternatives rejected

- **A standalone desktop agent with its own event log.** Second writer, second
  daemon, ambient capture — illegal under D2 and
  [DRV-PRIVACY](../features/DRV-PRIVACY.md), and it would predict over a context
  this product cannot see.
- **Adding prediction kinds to the room event union.** The room log is trimmed
  oldest-first and read by the stage reducer; high-volume prediction records
  would evict room history and slow a hot path (ADR-0029).
- **Screenshot or pixel context.** Pixel share is already rejected
  ([DEC-open-product-forks](../decisions/DEC-open-product-forks.md)); here it is
  additionally worse data at higher cost, since structured events carry history
  and pixels carry only the present frame.
- **A confidence threshold that promotes Tier 3 verbs to execution.** No score
  makes an irreversible action reversible. The tier boundary is not a tunable.
- **Treating checkpoint restore as a general undo.** Its granularity is the user
  run and its coverage stops at the worktree; selling it as "revert anything"
  would be the automation-complacency failure this design is supposed to resist.
- **Two DOs meaning "execute the top two candidates."** Chaining must stay a
  human decision per step, or the autonomy non-goal is lost on the first
  convenience.
- **Sourcing candidates from the bank cursor.** Duplicates `deriveBankSnapshot`
  and rebuilds exactly the ranker 09 declined to build.
