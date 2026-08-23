# ADR Planner Milestone 6 evidence

**Recorded:** 2026-08-16
**Scope:** private package reproducibility, staged compatibility, and
crash-recoverable install/receipt transaction slice
**Decision state:** ADR-0036 Accepted; ADR-0037 through ADR-0040 and ADR-0044 Proposed

## Verdict

ADR Planner's direct runtime dependency is now exact and both its source-tree
boundary test and packed-archive verifier reject mutable direct runtime or
optional-runtime dependency specifications. This removes one source of
same-commit install drift in the current package.

The canonical `qh2-template` now also stops installing temporary clones and
monorepo source directories directly. It materializes the four declared runtime
roots at one stable ignored path, so Cline's local-source identity is stable
for same-pin reinstall and future staged upgrades, while development-only
tests/scripts do not enter the managed install. A canonical schema-3 intent
records source and candidate identity. Stubbed template tests now prove
same-pin idempotency and cross-pin handoff while requiring Cline to construct
the final attested receipt.

The Cline installer now also offers an optional staged compatibility gate. It
requires a valid package manifest whose declared entries are unique, regular,
contained files; sandbox-loads the staged package; runs full parent-side
contribution initialization; rejects load/setup failures and warnings; and
compares exact package, plugin, capability, command, tool, and skill sets before
replacement. `qh2-template` requires ADR Planner's complete expected surface.

The verifier hashes the staged package before code execution, shuts down the
sandbox, rejects content mutation, and validates the same digest immediately
after rename while the prior install backup is still recoverable. Actual names
remain canonical and duplicate-sensitive; bundled skills use the production
parser and contained regular files.

The coordinated transaction now stages and retains backups outside plugin
discovery, serializes all mutation with a strict workspace lock, snapshots exact
old receipt bytes and old/new tree digests, writes a content-addressed
attestation and schema-3 receipt inside the install operation, and recovers
offline according to receipt authority rather than journal phase. Exact
same-pin replay is a no-op; same-tree/different-host replacement keeps distinct
attestations; all present trees are validated before recovery mutates anything.

Real child-process kills pass at every durable boundary. Concurrent upgrades,
fresh non-force installs, and receipt-bound uninstall serialize. Malformed and
duplicate journals, unknown active/candidate/backup content, untrusted paths,
symlinked roots/evidence, unknown artifacts, malformed or ambiguous lock owners,
and valid dead-owner reclaim fail closed as specified.

This evidence does not claim a security sandbox or immutable production release
provenance. Immutable-remote generated-repository smoke, dependency
lifecycle-script policy, accepted release evaluation, publication coordinate,
owner acceptance, and the immutable remote template default remain open.

## Implemented proof

| Surface | Evidence |
|---|---|
| Runtime dependency | `zod` is declared as exact `4.3.6` in the private package. |
| Workspace lock | ADR Planner's workspace dependency spec is exact and resolves to the exact package version. |
| Source boundary | `package-boundary.test.ts` rejects any mutable direct runtime or optional runtime version. |
| Packed boundary | `verify-package.ts` applies the same exact-version invariant to the package being packed. |
| Candidate archive | Two independent packs produced the same 32-entry archive and SHA-256 `2100772988a03ffe5fa0cd29a367613da590ab7ab90b983acae930664418d30c`; normalized inventory SHA-256 is `c1e0827566bddf207b9ef282a61f391ac24cfb912c8fd6c7e82a689df3300436`. |
| Authority | Host-owned `@cline/sdk` remains an optional peer and is not misrepresented as installed runtime content. |
| Template source identity | Remote temp clones are reduced to one stable `.qh2/.cache/adr-planner-package` source path before Cline installation. |
| Package boundary | Template candidate contains only `package.json`, `README.md`, `src/`, and `skills/`; source `test/` and `scripts/` are excluded. |
| Receipt | Schema 3 retains source manifest/candidate digests and binds transaction, content-addressed attestation, installed-tree, plugin API, and host identities without absolute paths. |
| Upgrade contract | Stubbed same-pin replay preserves receipt bytes; a second immutable ref reaches the same coordinated transaction flags and commits a different schema-3 receipt. |
| Real generated repository | A working-tree copy excluding `.git` installed the real runtime-only candidate through the real CLI; template integrity passed. |
| Installed surface | Production discovery found one plugin, commands `adr-attest`/`adr-plan`/`adr-preplan`, six expected tools, and one bundled skill root; forged readiness remained blocked and host-composed workflow smoke passed. |
| Installed content | Managed package excludes source `test/` and `scripts/`; installed direct runtime dependency is exact `zod@4.3.6`. |
| Real same-pin replay | A second real CLI bootstrap kept exactly one managed install and preserved receipt bytes (`sha256 a8eae0c12ce74c97d5027edc399f286aabc329168b61a725e2d17dd09dbb4168`); post-reinstall sandbox smoke passed. |
| Exception consistency | `--without-adr-planner` refuses to overwrite a planner-bound receipt or contradict a discovered managed install; the existing lock remains byte-identical. |
| Receipt migration | Generated repositories with valid schema-1/2 receipts remain accepted as old authority; transactional bootstrap writes schema 3. |
| Runtime file types | Candidate materialization rejects symlinks and special files before Cline installation and writes no receipt. |
| Failed staging cleanup | Rejected runtime materialization removes `.next`/new candidate state and writes no receipt; the prior ignored candidate is not removed before replacement begins. |
| Digest ordering | Schema 2 freezes `LC_ALL=C` byte ordering; the same-pin fixture includes BMP-private-use and supplementary-plane filenames whose UTF-8 byte order differs from UTF-16 code-unit order. |
| Release-artifact CI path | Workflow packs, extracts, installs, and smokes the exact 32-entry archive; local reproduction passed with the exact 3-command/6-tool/1-skill surface. |
| CI governance | External checkout is commit-pinned, job timeout is 15 minutes, and `apps/cli/**` changes trigger the plugin workflow. |
| Staged entry boundary | Verified installs require valid manifest declarations and reject missing, duplicate, escaping, symlinked, non-module, and discovery-fallback entries before code load. |
| Staged compatibility | The real sandbox plus parent contribution registry reports exact package `@cline/adr-planner`, runtime plugin `adr-planner`, capabilities `commands`/`tools`, three commands, six tools, and skill `adr-planner`. |
| Pre-swap rollback | A real forced install with an intentionally wrong expected plugin name exited 1; the active `src/index.ts` remained SHA-256 `103399b5e495ec3532d516b5abe95ce3d4040162a0b3937c9eb1456792dd04c2` before/after and staging was empty. |
| Template integration | qh2 supplies an exact typed verification contract plus canonical source intent; only Cline writes attested schema-3 fields, and qh2 ignores textual/JSON output for authority. |
| Transaction storage | Candidate and backup live under `.cline/plugin-install-transactions`, outside recursive plugin discovery; the managed active path remains the only discovered copy. |
| Transaction authority | Exact old/new receipt bytes and versioned tree digests select rollback/roll-forward. Journal phase is diagnostic only; malformed receipt, noncanonical/duplicate journal, unknown role path, or unknown digest fails closed. |
| Core transaction fixture | Fresh schema-3 install, exact same-pin no-op, same-tree/different-host replacement, and A-to-B replacement pass; malformed old receipt is rejected before swap, prior install bytes remain unchanged, and orphan pre-journal state is recovered offline. |
| Source-intent binding | Cline independently hashes the copied pre-dependency package with qh2's UTF-8 byte-sorted manifest algorithm and rejects a mismatched manifest or candidate-content digest before swap. |
| Crash recovery | A real child process is killed at `prepared`, `old-moved`, `candidate-active`, `attestation-written`, `receipt-committed`, and `backup-deleted`; fresh-process offline recovery rolls back the first four and finalizes the last two. Same-tree host-change kills also preserve old authority before receipt commit and finalize new afterward. |
| Pre-mutation validation | Unknown active, candidate, or backup digests and symlinked candidate/evidence roots are detected before the first recovery mutation; receipt, active tree, and all transaction evidence remain unchanged. |
| Trusted paths | Journal roles require canonical relative paths beneath exact install/receipt/attestation roots; direct recovery rejects a symlinked `.cline`, path aliases/escapes, and unknown transaction artifacts. |
| Workspace lock | Lock ownership requires one canonical regular owner marker with matching PID contents. Malformed/multiple owners fail immediately, a live owner is never age-reclaimed, a valid dead owner is renamed aside, and release atomically removes the lock namespace. |
| Force serialization | Two fresh verified `force=false` processes both cross the pre-lock barrier; exactly one commits and the other fails the under-lock existence check. |
| Uninstall serialization | Default-CWD, explicit-CWD, and `workspaceRoot` uninstall all join the mutation lock. Schema-3 attestation path—not plugin name—binds the protected install; generic uninstall fails closed for valid or malformed receipt evidence. |
| Mutation race | Two verified same-pin upgrades and a receipt-bound uninstall start beyond the verification barrier; both upgrades converge, uninstall is refused, one active install/receipt remains, and the process-level race passed five consecutive repetitions. |
| Attestation immutability | Attestations use `<transaction-id>-<attestation-digest>.json`; an exact replay preserves the existing file, while a same-source different-host receipt receives a distinct file and cannot overwrite old authority. |
| Immutable A-to-B | Real source CLI upgraded local Git commit `88614cd64e7230d290a08b51a638a693b7696fb4` to `8b7f684a2bca14ecfaf38d6d6d6bbf288c5774e6`; final receipt/attestation matched B, one managed install remained, and no transaction directory survived. |

## Verification ledger

To be filled only from the actual verification run for this slice:

| Verification | Result |
|---|---|
| Frozen lockfile check | pass (`bun install --frozen-lockfile --lockfile-only`) |
| `bun -F @cline/adr-planner typecheck` | pass |
| `bun -F @cline/adr-planner test` | 85 pass, 0 fail across 12 files |
| `bun plugins/adr-planner/scripts/verify-package.ts` | pass; extracted artifact manifest exact-dependency check; two byte-identical 32-entry archives, SHA-256 `2100772988a03ffe5fa0cd29a367613da590ab7ab90b983acae930664418d30c`; inventory SHA-256 `c1e0827566bddf207b9ef282a61f391ac24cfb912c8fd6c7e82a689df3300436` |
| Changed-file Biome check | pass with error diagnostics |
| Drivecode structure and Done checks | pass |
| Drivecode documentation tests | 25 pass, 0 fail |
| Repository-local link check (`--no-site`) | 3,979 links across 670 files; pass |
| `qh2-template` integrity and bootstrap contract | pass; schema-3 mock writer and verifier require the content-addressed trusted attestation path |
| `qh2-template` shell syntax and ShellCheck | pass |
| Packed-artifact install and sandbox smoke | pass |
| `bun run build:sdk` | pass after installer API changes |
| Core plugin-install/uninstall tests | 36 pass, 0 fail across installer, transaction, and uninstall suites; includes six real child-process crash points, same-tree authority, exact no-op replay, fresh-install and upgrade races, structural uninstall refusal, host/API mismatch and transactional MCP rejection, strict release-owner validation, explicit source-intent mismatch rejection, A-to-B receipt commit, malformed-receipt preservation, adversarial journal/path/digest/lock/symlink rejection, manifest escape rejection, wrapper mutation rejection, and undeclared-contribution rejection |
| `bun -F @cline/cli typecheck` | pass |
| CLI plugin command tests | 32 pass, 0 fail; verified JSON report serialized |
| Real qh2 exact-contract bootstrap/replay | pass through source CLI; exact package/plugin/capability/command/tool/skill report |
| Real qh2 schema-3 source binding | pass; candidate digest equals transaction id, attestation digest verifies, installed-tree digest is distinct, and template integrity passes |
| Real immutable Git A-to-B | pass after one transient local-clone filesystem retry; one discovered managed install, B receipt/attestation, and zero retained transaction directories |

The real generated-repository proof used the current dirty local development
source and therefore records `source_dirty=true`; it proves the lifecycle path,
not immutable release provenance. The immutable remote-candidate run remains a
release gate.

## Remaining M6 gates

See [Milestone 6 implementation plan](milestone-6-implementation-plan.md). No
successful package/template test can self-accept ADR-0037/0044, publish the package, or
set the remote `qh2-template` pin.
