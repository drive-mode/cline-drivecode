# DRV-SHIPPED-DIGEST · Opt-in “what Drive shipped” digest

Back to [README](../README.md). Phase 2+ Planned. Product: [PRD 10](../prd/prd-task-satisfaction-observability.md). Requirements: [req-value-proof-digest](../initiatives/session-satisfaction-moments/req-value-proof-digest.md).

## Problem / user value

Task-as-unit is the honest alternative to token narratives, but users cannot export “what Drive shipped.” Explicitly export a local digest of sessions → tasks completed → plans drained for personal or lead review.

## Acceptance criteria

- Default off; user-triggered only (button and/or CLI dump).
- Payload: Markdown and/or JSON with rollup counts, task/plan ids, titles, clean-drain flags. Destination: file/clipboard; MVP localhost only.
- Schema forbids transcript/audio/utterance fields; inherits [DRV-PRIVACY](DRV-PRIVACY.md) redaction; privacy tests pass.
- One smoke session can produce a readable digest.
- Does not add core-events Drive telemetry. Not billing, NPS, PostHog, or satisfaction-% marketing.

## Dependencies

- SessionRollup honesty ([DRV-TASK-METRICS](DRV-TASK-METRICS.md)). Soft: [DRV-STATUS-SESSIONS](DRV-STATUS-SESSIONS.md) as launch point.

## Surfaces touched

- Status / Drive settings opt-in control and/or CLI dump
- Pure digest builder in `@cline/drive`
- Local file or clipboard only

## Agent tasks

- [ ] Define digest schema (counts, ids, titles, S3 flags) with forbidden utterance/audio/transcript keys.
  - Owner package: `@cline/shared`
  - Verify: privacy / forbidden-key tests
  - Done when: schema rejects utterance payloads; redaction inherits DRV-PRIVACY.
- [ ] Implement pure digest builder from local SessionRollups → Markdown and/or JSON.
  - Owner package: `@cline/drive`
  - Verify: unit fixture from one synthetic session
  - Done when: readable digest names completed tasks and drained plans.
- [ ] Add opt-in export control (hub button and/or CLI); default off; localhost destination only.
  - Owner package: `@cline/cline-hub` and/or `@cline/cli`
  - Verify: smoke export; no network egress
  - Done when: user trigger required; no core-events telemetry added.

## Risks

- Scope creep into metering/NPS. Mitigation: PRD 10 non-goals; opt-in local only.
- Over-rich payloads. Mitigation: counts + ids/titles; no transcripts.
