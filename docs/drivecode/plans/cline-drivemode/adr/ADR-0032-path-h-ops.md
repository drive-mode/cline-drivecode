# ADR-0032 · Path H hosted writer operations

**Status:** Proposed (2026-08-08)  
**Owner:** Drivecode SE lead / PM  
**Constrained by:** [ADR-0016](ADR-0016-distribution-and-positioning.md) (path H),
[DEC-mobile-consumer-owner](../decisions/DEC-mobile-consumer-owner.md),
[ADR-0021](ADR-0021-drive-credential-onboarding.md),
[ADR-0029](ADR-0029-room-hotpath-redesign.md) H5,
[ADR-0013](ADR-0013-state-partition.md) (single writer, same wire).

## Context

Path H accepts a hosted single-writer that speaks the **same Drive wire**.
Product accepted freemium (Cline Sign-in primary). What is still undefined is
the **ops envelope**: who authenticates, what is stored where, tenancy shape,
and what happens when credits fail. Without this, H5 implementers invent a
second product.

## Decision

1. **Same wire, one writer.** Hosted hub is still the sole room writer;
   clients discover/connect as today. No multi-human rooms. No MCP room bus.
2. **Auth.** Session credentials come from Cline account (device-code / Sign in
   with Cline) per ADR-0021; Drive consumes readiness + entitlement signals,
   never stores provider API keys. BYOK remains secondary.
3. **Tenancy (MVP).** One human operator per hosted room writer instance
   (single-tenant-or-equivalent). Org multi-tenant control plane is out of
   scope until a later ADR.
4. **Data residency.** Room event log + bank stay on the hosted writer’s
   durable store for that workspace; no silent export to analytics by default
   (ADR-0015 local-first spirit). Opt-in export inherits DRV-PRIVACY.
5. **Freemium failure is honest Preview.** When credits/entitlement are missing
   or exhausted: block real turns with a clear readiness/entitlement state;
   do not fake Live; do not invent Drive-owned plan/pricing chrome — deep-link
   to Cline account surfaces.
6. **Support boundary.** Hosted path support is distinct from self-host clone
   support; document which GitHub / account channel owns each.

## Non-goals

- Multi-human hosted rooms.
- Drive-owned billing UI.
- Replacing Route B self-host.

## Open

1. Concrete region / storage vendor for the hosted writer (ops pick, not wire).
2. Whether a workspace may migrate between self-host and path H without
   replaying history (export/import shape).
3. Rate limits / abuse controls for freemium (product + infra).

## Alternatives rejected

- Multi-tenant social rooms as the path H MVP.
- BYOK-only hosted first-run (contradicts DEC-mobile).
- Silent degrade to demo while showing Live.
