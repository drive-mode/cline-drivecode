# drive-audio · Initiative index

**Status:** planned — engine decision locked (Kokoro-82M), demo clips shipped;
product slices not started
**Demo reference:** [drive-product-demo.html](../../../../design/canvases/drive-product-demo.html)
narrates with pre-rendered clips from `docs/drivecode/assets/demos/voice/`
**Posture:** TTS ships **off by default** (DRV-TTS); the demo's always-on voice
is a demo-only default, reconciled in the overview's "Demo vs product default"
section

Make Drive calls audible: agent narration as speech, presence/attention chimes,
and a derived CC transcript — voice-first without being voice-required.

| File | What |
|---|---|
| [overview.md](overview.md) | Slices 1–7 (speaking presence → narrator → chimes → volume/prefs → CC transcript → engine → dead-air design), Kokoro engine decision, demo/product reconciliation |
| [28-huggingface-speech-to-speech.md](../../research/28-huggingface-speech-to-speech.md) | HF speech-to-speech cascade evaluated — **not adopted** as a Drive daemon; VAD/port harvest only |

### Feature ids

| DRV | Component |
|---|---|
| [DRV-TTS](../../features/DRV-TTS.md) | Speech synthesis, off-by-default posture |
| [DRV-NARRATION](../../features/DRV-NARRATION.md) | Decision-point narration density |
| [DRV-CAPTIONS](../../features/DRV-CAPTIONS.md) | Caption surfaces |
| [DRV-TRANSCRIPT](../../features/DRV-TRANSCRIPT.md) | Derived CC transcript |
| [DRV-PRIVACY](../../features/DRV-PRIVACY.md) | Metadata-only events, forbidden keys |
