# Privacy · what Drive keeps and what leaves your machine

Back to [reference README](README.md). Policy source:
[DRV-PRIVACY](../plans/cline-drivemode/features/DRV-PRIVACY.md) ·
[DRV-CAPTIONS](../plans/cline-drivemode/features/DRV-CAPTIONS.md) ·
[DRV-TRANSCRIPT](../plans/cline-drivemode/features/DRV-TRANSCRIPT.md).

This page describes what the code does today, not what we would like it to do.
Everything below was read out of the shipped source. Where the behaviour is
narrower than the slogan, the slogan loses.

## The short version

Drive runs entirely on your machine. It binds to `127.0.0.1`, writes its
history to files inside your own checkout, and sends nothing to us. Two things
do leave your machine, and both are things you asked for: **your prompts go to
whichever LLM provider you configured**, and — if you use the default
speech-to-text — **your microphone audio goes to your browser vendor**.

## What is recorded, and where

Drive keeps an append-only log of what happened in a room, under
`<workspace>/.cline/drive/`. It is created the first time you join a call, and
it is gitignored.

| Path | Holds |
|---|---|
| `.cline/drive/rooms/<roomId>/events.jsonl` | the room's event history |
| `.cline/drive/rooms/<roomId>/meta.json` | the sequence cursor |
| `.cline/drive/bank/events.jsonl` | task-bank history for the workspace |
| `.cline/drive/facets.v1.json` | Drive config: profile, speech provider ids |
| `.cline/drive/providers/<id>/manifest.json` | bring-your-own provider manifests |

The logs are capped and trim oldest-first on append — 2048 records per room,
4096 per workspace bank
(`sdk/packages/core/src/hub/collaboration/logRetention.ts`). Separately,
`~/.cline/data/` holds session, status and cron databases, hub logs, and
`settings/providers.json`. **Your API keys are in that last file.**

## What those events contain

Most Drive events are metadata: a file path that was edited, a command that
ran, who is speaking, who joined. The event schema
(`sdk/packages/shared/src/drive/events.ts`) is closed — every variant is a
`.strict()` object, and a list of forbidden keys (`audio`, `rawAudio`, `pcm`,
`wav`, `transcript`, `fullTranscript`, `rawTranscript`, `speechAudio`) is
rejected by parse, with tests that fail if a schema ever admits one.

**But two event types carry text, and that text is written to disk:**
`conversation.message` carries the message you sent, and
`conversation.narration` carries the line the agent narrates. So "Drive events
carry metadata only" is true of the work, presence and control tracks and
false of the conversation track. If you would not want a sentence sitting in a
JSONL file in your repo, do not say it in a call.

## What is never written down

Live speech is not the same thing as a conversation message.

- **Captions** — the words appearing in the composer as you speak — are React
  state and nothing else. The Drive slice of persisted UI state is built by
  `buildDrivePersistPayload`, which hard-deletes `voiceCaption`, `caption`,
  `captions`, `transcript` and `driveTranscript` on the way out
  (`apps/cline-hub/src/webview/src/drive/voice/voiceCaptionState.ts`). A caption
  cannot survive a reload.
- **The CC panel** is a 40-line ring buffer that drops the oldest line as new
  ones arrive and is emptied when you leave the call
  (`drive/voice/driveTranscript.ts`).
- **Muting the mic discards the draft**, including a partial utterance that
  lands after the mute — so nothing reappears when you unmute.
- **Audio is never stored.** No recording is written anywhere, in any mode.

A caption only becomes durable if you press send, at which point it is a
`conversation.message` like anything you typed.

## What leaves your machine

**Your LLM provider.** This is the point of the product: prompts, file context
and tool results go to whichever provider you configured, under that provider's
terms. Nothing routes through us on the way.

**Speech-to-text, by default.** The default STT backend is the browser's Web
Speech API. In Chrome and Edge that ships your microphone audio to the browser
vendor's servers for recognition. The code is explicit about it — the builtin
manifest is labelled `egress: "platform-cloud"`
(`sdk/packages/shared/src/drive/providers.ts`). If that is not acceptable,
switch STT to the local worker in Drive Settings and run a loopback
whisper server; non-loopback URLs are rejected for that backend
([ops/local-stt.md](../plans/cline-drivemode/ops/local-stt.md)). Text-to-speech
uses the browser's own `speechSynthesis` and is loopback-only.

**Telemetry: off.** The hub builds a telemetry service whose only sink writes a
line to your local hub log. OpenTelemetry export is enabled only when you set
`OTEL_TELEMETRY_ENABLED` **and** an OTLP endpoint
(`sdk/packages/shared/src/services/telemetry-config.ts`,
`sdk/packages/core/src/services/telemetry/OpenTelemetryProvider.ts`). There is
also a global `telemetryOptOut` setting that forces a no-op service regardless.

## Who can reach your hub

The hub binds `127.0.0.1`. On startup with no `ROOM_SECRET` set it prints:

```
ROOM_SECRET is not set; this local-only instance accepts browser connections
without an invite token.
```

That is fine for a machine you control, and it is the only supported topology
in this beta — Drive rooms are single-machine and single-human. There is no
remote participant bridge; the capability flags for one exist and default to
false.

## Deleting it

`bun run cli doctor fix` to stop the daemon, then remove
`<workspace>/.cline/drive/` for a workspace's call history, or `~/.cline/data/`
for everything including your saved API keys. Deleting a room directory is
enough to erase that room — the live snapshot is rebuilt from the log, so there
is no second copy.

## Known gaps

- The MVP plan describes Drive events as carrying "metadata only". The
  conversation track carries message and narration text. This page is the
  accurate statement.
- `DRV-PRIVACY` still lists the schema-level audio assertion as an open task.
  It has in fact shipped — `DRIVE_EVENT_FORBIDDEN_KEYS` plus the privacy-gate
  tests in `sdk/packages/shared/src/drive/events.test.ts`.
- `privacy.debugRetention` exists as a facet and raises the retention caps, but
  the call-strip indicator that is supposed to make it visible has not shipped.
