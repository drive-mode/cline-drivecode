# Drivecode PRDs (cline-drivemode)

Product requirements for Drivecode features that sit on top of the existing drivemode plan set. Numbered for stable cross-reference from ADRs and feature specs.

| # | File | Focus |
|---|------|--------|
| PRD 6 | [prd-driveagent-portfolio.md](prd-driveagent-portfolio.md) | `.driveagent/` homes, per-agent knowledge graphs, recruit-into-call |
| PRD 7 | [prd-pip-partner.md](prd-pip-partner.md) | PiP Partner companion |
| PRD 8 | [prd-drive-as-cline-mode.md](prd-drive-as-cline-mode.md) | Drive as a Cline mode |
| PRD 9 | [prd-task-bank-drive-loop.md](prd-task-bank-drive-loop.md) | Task bank; plans sequence tasks |
| — | [prd-success-metrics.md](prd-success-metrics.md) | Phase gates / privacy CI (not session satisfaction) |
| PRD 10 | [prd-task-satisfaction-observability.md](prd-task-satisfaction-observability.md) | Task-centric session satisfaction + closed-loop improve |
| PRD 11 | [prd-magic-hotkey.md](prd-magic-hotkey.md) | Magic Hotkey — next-action prediction with a DO / SKIP / UNDO triad |

Related plan docs: [06-platform-config.md](../foundation/06-platform-config.md), [05-workflows.md](../foundation/05-workflows.md), [../README.md](../README.md).  
Session satisfaction research: [../research/15-task-satisfaction-observability.md](../research/15-task-satisfaction-observability.md), [../research/16-task-as-unit-models.md](../research/16-task-as-unit-models.md).  
Next-action prediction research: [../research/21-operator-experience.md](../research/21-operator-experience.md), [../research/29-large-task-models.md](../research/29-large-task-models.md).

Example agent home: [../examples/driveagent-pair-partner/](../examples/driveagent-pair-partner/).

**ADR** here means Architecture Decision Record (same role as ADR in cursor-drive / harrison-site). See [../adr/](../adr/).

## Lessons imported from `briefs`

The BRIEF.md work informs this area without replacing it:

| BRIEF primitive | Driveagent portfolio analog |
|---|---|
| Three-standard stack (AGENTS / SKILL / BRIEF) | Behavior / capability tools / **portfolio graph + home** |
| Canonical vs `latest/` derived | YAML knowledge source vs compiled `graph.json` |
| Graduated read modes | Retrieve a *slice* of the graph into a turn, not the whole DB |
| Subagent file scoping | Recruit + seat with bound definition + scoped graph context |
| Audit expected vs actual | Log which graph nodes were injected into a turn |
| Lifecycle privacy | No transcript dump into knowledge; gated propose/accept |
| Scope discipline | BRIEF stayed context-only; Driveagent graph stays portfolio/recruit, not a second prompt store |
