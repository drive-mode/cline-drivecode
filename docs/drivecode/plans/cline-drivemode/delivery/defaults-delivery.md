# Delivery — turning the default posture into shipped work

**Status:** plan (2026-08-02)
**Implements:** [research/22-default-posture.md](../research/22-default-posture.md),
answering open questions in [ADR-0021](../adr/ADR-0021-drive-credential-onboarding.md),
[ADR-0022](../adr/ADR-0022-agent-economics.md),
[ADR-0023](../adr/ADR-0023-agent-spawn-governance.md),
[ADR-0024](../adr/ADR-0024-drive-web-runtime.md).

## How this is ordered

Not by document. Grouped by **cost and risk**, because three of these are
defects wearing a default's clothing and should not wait behind a schema rev.

The ordering argument, in one line each:

- **A** first — the product currently has no limit or actively lies. No design
  needed, nothing depends on them.
- **B** next — cheap, and each *completes a half-built feature* rather than
  adding one.
- **C** third — the biggest product win (rung 2 of the trust ladder) and the
  thing that makes budgets meaningful later.
- **D** after C — a consult that is cheap in risk is not free in spend, so
  governance wants the meter first.
- **E** last of the product work — riskiest, a schema rev that ripples.
- **F** in parallel — a different layer; only one shared item.

## Tranche A — defects the defaults exposed

Ship independently, in any order. None needs a decision.

| # | Work | Where | Gate |
|---|---|---|---|
| A1 | Bound fork depth + ancestry | `chatForkPolicy.ts` `assertForkLegal`, fork tick | a worker cannot cause a worker; depth configurable; **suppression is visible**, not silent |
| A2 | Fix the `/drive` "Checking…" hang | `drive-view.tsx:271`, subscribed types at `:168,:179,:202` | with no hub, the view states why within seconds |
| A3 | Stop silent degradation to memory | `bankSession.ts:383-385`, `requestDriveagentHome.ts`, `planImproveResolve.ts`, `sessionRollupsDump.ts` | a 3 s timeout announces itself; no fallback silently substitutes for real data |

**A1 is the urgent one.** Generations are unbounded today
([ADR-0023](../adr/ADR-0023-agent-spawn-governance.md)); width is capped at 2
and depth is not guarded at all. Its risk is the inverse of the others: it may
*suppress work that happens today*, which is why "visible when suppressed" is
in the gate rather than a nice-to-have.

## Tranche B — cheap defaults that finish something

| # | Work | Where | Gate |
|---|---|---|---|
| B1 | Earcon split — join/leave + approval on, task-complete off | `driveEarcons.ts` facet defaults | a long session produces no ambient chime; an approval always does |
| B2 | First-call `tts.enabled` prompt | Drive settings / call chrome | a user who never opens settings can turn voice on |
| B3 | Credential onboarding, dismissible | per [ADR-0021](../adr/ADR-0021-drive-credential-onboarding.md) | dismissing reaches the credential-free demo route |

B2 and B3 are the same shape: a feature that is off with no in-product path to
on is unfinished, not conservative. Delivery sequencing for B2/B3 under the
ADLC factory outcome lives in
[adlc-drive-factory](../initiatives/adlc-drive-factory/) (phases 2–3) and
[ADR-0028](../adr/ADR-0028-adlc-control-plane.md). This file remains the
defaults source of truth.

## Tranche C — the meter

The largest instrumentation win, and the prerequisite for D.

| # | Work | Depends | Gate |
|---|---|---|---|
| C1 | Attribute per-message usage to a participant; fold into room state | — | room answers "what has this agent cost" without a second accounting system |
| C2 | Context remaining %, warn at 80%, **announce compaction** | — | context is never silently rewritten |
| C3 | The meter in the call strip row | C1 | spend + context visible without opening anything; **stage height unchanged** |

**C2 is separable and worth shipping alone** — it is a pure honesty fix over
machinery that already exists (`usage.ts:75-87`, currently CLI-only).

**C3's gate names stage height on purpose.** Instrumentation is chrome, and
chrome already beat the stage once (#130). If the meter costs stage height, it
is in the wrong place.

Per [ADR-0022](../adr/ADR-0022-agent-economics.md) this must **derive** from
existing measurement — no parallel counter, which would drift and be wrong in
a way nobody notices.

## Tranche D — governance

| # | Work | Depends | Gate |
|---|---|---|---|
| D1 | Wire `capPreset = min(parent, child)` into `call_seat` | — | a child can never exceed its parent's preset |
| D2 | Consult vs delegate as gate classes | D1, C1 | delegation is gated; consulting a granted pack is not |
| D3 | Advisory packs granted per room | D2 | an agent cannot consult a pack the human never saw |

**D1 is the cheapest structural win in this entire plan.** The min-rule already
exists as a pure function (`expand.ts:22-28`) and is wired only into an unused
harness path; `call_seat` hardcodes no preset. This is connecting something,
not building it.

D2 depends on C1 because a consult still spends tokens — cheap in risk is not
free in money, and without attribution it becomes an invisible budget leak.

## Tranche E — per-agent model

| # | Work | Gate |
|---|---|---|
| E1 | Connect `agent.yaml` `providerId`/`modelId`/`maxIterations` to session start | an agent home's declared model is the model it runs |
| E2 | `AgentParticipantSchema` rev carrying the resolved model | the roster shows what each agent is running |

E1 is smaller than it sounds — the vocabulary already compiles
(`home/schemas.ts:32-34`, `compile.ts:146-150`) and dead-ends at a read-only
handler. **E2 is the riskiest item in the plan**: `AgentParticipantSchema` is
`.strict()`, so a rev ripples to every consumer of the room snapshot and needs
a version bump and migration note.

## Tranche F — web runtime

Order is set by [drive-web/architecture.md](../initiatives/drive-web/architecture.md).
Runs in parallel; **A2 is the one shared item** and should land first, since
the web build makes that hang far more likely.

**F0 is an investigation, not implementation, and it gates the rest:** assess
how strong `runHostConformance` actually is.
[ADR-0024](../adr/ADR-0024-drive-web-runtime.md) leans on it entirely — if the
suite is thin, the "conformant host, not a mock" claim is weaker than it reads
and the design needs revisiting before code.

## If forced to cut

Ship **A + B + C2** and nothing else, and the product is meaningfully better:
no unbounded recursion, no silent lies, no ambient chime fatigue, voice
reachable, and context that never changes underneath you. That is roughly two
weeks of the twelve, and it is most of the trust.

The tempting cut is C1/C3 — the meter is the most *visible* work here. It is
also the one that turns "watch your agent" into "trust your agent", and every
budget conversation afterwards depends on it. Cut D and E before C.

## What this plan does not do

- **No budget enforcement.** Per the default posture: visible spend, no cap.
  If a beta tester is surprised by a bill, that bet was wrong and a default
  soft cap becomes tranche G.
- **No hosted hub.** Out of scope by ADR-0016 and
  [hosted-preview](../initiatives/hosted-preview/README.md) tier 4.
- **No dead-air design.** drive-audio slice 7 remains unbuilt, and B1 makes it
  slightly more visible by removing the task-complete chime — worth watching.
