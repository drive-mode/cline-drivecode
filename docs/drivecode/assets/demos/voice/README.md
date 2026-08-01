# Demo narration clips (v4 — the director's cut)

Pre-rendered agent dialogue for `docs/drivecode/design/canvases/drive-product-demo.html`.
The voice is the AGENT WORKING (pair-partner register), never a product narrator —
product explanation lives in the demo's caption bar. Beats pace themselves
`auto_after_say`: autoplay holds a voiced beat until its clip ends plus a 400ms
pad. The story is real: the demo reenacts the flashing bug we hit (and fixed)
while building this very canvas — differential region rendering + the fixed
caption slot, PR #91.

v4 reorders the script around the human: Harrison reports the bug FIRST, Cline
invites a screen takeover, and only then diagnoses. His captions steer is now
dictated (you-02 wired), and the walkthrough follows the ack.

- Engine: **Kokoro-82M** (`onnx-community/Kokoro-82M-v1.0-ONNX`, q8) via `kokoro-js` — Apache-2.0.
- Voices: Cline = `am_michael` at **1.12 speed**, Riley = `af_heart` at **1.05 speed**
  (per-agent `voiceSlot` concept). Every v4 clip carries a **200ms silent tail**;
  with the player's 400ms `auto_after_say` pad, lines never feel cut off.
- Human ("You") lines are Harrison's recorded voice (`you-*` below) — DRV-TTS still
  holds for the product (agent voice out is narration-only); the demo plays the
  human side because the human here is real. **you-01 was RE-CUT for v4**: the
  "It feels jarring." sentence no longer exists in the audio.
- Regenerate from a SHORT path (Windows MAX_PATH breaks the HF cache): `npm i kokoro-js`,
  render 24kHz WAV, append the 200ms tail, `ffmpeg -q:a 4` to MP3. Narration
  display text must match clip text verbatim.

| clip | beat | speaker | line |
|---|---|---|---|
| you-01-fix-the-flashing | a2-message | You | Cline — the demo flashes and refreshes the whole page every time it updates. Can you make it one smooth experience? |
| v4-01-cline-see-it-show-me | a2-message | Cline | Yep, I see it. Actually — grab the screen and show me exactly where it jumps. |
| you-03-jumps-here-to-here | a2-you-show | You | Here's what I mean — it jumps from here to here. |
| v4-02-cline-found-it | a2-narration | Cline | Perfect, that's all I need. Okay — found it. Every beat, we rebuild the entire page, so everything replays its entrance animation. That's your flash. Let me put it up. |
| v4-03-cline-watch-the-flash | a3-bug | Cline | Watch — every beat, the whole page rebuilds and everything animates back in. Now the fixed path... fingerprint matches, nothing moves. Only the new message animates. |
| v4-04-cline-the-plan | a3-plan | Cline | So here's the plan. Fingerprint what each region shows, skip the repaint when nothing changed, and only animate what's actually new. |
| v4-05-cline-render-map | a3-arch | Cline | Quick map of how this thing renders. State folds in from the left, render pushes it into these four regions... and the flash lives right here, at this rebuild edge. |
| v4-06-cline-fingerprint-check | a3-edit | Cline | I'll keep the map up while I work. Adding the fingerprint check now — if a region didn't change, we don't touch it. |
| v4-07-cline-green | a3-test | Cline | There we go — green. Same message node before and after the beat. Nothing re-mounts. |
| you-02-captions-one-place | a4-steer-send | You | Also — the captions keep shifting around. Give them one consistent place. |
| v4-08-cline-captions-ack | a4-pause | Cline | Good catch — one home for the captions. Let me wrap this check, then you drive. |
| v4-09-cline-walkthrough | a3-walk | Cline | Let me walk you through it. This guard is the whole fix — compare the fingerprint, skip the rebuild, remember the new one. |
| v4-10-cline-smooth-live | a3-demo | Cline | And here it is live — beats advancing, zero flashes. Smooth. |
| v4-11-riley-regression-checks | a5-sharer | Riley | Riley here — grabbing the screen for a minute. I'm adding regression checks so the flash can't sneak back in. |
| v4-12-cline-keep-working | a6-status | Cline | I'll keep going while you look around. Pinning the caption slot into place now. |
| v4-13-cline-welcome-back | a8-rejoin | Cline | Welcome back — nothing was torn down. I'm writing up the change while it's fresh. |
| v4-14-cline-catch-up | a8-since | Cline | Quick catch-up — Riley's regression checks landed, and the battery stayed green the whole time. |
| v4-15-cline-signoff | a9-gates | Cline | One thing before I open the pull request — I need your sign-off. The card's on your screen. |
| you-04-approved | a9-approved | You | Looks good — approved. Go ahead. |
| v4-16-cline-pr-ninety-one | a9-approved | Cline | Thanks. PR ninety-one's up, before-and-after attached. |
| v4-17-cline-take-the-wheel | a10-explore | Cline | And we're back — everything right where we left it. Take the wheel. |
| you-05-take-it-from-here | a10-explore | You | Nice. I'll take it from here. |

Deliberately silent (captions carry the product story): a1-join, a5-you-pin
(caption-only in v4 — the spoken pin moment moved up to a2-you-show),
a6-artifacts, a7-leave-choice, a7-end-packet, a9-mode, a9-privacy, a10-agents,
a10-tasks, a10-rooms, a10-stop, and all pure-UI beats.

Wiring, per registry (the canvas `speech`/`narration` fields carry the
authoritative display text; this is what actually plays):

1. `you-01` · a2-message · **the STT source.** The scripted cursor clicks the
   mic, this clip plays while its words transcribe into the composer in chunks,
   then the cursor presses Send (`input: {mode:"stt"}` on the beat). Cline's
   `v4-01` reply is the beat's narration — it plays on entry, after the send.
2. `you-03` · a2-you-show · **plays on beat entry** (`SPEECH_CLIPS`): the click
   is the share button, your voice lands over the takeover pin.
3. `you-02` · a4-steer-send · **the second STT source** (wired in v4; the v3
   steer was typed): same mic → transcribe → Send choreography as you-01.
4. `you-04` · a9-approved · **sequenced first** (`CLIP_SEQS`): your sign-off,
   then Cline's `v4-16`; the beat holds for both.
5. `you-05` · a10-explore · **sequenced second** (`CLIP_SEQS`): Cline's `v4-17`
   hands back, then your line closes the demo.
