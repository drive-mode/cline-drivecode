# Drive mode MVP — public self-hosted beta

**Status:** active track (opened 2026-08-02)
**Goal:** anyone can clone `hhalperin/cline-drivecode`, run it, and pair with an
agent on a voice call with a shared Spotlight.
**Decisions that shape it:** [ADR-0016](../adr/ADR-0016-distribution-and-positioning.md)
(Route B fork; public self-hosted beta) · voice is in scope · multi-human rooms
and hosted infrastructure remain non-goals.

## The premise

The demo canvas
([drive-product-demo.html](../../../design/canvases/drive-product-demo.html),
47 beats) is the **product spec**. It settled the design for every Drive
surface, and its per-beat maturity badges were audited for honesty during the
2026-08-01 review wave — so a beat badged `planned` is a real build item, not
marketing. This track turns those into production components.

The design system **follows** the build: `@cline/ui` is synced and is the
substrate these surfaces compose; the Drivemode design project receives Drive
surfaces as they become real components.

## Reality check (verified against code, 2026-08-02)

| Demo surface | Reality |
|---|---|
| Spotlight, StickyStagePane, call chrome, roster | Shipped — `apps/cline-hub/src/webview/src/drive/` |
| Status Hub + 4 lenses | Shipped — `components/views/status-view.tsx`, `dependency-map.tsx` |
| Director engine (backlog, script, sticky, artifact kinds) | Shipped — `shared/src/drive/director.ts`, `drive/src/director/`, `core/src/hub/driveShowRuntime.ts` |
| Handoff packet, stall classifier, chat-fork | Shipped — `drive/src/handoff.ts`, `stallClassifier.ts`, `drive/StuckRecoveryFork.tsx` |
| Rooms · Artifacts · Inbox · Teams | **Absent** — no `View` union entry (`App.tsx:107`), no view, no wire |
| Tasks as a first-class page | Lens only (`dependency-map.tsx` inside Status Hub) |
| Customizable rail | Absent — nav is three hardcoded arrays (`App.tsx:393–441`) |
| Member-status sidebar | Absent; needs a `ParticipantStatusSchema` rev (`shared/src/drive/room.ts:26–31`) |
| TTS narration | **Wired** (drive-audio 1–2) — `say` beats and `conversation.narration` speak through `driveNarrator.ts` behind `shouldSpeakDriveTts`. `tts.enabled` stays default-off. Mic mute and output deafen are now separate: deafen silences playback, mic mute does not |
| STT | Component exists (`components/ai-elements/speech-input.tsx`), not wired to the Drive composer |
| CC transcript, chimes | Absent — drive-audio slices |
| `walkthrough.animation` renderer | Schema ships, no renderer — spotlight S9 |

**Headline: the engine is ahead of the UI.** What's missing is mostly surfaces
and wiring, not core architecture.

## Scope

**In:** the call loop framed like the demo (spotlight S1, S2, S4, S5) · real
artifact rendering (S3, S6, S7) · voice (drive-audio 1–5 on the browser
backend) · Rooms (durable start/stop) · self-hosted packaging.

**Deferred, deliberately:**

| Deferred | Why |
|---|---|
| Agents / Teams surface | Multiplies room/roster/authz complexity. Solo-dev-with-many-agents is already the shipped topology and a complete story. |
| Artifacts gallery · Tasks as a page | Engines already ship (director backlog; dependency-map lens); a tester reaches the same information via Spotlight and Status Hub. Promote on feedback. |
| Inbox | Existed in the demo only to demonstrate rail add/remove. |
| Customizable rail | Polish. The fold (S5) delivers most of the value. |
| S9 `walkthrough.animation` | Blocked on [ADR-0017](../adr/ADR-0017-narration-bound-presentation-cues.md) (deferred). Best demo moment, not required for the loop. |

## Phases

Each phase ends by syncing the components it created into the Drivemode design
project — **built first, synced second**.

| # | Phase | Work | Gate |
|---|---|---|---|
| 0 | Decisions | ADR-0016 accepted; ADR-0017 deferred; no speculative schema changes | this document |
| 1 | The call looks like the demo | S1 → S2, then S4 + S5 in parallel. Webview recomposition of `Chat.tsx`, `Spotlight.tsx`, `DriveCallChrome.tsx`, `App.tsx` nav. No wire changes. | visual parity vs the canvas at 1280×640 light+dark |
| 2 | Spotlight presents real work | S3 → S6 → S7. Reuse `ai-elements/plan.tsx` and the streamdown mermaid plugin. | present each artifact kind on a live room |
| 3 | Voice | drive-audio 1–5 on `browser-speechSynthesis`; narrator gated by `advance: auto_after_say`; wire `speech-input.tsx` into the Drive composer. `tts.enabled` stays default-off (DRV-TTS) with a first-call enable prompt. | narration speaks; **deafen** cancels in-flight speech, and mic mute does not |
| 4 | Rooms | New `View` entry + `components/views/rooms-view.tsx` over ADR-0013's durable facets. | stop a room, restart it, config + history survive |
| 5 | Self-hosted packaging | Tagged release + workflow, install docs, preflight, support path, plain-language privacy note (events carry metadata only). | a clean clone on a second machine reaches a working call using only the README |

## Verification

Per phase: `bun -F @cline/hub-webview test` + typecheck; `/drive?demoShareScreen=1`
stays green (it is the shipped share-screen demo route); visual parity against
the demo canvas.

## Open for the owner

1. **Voice backend for beta** — browser `speechSynthesis` (zero-config, robotic)
   vs BYOK (better, but every tester needs keys). Plan assumes browser first.
2. **Beta support path** — GitHub issues on the fork, or something managed.
3. **The deferral list** — especially Agents/Teams, the most compelling cut.
