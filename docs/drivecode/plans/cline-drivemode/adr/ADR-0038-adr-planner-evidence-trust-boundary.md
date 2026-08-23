# ADR-0038 · ADR Planner repository-evidence trust boundary

**Status:** Proposed
**Owner:** Harrison / Drivecode
**Decider:** Harrison
**Initiative:** [adr-planner](../initiatives/adr-planner/)
**Plan:** [Milestone 2](../initiatives/adr-planner/milestone-2-implementation-plan.md)
**Constrained by:** [ADR-0004](ADR-0004-gated-learn-privacy.md),
[ADR-0036](ADR-0036-adr-planner-plugin-boundary.md),
[ADR-0037](ADR-0037-adr-planner-package-contract.md)

## Context

ADR Planner must use repository evidence to avoid generic plans, but repository
access creates a materially different authority boundary from M1's
structured-input-only tools. A broad recursive scanner could read ignored
files, secrets, symlinks outside the workspace, source text unrelated to
planning, evaluator material, or enough content to make telemetry and model
prompts unsafe.

The host already supplies a session-scoped `workspaceInfo.rootPath`. Git can
enumerate tracked and unignored files with repository-native ignore semantics.
Most six-dimension profile evidence can be derived from file presence and
selected manifest metadata; raw application source, documentation prose,
workflow bodies, environment files, and transcripts are not necessary for the
first evidence slice.

## Proposed decision

1. Add one explicit `adr_planner_collect_evidence` tool and one composite
   `adr_planner_profile` tool. Each collects repository evidence from the host
   workspace itself; neither accepts caller-authored evidence, assertions, or
   paths. Collection runs only when the model or user calls a tool during an
   explicit planner workflow; setup, hooks, and background events never scan.
2. Resolve the workspace only from `PluginSetupContext.workspaceInfo.rootPath`.
   Missing workspace context returns a blocked diagnostic. Never substitute
   `process.cwd()`.
3. Enumerate with `git ls-files --cached --others --exclude-standard -z` in the
   workspace. Git failure, non-repository workspaces, oversized index output,
   or cancellation fail closed with no partial evidence claim.
4. Filter the index through a package-owned allowlist before filesystem reads.
   M2 may inspect selected package manifests and use presence-only evidence for
   deployment, CI, ownership, language, and policy files. It may not accept
   caller-provided paths.
5. Resolve every candidate beneath the real workspace root, use `lstat`, open
   with no-follow semantics, compare device and inode through the opened file
   descriptor, read at most the remaining byte budget plus one, and revalidate
   descriptor identity and metadata after reading. Reject symlinks,
   non-regular files, parent/final-component swaps, concurrent mutation, path
   escapes, over-limit files, and over-limit aggregate reads.
6. Deny secret-shaped filenames independently of Git ignore status. M2 never
   reads environment files, credentials, key material, private evaluator
   directories, raw transcripts, or chat exports.
7. Parsers emit only package-owned signal codes and fixed claim text. Tool
   output, diagnostics, logs, and telemetry contain no raw file content,
   dependency names, script bodies, secret values, or Git stderr. Evidence
   retains a workspace-relative locator and optional SHA-256 content digest for
   provenance.
8. Separate I/O from interpretation. The adapter lists and reads bounded
   candidates; pure functions convert candidate metadata into evidence and
   convert collector-produced evidence into the six-dimension project profile.
9. Repository signals classify a dimension only when the mapping is explicit
   and structural. Dependency membership always emits a candidate signal and
   becomes an unsupported inference, never a profile fact;
   absent evidence produces the literal `unknown` value. Silence never selects
   a common architecture default.
10. Keep typed profile-assertion schemas for a future host-attested channel,
    but do not expose that channel through the M2 model tool. The tool cannot
    manufacture `brief`, `user`, or `decision` authority. The pure kernel
    validates repository evidence derivation and assertion authority for
    trusted programmatic/evaluator use; conflicting known and `unknown` values
    fail closed to `unknown`.
11. Output ordering, evidence ids, claims, digests, profiles, unknowns, and
    diagnostics are deterministic for the same Git-visible workspace state.
12. M2 remains local and read-only: no network, artifact persistence,
    repository mutation, ADR acceptance, risk acceptance, or telemetry payload
    containing collected evidence.

## Initial read policy

| Candidate | Read policy | Emitted information |
|---|---|---|
| Root and bounded-depth `package.json` | Descriptor-bound parse up to per-file and aggregate byte limits | Direct structural signal codes, unsupported dependency candidates, file digest, and fixed structural locator |
| Deployment descriptors such as `Dockerfile`, `wrangler.toml`, `vercel.json`, `fly.toml`, and Compose files | Presence only | Fixed deployment/runtime signal code and relative path |
| `.github/workflows/*.yml` | Presence only | CI-present signal; workflow body is never read |
| `CODEOWNERS`, `SECURITY.md`, license files | Presence only | Ownership, policy, or open-source-candidate signal |
| Language manifests such as `pyproject.toml`, `go.mod`, `Cargo.toml`, and `pom.xml` | Presence only in M2 | Ecosystem-present signal; dependency bodies are deferred |
| Source, README/docs prose, lockfiles, environment files, transcripts, memories, benchmark gold | Denied | Nothing |

## Options considered

| Option | Result |
|---|---|
| Git-visible, allowlisted metadata collector | Proposed. Uses native ignore semantics and minimizes content reads while retaining provenance. |
| Recursive filesystem walk with a custom `.gitignore` parser | Rejected. Nested ignore semantics and negation are easy to implement incorrectly. |
| Arbitrary-path plugin read tool | Rejected. It duplicates host file tools and turns planner invocation into general filesystem authority. |
| Ask the model to read files and submit prose evidence | Rejected as the authoritative path. It cannot deterministically enforce read minimization, source provenance, or content redaction. |
| Host file index without plugin reads | Deferred. The current plugin API does not expose the host index as a contribution service. |
| Read all manifests, workflows, and architecture docs | Rejected for M2. It increases secret and source-text exposure before a demonstrated classification need. |
| No repository access; structured inputs only | Rejected for M2. It would not satisfy repository evidence ingestion or automatic pre-planning. |

## Consequences

### Positive

- Planning gains repository-specific facts without ingesting application source
  or ignored content.
- Provenance and deterministic signals can be evaluated independently from
  model prose.
- Git ignore behavior is delegated to the repository's actual source of truth.
- Unknown-heavy profiles remain honest and drive bounded questions in M4.

### Negative

- Non-Git workspaces cannot use automatic collection in the first slice.
- Presence and package metadata cannot classify data trust, lifecycle, scale,
  or governance completely; a future host-attested brief/user channel remains
  necessary.
- Git becomes a local runtime prerequisite for collection.
- A package-owned signal taxonomy and dependency map require maintenance.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Tracked secret file bypasses `.gitignore` | Independent secret-name denylist; fixed allowlist; no arbitrary path input. |
| Symlink or path-swap escapes workspace | Real-root containment, `lstat`, no-follow open, descriptor device/inode comparison, bounded reads, and post-read metadata validation. |
| Huge repository or manifest exhausts memory | Git-output, file-count, per-file, aggregate-read, and timeout limits; fail closed. |
| Manifest contains secret-bearing scripts or private package names | Inspect only structural fields and dependency-key membership; never emit names, values, or source text. |
| Dependency presence is mistaken for business fact | All dependency mappings emit candidate signals and unresolved unsupported inference; only direct package structure classifies. |
| Model forges repository or human authority | Profile tool takes an empty strict object and recollects repository evidence internally; host-attested human evidence is deferred. |
| Git errors leak repository details | Fixed diagnostics; stderr is never returned or logged by the plugin. |
| Plugin setup lacks a workspace | Collection returns blocked; no `process.cwd()` fallback. |

## Acceptance conditions

1. Ignored, secret-shaped, symlinked, outside-root, oversized, and
   non-allowlisted fixtures produce no evidence content.
2. Package manifest fixtures emit only controlled signals and no raw package,
   dependency, script, or secret text.
3. Every emitted repository evidence record has deterministic id, source,
   claim, locator, and digest behavior.
4. Six-dimension profile fixtures preserve unknowns, reject forged repository
   evidence and repository-backed assertions, and fail known/unknown conflicts
   to `unknown`.
5. Ten identical collections and profiles are byte-identical.
6. Installed-package sandbox smoke discovers and invokes both M2 tools against
   a non-empty privacy fixture and proves deterministic, canary-free output.
7. Package-content review and M1 no-network/no-write guarantees remain green.

## Revisit triggers

- Expose a host-provided ignore-aware evidence reader when the plugin API gains
  a narrow capability for it.
- Add non-Git collection only with a tested ignore-semantics implementation and
  a separate decision.
- Expand document or workflow parsing only when benchmark omissions prove a
  material need and redaction tests exist first.
- Add persistence only after the artifact-root and change-history decisions in
  M4/M5.
