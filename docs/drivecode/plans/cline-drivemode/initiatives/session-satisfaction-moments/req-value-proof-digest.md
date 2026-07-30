# Requirements · Value-proof shipped digest

**DRV:** [DRV-SHIPPED-DIGEST](../../features/DRV-SHIPPED-DIGEST.md)  
**Related:** DRV-STATUS-SESSIONS, DRV-PRIVACY, PRD 10 non-goals

## Problem

Task-as-unit is the honest alternative to token narratives, but users cannot export “what Drive shipped.”

## User job

Explicitly export a local digest of sessions → tasks completed → plans drained for personal or lead review.

## Shape

- Opt-in control only (button / CLI dump)
- Payload: Markdown and/or JSON with rollup counts, task/plan ids, titles, clean-drain flags
- Destination: file/clipboard; MVP localhost only
- Not billing, NPS, PostHog, or satisfaction % marketing

## Acceptance criteria

1. Default off; user-triggered only.
2. Schema forbids transcript/audio/utterance fields; privacy tests pass.
3. Inherits DRV-PRIVACY redaction.
4. One smoke session can produce a readable digest.
5. Does not add core-events Drive telemetry.

## Dependencies

- SessionRollup honesty (Obs slice 2)
- Soft: Status sessions UI as launch point

## Risks

- Scope creep into metering/NPS
- Over-rich payloads

## Open questions

1. Markdown letter vs JSON vs both?
2. Window: last session vs last N local sessions?
3. Include P* churn in user-facing digest?
