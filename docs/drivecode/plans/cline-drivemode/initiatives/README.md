# Initiatives

Multi-file delivery plans for Drive product work. Single-feature specs stay in
[`../features/DRV-*.md`](../features/). Each initiative folder needs a `README.md`
with purpose, linked DRV ids, and status (`active` | `reference` | `done`).

| Slug | Status | Primary DRV |
|---|---|---|
| [status-dependency-graph](status-dependency-graph/) | active (UX locked) | [DRV-DEP-MAP](../features/DRV-DEP-MAP.md) |
| [show-backlog-director](show-backlog-director/) | reference (slices on main) | [DRV-SHOW-BACKLOG](../features/DRV-SHOW-BACKLOG.md) |
| [share-and-router](share-and-router/) | reference | [DRV-DEMO-SHARE](../features/DRV-DEMO-SHARE.md), [DRV-AGENT-ROUTER](../features/DRV-AGENT-ROUTER.md) |
| [task-bank-drive-loop](task-bank-drive-loop/) | reference (partial) | [DRV-TASK-BANK](../features/DRV-TASK-BANK.md) |
| [task-satisfaction-observability](task-satisfaction-observability/) | active | [DRV-CALL-SESSION](../features/DRV-CALL-SESSION.md), [DRV-TASK-METRICS](../features/DRV-TASK-METRICS.md), [DRV-PLAN-IMPROVE](../features/DRV-PLAN-IMPROVE.md) |
| [session-satisfaction-moments](session-satisfaction-moments/) | active | [DRV-STUCK-RECOVERY](../features/DRV-STUCK-RECOVERY.md) … [visual plan](session-satisfaction-moments/visual-plan.md) |
| [adlc-drive-factory](adlc-drive-factory/) | active (plan) | [ADR-0028](../adr/ADR-0028-adlc-control-plane.md) — ADLC control plane over existing Drive planes |
| [share-screen-canvas](share-screen-canvas/) | reference | [DRV-SHARE](../features/DRV-SHARE.md), [DRV-STAGE](../features/DRV-STAGE.md) |
| [ux-quality](ux-quality/) | active (plan) | Web + mobile UX backlog over [drive-web](drive-web/), [hosted-preview](hosted-preview/), [00-vision](../foundation/00-vision.md) |
| [mobile-consumer](mobile-consumer/) | active (plan) | Phone-first Drive app for less-technical users — PWA before native; hosted ADR fork explicit |
| [multi-device](multi-device/) | active | Cross-device feature list + backlog (hub / PWA / iOS / TUI); skill `multi-device-backlog` |
| [drive-hotpath](drive-hotpath/) | active | Room wire hot path — fold checkpoint, delta publish, one stage clock ([ADR-0029](../adr/ADR-0029-room-hotpath-redesign.md)) |
| [portfolio-now](portfolio-now/) | active (bootstrap) | Remaining **Now** work as a DrivePlan — dogfood via Status `?demoPlans=1` |
| [adr-planner](adr-planner/) | active (M1–M4 private proofs) | Pre-plan and plan plugin, benchmark, and [ADR-0046](../adr/ADR-0046-adr-planner-plugin-boundary.md) |
| [cross-session-chat-management](cross-session-chat-management/) | active (production convergence; gate off) | Core-owned chat lifecycle and [ADR-0051](../adr/ADR-0051-cross-session-chat-catalog-authority.md) |
| [integrations-vcs](integrations-vcs/) | active (plan) | VCS + comms as adapters — git substrate, GitHub/GitLab/Entire.io/Cursor Origin capability matrix, Slack-first interrupts, [ADR-0021](../adr/ADR-0021-drive-credential-onboarding.md) credential reuse |
| [drive-desktop](drive-desktop/) | active (landing on PR #42) | Drive Mode inside the upstream Cline desktop app — sidecar bridge, folded room state, labeled demo world, every Drive section |
