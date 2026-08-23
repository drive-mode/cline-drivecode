# ADR Planner Milestone 6 implementation plan

**Status:** active — package reproducibility, staged compatibility, and
crash-recoverable install/receipt transaction implemented; immutable release,
evaluation, publication, and owner acceptance remain open
**Architecture candidate:** [ADR-0054](../../adr/ADR-0054-adr-planner-install-attestation.md)
**Product requirements:** [ADR Planner PRD](../../prd/prd-adr-planner.md)
**Depends on:** M4 private workflow proof; M0/ADR-0047 owner decisions for release

## Outcome

Milestone 6 makes a generated `qh2-template` repository prove which ADR Planner
candidate it installed, that the installed package loads with the expected
bounded surface, and that upgrades cannot destroy the last verified install.
It also executes the frozen development and held-out release policy without
placing gold or evaluator state in the plugin package.

M6 does not accept ADRs, enable the remote default pin, publish an unapproved
coordinate, treat install success as planning readiness, or weaken the M2–M4
authority boundaries.

## Requirement coverage

| Requirement | M6 proof |
|---|---|
| `ADRPL-FR-013` | A pristine generated repository installs one immutable candidate project-locally and records a versioned external receipt after discovery/smoke. |
| `ADRPL-FR-014` | An explicit pinned reinstall stages and validates the replacement; failure restores the prior verified install and receipt. |
| `ADRPL-NFR-002` | Candidate archive/content digest and deterministic planning artifacts are stable across replay. |
| `ADRPL-NFR-007` | Ordinary Cline remains usable after plugin failure; a planner request has no passing readiness claim. |
| `ADRPL-NFR-009` | Package, generated repository, logs, caches, and model context exclude held-out briefs and gold. |
| `ADRPL-NFR-010` | Release manifests identify source/archive, host, template, evaluator, model, prompt, and case-set versions. |

## Delivery channels

| Channel | Source identity | Intended use | Release claim |
|---|---|---|---|
| Trusted local path | checkout ref + dirty bit | development only | none |
| Immutable Git commit + package subdir | repository + 40-char commit + subdir | private beta while package coordinate is unresolved | only after full M6 fixture passes |
| Exact package coordinate | package name + exact version + archive digest | production target | only after ADR-0047/0044 and release policy acceptance |
| `--without-adr-planner` | explicit exception receipt | deliberate bootstrap exception | never a planner-ready claim |

## Work packages

### M6.1 · Reproducible candidate package

- Pin every direct runtime and optional runtime dependency exactly.
- Keep host-provided `@cline/*` packages as optional peers and exclude them from
  installed dependency identity.
- Reject mutable runtime dependency specs in unit and archive verification.
- Pack from a clean candidate and record archive digest plus normalized file
  inventory.
- Fail if benchmark, review, held-out, gold, test, or private evaluator material
  enters the archive.

### M6.2 · Structured template install receipt

- For Git-source beta, copy only `package.json`, `README.md`, `src/`, and
  `skills/` into one stable ignored candidate path; never install a temporary
  clone or the monorepo source directory.
- Do not derive authority from textual CLI output. Pass exact expectations into
  the installer and write the external receipt only after its typed verifier
  exits successfully.
- Verify declared entry realpath containment inside the staged package and bind
  the compatibility report to an unchanged staged/installed content digest.
- Verify package name, version, declared entry, capabilities, bundled skill,
  direct dependency versions, and source-to-install runtime content digest.
- Schema 3 retains the versioned schema-2 source/candidate digest contract and
  adds installer-owned transaction, content-addressed attestation,
  installed-tree, plugin API, and host identities. Readers preserve valid
  schema-1/2 receipts byte-for-byte as old authority during migration.
- Keep absolute paths, timestamps, actor data, and secrets out of committed
  receipts.

### M6.3 · Fresh generated-repository conformance

- Copy the pristine template as GitHub generation would.
- Install the exact candidate through the production CLI.
- Load through production project discovery and a fresh host state directory.
- Assert exactly three commands, six tools, one skill root, no hooks/rules/MCP,
  fail-closed readiness, deterministic repository evidence, and privacy
  canaries.
- Verify the generated project brief and ADR/planning directories survive.

### M6.4 · Atomic upgrade

- Use the implemented installer-owned staged compatibility verification before
  replacement: strict manifest containment, sandbox load, full parent-side
  contribution initialization, and exact package/runtime contract comparison.
- Treat compatibility verification as execution of trusted immutable code, not
  as a security boundary; define dependency lifecycle-script and environment
  policy before release.
- Preserve mutable project config/planning artifacts outside managed install.
- Implement the coordinated
  [install transaction design](milestone-6-install-transaction-design.md):
  installer journal, workspace lock, non-discoverable retained backup,
  installer-owned receipt commit, digest-based rollback/recovery, and cleanup.
- Maintain fixtures for dependency failure, malformed output, path escape,
  wrong package, missing skill, setup throw, schema mismatch, smoke failure,
  interruption, same-tree authority, unknown content, strict lock ownership,
  and concurrent install/uninstall.

### M6.5 · Evaluation release gate

- Materialize development cases from the frozen manifest and held-out cases
  from an evaluator-owned store unavailable to the candidate.
- Use a fresh workspace and session for every run.
- Score development and held-out slices separately against policy `m0.1`.
- Enforce automatic failures before aggregate thresholds.
- Emit raw numerators/denominators and the full release identity manifest.
- Require the named independent human reviewer before release-gold
  adjudication.

## Verification matrix

| Test | Required proof |
|---|---|
| Manifest | Mutable direct runtime ranges fail; exact dependencies pass. |
| Archive | Stable digest/inventory; no tests, benchmark, review, gold, or held-out content. |
| External receipt parser | Unsupported schemas, duplicate/unknown fields, malformed values, and type mismatches fail closed. |
| Containment | Relative, escaped, symlinked, missing, and outside-root entries fail. |
| Contract | Wrong package/version/entry/capability/skill/dependency fails. |
| Fresh install | Real CLI install plus real sandbox discovery and smoke pass. |
| Idempotency | Same candidate rerun yields equivalent stable receipt content. |
| Upgrade | Successful replacement advances candidate and receipt. |
| Rollback | Every staged/post-load failure preserves prior install and receipt. |
| Privacy | Source, ignored, secret, evaluator, transcript, and gold canaries never appear. |
| Evaluation | Development and held-out automatic failures/floors are reported independently. |
| Regression | M1–M4 tests, host plugin tests, template integrity, docs, links, and package checks pass. |

## Current slice

Implemented in the private worktree:

- M6.1 pins and verifies exact runtime dependencies and reproducible package
  inventory/digest boundaries.
- `qh2-template` materializes only the declared runtime allowlist at one stable
  ignored source path, emits a canonical schema-3 source intent, and requires
  Cline's exact package/plugin/capability/command/tool/skill contract.
- Cline stages outside discovery, sandbox-loads and fully validates the parent
  contribution registry, rehashes before and after replacement, and rejects MCP
  state for this transaction.
- Cline owns one schema-3 receipt transaction: strict workspace lock, exact old
  receipt snapshot, old/new tree digests, retained backup, content-addressed
  attestation, atomic receipt commit, offline recovery, and cleanup.
- Exact same-pin replay is a no-op. Same-tree/different-host replacement retains
  both immutable attestations and recovers by receipt identity when tree hashes
  are equal.
- Real child-process kills at all six durable boundaries pass. Unknown active,
  candidate, or backup content; noncanonical/duplicate journals; untrusted or
  symlinked paths; unknown artifacts; and malformed/ambiguous lock ownership
  fail closed before recovery mutation.
- Two fresh non-force installs admit exactly one commit. Two verified upgrades
  converge under the same lock while structural receipt binding refuses generic
  uninstall for default CWD, explicit CWD, and `workspaceRoot` callers.
- qh2 shell syntax, ShellCheck, bootstrap contract, and pristine integrity pass;
  its verifier requires the exact content-addressed attestation path.
- The focused core gate passes 36 tests, CLI plugin commands pass 32 tests, both
  typechecks pass, and the SDK packages successfully.
- A real immutable local-Git A-to-B fixture finishes with B receipt/attestation,
  one managed install, and no transaction residue.

This closes M6.1, the implemented schema-3/install portions of M6.2, and the
project-local filesystem transaction portion of M6.4. Immutable-remote
generated-repository conformance, dependency lifecycle policy, accepted release
evaluation, publication, ADR acceptance, and remote default pinning remain open.

## Milestone 6 exit

- [ ] ADR-0047 and ADR-0054 are accepted or the release remains explicitly private/reversible.
- [x] Direct runtime dependencies are exact and enforced by package tests.
- [x] Candidate archive digest and normalized inventory are deterministic and
      recorded by package verification.
- [x] Git-source beta materializes only the runtime allowlist at one stable path
      and records a normalized candidate-content digest.
- [x] Installed package and host identity are bound into an installer-owned
      schema-3 receipt and versioned attestation after exact staged verification.
- [x] A development local-source generated-repository install and same-pin
      reinstall pass the real CLI/discovery/sandbox smoke with one managed copy.
- [ ] Fresh generated-repository conformance passes against an immutable candidate.
- [x] Same-pin idempotency and qh2's stubbed cross-pin contract pass with
      installer-owned schema-3 fields.
- [x] Core A-to-B replacement and malformed-old-receipt fail-closed fixtures pass.
- [x] Immutable local-Git A-to-B passes the real source CLI with one managed
      install, matching schema-3 receipt/attestation, and no transaction residue.
- [x] Fresh-process crash recovery passes six durable swap/receipt boundaries,
      proving old rollback before receipt commit and new finalization after it.
- [x] Concurrent upgrades, fresh non-force installs, and receipt-bound uninstall
      serialize under the shared workspace lock; adversarial
      path/journal/digest/symlink/lock fixtures pass.
- [x] Pre-swap load/setup/contract failures preserve the prior install.
- [x] Post-swap process-kill/receipt failures prove rollback or roll-forward
      through fresh-process offline recovery at all six implemented boundaries.
- [ ] Development and held-out evaluation satisfy accepted release policy.
- [ ] Exact production package coordinate and immutable `qh2-template` pin are enabled.

## Explicit external gates

1. Harrison accepts/amends M0 gold and release policy.
2. Harrison accepts/amends ADR-0047 and ADR-0054.
3. A standing independent human release reviewer is named or release gold is
   explicitly deferred.
4. The ADR Planner package exists at a reviewed immutable remote commit or an
   accepted exact publication coordinate.
