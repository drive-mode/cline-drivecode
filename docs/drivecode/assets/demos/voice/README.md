# Demo narration clips (v2 — in-world dialogue)

Pre-rendered agent dialogue for `docs/drivecode/design/canvases/drive-product-demo.html`.
The voice is the AGENT WORKING (pair-partner register), never a product narrator —
product explanation lives in the demo's caption bar. Beats pace themselves
`auto_after_say`: autoplay holds a voiced beat until its clip ends.

- Engine: **Kokoro-82M** (`onnx-community/Kokoro-82M-v1.0-ONNX`, q8) via `kokoro-js` — Apache-2.0.
- Voices: Adam = `am_michael`, Riley = `af_heart` (per-agent `voiceSlot` concept).
- Human ("You") lines are caption/transcript-only — DRV-TTS: voice out is narration-only.
- Regenerate from a SHORT path (Windows MAX_PATH breaks the HF cache): `npm i kokoro-js`,
  render 24kHz WAV, `ffmpeg -q:a 4` to MP3. Narration display text must match clip text verbatim.

| clip | beat | speaker | line |
|---|---|---|---|
| v2-01-adam-good-timing | a1-join | Adam | Hey — good timing. I'm on that double-retry bug in the router. Give me a second and I'll show you what I found. |
| v2-02-adam-found-it | a2-narration | Adam | Okay, found it. If two timeouts overlap, schedule-retry fires twice. Let me put it on the screen. |
| v2-03-adam-plan-of-attack | a3-plan | Adam | Here's my plan of attack. I've already reproduced it — next I guard the pending flag, and then the tests prove it. |
| v2-04-adam-quick-map | a3-arch | Adam | Quick map before I touch anything. Requests come through the router, and both timeout paths can reach schedule-retry. That amber box is where our race lives. |
| v2-05-adam-keep-the-map-up | a3-edit | Adam | I'll keep the map up while I make the change. Adding the guard now — if a retry is already pending, we just bail out. |
| v2-06-adam-green | a3-test | Adam | There we go — green. One retry per timeout, exactly once. |
| v2-07-adam-line-forty-three | a3-walk | Adam | Let me walk you through it. Line forty-three is the whole fix — if pending is set, we return before ever scheduling. |
| v2-08-adam-live-clean-200 | a3-demo | Adam | And here it is live. The request times out, one retry, clean two hundred. |
| v2-09-adam-you-drive | a4-pause | Adam | Got it — the guard stays in the router. Let me finish this tool call, then you drive. |
| v2-10-riley-grabbing-screen | a5-sharer | Riley | Riley here — grabbing the screen for a minute. The retry docs still promise the old behavior, so I'm fixing that. |
| v2-11-adam-keep-working | a6-status | Adam | I'll keep working while you look around. Running the full suite in the background now. |
| v2-12-adam-welcome-back | a8-rejoin | Adam | Welcome back — nothing was torn down. I'm drafting the PR body while it's fresh. |
| v2-13-adam-quick-catch-up | a8-since | Adam | Quick catch-up: Riley shipped the docs fix, and the tests stayed green the whole time. |
| v2-14-adam-need-your-signoff | a9-gates | Adam | One thing before I open the PR — I need your sign-off. The approval card is on your screen. |
| v2-15-adam-pr-twelve-up | a9-approved | Adam | Thanks. PR twelve is up, with the handoff attached. |
| v2-16-adam-take-the-wheel | a10-explore | Adam | And we're back — everything right where we left it. Take the wheel. |

Deliberately silent (captions carry the product story): a6-artifacts, a7-leave-choice,
a7-end-packet, a9-mode, a9-privacy, a10-agents, a10-tasks, a10-rooms, a10-stop, and all
pure-UI beats.

Human speech (caption-only): a2-message · a4-steer-send · a5-you-pin (see the canvas
`speech` fields for current text).
