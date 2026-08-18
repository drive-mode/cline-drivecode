# ADR-0030 · Plane naming for agent-facing code

**Status:** Proposed (2026-08-08) — docs-first; code moves when a PR already touches the file  
**Owner:** Drivecode SE lead  
**Constrained by:** [ADR-0028](ADR-0028-adlc-control-plane.md) (no second workflow runtime),
[ADR-0013](ADR-0013-state-partition.md) (hub single writer), Architecture D1–D6.  
**Evidence:** arena synthesis (domain nouns, no `*Engine`); nest `AGENTS.md` collisions.

## Context

Agents invent parallel trees (`engines/`, `WorkflowEngine`, `DirectorEngine`)
because ownership nouns are overloaded: Stage / Show / Spotlight / StickyStage;
Director / Producer / Projector; Runtime; Status. Informal `visualEngine.ts`
names a layout helper as if it were a peer plane. ADR-0028 already forbids a
second workflow runtime; this record names the **folder grammar** so placement
answers are mechanical.

## Decision

1. **Collaboration planes are folder nouns**, same names across `@cline/drive`,
   `@cline/core` hub, and hub UI: `room/` · `show/` · `status/`.
2. **Supporting planes (not peers of the three):** `stage/` = room projection of
   shared work; `visual/` = client layout adaptation ([ADR-0031](ADR-0031-visual-layout.md));
   `turn/` lives in `@cline/agents` (not a Drive plane peer).
3. **Verb = file** inside a plane (`present.ts`, `materialize.ts`,
   `projectTool.ts`, `layout.ts`). Do not promote verbs to plane folders.
4. **Banned as ownership / folder nouns:** Engine, WorkflowEngine,
   OrchestrationEngine, Producer, Projector; **Director** as a plane (it is
   signed host orchestration policy, not a folder peer); **Spotlight** as a code
   folder (UI label → `stage/` / `show/`); **Runtime** as a Drive plane (session
   runtime stays `@cline/core`). A `Presenter` is a temporary Agent Title and
   likewise does not create a plane.
5. **Closed noun set.** Adding a new top-level plane noun requires a new ADR
   (or amend this one). Synonym redirects live in nest + sdk `AGENTS.md`.
6. **Docs matrix (LAYER × PLANE)** may teach placement (contract / kernel / hub /
   ui) without renaming packages.

## Non-goals

- Big-bang rename of the tree.
- Top-level `engines/` package.
- Affordance registry as the placement oracle.

## Open

1. Whether `stage/` stays under `room/` or remains a sibling folder in apps.
2. Exact redirect table wording in sdk `AGENTS.md` (ship with first rename PR).

## Alternatives rejected

- `*Engine` product nouns — agents treat them as peer systems.
- Affordance JSON registry as day-one navigation — useful later as a check.
- Dual-axis `kernel/show` package language — folders stay plane nouns.
