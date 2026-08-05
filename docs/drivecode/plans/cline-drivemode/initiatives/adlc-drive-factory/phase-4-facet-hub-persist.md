# Phase 4 · Facet hub persist

Back to [overview](overview.md). Closes a programmatic gap: voice toggles today
patch client state but the webview does not call `drive_config_put`.

## Goal

TTS (and sibling voice facet patches from Drive Settings) persist through the
hub config lane agents and reloads can trust.

## Changes

- Wire Drive voice facet patches through existing `drive_config_get` /
  `drive_config_put` handlers.
- Keep client persist as a cache, not the source of truth.
- Touch only the voice settings path. Do not widen to full facet editor UI.

## Data structures

Existing durable facet store under `.cline/drive`. No new facet ids.

## Verification

**Static.** Hub unit or webview test: put → get round-trip for `tts.enabled`.

**Runtime.** control-ui: enable TTS → reload dashboard → narration still allowed
without re-prompt. Hub restart keeps the facet.
