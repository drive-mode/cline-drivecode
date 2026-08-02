# 21 · Operator experience — what a user can see, and what they cannot

**Date:** 2026-08-02 · **Status:** analysis, no decision
**Scope:** the shipped Drive surfaces on `main` after MVP phases 0–5.
**Companions:** [ADR-0022](../adr/ADR-0022-agent-economics.md) (economics),
[ADR-0023](../adr/ADR-0023-agent-spawn-governance.md) (spawn governance).

## Thesis

Drive is built around **presence**. The Spotlight is a screen share, the
partner narrates, the roster shows who is speaking, chimes mark moments, and
rooms survive a stop. All of that works, and the screen-share metaphor is the
product's best idea — "what is my agent doing" is answerable at a glance in a
way a chat transcript never manages.

What is missing is the **operator** layer. Drive asks a user to hand an agent
the keys and then gives them a windscreen with no instrument panel. You can
see where you are going. You cannot see fuel, altitude, or what it will cost
to get there.

Every gap below is an instance of that one sentence.

## What is genuinely good

Worth stating plainly, because the rest of this document is critical.

- **The Spotlight as a literal screen.** Fixed-dark in both themes, so a share
  reads as a machine rather than a themed panel. Artifacts render as
  themselves — live mermaid, real plan cards, walkthroughs with highlighted
  line ranges — not as text dumps.
- **The call chrome is disciplined.** Icon-only 30 px controls whose
  `StripButton` makes the accessible label a *required* prop, so an unlabelled
  control cannot be added by accident.
- **Status is not colour-only.** Backlog chips read dashed → solid → amber
  with a live dot → strikethrough, so the four states survive colour-blindness
  and greyscale.
- **You can follow without audio.** Narration subtitles under the frame, plus
  an ephemeral CC panel, plus captions that never persist.
- **Mic and output are separate concerns.** Muting your microphone does not
  silence the agent — the conferencing semantics are right, and the mic
  defaults to muted.
- **"Stop ≠ lose."** A stopped room restarts with its config and history.

## What does not feel good

### 1. The primary surface was invisible

Until #130 the stage measured **624 × 9 px** at the documented 1280×640 design
floor. The entire product thesis is *watch your agent work*, and you could
not. It is fixed, but the lesson generalises: **the stage must be defended by
a measured floor**, because every new piece of chrome is a claim on the same
vertical budget and nobody notices the stage shrinking one row at a time.

### 2. Cost and context are invisible where the spending happens

Fully detailed in [ADR-0022](../adr/ADR-0022-agent-economics.md). In short:
the SDK measures tokens and USD per message; the Hub session list and the CLI
status bar display them; **the Drive room shows nothing**. `status-view.tsx`
contains zero references to token, cost, model, or context.

Compaction makes this worse. Hub sessions auto-compact by default, so on a
long call the agent's context is silently rewritten underneath the user, with
no banner and no percentage.

### 3. "Workers" is a number

ADR-0014 calls chat forks "invisible auditable workers", and the invisibility
is by design — the human should not manage them. But the surface has settled
at a **count badge**. A user watching `3` cannot tell what those three are
doing, what they have cost, whether one is stuck, or stop a single one.
Auditable after the fact is not the same as accountable during.

### 4. The roster shows presence, not state

`ParticipantStatus` is `idle | working | speaking | away`. There is no task
line, no "blocked on you", no elapsed. In a room with one agent that is
tolerable. It is the reason the member-status sidebar is on the deferred list,
and it is the single cheapest upgrade to felt control.

### 5. Dead air is undesigned

A real call is mostly silence while the agent works. The demo compresses
minutes into seconds, so nothing in the product designs the waiting
experience. drive-audio slice 7 names this and it remains unbuilt. Silence
plus no instrumentation is where a user starts to wonder whether anything is
happening at all.

### 6. Approval gates are a taxonomy, not a surface

`gates.ts` landed the enums. The status board still lists the approval UI as
open. So "the agent asks permission" — the loop that makes autonomy safe — is
not something a user actually experiences yet.

## What I can see vs what I want to see

| I can see | I want to see |
|---|---|
| Who is speaking | What each participant is *working on*, and for how long |
| `3` workers | What each worker is doing, its cost, and a way to stop one |
| NOW / NEXT titles | Why *this* task, elapsed time, and whether it is stuck |
| The artifact on screen | The next action **before** it happens |
| Room is Live / Stopped | Session spend so far, and burn rate |
| Mode pill (plan/act) | Which model each agent is running |
| Narration | Remaining context, and when compaction is about to rewrite it |
| — | Files touched this session, as a reviewable diff |

The right column is one theme: **provenance and consequence**. The left column
is atmosphere. Drive currently over-delivers atmosphere and under-delivers
instrumentation, which is exactly backwards for a product whose pitch is
delegated autonomy.

## The trust ladder

A useful frame for sequencing. Each rung is worthless without the one below.

1. **See** — what is happening now (Drive is good here).
2. **Understand** — why it is happening, what it costs (largely absent).
3. **Predict** — what happens next, before it happens (absent).
4. **Control** — stop, redirect, constrain, at the granularity of the action
   rather than the call (leave/end only).
5. **Delegate** — hand off with confidence, including agent-to-agent
   ([ADR-0023](../adr/ADR-0023-agent-spawn-governance.md)).

The MVP built rung 1 well and reached for rung 5 (multi-agent rooms, forks)
without rungs 2–4. That is why "how do I manage spend and spawning" is the
natural next question — the product's ambition outran its instrumentation.

## Recommended sequence

Not a commitment; the ordering argument matters more than the list.

1. **Session meter** — spend, context, model, in the call chrome. Rung 2, and
   it unblocks every later budget conversation.
2. **Participant state line** — what each agent is on, and for how long. Rung
   2, cheapest felt-control win.
3. **Worker panel with a stop** — turn the count badge into an accountable
   list. Rung 4.
4. **Next-action preview + approval surface** — finish DRV-GATES. Rung 3–4.
5. **Per-agent model and budget** — [ADR-0022](../adr/ADR-0022-agent-economics.md).
6. **Spawn governance** — [ADR-0023](../adr/ADR-0023-agent-spawn-governance.md).
7. **Dead-air design** — drive-audio slice 7.

## Open question worth settling early

**Does an operator panel belong in the call, or beside it?** The Spotlight
already lost the vertical-budget fight once. Instrumentation is exactly the
kind of chrome that will try to take stage height back. A drawer or an
overlay that does not compete with the stage is probably right, but that is a
design decision, not an obvious one.
