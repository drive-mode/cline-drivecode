# ADR Planner

Private Milestone 1–4 development package for the ADR Planner initiative. It
provides explicit pre-plan and plan commands, a bundled Cline skill, and pure
schema/graph/routing/readiness validation. The M2 proof adds explicit,
Git-visible, allowlisted repository-metadata collection and deterministic
six-dimension profiling without returning raw source.

The M3 private proof adds a source-backed 12-concern nucleus, strong
three-valued applicability rules, explicit ADR significance filtering,
prerequisite validation, urgency propagation, and stable topological ordering.
The model-facing concern tool accepts no caller facts or policy.

M4 registers `/adr-attest` and `adr_planner_compile_workflow` through a
host-mediated boundary. The CLI command host stamps session and actor context,
applies bounded mutation requests with compare-and-swap and replay protection,
and persists them under a host-derived plugin installation identity. The
separate runtime plugin load discards caller-created state and injects a fresh
snapshot immediately before tool execution.

This boundary protects against model/tool-input forgery and accidental
cross-session sharing. Installed plugin code remains trusted policy code; the
SQLite file is not a security sandbox against malicious same-user plugins, and
serialized `authority` labels are not standalone proof. Artifact signing,
authenticated organization principals, connector-specific assurance, and
host-owned confirmation UI remain later hardening work.

The package is not published and is not yet pinned by `qh2-template`.
ADR-0037 remains Proposed until the package path, coordinate, and registry
authority are accepted.

## Development

```sh
bun -F @cline/adr-planner typecheck
bun -F @cline/adr-planner test
cline plugin install ./plugins/adr-planner --cwd /path/to/fixture
```

The plugin does not scan during setup or in the background, accept arbitrary
paths, return source text, write planning artifacts, access the network, accept
ADRs or risk, authorize deployment, or run hooks. Repository collection occurs
only through explicit tools and fails closed without host workspace context or
Git visibility. The model-facing readiness tool can diagnose caller-authored
artifacts but is forced to `blocked`; it cannot emit a passing verdict.
Controlled planning-session state is persisted by the host, not by plugin code,
and is scoped to workspace, core session, plugin installation, and state key.
