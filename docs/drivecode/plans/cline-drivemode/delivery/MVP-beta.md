# Drive mode MVP — public self-hosted beta

**Status:** all five phases delivered (opened 2026-08-02, phases 0–5 merged
2026-08-02). Open items are listed under
[What still needs a human](#what-still-needs-a-human-before-the-beta-opens) —
none of them are code.
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
| Spotlight, call chrome, roster | Shipped — `apps/cline-hub/src/webview/src/drive/`. The presented artifact now renders inside the Spotlight `ScreenFrame` (S2); `StickyStagePane` survives only in `ChatForkDemo` and is no longer the live surface |
| Status Hub + 4 lenses | Shipped — `components/views/status-view.tsx`, `dependency-map.tsx` |
| Director engine (backlog, script, sticky, artifact kinds) | Shipped — `shared/src/drive/director.ts`, `drive/src/director/`, `core/src/hub/driveShowRuntime.ts` |
| Handoff packet, stall classifier, chat-fork | Shipped — `drive/src/handoff.ts`, `stallClassifier.ts`, `drive/StuckRecoveryFork.tsx` |
| Rooms · Artifacts · Inbox · Teams | **Absent** — no `View` union entry (`App.tsx:107`), no view, no wire |
| Tasks as a first-class page | Lens only (`dependency-map.tsx` inside Status Hub) |
| Customizable rail | Absent — nav is three hardcoded arrays (`App.tsx:393–441`) |
| Member-status sidebar | Absent; needs a `ParticipantStatusSchema` rev (`shared/src/drive/room.ts:26–31`) |
| TTS narration | **Wired** (drive-audio 1–2) — `say` beats and `conversation.narration` speak through `driveNarrator.ts` behind `shouldSpeakDriveTts`. `tts.enabled` stays default-off. Mic mute and output deafen are now separate: deafen silences playback, mic mute does not |
| STT | **Wired, and already was** — `Chat.tsx` → `DriveVoiceBar` → `DriveMicBar` → `SpeechInput` has existed since #23/#42, so this row was simply wrong. #120 made it honour the now-default-muted mic (a partial utterance was still transcribed after mute), fixed a Firefox crash under the default topology, and surfaced capture errors that rendered hidden |
| CC transcript, chimes | **Shipped** (drive-audio 3, 5) — synthesized earcons through `playAudioUrlOnSink()`; ephemeral 40-line CC panel (`voice/driveTranscript.ts`). Neither persists: `DRIVE_FORBIDDEN_PERSIST_KEYS` hard-deletes caption keys on the way out |
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

| # | Phase | Status | Work | Gate |
|---|---|---|---|---|
| 0 | Decisions | **done** | ADR-0016 accepted; ADR-0017 deferred; no speculative schema changes | this document |
| 1 | The call looks like the demo | **done** (#107 #108 #110 #114) | S1 → S2, then S4 + S5 in parallel. Webview recomposition of `Chat.tsx`, `Spotlight.tsx`, `DriveCallChrome.tsx`, `App.tsx` nav. No wire changes. | visual parity vs the canvas at 1280×640 light+dark |
| 2 | Spotlight presents real work | **done** (#115 #116 #117) | S3 → S6 → S7. Reuse `ai-elements/plan.tsx` and the streamdown mermaid plugin. | present each artifact kind on a live room — **not yet exercised on a live room**; renderers verified against real produced artifacts |
| 3 | Voice | **done** (#118 #119 #120 #121) | drive-audio 1–5 on `browser-speechSynthesis`; narrator gated by `advance: auto_after_say`; wire `speech-input.tsx` into the Drive composer. `tts.enabled` stays default-off (DRV-TTS). | narration speaks; **deafen** cancels in-flight speech, and mic mute does not — verified by instrumented playback, **not yet by ear** |
| 4 | Rooms | **done** (#123) | New `View` entry + `components/views/rooms-view.tsx`. Durability came from ADR-0013 **lane 1**, not the facets — facets are user/workspace-scoped, not per-room. No schema change. | **passed** — stop → restart, and a killed-and-restarted hub process, both keep config + history |
| 5 | Self-hosted packaging | **done** (#124 #125) | Draft-only release workflow, install + privacy docs, `preflight`, issue template. | **passed on a second clone**, not a second machine — see below |

**Deferred, not dropped:** the first-call `tts.enabled` prompt (the facet ships
default-off with no in-product path to turn it on yet), per-agent `voiceSlot`
(drive-audio 6), and re-keying `DriveRoomStore` by workspace + roomId so two
open workspaces cannot share a live entry for a same-named room. The last one
wants an ADR, not a patch — listing and durability are already correct.

## What still needs a human before the beta opens

Code is not the blocker on any of these.

1. **A credentialed call.** No API key was ever entered. The no-credential
   demo route is verified end to end; the real call leg is not.
2. **Hearing it.** Voice was verified by instrumented playback — `speechSynthesis`
   transitions, deafen cutting in 63ms, generated WAVs decoding at peak 0.89 —
   but nobody has listened. `join` and `taskComplete` are the earcon pair most
   likely to sound alike.
3. **Presenting each artifact kind on a live room** (the Phase 2 gate).
   Renderers were verified against real produced artifacts, not a live room.
4. **A genuinely separate machine** for the Phase 5 gate. A second clone passed;
   ports were held locally, so the hub ran with `CLINE_HUB_PORT` overridden.
5. **Support path** — GitHub issues on the fork ships as *proposed*, not decided.
6. **Cutting the first tag.** The release workflow is `workflow_dispatch` only,
   requires a typed confirmation, and creates a **draft**. Nothing publishes
   without a human.

## Privacy: the plan was wrong, the docs are right

This plan previously described the beta privacy note as "events carry metadata
only". **That is false for the conversation track.** `conversation.message.text`
and `conversation.narration.text` are plain strings
(`sdk/packages/shared/src/drive/events.ts:117`) and persist to
`.cline/drive/rooms/<id>/events.jsonl`. Work, presence and control events are
genuinely metadata; conversation is not.

Two further gaps found while writing the note: the **default STT sends
microphone audio to your browser vendor** (Web Speech API, already labelled
`egress: "platform-cloud"` in the provider manifest but undocumented), and
`DRV-PRIVACY` still lists a schema assertion as open that has since shipped.

[reference/privacy.md](../../../reference/privacy.md) states the accurate
version. Where behaviour is narrower than the slogan, the slogan loses.

## Verification

Per phase: `bun -F @cline/hub-webview test` + typecheck; `/drive?demoShareScreen=1`
stays green (it is the shipped share-screen demo route); visual parity against
the demo canvas.

## Open for the owner

1. **Voice backend for beta** — browser `speechSynthesis` (zero-config, robotic)
   vs BYOK (better, but every tester needs keys). Plan assumes browser first.
2. **Beta support path** — GitHub issues on the fork, or something managed.
3. **The deferral list** — especially Agents/Teams, the most compelling cut.
