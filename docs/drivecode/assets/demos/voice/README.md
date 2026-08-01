# Demo narration clips (v3 — the real flashing-fix story)

Pre-rendered agent dialogue for `docs/drivecode/design/canvases/drive-product-demo.html`.
The voice is the AGENT WORKING (pair-partner register), never a product narrator —
product explanation lives in the demo's caption bar. Beats pace themselves
`auto_after_say`: autoplay holds a voiced beat until its clip ends. The story is
real: the demo reenacts the flashing bug we hit (and fixed) while building this
very canvas — differential region rendering + the fixed caption slot, PR #91.

- Engine: **Kokoro-82M** (`onnx-community/Kokoro-82M-v1.0-ONNX`, q8) via `kokoro-js` — Apache-2.0.
- Voices: Cline = `am_michael`, Riley = `af_heart` (per-agent `voiceSlot` concept).
- Human ("You") lines are Harrison's recorded voice (`you-*` below) — DRV-TTS still
  holds for the product (agent voice out is narration-only); the demo plays the
  human side because the human here is real.
- Regenerate from a SHORT path (Windows MAX_PATH breaks the HF cache): `npm i kokoro-js`,
  render 24kHz WAV, `ffmpeg -q:a 4` to MP3. Narration display text must match clip text verbatim.

| clip | beat | speaker | line |
|---|---|---|---|
| v3-01-cline-looking-at-flashing | a1-join | Cline | Hey — good timing. I'm looking at that flashing you reported. Give me a second and I'll show you what's going on. |
| v3-02-cline-found-it | a2-narration | Cline | Okay, found it. Every beat, we rebuild the whole page — so everything replays its entrance animation. That's the flash. Let me put it on the screen. |
| v3-17-cline-watch-the-flash | a3-bug | Cline | Watch this — every beat, the whole page rebuilds, and everything animates back in. That's the flash. Now the fixed path: fingerprint matches, nothing moves — only the new message animates. |
| v3-03-cline-the-plan | a3-plan | Cline | Here's the plan. Fingerprint what each region shows, skip the repaint when nothing changed, and only animate what's actually new. |
| v3-04-cline-render-map | a3-arch | Cline | Quick map of how the demo renders. State folds in from the left, and render pushes it into these four regions. The flash lives right here — at this rebuild edge. |
| v3-05-cline-fingerprint-check | a3-edit | Cline | I'll keep the map up while I make the change. Adding the fingerprint check now — if the region's state didn't change, we don't touch it. |
| v3-06-cline-green-no-remounts | a3-test | Cline | There we go — green. Same message node before and after the beat. Nothing re-mounts. |
| v3-07-cline-walkthrough-guard | a3-walk | Cline | Let me walk you through it. This guard is the whole fix — compare the fingerprint, skip the rebuild, remember the new one. |
| v3-08-cline-smooth-live | a3-demo | Cline | And here it is live — beats advancing, zero flashes. Smooth. |
| v3-09-cline-you-drive | a4-pause | Cline | Got it — one home for the captions. Let me finish this check, then you drive. |
| v3-10-riley-regression-checks | a5-sharer | Riley | Riley here — grabbing the screen for a minute. I'm adding regression checks so the flash can't sneak back in. |
| v3-11-cline-keep-working | a6-status | Cline | I'll keep working while you look around. Pinning the caption slot into place now. |
| v3-12-cline-welcome-back | a8-rejoin | Cline | Welcome back — nothing was torn down. I'm writing up the change while it's fresh. |
| v3-13-cline-catch-up | a8-since | Cline | Quick catch-up: Riley's regression checks landed, and the battery stayed green the whole time. |
| v3-14-cline-signoff | a9-gates | Cline | One thing before I open the pull request — I need your sign-off. The approval card is on your screen. |
| v3-15-cline-pr-ninety-one | a9-approved | Cline | Thanks. PR ninety-one is up, with the before and after attached. |
| v3-16-cline-take-the-wheel | a10-explore | Cline | And we're back — everything right where we left it. Take the wheel. |

Deliberately silent (captions carry the product story): a6-artifacts, a7-leave-choice,
a7-end-packet, a9-mode, a9-privacy, a10-agents, a10-tasks, a10-rooms, a10-stop, and all
pure-UI beats.

Human lines — Harrison's real voice, recorded by him (trimmed, loudness-matched
to the Kokoro clips at -24 LUFS, 24kHz MP3). The canvas `speech` fields carry the
authoritative display text; wiring below is what the canvas actually plays:

1. `you-01-fix-the-flashing` · a2-message · **wired — the STT source.** The
   scripted cursor clicks the mic, this clip plays while its words transcribe
   into the composer in chunks, then the cursor presses Send
   (`input: {mode:"stt"}` on the beat).
   "Cline — the demo flashes and refreshes the whole page every time it updates.
   It feels jarring. Can you make it one smooth experience?"
2. `you-02-captions-one-place` · a4-steer-send · **held in reserve.** The steer is
   deliberately TYPED (voice when you have the floor, text when you don't want to
   interrupt), so this clip stays unwired. To swap the beat to dictation, change
   its input field to
   `input: {mode:"stt", text: <same>, clip: "you-02-captions-one-place.mp3"}`.
   "Also — the captions keep shifting around. Give them one consistent place."
3. `you-03-jumps-here-to-here` · a5-you-pin · **wired — plays on beat entry**
   (`SPEECH_CLIPS`): the click is the share button, your voice lands over the pin.
   "Here's what I mean — it jumps from here to here."
4. `you-04-approved` · a9-approved · **wired — sequenced first** (`CLIP_SEQS`):
   your sign-off ("Looks good — approved. Go ahead."), then Cline's `v3-15`; the
   beat holds for both.
5. `you-05-take-it-from-here` · a10-explore · **wired — sequenced second**
   (`CLIP_SEQS`): Cline's `v3-16` hands back, then your "Nice. I'll take it from
   here." closes the demo.
