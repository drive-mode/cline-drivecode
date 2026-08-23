# ADR Planner Milestone 4 private-proof evidence

**Verified:** 2026-08-14
**Scope:** reversible host-mediated private proof; production hardening incomplete
**Decision state:** ADR-0046 Accepted; ADR-0047 through ADR-0050 Proposed
**Catalog:** `m3-nucleus.1`
**Workflow policy:** `m4-workflow.1`

## Verdict

The original plugin-local authority design was rejected, then replaced with a
host-owned extension-state boundary. Commands now receive host-created session
and actor context, return bounded mutation requests, and are committed by the
CLI host with compare-and-swap and invocation-replay protection. The runtime
loads a separate plugin sandbox, discards caller-created extension state,
overwrites session identity, and injects a fresh SQLite snapshot.

`/adr-attest` and `adr_planner_compile_workflow` are registered in the private
package. A fresh project-local install compiled a `host-composed` workflow while
the model-facing readiness surface continued to reject a forged passing input.

This is not yet a production authority claim. Installed plugin code is trusted
policy, SQLite does not isolate malicious same-user plugins, serialized labels
are not proof, authenticated connector-principal policy is incomplete, and
third-party mutation consent needs a host-owned declarative grammar or explicit
confirmation UI.

The proof does not accept ADR-0050, persist planning artifacts, promote ordinary
prose into facts, accept ADRs or business risk, waive obligations, ingest
implementation-resolution evidence, authorize deployment, publish the package,
or pin the package in `qh2-template`.

## Implemented proof surface

| Surface | Evidence |
|---|---|
| Command parser | Controlled Boolean parsing, atomic full-snapshot replacement, limits, clear, status, deterministic ordering, and exact argument-to-fact tests. |
| Host session state | SQLite rows are scoped by canonical workspace path, core session id, content-bound plugin installation id, and state key. Revisions use CAS; invocation replay is content-bound. |
| Command provenance | Interactive and connector command surfaces stamp invocation id, source, workspace, session, and actor fields. Missing session or non-human actor fails closed. |
| Separate lifecycle | A real CLI test loads command and tool contributions through separate plugin sandboxes and independent store instances. Resume sees the state; another session remains empty. |
| Model boundary | Compiler input is an empty object. The wrapper removes caller `extensionState`, overwrites caller session id, and injects host state. State-enabled in-process loading is rejected. |
| Installation identity | Persistent namespace is derived from canonical plugin entry path, entry bytes, and display name. Same-name entry replacement does not automatically inherit state. |
| Composition | Host-mediated workflow output is `host-composed`; the public library kernel remains `untrusted-library`. The output label itself is explicitly non-probative. |
| Questions and experiments | Only decisive missing registered Boolean facts become questions; the queue is capped at eight. Experiment-routed concerns emit complete bounded records. |
| Routed work and next wave | Applicable non-ADR routes become unresolved typed outputs. At most three dependency-unblocked concerns enter the next wave. |
| Readiness | Project facts change applicability but cannot resolve an obligation or pass an unresolved blocker. Caller-authored readiness that otherwise passes is forced to `blocked`. |
| Determinism and privacy | Canonical JSON/Markdown omit wall-clock fields, raw briefs, transcripts, actor secrets, and repository source. Ten permutations remain byte-identical. |
| Runtime surface | The package registers 3 commands and 6 tools. Missing host state blocks compilation with `workflow.host_state_unavailable`. |

## Verification ledger

| Verification | Result |
|---|---|
| `bun -F @cline/adr-planner typecheck` | pass |
| `bun -F @cline/adr-planner test` | 85 pass, 0 fail across 12 files after host-mediated consent coverage |
| Shared, core, CLI, and plugin focused typechecks | pass |
| Core SQLite/sandbox/config authority tests | 42 pass, including CAS, replay, scope, fresh injection, caller overwrite, and state-enabled in-process rejection |
| CLI command/two-load and interactive lifecycle tests | 10 pass |
| Fresh project-local install and `smoke-installed.ts` | 3 commands, 6 tools; controlled attestation compiled `host-composed`; forged readiness blocked; privacy checks passed |
| Host SDK rebuild | pass across shared, drive, llms, agents, core, and sdk packages |
| Changed-file Biome check | pass with error diagnostics enabled |
| `bun plugins/adr-planner/scripts/verify-package.ts` | pass; 32-entry private archive excludes benchmark, review, gold, held-out, and test material |
| Drivecode structure and Done checks | pass; 25 documentation tests pass |
| Repository-local link check (`--no-site`) | pass; 3,904 links across 655 files |

## Independent adversarial reviews

The first review found five severe flaws in the plugin-local design. All were
accepted: forged model readiness, separate setup-local stores, source-minted
authority, setup scope mistaken for task scope, and unattributed command input.
The unsafe registration was removed before the host redesign.

The second review challenged the redesigned host contract. The private proof
addressed stale-write races with CAS, bound invocation replay to a mutation
digest, derived installation identity from host-observed entry bytes, failed
closed for state-enabled in-process plugins, and added exact `/adr-attest`
argument mapping tests. The following findings remain explicit production
gates:

- human invocation alone does not make arbitrary third-party plugin mutations
  informed consent;
- matching `authority` JSON is not independently verifiable provenance;
- SQLite under the same OS account does not isolate malicious plugins;
- connector actor identifiers need authentication and authorization assurance;
- workspace path identity, deletion/retention, plugin migration, and signed
  cross-boundary results need separate decisions; and
- tools currently receive the extension snapshot rather than a declared
  per-tool least-privilege key subset.

## Fresh installed-package result

The plugin was copied project-locally into a new Git fixture and loaded through
production plugin discovery. The installed surface was exactly:

- commands: `adr-attest`, `adr-plan`, `adr-preplan`;
- tools: collection, workflow compilation, concern planning, profiling,
  fail-closed readiness, and validation; and
- one bundled `adr-planner` skill directory under the copied package.

The smoke applied `data.persisted=false` through the controlled command result,
committed it under the host installation/session scope, and invoked the
empty-input compiler through the runtime sandbox. The resulting workflow was
`compiled` and `host-composed`. An otherwise passing caller-authored readiness
request remained `blocked` with `readiness.untrusted_tool_input`.

Repository-only concern planning remained `repository-derived` and preserved
`external-interface` as unknown. Non-empty caller payloads containing forged
facts, catalog, rules, gates, and decisions were rejected. Serialized results
contained none of the fixture's source, secret, ignored-file, dependency,
script, or evaluator canaries.

## Adversarial and regression coverage

| Risk | Proof |
|---|---|
| Partial parser mutation | Malformed, duplicate, unauthorized, excessive, and private-canary batches leave the prior snapshot unchanged. |
| Lost concurrent update | Commit requires the host snapshot revision; a stale expected revision is rejected. |
| Invocation replay change | The same invocation id with a different mutation digest is rejected; exact replay is idempotent. |
| Hidden cross-load singleton | Separate command and runtime sandboxes share only SQLite rows under the same scope. |
| Session leakage | A second session, forged caller session id, different workspace, and different extension id do not reveal the first state. |
| Caller-created state | Sandbox wrapper deletes forged state and injects the host snapshot on every call. |
| Natural brief becomes fact | Brief text is submitted as context but never enters the controlled state or canonical fact list. |
| Source precedence masks conflict | Repository/attestation contradictions block concern and workflow output without a partial plan. |
| Attestation passes readiness | Facts can change applicability, but obligations remain unknown without resolution evidence. |
| Ordering changes bytes | Fact, evidence, and profile permutations remain byte-identical. |
| M1–M3 regression | Repository containment, profiling, rules, graph, routing, readiness, canonical JSON, and validation remain green. |

## Remaining gates

1. Harrison accepts or amends ADR-0050 after reviewing the host design, trust
   limits, and lifecycle evidence.
2. Add authenticated connector-principal policy and real connector-thread,
   reset, fork, resume, deletion, and retention lifecycle tests.
3. Add a host-owned declarative mutation grammar or explicit confirmation UI
   before third-party plugin mutations can claim informed human consent.
4. Add signed host execution receipts before canonical artifacts cross an
   independent trust boundary.
5. Decide workspace identity, plugin-state migration, per-tool least privilege,
   and whether malicious same-user plugin isolation requires a stronger sandbox
   or separate host service.
6. Design ADR acceptance, risk acceptance, waivers, and implementation evidence
   as separate explicit authority channels.
7. Keep protected Markdown/JSON persistence and generated-region ownership
   deferred; M4 returns previews and writes no planning artifact.
8. M5 must add brownfield history and accepted-decision change impact without
   weakening the M2–M4 boundaries.
9. Publication and immutable `qh2-template` pinning remain blocked on ADR-0047
   and M6 fresh/upgrade install gates.
