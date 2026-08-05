# adlc-drive-factory · Initiative index

**Status:** active (plan)
**ADR:** [ADR-0028](../../adr/ADR-0028-adlc-control-plane.md) (Proposed)
**Related delivery:** [defaults-delivery.md](../../delivery/defaults-delivery.md)
(B2/B3 on-ramps) · [enforced-authority](../enforced-authority/) (D1 / E2 ceiling)
· [task-satisfaction-observability](../task-satisfaction-observability/) (traces)
· [driveplan-agent-runtime](../driveplan-agent-runtime/) (receipt atom)
**External brief:** [Cloudflare ADLC](https://blog.cloudflare.com/agent-development-lifecycle/)

Drive Mode already has the factory parts. This initiative names the control
plane, closes first-use gaps, and wires two missing links (Status→Drive push,
task+receipt as the ship atom) without a second runtime.

| File | What |
|---|---|
| [overview.md](overview.md) | Context, alternatives, phase order, verification |
| [phase-1-framing.md](phase-1-framing.md) | ADR-0028 + nest pointers |
| [phase-2-credential-onboarding.md](phase-2-credential-onboarding.md) | Dismissible hub credential path (B3) — **landed** |
| [phase-3-tts-first-call.md](phase-3-tts-first-call.md) | First-call TTS enable (B2) |
| [phase-4-facet-hub-persist.md](phase-4-facet-hub-persist.md) | Voice facets via `drive_config_put` |
| [phase-5-status-drive-bridge.md](phase-5-status-drive-bridge.md) | `critical` / `failed` → stall offer |
| [phase-6-traces-as-product.md](phase-6-traces-as-product.md) | Session evidence drill |
| [phase-7-receipt-ship-atom.md](phase-7-receipt-ship-atom.md) | Bind run + receipt on complete |
| [testing.md](testing.md) | Static + runtime gates across phases |
