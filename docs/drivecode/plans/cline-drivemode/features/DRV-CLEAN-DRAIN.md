# DRV-CLEAN-DRAIN · Clean-drain ritual (S3 → invite E1)

Back to [README](../README.md). Phase 2+ Planned. Product: [PRD 10](../prd/prd-task-satisfaction-observability.md). Requirements: [req-clean-drain-ritual](../initiatives/session-satisfaction-moments/req-clean-drain-ritual.md).

## Problem / user value

E1 (post-success continue) is the preferred engagement proxy but has no product moment. NowNext collapsing on archive can feel like failure. When a plan finishes cleanly, the user is acknowledged and gently invited to set the next goal — without pressure.

## Acceptance criteria

- Verified S3 + ≥1 completion → single acknowledgment in one interaction cycle (narration, NowNext successor, or Spotlight complete card — pick one primary).
- Affordance exists to start E1 (new plan / title refresh / first tasks) without forcing accept.
- Does not fire on non-S3 archive or zero-completion sessions.
- Dismissible; does not block leave/end. Ritual invite alone does **not** set E1 true — only user continue does.
- Privacy: plan/task ids only if logged — no utterances, no phone-home.

## Dependencies

- Honest S3 from [DRV-TASK-METRICS](DRV-TASK-METRICS.md) (Obs slices). [DRV-NOWNEXT](DRV-NOWNEXT.md), [DRV-NARRATION](DRV-NARRATION.md); optional Show plan card.

## Surfaces touched

- Narration / NowNext / Spotlight (one primary home)
- PlanEditor or composer idle “What’s next?” affordance
- Leave/end path (must remain unblocked)

## Agent tasks

- [ ] Gate ritual on verified S3 + ≥1 completion; skip churny/zero-completion archives.
  - Owner package: `@cline/drive`
  - Verify: rollup fixture matrix (S3 true/false, zero completes)
  - Done when: ritual fires only on clean drain with completions.
- [ ] Ship one primary acknowledgment + soft E1 invite CTA; dismissible, non-blocking.
  - Owner package: `@cline/cline-hub`
  - Verify: hub smoke dismiss + leave during ritual
  - Done when: invite alone does not mark E1; leave/end still work.
- [ ] Ensure logging uses plan/task ids only — no utterance or egress defaults.
  - Owner package: `@cline/shared`
  - Verify: privacy / forbidden-key tests
  - Done when: schema forbids utterance fields.

## Risks

- Fatigue if every archive invites. Mitigation: S3 + completion gate only.
- Confusing with improve loop. Mitigation: positive copy; distinct from stall/diagnose proposals.
