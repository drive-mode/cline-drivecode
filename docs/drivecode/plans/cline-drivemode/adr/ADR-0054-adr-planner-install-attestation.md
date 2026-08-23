# ADR-0054 · ADR Planner reproducible install and upgrade attestation

**Status:** Proposed — coordinated install/receipt transaction, crash recovery,
concurrency, and adversarial evidence implemented; owner acceptance and release
gates remain open
**Date:** 2026-08-16
**Owner:** Harrison / Drivecode
**Initiative:** [adr-planner](../initiatives/adr-planner/)
**Plan:** [Milestone 6](../initiatives/adr-planner/milestone-6-implementation-plan.md)
**Depends on:** [ADR-0046](ADR-0046-adr-planner-plugin-boundary.md) and
[ADR-0047](ADR-0047-adr-planner-package-contract.md)

## Context

`qh2-template` must install ADR Planner before a generated repository begins
production-intent work. A Git commit pin authenticates source history, but it
does not by itself prove which runtime bytes were installed or that the
installed entry can be loaded. The Cline installer copies a local package and
runs a fresh production dependency install with no package lock. A mutable
runtime dependency range can therefore produce different installed bytes from
the same source commit.

The template records source kind, commit, package subdirectory, source manifest
digest, candidate-content digest, and dirty state as a canonical receipt intent.
It supplies that intent and an exact typed runtime contract to Cline. Cline now
constructs and commits installed-content, transaction, attestation, plugin API,
and host fields inside the install transaction; qh2 neither writes those fields
nor interprets CLI text as authority. Fresh-process kills at all six durable
boundaries, same-tree host changes, concurrent installs, receipt-bound
uninstall, and adversarial journal/path/digest/lock fixtures now pass. This is
filesystem transaction evidence, not a security-sandbox or release-provenance
claim.

These are separate claims and must not be collapsed:

1. **source identity** — what reviewed source was requested;
2. **installed-content identity** — what package and dependencies were
   materialized;
3. **load compatibility** — whether the installed plugin exposes the expected
   bounded surface in the target host; and
4. **upgrade atomicity** — whether a failed replacement leaves the prior
   verified install and receipt intact.

## Proposed decision

1. Production ADR Planner runtime dependencies use exact versions. Host-owned
   `@cline/*` optional peers may retain the host compatibility range because
   the installer removes them and the host supplies them.
2. Release CI packs the exact candidate, rejects mutable direct runtime
   dependency specifications, and records the archive digest and file list.
3. `qh2-template` accepts only an immutable reviewed source commit or an exact
   published package coordinate. A local path remains an explicit development
   mode and its receipt records dirty/unversioned state.
4. Git-source beta bootstrap materializes only the package runtime allowlist at
   one stable ignored path inside the generated repository before calling
   Cline. It must not install the temporary clone path: Cline derives local
   installation identity from that path, so a new temp path would accumulate a
   second discovered plugin instead of replacing the first. It must also not
   install the monorepo source directory, which would bypass the package
   `files` boundary and copy tests and release scripts.
5. Template bootstrap does not interpret textual Cline output as authority. It
   supplies ADR Planner's exact package, runtime plugin, capability, command,
   tool, and skill expectations to the installer and proceeds only after the
   typed staged verifier exits successfully. The installer requires contained
   regular declared entries and binds the report to unchanged staged and
   immediately installed bytes.
6. Source and candidate identity are supplied in a canonical schema-3 intent.
   Cline writes the final external receipt under `.qh2/` with installed runtime,
   attestation, transaction, host, and plugin API identity. Machine-specific
   absolute paths are never committed.
7. A successful install receipt is not a planning/readiness attestation and
   cannot accept an ADR, risk, waiver, or lifecycle gate.
8. A fresh-generation test starts from a pristine template copy, installs the
   candidate through the production CLI, loads it through production plugin
   discovery, checks the exact command/tool/skill surface, and records a
   receipt only after those checks pass.
9. The target upgrade uses receipt-owned staged replacement. Exact old receipt
   bytes remain rollback authority until the exact precommitted schema-3 receipt
   is renamed and directory-synced. Recovery prevalidates every present active,
   candidate, and backup tree, then uses old/new receipt bytes and tree digests,
   never journal phase alone. Real child-process kills prove rollback before
   receipt commit and roll-forward after it at all six durable boundaries.
10. The immutable source ref and accepted publication coordinate are distinct
   release channels. The Git-subdirectory bootstrap may serve private beta;
   general release waits for ADR-0047's coordinate and registry authority.
11. CI must test a fresh install, exact same-pin no-op, same-tree/different-host
    replacement, successful cross-pin upgrade, dependency-install failure,
    malformed receipt/journal/lock, unknown content, path and symlink escape,
    contract mismatch, sandbox-load failure, schema incompatibility, races, and
    post-smoke rollback.
12. Staged sandbox loading is a host compatibility check, not a security
    boundary. It executes dependency installation and plugin setup with user
    permissions and is restricted to reviewed immutable artifacts. Release
    requires an explicit dependency lifecycle-script and environment policy.
13. Cross-pin upgrade uses the coordinated
    [install transaction design](../initiatives/adr-planner/milestone-6-install-transaction-design.md):
    an installer-owned durable journal and workspace lock retain the old backup
    until Cline itself commits and validates the exact new receipt. Public
    prepare/finalize phases and caller-generated post-swap receipts are rejected.
14. Generic uninstall joins the same workspace mutation lock and refuses the
    install path structurally bound by a valid schema-3 receipt/attestation.
    Missing or malformed receipt evidence fails closed. Receipt-aware uninstall
    remains a separate lifecycle operation.

## Receipt boundary

Template receipt schema 3 retains the schema-2 source/candidate contract:

```text
schema_version
source_kind
source
ref
subdir
package_manifest_sha256
source_dirty
package_content_sha256
```

`package_content_sha256` is SHA-256 over a `LC_ALL=C` byte-sorted manifest of
`<relative-path><TAB><file-sha256><LF>` rows for regular files beneath the four
materialized runtime roots (`package.json`, `README.md`, `src/`, `skills/`).
Symlinks and special files are rejected. Absolute paths, timestamps, logs,
caches, installed dependencies, and host-owned peers are excluded. Readers
accept valid schema-1/2 receipts as old rollback authority during migration;
transactional writers emit schema 3.

Schema 3 adds transaction id, attestation path and digest, installed-runtime
digest, plugin API version, and host version. The content-addressed attestation
at `.qh2/attestations/<transaction-id>-<attestation-digest>.json` carries the
exact package/plugin/capability/contribution verification report. It prevents a
same-source install under a different host from overwriting prior evidence.

## Authority and failure semantics

- The source pin proves repository identity, not host execution.
- The runtime digest proves byte identity under its versioned algorithm, not
  that the code is safe.
- Sandbox smoke proves compatibility with one identified host build, not owner
  acceptance of planner outputs.
- No new receipt is committed after a failed install or failed smoke.
- An existing lock must never be advanced while the prior install cannot be
  restored.
- Exact same-pin replay with the same host and verification report is a no-op;
  it creates no journal and preserves receipt, attestation, and active bytes.
- When old and next install-tree digests are equal but receipts differ, receipt
  identity still selects authority. Rollback preserves a known active tree and
  content-addressed attestations keep both host reports immutable.
- A pre-swap verifier failure preserves the active install but does not prove
  crash consistency after replacement; the durable transaction journal owns
  that stronger claim.
- Plugin `setup()` may run more than once during verification and activation.
  Until a pure describe/preflight lifecycle exists, verified plugins must keep
  setup idempotent and avoid externally visible side effects.
- A plugin load failure remains nonfatal to ordinary Cline use and fail-closed
  for requested planning readiness.

## Options considered

| Option | Decision |
|---|---|
| Git commit only | Insufficient: dependencies and installed bytes can drift. |
| Source manifest hash only | Insufficient: excludes package content, installed dependencies, and load compatibility. |
| Commit `.cline/plugins/_installed` | Rejected: machine/package-manager output is noisy, platform-sensitive, and duplicates the release unit. |
| Mutable semver ranges plus lockfile outside the package | Rejected: the Cline local-package installer intentionally omits the source lockfile from dependency resolution. |
| Exact direct runtime dependencies plus candidate archive/content digest | Proposed baseline; simple and auditable for the current one-dependency package. |
| Post-install smoke without rollback | Rejected as an atomic-upgrade claim; useful only as diagnostic evidence. |
| Installer-owned staged validation and rollback | Proposed production target. |

## Consequences

### Positive

- One source pin no longer silently permits a different direct runtime version.
- Template receipts can distinguish requested source from installed content.
- Fresh and upgrade tests measure the generated-repository path rather than
  only the source workspace.
- Failure semantics remain honest: static install, load compatibility, and
  planning authority are separate gates.

### Negative

- Dependency upgrades require explicit package changes and review.
- The Cline installer now has a durable journal, strict workspace lock, retained
  backup, receipt commit, and offline recovery. The implementation and evidence
  burden are higher than a best-effort file replacement.
- Git-source beta and package-coordinate release need separate fixtures.
- Runtime-content hashing and receipt migration add a small versioned protocol.

## Acceptance conditions

1. Package CI rejects mutable direct runtime dependencies and records a
   deterministic candidate archive digest.
2. Template bootstrap supplies the exact typed install contract and derives no
   authority from textual installer output; Cline validates entry containment
   and binds staged-to-installed bytes before returning success.
3. Fresh generated-repository smoke discovers exactly the expected commands,
   tools, and bundled skill.
4. Exact same-pin rerun is a no-op and leaves install, receipt, and attestation
   byte-identical; a same-tree host change receives a distinct immutable
   attestation.
5. Successful upgrade advances install and receipt together while generic
   uninstall cannot orphan either side.
6. Failures before and after sandbox load restore the prior verified install
   and preserve the prior receipt byte-for-byte.
7. The release report identifies plugin source/archive, host, template,
   contract, evaluator, and test-fixture versions.
8. Harrison accepts or amends this ADR before the remote default pin is enabled
   in `qh2-template`.

## Revisit

- Replace the Git-source private-beta channel with the accepted exact package
  coordinate after registry authority exists.
- Add signature/transparency verification if artifacts cross an independent
  organizational trust boundary.
- Revisit transitive dependency attestation if ADR Planner gains dependencies
  with mutable transitive graphs or native/platform-specific artifacts.
