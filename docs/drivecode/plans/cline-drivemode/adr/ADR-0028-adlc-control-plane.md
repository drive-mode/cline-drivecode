# ADR-0028 · Drive Mode is the ADLC control plane

**Status:** Accepted (2026-08-08) — binding control-plane framing  
**Impl:** decision — sequences existing planes; no second workflow runtime
**Owner:** Drivecode SE lead
**Supersedes:** nothing.
**Constrained by:** [ADR-0007](ADR-0007-drive-as-cline-mode.md) (Drive as Cline mode),
[ADR-0015](ADR-0015-task-session-observability.md) (local traces),
[ADR-0018](ADR-0018-agent-runtime-contract.md) (task → run → receipt),
[ADR-0021](ADR-0021-drive-credential-onboarding.md) (credentialed first call),
[ADR-0023](ADR-0023-agent-spawn-governance.md) / [ADR-0025](ADR-0025-enforced-authority.md)
(permissioned spawn), [ADR-0016](ADR-0016-distribution-and-positioning.md)
(self-hosted beta).
**Implements:** initiative [adlc-drive-factory](../initiatives/adlc-drive-factory/).

## Context

Cloudflare’s [Agent Development Lifecycle](https://blog.cloudflare.com/agent-development-lifecycle/)
argues that cheap implementation flooded the rest of the SDLC with slop, and that
the fix is to let agents own more of Plan → Maintain on a platform built for
them: programmatic, push-based, atomic, permissioned, and self-improving.

Drive Mode already owns most of that surface under other names (room, bank,
gates, Status Hub, stall recovery, session rollups, DriveRun receipts). What is
missing is an explicit control-plane decision. Without it, ADLC work risks
arriving as a second workflow engine, a Cloudflare stack port, or a parallel
backlog beside [defaults-delivery.md](../delivery/defaults-delivery.md) and
[enforced-authority](../initiatives/enforced-authority/).

## Decision

1. **Drive Mode is the ADLC control plane for this fork.** The human joins a
   call. The room runs the factory loop. Humans appear at judgment gates
   (approve, steer, accept plan-improve), not as babysitters of every step.
2. **No second workflow runtime.** Orchestration stays on hub ops + existing
   ChatFork / wave / bank / stall paths. Do not add a Cloudflare Workflows-shaped
   package or a second event bus.
3. **Map the seven factory properties onto existing planes** rather than new
   products:

| Property | Drive plane |
|---|---|
| Programmatic | `HubCommandName` + tools; every ClickOps path earns a hub/API twin |
| Horizontally scalable | Isolation before `teamOpt`; one partner until then |
| Reproducible | Room + bank JSONL folds; local traces match in-call view |
| Real-time push | `room.event`, status `seq`, stall auto-offer; Status→Drive bridge |
| Atomic | `DriveTask` + accepted `Receipt` (ADR-0018) |
| Permissioned | Gates + `capPreset` enforcement (ADR-0023 / 0025) before Agents UI |
| Self-improving | Session rollup → stall / plan-improve (ADR-0015); gated only |

4. **First-use on-ramps are ADLC work.** A factory nobody can start is not a
   factory. Credential onboarding (ADR-0021) and first-call TTS enable land in
   this track’s early phases.
5. **Status Hub push to humans is not enough.** `high` / `critical` →
   `ui.notify` stays. When Drive is active, selected Status failures also feed
   the Drive stall / bank spine (offer, not silent auto-execute).

## Consequences

- Product copy and demo framing may say “ADLC control plane” without inventing
  a separate app name. Drive remains a Cline mode (ADR-0007).
- [defaults-delivery](../delivery/defaults-delivery.md) B2/B3 and
  [enforced-authority](../initiatives/enforced-authority/) E2 remain the owners
  of their slices. This ADR sequences them under one factory outcome; it does
  not fork those plans.
- Auto-merge to production remotes stays out of scope. Permissioned escalation
  through gates is the trust pattern we borrow from ADLC, not unsupervised ship.

## Non-goals

- Porting `@cloudflare/ci`, Workers Workflows, or Flagship gradual deploy.
- WebRTC / multi-human media.
- Agents / Teams spawn UI before D1 / E2 enforcement.
- Unifying Status Hub and Drive bank into one store.
