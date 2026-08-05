# Phase 3 · First-call TTS enable

Back to [overview](overview.md). Implements defaults-delivery **B2**.

## Goal

A user who never opens Drive Settings can turn partner narration on during the
first call.

## Changes

- First-call prompt in call chrome when `tts.enabled` is false and the topology allows speak.
- Accept writes the facet the same way the settings checkbox does.
- Decline stays quiet for the session (no nag loop). Earcons stay independent of TTS.

## Data structures

Existing facet `tts.enabled: boolean`. No schema rev.

## Verification

**Static.** `bun -F @cline/cline-hub test` on prompt accept/decline and
`shouldSpeakDriveTts` unchanged for deafen/mute separation.

**Runtime.** control-ui: join call with default-off TTS → accept prompt → hear
(or instrumented `speechSynthesis`) narration; deafen still cancels.
