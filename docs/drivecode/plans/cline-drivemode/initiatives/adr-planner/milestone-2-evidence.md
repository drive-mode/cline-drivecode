# ADR Planner Milestone 2 implementation evidence

**Recorded:** 2026-08-14
**Branch:** `feat/adr-planner-milestone-0`
**Package:** `plugins/adr-planner` (`@cline/adr-planner@0.0.0`, private)
**Decision state:** ADR-0036 Accepted; ADR-0037 and ADR-0038 Proposed

## Result

The private M2 proof adds explicit repository evidence collection and a
deterministic six-dimension profiler without broadening the plugin beyond its
commands/tools capability. Collection runs only through
`adr_planner_collect_evidence`; `adr_planner_profile` independently recollects
the same bounded evidence and accepts no caller-authored evidence or
assertions. Neither tool writes, persists, accepts decisions, emits telemetry
evidence, accesses the network, or runs during plugin setup.

This proof does not accept ADR-0038, publish the package, modify `qh2-template`,
or claim that M3 concern generation and M4 complete workflows exist.

## Implemented boundary

| Boundary | Evidence |
|---|---|
| Workspace authority | Plugin setup captures only host-provided `workspaceInfo.rootPath`; missing context blocks collection and never falls back to `process.cwd()`. |
| Visibility | Git lists tracked and unignored paths with standard repository ignore semantics; non-Git, timeout, output overflow, cancellation, and path-count failures block with fixed diagnostics. |
| Candidate policy | No path input exists. A fixed allowlist covers bounded-depth package manifests and presence-only deployment, CI, ownership, policy, license, and language files. |
| Secret/privacy policy | Token-aware secret/private/evaluator path variants, ignored paths, symlinks, non-files, escapes, oversized files, and aggregate budget excess are denied or skipped. |
| Race safety | Package reads bind `lstat` state to an opened no-follow descriptor by device/inode, cap reads at the remaining budget plus one byte, and revalidate identity, size, and modification time after reading. Parent swaps, same-size replacement, and concurrent append fixtures emit no evidence. |
| Content policy | Only bounded `package.json` structural fields and known dependency-key membership are inspected. Names, versions, scripts, field values, workflow bodies, source, docs, environment files, transcripts, Git stderr, and absolute roots are not returned. |
| Provenance | Controlled evidence has deterministic id, repository-relative source, fixed claim, structural locator, and SHA-256 digest when content was read. |
| Interpretation | Pure mapping classifies only direct structural product/runtime signals. Every dependency mapping and license presence becomes unsupported inference, not profile fact. Missing dimensions remain exactly `unknown`. |
| Provenance authority | The model-facing profile tool has an empty strict input and recollects internally. Kernel validation excludes malformed repository derivations, repository-backed human assertions, conflicting duplicate ids, and known-plus-unknown conflicts. Host-attested human evidence is deferred. |

## Verification results

| Verification | Result |
|---|---|
| Plugin typecheck | Passed. |
| Focused plugin suite | 52 passed, 0 failed, 203 assertions across eight files. |
| Privacy canaries | Package names, dependency names/versions, scripts, ignored content, tracked secret files, unrelated source, workflow bodies, symlink targets, oversized/aggregate content, absolute roots, and Git errors were absent from serialized output. |
| Limits | Cancellation, Git timeout, Git output cap, path count, candidate count, per-file bytes, aggregate bytes, invalid paths, non-Git failure, parent swaps, descriptor replacement, and concurrent growth were exercised. |
| Determinism | Analyzer, collection, and profiler each produced byte-identical canonical output across ten replays. |
| Full workspace types | Every workspace typecheck passed, including SDK, Core, CLI, Hub, IDE, Kanban, examples, and ADR Planner. |
| Package archive | Private 21-entry archive passed required-file and evaluator-separation review. |
| Fresh installed sandbox | A brand-new temporary Git project installed through the real Cline CLI; one plugin entry and skill root loaded; two commands and four tools registered. Its non-empty fixture included direct package structure, dependency candidates, presence files, unrelated source, ignored manifests, and tracked secret/evaluator manifests. Collection returned `collected`; repeated output was byte-stable and canary-free; profiling returned only direct CLI/library facts; invalid artifact returned `false`; invalid readiness returned `blocked`. |
| Real repository exercise | On `cline-drivecode`, Git exposed 5,179 paths; the policy selected 45 candidates, read 12 manifests, emitted 59 controlled evidence records, skipped none, and produced no diagnostics. |
| Real repository profile | Direct structure resolved product surfaces to CLI and library. Lifecycle, data trust, runtime topology, scale/reliability, and delivery/governance remained unknown. Nine dependency/license implications remained unsupported inferences. |
| Documentation | Structure and Done-claim checks passed; 25 documentation tests passed; 9,330 links across 649 repository files had no repository-local breakage. The crawler separately reported pre-existing non-fatal external `cline.bot` 404s. |

The existing M1 evidence records wider host Vitest suite failures outside the
ADR Planner package. M2 changed no host source and uses the real CLI plus
sandbox install smoke as its host-path acceptance proof.

## Acceptance commands

```bash
mise exec bun@1.3.13 -- bun -F @cline/adr-planner typecheck
mise exec bun@1.3.13 -- bun -F @cline/adr-planner test
mise exec bun@1.3.13 -- bun run types
mise exec bun@1.3.13 -- bun biome check --diagnostic-level=error plugins/adr-planner .github/workflows/adr-planner-plugin.yml
mise exec bun@1.3.13 -- bun plugins/adr-planner/scripts/verify-package.ts
mise exec bun@1.3.13 -- bun run check:drivecode-docs
mise exec bun@1.3.13 -- bun run test:drivecode-docs
mise exec bun@1.3.13 -- bun run check:links
```

CI additionally creates a fresh Git fixture, installs the local package through
the Cline CLI with Bun as the npm-compatible dependency installer, and runs the
installed sandbox smoke under the production build environment.

## Remaining gates

1. Harrison accepts ADR-0038 or explicitly keeps M2 as a private reversible
   proof while its read/signal policy is evaluated.
2. M0 gold/release decisions and ADR-0037 publication authority remain open.
3. The canonical `qh2-template` source must be recovered or recreated before a
   pinned consumer integration can be verified.
4. M3 must turn evidence/profile outputs into applicable, unknown, and explicit
   not-applicable concern records without weakening this evidence boundary.
