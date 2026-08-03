# 22 · Default posture — what ships out of the box

**Date:** 2026-08-02 · **Status:** analysis, recommendations not yet decided
**Answers the open questions in** [ADR-0021](../adr/ADR-0021-drive-credential-onboarding.md),
[ADR-0022](../adr/ADR-0022-agent-economics.md),
[ADR-0023](../adr/ADR-0023-agent-spawn-governance.md),
[ADR-0024](../adr/ADR-0024-drive-web-runtime.md), and
[hosted-preview](../initiatives/hosted-preview/README.md).

## Why this document exists

Four ADRs each ended with open questions, and answering them one at a time
produces an incoherent product. A default is not a shrug — it is the product's
opinion about the median user, applied to everyone who never opens settings.
That is most people, most of the time.

## The principle

**Sit on the safe side of every asymmetric axis, and the useful side of every
symmetric one.**

Some axes are asymmetric: the harm of too much is much greater than the harm
of too little. Money spent, audio captured, code written unattended, agents
spawned. On those, default conservative — the cost of being wrong is a user
who turns something on, versus a user who was quietly charged, recorded, or
committed to.

Other axes are symmetric: showing a number, announcing an action, labelling a
state. Nothing bad happens if you show too much, so default to showing it.

Two corollaries that matter more than they look:

- **"Off by default" for everything is not safety, it is cowardice.** It ships
  a dead product and makes the user assemble it. `tts.enabled` is off with no
  in-product way to turn it on — that is not a conservative default, it is an
  unfinished one.
- **Defaults teach.** A user who never reads docs learns the product's model
  from how it behaves. The mic defaulting to muted teaches "you control when
  you are heard" in one interaction. That is worth more than a tooltip.

And a rule this codebase has already earned: **a default that fails silently is
the worst kind.** The 9 px stage, the fabricated Rooms list, the 3-second
fallbacks that produce a UI that looks fine and is lying — every one was a
quiet default doing something plausible and wrong.

## Recommended defaults

### Money and context (ADR-0022)

| Question | Recommendation | Why |
|---|---|---|
| Where the meter lives | **In the call strip row, one compact line** — spend + context %, expanding to a drawer | Instrumentation you must go find does not build trust. A new row repeats the 9 px mistake; the strip row already exists |
| Cap by default? | **No cap. Always-visible spend.** One click to set one | Our cost is an *estimate* from a drifting price catalog. A cap the user did not choose, stopping their agent mid-task, on an estimate, is worse than a number they can see. Today's `CLINE_MAX_SESSION_COST` aborts with **no warning** — the worst of both |
| Warnings | **Warn on approach, always, even with no cap** | Symmetric axis. Nothing bad happens from telling someone |
| Spend scope | **Per room is the headline; per session drills down** | Rooms are durable now. "This room cost $12" matches how people think about a project |
| Per-agent model | **Inherit room default; override explicitly; show the override** | A cheap triage model is valuable *as a choice*. A default that silently downgrades an agent is a surprise about quality |
| Context | **Show remaining %, warn at 80%, and announce compaction** | Compaction stays on — it is right. It stops being **silent**. Having your context rewritten without being told is the definition of a bad quiet default |

### Spawning (ADR-0023)

| Question | Recommendation | Why |
|---|---|---|
| Fork depth | **1 — a worker may not cause workers.** Configurable up | Safe, matches existing *intent* (the non-fork parent filter exists but is bypassed), and depth >1 has no demonstrated need. **Must be visible when it suppresses work**, or it reads as the agent going quiet |
| Consult | **Allowed by default, to explicitly granted packs only. Read-only, terminal** | Returns an opinion, writes nothing. Cheap in risk, high in value |
| Delegate | **Off by default. Explicit grant** | Writes code and spends money. The asymmetry is the whole point of splitting the two |
| Consult context | **Its own, seeded with an explicit brief** | Cheaper, avoids exposing the whole conversation, and forces the parent to articulate the question — which improves the answer |
| Approval granularity | **Per pack, per room, remembered** | Per-spawn is safest and gets click-fatigued into meaninglessness, which is worse than a coarser gate people actually read |
| Unseen packs | **No — packs are granted per room** | Otherwise "consult" is an unbounded capability discovered at runtime |

### Voice (drive-audio)

| Question | Recommendation | Why |
|---|---|---|
| Mic | **Muted** (shipped) | Asymmetric: a hot mic is unrecoverable, a muted one is one click |
| TTS | **Off, with a first-call prompt to enable** | Off is right; off *with no path* is unfinished. The prompt is the missing half |
| Earcons | **Split them.** Join/leave **on**, approval-required **on**, task-complete **off** | Not all-on or all-off. Approval-required is *actionable* — it needs you. Task-complete is ambient, fires often, and is the one that becomes noise. A chime that never means anything trains people to ignore chimes |
| Deafen | **Off** | Symmetric; the user came for a call |

### Credentials (ADR-0021)

| Question | Recommendation | Why |
|---|---|---|
| First-run onboarding | **Dismissible, not blocking** | The demo route is credential-free. A tester should reach *something real* with no account. Blocking the door on a product nobody has evaluated yet is backwards |
| Sign-in path | **Device code first, BYOK second** | Only flow that works when the browser and daemon are on different machines |

### Web build (ADR-0024, hosted-preview)

| Question | Recommendation | Why |
|---|---|---|
| Settings (Door B, ~40 commands) | **Hide, do not stub** | A settings page that appears to work and changes nothing is exactly the "looks fine and is lying" failure. Hiding is honest and less work |
| Mermaid on phones | **Lazy, tap-to-render below a breakpoint** | ~1.5 MB. Do not spend a phone's first paint on a diagram it may never scroll to |
| "This is a preview" | **Persistent, quiet, non-modal** — a marker in the chrome | Someone who believes they are talking to a live agent has been misled, even if we never said so |

## The shape this adds up to

Out of the box a user gets: a muted mic, a silent partner they can switch on,
chimes only when something needs them, visible spend with no cap, an announced
compaction, agents that may ask for advice but not hand out work, and workers
that cannot recruit workers.

That is a product that is **safe, honest, and useful in that order** — and one
where every restriction is discoverable by hitting it, not by reading this
document.

## What I am least sure about

- **Fork depth 1** may suppress real cascades. It is the right *starting*
  default, but it needs a real-workload check rather than confidence.
- **No default spend cap** is a genuine bet that visibility beats enforcement.
  If a beta tester runs up a bill they did not expect, that bet was wrong and
  the answer is a default soft cap, not a louder number.
- **Task-complete earcon off** may read as the product being unresponsive on
  long tasks — the dead-air problem (drive-audio slice 7) is adjacent and
  unsolved.
