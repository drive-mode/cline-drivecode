# ADR-0037 · Desktop sensing is invocation-scoped, or it does not happen

**Status:** Proposed (2026-08-16)  
**Owner:** Drivecode SE lead / PM  
**Amends:** [ADR-0036](ADR-0036-next-action-triad.md) decisions 1 and 12. Leaves
ADR-0036 decision 2 standing and lowers its cost (see decision 3 below). All
other ADR-0036 decisions — the triad, tier derivation, the single `ToolPolicy`
enforcement point, the `predict` family — are unchanged and binding.  
**Constrained by:** [ADR-0004](ADR-0004-gated-learn-privacy.md) (gated learn,
accept gate, allowed-evidence table), [ADR-0013](ADR-0013-state-partition.md)
(D2 — hub is the single writer), [ADR-0015](ADR-0015-task-session-observability.md)
(local lane, no phone-home), [ADR-0025](ADR-0025-enforced-authority.md) (a
declared limit needs a path that can refuse),
[DRV-PRIVACY](../features/DRV-PRIVACY.md) (strict defaults, visible indicator
for any retention widening), [DRV-EVENTS](../features/DRV-EVENTS.md)
(schema-level enforcement), [DEC-open-product-forks](../decisions/DEC-open-product-forks.md)
§3 (pixel capture rejected — **not** reopened here),
[DEC-multi-device-parity](../decisions/DEC-multi-device-parity.md).  
**Product:** [PRD 11](../prd/prd-magic-hotkey.md) · **Research:**
[29-large-task-models](../research/29-large-task-models.md) · **Wiring:**
[next-action-triad](../initiatives/next-action-triad/) (answers ADR-0036 Open 6;
records constraints C1 and C2).

## Context

[ADR-0036](ADR-0036-next-action-triad.md) closed the door on desktop sensing on
three separate grounds, and they are not equally strong.

1. **Architecture.** The source proposal shipped a standalone Python agent with
   its own `events.jsonl` — a second writer and a second daemon, illegal under
   D2 ([ADR-0013](ADR-0013-state-partition.md)).
2. **Privacy.** Recording the operator's unprompted actions is "structurally
   indistinguishable from a keylogger" (decision 12).
3. **Data quality.** Typed events carry history; a window title is a guess.

The product that is actually wanted is the system-wide one: a global hotkey that
senses what the operator is looking at across every application, with
do / skip / undo / **redo**. ADR-0036 decision 12 anticipated this and specified
the remedy precisely — it "needs its own decision and its own consent surface —
never a settings flag on this feature." This is that decision.

It reopens exactly one of the three grounds. Ground 1 is answered by structure
(decision 4 below), ground 3 is conceded rather than argued — typed events remain
the better signal and desktop context is additive, not a replacement — and ground
2 is the one that needs a real answer.

The answer is narrower than "desktop sensing is now allowed," which would be a
straight reversal and would deserve to lose. The claim is this: **decision 12
rejected observation the operator did not ask for, and a keypress is asking.**
Observation bracketed by an explicit invocation is a different act from ambient
capture, in the same way that a screenshot the user takes differs from a screen
recorder they forgot was running. That distinction is the whole basis of this
record. Everything below exists to keep it true in code rather than in prose,
because the failure mode — a sensor that quietly starts sampling outside the
bracket — is invisible to the operator and fatal to the product.

## Decision

1. **Sensing is invocation-scoped.** The sensor reads only inside a bounded
   window bracketing a hotkey press. No background poll, no idle listener, no
   "warm" context maintained between invocations, no sampling while the hint
   surface is merely open. If the implementation ever reads outside an
   invocation window it has become the thing ADR-0036 decision 12 rejected, and
   the correct response is to delete it, not to add a setting.

   One component is unavoidably always live: the global hotkey registration
   itself. Binding consequence — it observes **one chord** (two, per decision 2)
   and must be structurally incapable of reporting any other key to any other
   part of the system. It is a latch, not a listener. This is the single largest
   piece of trusted surface this record creates and it should be reviewed as
   such.

2. **What may be sensed, exhaustively.** A closed list, not a category. On
   invocation the sensor may read:

   | Fact | Form | Why this form |
   |---|---|---|
   | Frontmost application | bundle identifier | Identity without content |
   | Clipboard | content type + byte length + SHA-256 | "a stack trace was copied" is derivable; the stack trace is not stored |
   | Frontmost document path | workspace-relative path, **only** when the frontmost app is the workspace's own editor **and** the path resolves inside the workspace root | Same trust boundary the product already has |
   | Selection or clipboard **content** | verbatim | Only under decision 3 |

   Everything else is out, and the exclusions are load-bearing rather than
   conservative defaults: **window titles** (they carry document names, ticket
   subjects, URLs, and correspondent names — the highest leak per byte of any
   signal on offer), **URLs**, **keystrokes**, **screen or pixel contents**,
   **accessibility trees**, and **any document belonging to an application that
   is not the workspace editor**.

3. **Content crosses only on a second, distinct gesture.** Clipboard or selection
   *content* — as opposed to the fingerprint in decision 2 — is read only when
   the operator invokes with an explicit "use my selection" chord. It is never
   the default invocation, never inferred from context, and never retained past
   the invocation that carried it.

   This is also what lowers the cost of ADR-0036 decision 2 without reversing it.
   The flagship flow ("you saved that file, so rerun its test") wanted continuous
   observation of operator-initiated editor activity. Invocation-scoped sensing
   delivers the same context at the only moment it is needed — the press —
   without observing anything between presses. Decision 2 stays exactly as
   written; this record makes it cheap rather than overturning it.

4. **The sensor is a host, not a daemon.** Global hotkey registration and
   frontmost-app identity require a native process on macOS; bun cannot do it and
   pretending otherwise would stall this at M0. The shim therefore exists — and
   holds no log, no port, no database, and no state that survives an invocation.
   It posts sensed facts to the hub over the existing host transport, and the hub
   remains the single writer (D2, [ADR-0013](ADR-0013-state-partition.md)). It is
   a host in the sense `apps/vscode` is a host.

   A sensor that keeps its own `events.jsonl`, binds a port, or writes anywhere
   under `.cline/` directly **is** the standalone desktop agent ADR-0036
   rejected, and this record does not revive it.

5. **The forbidden-key guard becomes global before the first sensed byte.**
   ADR-0036 decision 11 states that `.strict()` schemas "plus
   `DRIVE_EVENT_FORBIDDEN_KEYS`" already reject `transcript`, `audio`, `image`,
   `bytes`, `dataUri` "and their siblings at parse time." That overstates the
   machinery. At tip, `DRIVE_EVENT_FORBIDDEN_KEYS`
   (`sdk/packages/shared/src/drive/events.ts`) is applied at exactly one call
   site — `MediaArtifactProduceSchema.args` — and every other member is protected
   only by `.strict()`, which rejects *undeclared* keys and has nothing to say
   about a declared one. That is sufficient while no member wants to carry text
   and insufficient the moment one does, which is this record.

   Binding, and it gates decision 1 rather than following it: extend the list
   with `clipboard`, `clipboardText`, `selection`, `selectionText`, `windowTitle`,
   `title`, `keystroke`, `keys`, `screenshot`, `pixels`, `frame`, and `axTree`;
   apply the check across the whole `DriveEvent` union rather than one member;
   and land the assertion test DRV-PRIVACY already asks for
   (`sdk/packages/shared/src/drive/events.test.ts`) so a future member cannot
   quietly declare one. Enforcement is machine, not prose — that is ADR-0036
   decision 11's own standard, held to here.

6. **Consent is a surface, not a setting.** ADR-0036 decision 12 requires one by
   name. It is:

   - **Off by default.** The OS permission grant is necessary and never
     sufficient — macOS TCC answers "may this process use accessibility,"
     permanently and coarsely, and is not a consent surface for this product.
   - **Armed per session, explicitly.** Sensing disarms on session end, matching
     [ADR-0004](ADR-0004-gated-learn-privacy.md) tier 4 (session-tier state is
     wiped on leave). There is no persistent "always sense" toggle.
   - **Visibly indicated whenever armed,** following the pattern
     [DRV-PRIVACY](../features/DRV-PRIVACY.md) already requires for
     `privacy.debugRetention`.
   - **Denylisted by default, non-empty on ship.** Password managers, banking and
     payment apps, messaging clients, and private-browsing windows. A denylisted
     frontmost app **drops the invocation entirely** — it does not redact,
     degrade, or sense-then-filter, because a filter runs after the capture.
   - **Auditable.** Every sensed fact is inspectable by the operator after the
     fact, and the corpus leaves the machine only through ADR-0004's accept gate.

7. **Sensed context is a signal source, never an actuation target.** Reading
   another application's context grants no licence to write to it. Synthetic
   keystrokes stay rejected, as does any cross-application effect. The actuator
   surface is unchanged from ADR-0036 decision 5: one policy resolution, one set
   of host callbacks, against the workspace. Sensing must not widen what
   `ToolPolicy` permits, and a sensed fact is never an input to a tier
   calculation.

   Precise locations, since ADR-0036 decision 5 names only the gate: the gate is
   `prepareToolExecution` in `sdk/packages/agents/src/agent-runtime.ts`, and the
   resolution it applies is the single canonical `resolveToolPolicy` in
   `sdk/packages/shared/src/llms/tools.ts`. Those were two copies until
   [next-action-triad](../initiatives/next-action-triad/) deleted the private
   duplicate in `agent-runtime.ts`; that de-duplication is a precondition for
   this record, because "one policy table" requires one table to reach.

8. **Consequence — desktop context buys information, not reach.** ADR-0036
   decision 8 already binds: a verb whose effect escapes the worktree cannot be
   Tier 1, and every cross-application effect escapes the worktree by
   construction. Combined with decision 7, desktop sensing makes predictions
   *better informed* while leaving them executable only against the workspace.

   This should be read twice by anyone expecting the triad to drive their whole
   desktop, because it is the largest gap between the system-wide product as
   imagined and the one this record permits. The hotkey becomes system-wide; the
   actuator does not.

9. **REDO is a stack operation, not a fourth predicted verb.** The prediction
   vocabulary stays three-verb (ADR-0036 decision 3). REDO re-executes the last
   UNDOne verb from a local stack: it predicts nothing, ranks nothing, and writes
   no preference pair. The operator gets the fourth key they asked for; the
   corpus stays clean.

   The reason is label economics, not taste.
   [29](../research/29-large-task-models.md) rests on SKIP being *the* rejection
   signal — a skip chain yields preference pairs that share a context exactly.
   A fourth predicted verb splits rejection across two signals and makes the
   pairs ambiguous, degrading the corpus this whole feature exists to build.
   Making REDO predictable reverses ADR-0036 decision 3 and needs its own record.

10. **Sensing is a capability that may be absent.** Accessibility and global-hotkey
    APIs differ per OS and Linux may offer no usable equivalent. Under
    [DEC-multi-device-parity](../decisions/DEC-multi-device-parity.md) the triad
    degrades to ADR-0036's codebase-only mode wherever the capability is missing,
    with an identical verb set, identical tier outcomes, and identical rank
    semantics — a narrower context window, not a different product. A triad that
    only works on macOS is not a feature this repo ships.

11. **Sensed facts join the `predict` family.** They do not open a fifth log
    family and do not enter the room union — ADR-0036 decision 10's reasoning is
    unchanged. Invocation-scoping is what makes retention tractable: volume is
    bounded by keypresses rather than by wall-clock time, which is the property
    continuous sensing would destroy. Kind spelling stays open with ADR-0036
    Open 2.

12. **Acceptance gate.** Accept this record when the denylist, the visible armed
    indicator, the global forbidden-key guard with its assertion test, and the
    audit view exist — **not** when sensing works. The privacy machinery is the
    deliverable here; reading a bundle identifier is the easy part, and shipping
    it first is how this becomes the keylogger ADR-0036 refused.

## Non-goals

- Continuous, background, or idle observation of anything.
- Keystroke capture beyond the single registered chord pair.
- Screen, pixel, or window-title capture
  ([DEC-open-product-forks](../decisions/DEC-open-product-forks.md) §3 stands
  unamended).
- Reading documents belonging to applications other than the workspace editor.
- Synthetic keystrokes, or any cross-application actuation.
- A second writer, second daemon, or second event log.
- Making REDO a predicted verb.
- Using sensed context to widen `ToolPolicy`, promote a tier, or bypass an
  approval.
- Reopening ADR-0036 decision 2 (continuous observation of operator-initiated
  workspace activity). Decision 3 above reduces the need for it; it is not
  granted.

## Open

1. The chord pair — default invocation and "use my selection" — and collisions
   with OS and application bindings. Owner: product.
2. Whether the frontmost-app bundle identifier is itself sensitive. It reveals
   application-usage patterns over time, which is a profile even without content.
   Literal versus salted hash is undecided; a hash costs the planner the ability
   to reason about known tools by name.
3. Windows and Linux capability equivalents, and whether parity under decision 10
   is achievable or whether the honest answer is macOS-with-degradation.
4. Denylist ownership and extension. A shipped list that the operator cannot add
   to will be wrong for someone on day one; a list only the operator maintains
   will be empty when it matters.
5. Whether the invocation window is time-bounded or event-bounded, and what
   happens when the planner exceeds it. A window that stays open waiting for a
   slow model is a window that is open.
6. Retention cap for sensed facts as against predicted candidates. Inherits
   ADR-0036 Open 2 and does not resolve it.
7. Whether an invocation while a denylisted app is frontmost should be silently
   dropped or visibly refused. Silence is safer; a refusal teaches the operator
   the boundary exists.
8. Whether a `beforeTool` policy override makes decision 7 narrower than it
   reads. [next-action-triad](../initiatives/next-action-triad/) constraint **C2**
   establishes that `beforeTool` hooks may override a resolved policy and receive
   turn state, so an operator-initiated DO that skips them resolves a *different*
   policy than the same tool mid-turn — independent of sensing, and inherited by
   this record rather than created by it. **This record does not decide it.** It
   belongs to ADR-0036 decisions 5–6 and is tracked as that initiative's W3,
   which recommends degrading per session. Noted here only because decision 7
   leans on the policy path being single, and until W3 lands it is single in
   resolution but not in outcome.

## Alternatives rejected

- **Continuous sensing with a redaction layer.** Redaction runs after capture,
  so the sensitive read already happened and the guarantee is prose. This is
  ADR-0036 decision 12's keylogger with extra steps and a longer changelog.
- **A settings flag on PRD 11.** Forbidden by name in ADR-0036 decision 12.
  Ambient capture behind a checkbox is the failure this whole line of reasoning
  exists to prevent.
- **Window titles as cheap context.** The single highest-value signal per unit of
  implementation effort and the highest leak per byte. Document names, ticket
  subjects, correspondents, and URLs all arrive in one string with no structure
  to filter on.
- **Synthetic keystrokes for cross-application actuation.** Revives the rejected
  desktop agent, and there is no path that can refuse a synthetic keystroke —
  [ADR-0025](ADR-0025-enforced-authority.md) makes that disqualifying on its own.
- **Four predicted verbs.** Costs the corpus its unambiguous rejection signal
  (decision 9) to provide a key an undo stack already provides.
- **Treating the OS permission grant as the consent surface.** TCC is coarse,
  effectively permanent, and process-scoped. It answers "may this binary use
  accessibility," never "may this product read this application right now."
- **Shipping sensing before the privacy machinery.** The ordering in decision 12
  is the decision. Reversed, every subsequent safeguard is a retrofit against a
  capability already in operators' hands.
