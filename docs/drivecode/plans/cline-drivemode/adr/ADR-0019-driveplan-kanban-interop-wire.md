# ADR-0019: DrivePlan–Kanban Interop wire (`execute` / `collectReceipt`)

## Status

Accepted

## Metadata

- Date: 2026-08-03
- Accepted: 2026-08-03 (Drivecode planning — host wire track)
- Deciders: Drivecode planning (cline-drivemode)
- Related: ADR-0018, ADR-0016, ADR-0008, initiative driveplan-agent-runtime

## Context

[ADR-0018](ADR-0018-agent-runtime-contract.md) shipped the read-only projection stub (`getCapabilities` / `applyProjection` / `observe`) and Agent Control propose helpers. DriveKanban already keeps `externalRef` and disables auto-review for managed cards. What remained reserved was the **lease-scoped command + receipt** half of the interop protocol: agents must not treat Kanban UI actions as bank authority, and hosts must not invent ad-hoc execute paths outside a named capability.

## Decision

### 1. Capability surface

`KanbanInteropCapabilities` version stays `0` until a breaking change. Supported ops:

| Op | Role |
|---|---|
| `getCapabilities` | Advertise supports / deferred |
| `applyProjection` | One DriveRun → managed card descriptors |
| `observe` | Run-side status + host-supplied `projectionDiverged` |
| `execute` | Lease-scoped allowed command on the Kanban/worktree host |
| `collectReceipt` | Gather verifier evidence refs for a lease → Receipt draft |

### 2. Host port

`@cline/drive` stays pure. `execute` / `collectReceipt` require a `KanbanInteropHost`:

- `executeAllowedCommand({ lease, command, args })` — host enforces `lease.allowedActions` and workspace fingerprint.
- `collectReceiptEvidence({ lease })` — host returns evidence refs (paths, SHAs, test summary ids); never raw transcripts.

Kernel helpers validate lease ↔ run identity and assemble a `Receipt` draft with `decision: "accepted"` only when evidence is non-empty; human/verifier may still reject at bank complete.

### 3. Authority split (unchanged from ADR-0018)

- Kanban Done / trash never archives a `DriveTask`.
- Seed scripts are not product interop.
- Wave `DriveWorkItem` ≠ `DriveRunWorkItem`.

## Consequences

**Positive:** Named execute/receipt path; capability negotiation can grow without silent host forks.

**Negative:** DriveKanban and hub must implement `KanbanInteropHost` (or refuse with a clear error) before agents can rely on execute.

**Follow-on:** Hub command wrappers for execute/collect; live `projectionDiverged` when humans edit managed cards; capability version bump when command vocabulary freezes.

## Alternatives considered

- **Hang execute on DriveHostPort.** Rejected — host port has no bank/lease methods.
- **Kanban as scheduler of record.** Rejected — ADR-0018.
- **Leave execute forever deferred.** Rejected — blocks managed execution integration.

## References

- [ADR-0018](ADR-0018-agent-runtime-contract.md)
- [initiative README](../initiatives/driveplan-agent-runtime/README.md)
- `@cline/drive` `kanbanInterop.ts`
