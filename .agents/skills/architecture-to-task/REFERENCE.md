# Architecture-to-task reference

## Projection contract

Drive uses distinct artifacts for distinct jobs:

| Artifact | Owns | Must not own |
|---|---|---|
| Claims registry | Delivery status and evidence | Runtime task lease state |
| Drive task bank | Executable work, dependencies, leases, receipts | Architecture decision verdicts |
| ADR board | Human decision status | Feature completion |
| Portfolio initiative | Dependency order and acceptance narrative | Independent status |
| Diagram source | Explanatory graph and review lenses | Hidden product state |
| Status Hub map | Read-only delivery projection | DriveTask execution state or inferred IDs |

The production destination is a host-mediated annotation contract that links
stable claim references to explicitly accepted bank tasks. Until that wire
exists, an explicit demo fixture may project delivery state only when it is
generated from the machine-readable project map and claims registry and CI
refuses claim-ID, status, membership, and dependency drift.

## Status delivery projection

| Claim status | Status-map node projection |
|---|---|
| `verified_shipped` | `completed` |
| `active_partial` | `in_progress` |
| `planned` | `pending` |
| `scaffold` | `pending` |
| `blocked` | `blocked` |

This table does **not** map to `DriveTask.status`; bank tasks have an independent
execution lifecycle. `unknown` is a discovery result, not a claim status.
Resolve it or keep the candidate outside any writable proposal.

## Golden-path identity example

| Project step | Stable identity | Hard dependencies |
|---|---|---|
| GP0 Protocol foundation | `drv-golden-path-contract` | — |
| GP1 Trusted host | `drv-host-trust` | GP0 |
| GP2 Target registry | `drv-target-resolution` | GP0, GP1 |
| GP3 Managed chat | `drv-managed-chat` | GP2 |
| GP4 iOS binding | `drv-ios-managed-chat` | GP3 |
| GP5 Durable resume | `drv-return-loop` | GP3, GP4 |
| GP6 Remote call | `drv-remote-call-binding` | GP4, GP5 |
| GP7 Presenter | `drv-presenter-native` | GP6 |
| GP8 Conformance | `drv-cross-repo-conformance` | GP1–GP5 |
| GP9 Release services | `drv-release-services` | GP8 |

This table is illustrative of identity and dependency compilation. Canonical
status must always be read from the claims registry at execution time.

## Design lineage

The compiler approach follows patterns already proven in Harrison Halperin's
published work:

- [Diagram Generator](https://harrisonhalperin.com/work/diagram-generator):
  normalized source of truth, deterministic render, geometry validation.
- [Diagram-First](https://harrisonhalperin.com/work/diagram-first):
  schema-validated specs, render gate, cold-read claim review.
- [Clear Diagrams](https://harrisonhalperin.com/work/clear-diagrams):
  allowlisted evidence, split diagram sources, coverage and path-leak checks.
- [Constellation](https://harrisonhalperin.com/work/constellation): stable
  identity merge, evidence freshness, human confirmation before writes.
- [Terragram](https://harrisonhalperin.com/work/terragram): staged
  architecture-to-policy-to-infrastructure artifacts ending in a PR, not an
  apply.
- [Atlas](https://harrisonhalperin.com/work/atlas) and
  [Tightrope](https://harrisonhalperin.com/work/tightrope): deterministic
  readiness judges separated from agent fixes and merge authority.
