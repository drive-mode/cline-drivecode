# 27 · Agent compute substrate — `@cloudflare/computer` against a self-hosted beta

**Date:** 2026-08-04 · **Status:** analysis, no decision
**Scope:** Cloudflare's agent runtime, evaluated as a possible execution
substrate for Drive agents.
**Companions:** [ADR-0016](../adr/ADR-0016-distribution-and-positioning.md)
(public **self-hosted** beta), [ADR-0021](../adr/ADR-0021-drive-credential-onboarding.md)
(credential findings), [ADR-0009](../adr/ADR-0009-runtime-topology-local-cloud.md)
(deployment profile and egress ceiling),
[ADR-0018](../adr/ADR-0018-agent-runtime-contract.md) (`WorkLease`, isolation
class), [ADR-0024](../adr/ADR-0024-drive-web-runtime.md) (host conformance),
[hosted-preview](../initiatives/hosted-preview/README.md) (the four tiers).

## Why this document exists

Cloudflare shipped `@cloudflare/computer`, pitched as: *agents need more than a
container to scale — an agent runtime that dynamically orchestrates between
fast, efficient isolates and full Linux containers to give every agent a
computer of its own.*

Drive runs agents. The pitch lands directly on a question Drive has open —
where agent work executes — so it deserves a real evaluation rather than a
reflex in either direction.

## Thesis

**The technology is a good fit for a product Drive has explicitly decided not to
be. The narrow version that fits the product Drive *is* needs one new enum value,
not a platform.**

## What it actually is

Characterised from the [announcement](https://blog.cloudflare.com/cloudflare-computer/)
and the [`cloudflare/computer`](https://github.com/cloudflare/computer) README.
Stated plainly because the pitch and the maturity are far apart:

> **PREVIEW ONLY.** "APIs are unstable and the design is subject to change …
> NOT suitable for production use at this time." MIT licensed.

Architecture:

- A `Workspace` lives in a **Durable Object**; authoritative state is **SQLite**.
- One execution entry point: `workspace.runtime.exec(source, { backend })`.
- Three backends:
  - **Container** — the SQLite filesystem projected into a sandbox as a **FUSE
    mount**, full Linux userland (npm, native binaries, test runners).
  - **Isolate shell** — `just-bash` translating shell to JS in a Dynamic Worker,
    reaching the authoritative workspace over Workers RPC.
  - **Isolate JS** — an ES module in a fresh Dynamic Worker, with
    workspace-backed `node:fs/promises` and trusted modules `ws:git` /
    `ws:artifacts`.
- Backend selection is **not** a scheduler. It is steered by tool descriptions —
  the container tool advertises itself as for work needing "more than file
  manipulation" — on the stated bet that frontier models choose correctly, with
  a design target of a container being needed for **under 10%** of work.
- `createAITools()` exposes read / write / edit / ls / exec. It composes with
  `@cloudflare/think`.
- Operations are "gated, audited and observed".

One reported performance characteristic worth carrying: the FUSE mount "beats
real disk on metadata-heavy work and trails it on large sequential I/O."

## What Drive has today

**No Workers, Durable Objects, or Containers compute.** Cloudflare appears in
three unrelated places:

| Use | Location |
|---|---|
| Workers AI as an LLM provider | `sdk/packages/llms/src/providers/providers.generated.ts:425-436` (generated from models.dev) |
| R2 as an S3-compatible blob endpoint | `sdk/packages/shared/src/remote-config/blob-storage.ts:226` |
| Pages hosting for `drivemode.ai` | [`drive-mode/site`](https://github.com/drive-mode/site), manual `wrangler pages deploy` |

None of these is compute. Adopting `@cloudflare/computer` would be new
infrastructure, not an extension of something running.

## The collision

This is the part that decides the document.

"Give every agent a computer of its own" means hosting agent execution. In
[hosted-preview](../initiatives/hosted-preview/README.md)'s tier table that is
**Tier 4**, and the initiative is unambiguous:

> Tier 4 is out of scope for this plan and would need ADR-0016 superseded, not
> extended.

[ADR-0000](../adr/ADR-0000-status-board.md)'s status board is blunter, listing it
under decisions that are *closed*, not open:

> Hosted beta → **Rejected** for the MVP: the beta is public but **self-hosted**.
> A hosted hub would require multi-human rooms and a hosted-hub initiative, both
> explicit non-goals today.

And Tier 4 inherits [ADR-0021](../adr/ADR-0021-drive-credential-onboarding.md):
the provider catalog broadcasts **plaintext API keys** to connected peers, and
`roomSecret` rides in the **URL query string** — "tolerable on `127.0.0.1` …
not tolerable when the socket is someone else's browser and the keys are someone
else's money."

So the maximal reading of this technology is blocked three times over: by an
accepted positioning decision, by unfixed credential handling, and by the
vendor's own "not suitable for production."

## The narrow version that is not blocked

Strip the hosting story and something genuinely useful remains, because Drive
already has the seam.

[ADR-0018](../adr/ADR-0018-agent-runtime-contract.md) put an **isolation class**
on every unit of run work, and it is shipped:

```ts
// sdk/packages/shared/src/drive/run.ts:18-22
export const DriveRunIsolationSchema = z.enum([
	"workspace_shared",
	"worktree_isolated",
	"readonly",
]);
```

A Cloudflare-backed sandbox is a **fourth value** in that enum — say
`remote_sandboxed` — reached only through the same `WorkLease` boundary
everything else goes through. Agents already receive "a typed mission packet
only — never the whole bank, raw room history, other agents' private context, or
a broad Hub bearer" (ADR-0018 §3). Nothing about that changes.

Under that framing the constraints are already written:

- **[ADR-0009](../adr/ADR-0009-runtime-topology-local-cloud.md)** — remote
  execution is `cloud`-profile only. `local` is airgap and must refuse it;
  `hybrid` needs an explicit `runtime.egressCeiling`. `assertTopologyLegal` is
  pure and already the place this fails closed.
- **BYO account.** The user's Cloudflare account, their spend, their audit trail.
  This keeps ADR-0016 intact: still self-hosted, just self-hosted somewhere else.
- **[ADR-0024](../adr/ADR-0024-drive-web-runtime.md)** — "a host that passes the
  same suite as the daemon is a second implementation of a contract; one that
  does not is a mock, and mocks drift." A remote backend that does not pass
  `runHostConformance` should not ship.

That is a bounded, opt-in change to one enum and one execution path. It is not
what the announcement is selling, and it is the only version compatible with the
decisions already on the board.

## Recommendation

**Do not adopt now. Re-evaluate when it leaves preview.** Concretely:

1. Nothing should depend on unstable preview APIs while the beta is pre-1.0.
2. If remote isolation becomes a real requirement first, the `WorkLease`
   isolation-class seam is the design — and it is worth noting the same seam
   admits E2B, Firecracker, or a plain remote worktree. Committing to the seam
   costs nothing and commits to no vendor.
3. Any move toward Tier 4 must start by superseding ADR-0016 and closing
   ADR-0021's credential findings. In that order. The compute substrate is not
   the hard part of hosting Drive; the credentials are.

## Where this document is weak

- It evaluates the *fit*, not the technology. No prototype was built and no
  benchmark run, so claims about isolate-versus-container performance are
  Cloudflare's, repeated, not verified here.
- It assumes ADR-0016 holds. That is a positioning decision with a stated
  revisit point ("revisitable after the beta"), and if it flips, most of this
  document's force goes with it.
- The "frontier models choose the right backend" premise is load-bearing for the
  product and is untested here. If that bet is wrong, the runtime's central
  claim degrades to "a container with extra steps" — but nothing in this
  document establishes that either way.
