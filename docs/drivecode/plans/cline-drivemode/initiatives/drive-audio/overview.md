# Drive audio — initiative overview

Features: [DRV-TTS](../../features/DRV-TTS.md) · [DRV-NARRATION](../../features/DRV-NARRATION.md) · [DRV-CAPTIONS](../../features/DRV-CAPTIONS.md) · [DRV-TRANSCRIPT](../../features/DRV-TRANSCRIPT.md) · [DRV-PRIVACY](../../features/DRV-PRIVACY.md).

## North star

Voice makes the call feel live. The partner narrates at decision points, earcons mark
moments that matter, and the roster shows who is speaking — all ambient, never archival.
Spoken audio and captions are transient UI; nothing about them persists.

## What already exists (do not re-build)

| Seam | Where | State |
|---|---|---|
| TTS gate | `shouldSpeakDriveTts` — `apps/cline-hub/src/webview/src/drive/voice/driveVoiceUi.ts:118-132` | Shipped. Requires `tts.enabled` facet (default **false**, `sdk/packages/drive/src/topology/resolveTopologyFromFacets.ts:58`); human mute and partner mute both silence it |
| TTS speech today | `useDriveSession.ts:1109` (post-join greeting / while-away catch-up; filter at :1086-1092) + `Chat.tsx:1433` (local voice-send ack) | These are the **only** things spoken. DirectorScript `say` beats and `conversation.narration` are display-only |
| Mute cancel | `useDriveSession.ts:1069-1078` | Mute immediately cancels in-flight speech (DRV-TTS) |
| Voice stack | `createVoiceStack.ts` — `TtsPort.speak(text, {voiceSlot?, volume?, sinkId?})` / `cancel()` | Only backend is browser `speechSynthesis` |
| Audio playback helper | `playAudioUrlOnSink()` — `createVoiceStack.ts:199-218` | Exported, **zero callers**. Natural earcon seam |
| Volume | `driveVoice.hardware.outputVolume` (default 1.0, `driveHardwarePrefs.ts:19`) with a slider in `DriveSettingsPanel.tsx:79` | Plumbs into `speak()` today; not in call chrome |
| Speaking presence | `"speaking"` in `ParticipantStatus` (`sdk/packages/shared/src/drive/events.ts:192`, `room.ts:29`); `PresenceSpeakingEventSchema` (`events.ts:174-179`) | Roster renders it (`Roster.tsx:64`, amber ring + pulse) and the Rive persona reacts (`ai-elements/persona.tsx`) — but **nothing ever sets it**; the `presence.speaking` reducer case is a no-op (`reduceRoom.ts:218`) |
| Per-agent voice | `TtsSpeakOptions.voiceSlot` + `AgentMediaBag.voiceSlotId` (`sdk/packages/shared/src/drive/director.ts:116-124`); share-and-router PLAN.md (~:390-416) specifies spotlight-biased voice selection | Unimplemented plumbing — no call site passes `voiceSlot` |
| Earcons / chimes | — | **Net-new.** No chime, notification-sound, or audio-asset code exists anywhere in the repo |
| Privacy enforcement precedent | `voiceCaptionState.ts` — `buildDrivePersistPayload` hard-deletes `voiceCaption`/`caption`/`transcript` keys; `DRIVE_PERSIST_KEYS` excludes them | Pattern any transcript UI must follow |

## Demo vs product default

The demo canvas (PR #91) showcases TTS narration **on** at 50% volume with a slider,
completion and approval chimes, a CC transcript panel, and the speaking indicator.
That is the demo's job: show the experience. The **product** default stays off
(`tts.enabled` false, per DRV-TTS "off by default"). When a user enables the facet,
volume defaults to 50%. No slice below changes the default-off posture.

## Engine decision (researched 2026-07-31)

**Kokoro-82M** (`onnx-community/Kokoro-82M-v1.0-ONNX`) is the engine for both the demo
clips and the product's live TTS backend. It is the only quality-tier open engine with
Apache-2.0 on **both weights and code** (clean beside this Apache-2.0 SDK), ranks at the
top of small-model TTS arenas for presenter read-speech, and covers every deployment
shape behind one `TtsPort`:

| Tier | Path | Notes |
|---|---|---|
| In-browser | `kokoro-js` on WebGPU | ~850ms to first audio; gate on WebGPU (WASM is ~5x too slow) |
| Local process | same npm package, `device: "cpu"` | faster than real time on CPU |
| Self-host server | Kokoro-FastAPI / Speaches (OpenAI-compatible) | ~720ms first byte, word timestamps |
| Pre-rendered | demo clips (`docs/drivecode/assets/demos/voice/`) | Adam=`am_michael`, Riley=`af_heart` |

`voiceSlot` maps to Kokoro's 54 preset voice ids (slot -> id table; no cloning infra).
Fallback chain: WebGPU kokoro-js -> local Kokoro -> pre-rendered clips -> `speechSynthesis`.

**HD tier / runner-up:** Chatterbox Turbo (MIT) — blind-preferred over ElevenLabs in
Podonos A/B tests and supports 5s-reference voice cloning if a bespoke branded voice is
ever needed; outputs carry a Perth watermark (disclose or strip), server-only.

**License traps verified during research** (do not "upgrade" to these without re-reading
their HF LICENSE files): F5-TTS and Fish/OpenAudio weights are non-commercial; Orpheus
weights carry the Llama community license; maintained Piper is now GPL-3.0. Windows
gotcha: the `pip install kokoro` torch path wants GPL espeak-ng — use `kokoro-js` or
`kokoro-onnx` to stay pure-Apache, and run generation from a short path (MAX_PATH breaks
the HF cache under deep directories).

## Slices (each PR-sized, in order)

### 1. Speaking presence

Set `"speaking"` status when TTS playback starts; clear it on end/cancel. The event
schema, reducer status path (`presence.status`), Roster ring, and persona reaction all
exist — this slice only adds the emitter around `TtsPort.speak()`/`cancel()`. Cheapest
credible win; ships alone.

### 2. Narrator

Speak DirectorScript `say` beats and `conversation.narration` behind
`shouldSpeakDriveTts` — same gate, no new setting. Playback queue depth two,
drop-oldest beyond that (DRV-TTS). Volume defaults to 50% when the facet is enabled.
Mute-cancel behavior at `useDriveSession.ts:1069-1078` is preserved unchanged.
Narration density stays decision-point by default and is generated in the partner's
normal turn, not a second model call (DRV-NARRATION).

### 3. Earcons

Task-complete, approval-required, join/leave. Play via `playAudioUrlOnSink()` with
bundled short assets, or a small WebAudio synth if bundling is awkward — this is
net-new; no assets exist yet. Quiet by design: about 25% of the TTS volume.
Individually toggleable facets (e.g. `earcons.taskComplete`), all silenced by mute.

### 4. Volume control in call chrome

Slider 0–100 in the call strip, default 50 when TTS is enabled. Wires to
`TtsSpeakOptions.volume` and earcon gain. The existing settings-panel slider
(`DriveSettingsPanel.tsx:79`) and `outputVolume` pref stay the single source of truth;
this surfaces it where the call lives.

### 5. CC transcript panel

Ephemeral captions panel toggled from the call strip. Ring buffer of recent spoken
lines held in React state only — cleared on leave (mirroring the `spokenJoinNoteRef`
reset), excluded from persistence via the `buildDrivePersistPayload` hard-delete
pattern. Labeled privacy-strict in the UI. Nothing is written to disk, ever.

### 6. Per-agent voiceSlot

Pass `voiceSlotId` from the speaking participant's `AgentMediaBag` (biased by
spotlight owner, per share-and-router PLAN.md) into `speak()` as
`TtsSpeakOptions.voiceSlot`. Plumbing only; the option and schema field already exist.

## Constraints

Quoted from the feature docs; every slice must hold these.

- DRV-PRIVACY.md:11-16 — "Strict mode is the default. No raw audio retention, no
  transcript persistence…"
- DRV-CAPTIONS.md:11-14 — "Caption content is transient UI state. Nothing persists
  beyond the submitted message."
- DRV-TRANSCRIPT.md:16 — "No raw transcript persistence on disk unless privacy debug
  is on."
- DRV-TTS.md — narration-only voice out; off by default; mute silences immediately;
  "Spoken narration is ambient, not archival"; playback queue drop-oldest beyond
  depth two.
- DRV-NARRATION.md — decision-point density by default; narration generated in the
  partner's normal turn, not a second model call.
- Enforcement precedent: `voiceCaptionState.ts` (`buildDrivePersistPayload` deletes
  `voiceCaption`/`caption`/`transcript`; `DRIVE_PERSIST_KEYS` excludes them).

## Non-goals

- No audio persistence or recording of any kind.
- No WebRTC — this is TTS playback and UI presence, not live media transport.
- No cloud TTS requirement — browser `speechSynthesis` remains the floor; any cloud
  voice is BYOK through the existing provider settings.
- No change to the default-off `tts.enabled` posture.

## Verification

Per slice:

- Unit tests beside the voice files (`drive/voice/*.test.ts` pattern) — gate logic,
  queue depth/drop-oldest, persist-payload exclusion, volume clamping.
- Manual call-strip walkthrough: join → narration speaks → mute cancels mid-utterance
  → roster ring tracks playback → leave clears the CC buffer.
- Demo-canvas parity check: the PR #91 canvas exercises the same seams; each landed
  slice should make one demo affordance real instead of simulated.
