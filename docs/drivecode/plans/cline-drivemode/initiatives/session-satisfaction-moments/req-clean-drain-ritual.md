# Requirements · Clean-drain ritual

**DRV:** [DRV-CLEAN-DRAIN](../../features/DRV-CLEAN-DRAIN.md)  
**Related:** PRD 10 S3/E1, DRV-NOWNEXT, DRV-NARRATION, DRV-SHOW-BACKLOG plan card

## Problem

E1 (post-success continue) is the preferred engagement proxy but has no product moment. NowNext collapsing on archive can feel like failure.

## User job

When my plan finishes cleanly, I am acknowledged and gently invited to set the next goal — without pressure.

## Triggers

1. Plan archives with **S3 true** (no additive mid-plan task ids vs activate snapshot).
2. Same session has ≥1 task completed.
3. Non-triggers: churny archive, zero completions, leave without drain.

## Surfaces (pick one primary in implementation)

| Surface | Role |
|---|---|
| Narration | One-liner: finished `{plan.title}` + soft ask |
| NowNext successor | Brief “done → what’s next?” instead of hard hide |
| Spotlight plan card | Short complete card then fade |
| PlanEditor / composer | Idle “What’s next?” affordance |

## Copy principles

- Light: one line + optional single CTA
- No metric jargon, no NPS
- Invite, don’t demand; leave is valid
- Distinct from stall/diagnose proposals

## Acceptance criteria

1. Verified S3 + ≥1 completion → single acknowledgment in one interaction cycle.
2. Affordance exists to start E1 (new plan / title refresh / first tasks) without forcing accept.
3. Does not fire on non-S3 archive or zero-completion sessions.
4. Dismissible; does not block leave/end.
5. Ritual invite alone does **not** set E1 true — only user continue does.
6. Privacy: plan/task ids only if logged.

## Dependencies

- Honest S3 (Obs slice 1–2)
- NowNext / narration / optional Show plan card

## Risks

- Fatigue if every archive invites
- Confusing with improve loop
- Tiny-task gaming of S3 — prefer quality acknowledgment, not rate chasing

## Open questions

1. Primary home: narration vs NowNext vs Spotlight?
2. Prefer new plan activate vs title refresh (E1 vs E2)?
3. Mid-call vs only on End?
