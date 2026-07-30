# DRV-PLAN-IMPROVE · Gated planning improvement from session diagnosis

Back to [README](../README.md). Product: [PRD 10](../prd/prd-task-satisfaction-observability.md). Privacy: [ARD-0004](../ard/ARD-0004-gated-learn-privacy.md). Companion research: [16](../research/16-task-as-unit-models.md).

## Problem / user value

When users cannot complete tasks in Drive, the system should help **next** sessions plan better — without silently rewriting memory or plans from transcripts. Structured session diagnosis → planning-skill / plan proposals → human accept.

## Acceptance criteria

- Stall detection consumes `SessionRollup` + open tasks with `lastFailure` (thresholds via facet or policy constant — not calendar SLAs).
- Diagnosis inputs are event ids, artifact paths, skill ids, task/plan ids — never raw utterances or audio.
- Output is a **proposal** in the gated-learn family: planning skill patch, plan template, and/or draft sibling tasks.
- Accept | reject | mute required before durable write to `.driveagent/` knowledge or skill sources; bank mutations go through hub ops after accept.
- Reject/mute must not retry the same silent proposal without new user intent (align with M13 spirit).
- Partner may still propose in-band fix-up tasks under ARD-0008; this feature covers **post-session / cross-session** improvement skills.
- No second agent runtime inside `@cline/drive`; analysis may run as a host agent turn or offline job that only emits proposals.

## Dependencies

- DRV-TASK-METRICS, DRV-CALL-SESSION, DRV-TASK-BANK, DRV-PRIVACY, DRV-SKILL-PORT / Driveagent home (durable skill target), ARD-0004.

## Surfaces touched

- Hub learn / accept queue UI (extend or tag `kind: planning`)
- Host agent planning skill (ConfiguredAgent / `.driveagent` compile path)
- Optional pure helpers in `@cline/drive` for stall classification from rollups

## Agent tasks

- [ ] Specify proposal schema fields (kind, evidence event ids, target skill/path) without transcript blobs.
  - Owner package: `@cline/shared`
  - Verify: privacy/forbidden-key tests
  - Done when: schema rejects utterance payloads.
- [ ] Implement stall classifier from SessionRollup (pure).
  - Owner package: `@cline/drive`
  - Verify: unit fixtures for low-completion + high-churn
  - Done when: classifier returns stable reason codes.
- [ ] Wire propose → accept path reusing gated-learn hub ops (or thin parallel tagged queue).
  - Owner package: `@cline/core` + hub webview
  - Verify: integration test accept writes only on accept
  - Done when: reject leaves disk unchanged.

## Risks

- Lore poison via aggressive auto-propose. Mitigation: mute + evidence ids only; human accept.
- Scope creep into training a task model in-process. Mitigation: ARD-0015 §8; research stays proposer-only.
