# 28 · Hugging Face speech-to-speech — Drive fit

**Date:** 2026-08-03 · **Status:** evaluated, not adopted
**Upstream:** [huggingface/speech-to-speech](https://github.com/huggingface/speech-to-speech)
**Companions:** [ADR-0009](../adr/ADR-0009-runtime-topology-local-cloud.md),
[ADR-0010](../adr/ADR-0010-provider-harness-byok.md),
[drive-audio](../initiatives/drive-audio/README.md),
[`createVoiceStack.ts`](../../../../../apps/cline-hub/src/webview/src/drive/voice/createVoiceStack.ts).

## Why this document exists

Drive already ships a cascaded voice path (STT → text → Cline LM → TTS). The
Hugging Face speech-to-speech repo is a popular open cascade with a Realtime
WebSocket surface. This note records what it is, what Drive already covers, and
why the package is **not** a Drive daemon or second agent runtime.

## What speech-to-speech is

A **Python** modular pipeline:

1. **VAD** — Silero VAD v5 (turn boundaries)
2. **STT** — Parakeet TDT (default), Whisper / Faster-Whisper / MLX variants
3. **LLM** — OpenAI-compatible Responses/Chat Completions, Transformers, or mlx-lm
4. **TTS** — Qwen3-TTS (default); Kokoro-82M, Pocket TTS, ChatTTS, MMS as extras

Run modes: OpenAI Realtime-compatible WebSocket/WebRTC (`realtime`), local mic,
raw PCM WebSocket, and TCP socket. Production use today includes Reachy Mini
robots. Install is `pip install speech-to-speech` (Python 3.10+), not Bun.

## What Drive already has

| Concern | Drive | S2S |
|---|---|---|
| Cascade | `SttPort` → mute-gated text → Cline agent → `TtsPort` | VAD → STT → S2S LLM → TTS |
| Host | Hub webview + Bun/TS SDK | Python process |
| LLM ownership | Cline `@cline/llms` / seated `ConfiguredAgent` | Pipeline's own LLM slot |
| Audio in room events | Forbidden (ADR-0009) | Audio on Realtime/raw transports |
| Local STT | Loopback whisper worker | Parakeet / Whisper extras |
| Product TTS engine | Kokoro-82M (drive-audio decision) | Qwen3 default; Kokoro optional |
| Second daemon | Explicitly out of scope (nest HANDOFF) | Is a separate server |

Same cascade *shape*; different ownership of the LM and the process boundary.

## Decision

**Do not vendor, wrap, or run `speech-to-speech` as a Drive sidecar.**

Reasons that stay true under nest HANDOFF and Accepted ADRs:

- No second daemon / second writer for room state.
- No second agent runtime — S2S's LLM slot would fork prompts, tools, and
  provider config away from Cline-owned agent configuration.
- Toolchain is Bun/TS; a Python Realtime server is a new ops and privacy plane.
- Events-first stage: pixel/WebRTC media is later; hub events stay metadata-only.
- TTS engine is already locked to Kokoro for product + demo clips.

## Useful harvest (document only — not this change's code)

| Idea | Drive seam | Note |
|---|---|---|
| Silero VAD | Future local-worker / MediaRecorder turn boundary | Drive has no VAD stage today |
| Backend swap table | ADR-0010 manifests + `SttPort`/`TtsPort` | Prefer new adapters over a parallel pipeline |
| Realtime WS protocol | Optional future interop client | Not the hub room protocol |
| Kokoro extra on S2S | Confirms drive-audio engine choice | Do not pivot to Parler / Qwen3-TTS |

## Non-goals confirmed by this pass

- Replacing browser/`speechSynthesis` or planned Kokoro with Qwen3/Parler via S2S
- Pointing Drive mic audio at `ws://…/v1/realtime` as the primary agent path
- Shipping embeddings or robot/Reachy packaging with Drive

## Resume pointer

If voice quality or turn-taking needs improve later: add VAD or STT adapters
behind existing ports; keep Cline as the only LM. Re-open this doc only if a
second-host extract of `@cline/drive` explicitly wants a Python voice sidecar
with a written ADR.
