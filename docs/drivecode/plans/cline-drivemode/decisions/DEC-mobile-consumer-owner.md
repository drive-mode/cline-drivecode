# DEC · Mobile consumer owner defaults (2026-08-07)

**Status.** Accepted  
**Date.** 2026-08-07 (amended same day — hosted economics); slice id rename 2026-08-08  
**Deciders.** Harrison (owner)  
**Aligns with.** [ADR-0016](../adr/ADR-0016-distribution-and-positioning.md) (path H
amendment), [ADR-0021](../adr/ADR-0021-drive-credential-onboarding.md),
[mobile-consumer](../initiatives/mobile-consumer/),
[ADR-0029](../adr/ADR-0029-room-hotpath-redesign.md) **H5**

## Context

[mobile-consumer](../initiatives/mobile-consumer/) listed five open owner
questions that blocked teaching chips, PWA naming, install sequencing, hosted
phone turns, and hosted-turn economics. Harrison answered path H / voice /
brand / MC3 first; freemium vs BYOK closed as **Cline default** the same day.

## Decision

1. **Hosted consumer path (path H)** — **Yes.** Amend ADR-0016 so a hosted
   single-writer hub (same Drive wire) is an accepted product path for phone /
   PWA real turns. Self-hosted Route B beta remains valid. Multi-human rooms
   stay a non-goal. Engineering track: [ADR-0029](../adr/ADR-0029-room-hotpath-redesign.md)
   **H5**. Credential story still
   [ADR-0021](../adr/ADR-0021-drive-credential-onboarding.md).
2. **Voice default** — **Mic muted on join.** The strip Mute/Unmute control is
   the **Enable microphone** toggle (unmute = enable). Hold-to-talk teaching
   assumes muted start; do not ship hot-mic-from-beat-one as the consumer
   default. (Hub already seeds `muted: true` in `drive/types.ts`.)
3. **Home-screen / PWA display name** — **“Cline Drive”** (not “Drive” alone).
   Manifest `name` / `short_name` and splash copy use this when MC3 lands.
4. **MC3 (PWA) on the Now roadmap** — **Yes.** Install habit is not optional
   phase-8 polish; keep PWA install on the consumer Now sequencer.
5. **Hosted-turn economics** — **Cline default (freemium).** Hosted real turns
   use **Sign in with Cline** / account credits as the primary path; **BYOK is
   secondary** (same posture as [ADR-0021](../adr/ADR-0021-drive-credential-onboarding.md)
   §2). Do not ship BYOK-only as the consumer first-run for path H. Do **not**
   invent Drive-owned plan/pricing chrome — credit balance and upgrade stay on
   Cline account surfaces; Drive keeps readiness + spend honesty when a session
   has credentials.

## Sequencing (not economics)

Next build remains finish MC1 call verbs (hold-to-talk + strip). ADR-0029 **H5**
is **unblocked** by path H but stays **after** those unless a hosted real-turn
demo forces it earlier.

## Consequences

**Positive**

- Path H unblocks cloud signaling design without pretending the self-hosted
  beta already is a mass-market runtime.
- Privacy-safe voice default matches DRV-MIC / spotlight S4.
- One install brand string for MC3.
- Hosted turns share Cline’s existing account / freemium story; BYOK stays for
  power users without a second vault.

**Negative**

- Hosted path creates ops/credential work (ADR-0021) before “just open the app
  and build” is honest.
- Freemium depends on Cline account product; Drive must not fake plan UI when
  balance or entitlement is missing — Preview / readiness honesty instead.

## References

- Owner answers recorded against
  [mobile-consumer open decisions](../initiatives/mobile-consumer/README.md)
- Mark / motion still [DEC-drive-mark-official](DEC-drive-mark-official.md);
  this DEC only names the **product string** on the home screen
