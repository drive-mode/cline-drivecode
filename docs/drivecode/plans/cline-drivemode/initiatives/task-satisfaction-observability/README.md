# task-satisfaction-observability · Initiative index

**Status:** active — **slices 1–3 + W4 landed on main (#80)**; residuals in REMAINING
**Living backlog (source of truth for open work):** [delivery/REMAINING-task-satisfaction.md](../../delivery/REMAINING-task-satisfaction.md)
**DRV:** [DRV-CALL-SESSION](../../features/DRV-CALL-SESSION.md) · [DRV-TASK-METRICS](../../features/DRV-TASK-METRICS.md) · [DRV-PLAN-IMPROVE](../../features/DRV-PLAN-IMPROVE.md)
**PRD:** [prd-task-satisfaction-observability](../../prd/prd-task-satisfaction-observability.md) (PRD 10)
**ARD:** [ARD-0015](../../ard/ARD-0015-task-session-observability.md) (Proposed — impl ahead of accept)
**Research:** [15](../../research/15-task-satisfaction-observability.md) · [16](../../research/16-task-as-unit-models.md)
**Depends on:** [task-bank-drive-loop](../task-bank-drive-loop/) (event emit / hub complete — largely landed)

Local, privacy-safe session satisfaction metrics grounded in **tasks**, plus a gated diagnose→improve loop when sessions stall.

**Product moments (UX on the call arc):** [session-satisfaction-moments](../session-satisfaction-moments/) — stuck recovery, felt agency, clean-drain, return loop, Status/digest, recruit-on-stall, SDLC→bank. Visual plan: [visual-plan.md](../session-satisfaction-moments/visual-plan.md).

| File | What |
|---|---|
| [overview.md](overview.md) | Context, architecture diagram, slice list |
| [slice-1-instrumentation.md](slice-1-instrumentation.md) | Call session + bank event spine (**landed**) |
| [slice-2-local-session-rollup.md](slice-2-local-session-rollup.md) | Pure rollups + Status sessions lens (**landed**) |
| [slice-3-diagnose-propose-gate.md](slice-3-diagnose-propose-gate.md) | Stall → planning proposal → accept (**landed**; host skill compile residual) |
