# DEC · Codebase-map firewall

**Status.** Proposed (2026-08-08)  
**Deciders.** Drivecode SE lead (draft)  
**Aligns with.** [ADR-0025](../adr/ADR-0025-enforced-authority.md),
[ADR-0002](../adr/ADR-0002-agent-graph-canonical-derived.md),
[ADR-0004](../adr/ADR-0004-gated-learn-privacy.md), nest `AGENTS.md`
(codebase-map is explain/showcase only).

## Context

Platform **codebase-map** (graphify-backed skill / shared package) explains and
showcases structure. Skills and agents repeatedly try to write agent portfolio
knowledge or Status Hub task deps from map output. That crosses authority and
privacy planes.

## Decision

1. **Codebase-map is read-explain only.** It may produce diagrams, narratives,
   and showcase artifacts for humans. It must **not** write:
   - `.driveagent/**/knowledge/` canonical YAML or derived graphs
   - Status Hub subjects / task dependency edges as product SoT
   - Bank / DriveTask / DrivePlan mutations
2. **No silent side channel.** Map tools that can write FS or call
   `status.publish` / bank ops fail closed unless an explicit, separate
   Accepted path says otherwise (none today).
3. **Portfolio knowledge stays behind ADR-0004.** Propose→accept only; map
   output is not evidence for auto-learn.
4. **Status deps stay behind Status Hub + product features** (e.g. dependency
   map initiative) — not codebase-map.
5. **CI / skill wording.** Skill frontmatter and nest `AGENTS.md` state this
   firewall; violations are defects (ADR-0025 spirit: declared limit needs a
   refusal path — here, refuse the write).

## Non-goals

- Banning codebase-map as an explain tool.
- Replacing Status Hub dependency visualization.

## Open

1. Whether a future “import map → propose knowledge nodes” flow is allowed as
   an explicit gated tool (would need ADR-0004 UI) — default **no** until
   specified.
