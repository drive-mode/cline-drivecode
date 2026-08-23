# ADR Planner install transaction contract

**Status:** frozen for implementation  
**Decision:** [ADR-0044](../../adr/ADR-0044-adr-planner-install-attestation.md)  
**Design:** [Install transaction design](milestone-6-install-transaction-design.md)

## Scope

This contract defines the first crash-recoverable install transaction used by
`qh2-template` for the project-local ADR Planner package. It covers verified
local-package installs with zero MCP contributions. Transactional MCP settings,
OAuth state, npm publication, and remote acquisition remain out of scope.

The schema-3 receipt is the sole durable commit marker. Journal phase is only a
diagnostic hint: recovery always compares exact receipt bytes and content
digests before choosing rollback or roll-forward.

## Coordinated CLI contract

```text
cline plugin install <stable-local-source> \
  --cwd <repository> \
  --force --verify \
  --transaction-receipt .qh2/adr-planner.lock \
  --receipt-intent <contained-canonical-intent> \
  <exact contract flags> --json
```

The receipt intent contains the eight source-identity fields of schema 3 in
canonical key order. Cline derives the transaction id from
`package_content_sha256`; stages and verifies the candidate; constructs the
exact final receipt and attestation; and commits install, attestation, and
receipt under one workspace plugin-mutation lock. qh2 never constructs or
modifies attested receipt fields and never parses CLI prose or JSON output.

The command exits zero only after final on-disk validation and cleanup. It:

1. stages outside plugin discovery and verifies the exact runtime contract;
2. rejects every MCP capability or contribution;
3. acquires the workspace mutation lock and recovers older transactions;
4. snapshots the exact old receipt bytes and old install-tree digest;
5. persists and syncs candidate, old/new receipt copies, attestation, and journal;
6. compare-and-swaps old install and receipt identities;
7. swaps the verified candidate into the managed install path;
8. atomically writes the attestation and exact precommitted schema-3 receipt;
9. treats receipt rename plus directory sync as the commit point; and
10. revalidates, removes the backup, then removes the journal last.

The `--force` decision is checked again under the mutation lock. Two fresh
non-force installers may both finish expensive verification, but exactly one
can commit. An exact same-pin replay with the same host and report removes its
private staging attempt without creating a journal or replacing active bytes.

Recovery is explicit and also runs automatically before every transactional
install:

```text
cline plugin transaction recover --cwd <repository> --json
```

Recovery performs no network access and executes no plugin code.

## Authority state machine

```text
No transaction
    |
    v
Prepared -------- receipt is still exact old bytes
    |
    v
Swapping -------- active may be old, absent, or new; receipt is still old
    |
    v
Committed ------- exact new receipt is durable; new install is authoritative
    |
    v
Finalized ------- backup and journal removed after validation
```

- Exact old receipt, including expected absence: recover toward the old install.
- Exact new receipt: recover toward the new install.
- Any other receipt or unknown tree digest: fail closed and preserve evidence.
- Journal phase never overrides these rules.

## Non-discoverable path layout

Transaction candidates and backups are siblings of `plugins`, never descendants
of a plugin search root:

```text
.cline/
├── plugins/_installed/local/<managed-install-id>/
└── plugin-install-transactions/
    ├── .mutation.lock/
    ├── .staging/<unique-attempt>/
    └── <transaction-id>/
        ├── journal.json
        ├── candidate/
        ├── backup/
        ├── old-receipt
        ├── new-receipt
        └── attestation.json

.qh2/
├── adr-planner.lock
└── attestations/<transaction-id>-<attestation-digest>.json
```

The transaction and active-install parents must be on the same filesystem
before rename-based swap begins. Every journal path is canonical and
repository-relative: install paths are beneath `.cline/plugins/_installed/`,
the receipt is exactly `.qh2/adr-planner.lock`, and attestations are beneath
`.qh2/attestations/`. Symlinked roots/parents, dot-segment aliases, absolute
paths, path escapes, and unknown transaction artifacts are rejected.

## Journal schema 1

The strict journal records:

- transaction id and diagnostic phase (`prepared`, `old-moved`,
  `candidate-active`, `receipt-committed`, or `finalizing`);
- workspace identity and repository-relative install, receipt, and attestation
  paths;
- exact presence and SHA-256 identity of the old install and old receipt;
- exact candidate install-tree, new receipt, and attestation digests;
- versioned install-tree digest algorithm; and
- diagnostic creation time.

The old and new receipt files contain the exact bytes used for authority
comparison. The tree digest algorithm includes entry type, relative path,
relevant mode bits, file bytes, and contained symlink target.

## Attestation and schema-3 receipt

The deterministic attestation binds transaction id, managed install and entry
paths, installed-tree digest algorithm and digest, host version, plugin API
version, and the exact package/plugin/capability/command/tool/skill verification
result. Its digest is bound into both the receipt and its content-addressed
filename. A same-source transaction under a different host therefore cannot
overwrite an earlier authoritative attestation before receipt commit.

Schema 3 retains every schema-2 field and adds:

```text
install_transaction_id
install_attestation_path
install_attestation_sha256
installed_content_sha256
plugin_api_version
host_version
```

The receipt is canonical single-line key/value data with one final newline,
fixed field order, exact field count, no duplicates, and no unknown fields.
Schema-1/2 receipts are preserved byte-for-byte as rollback authority during
migration; every successful transactional install writes schema 3.

The record protects integrity and crash consistency against accidental damage
and concurrent tooling. It is not a cryptographic signature against a malicious
same-user process.

## Workspace mutation lock

- One workspace lock covers managed install swaps, qh2 receipt mutation, and
  recovery; project-local uninstall joins this lock before candidate discovery.
- Expensive materialization and sandbox verification happen before acquisition.
- Recovery, under-lock `--force` validation, identity snapshot, rename, receipt
  commit, and cleanup hold the lock.
- The populated lock has exactly one canonical `owner.<pid>.<uuid>` regular file
  whose contents repeat the PID. Malformed, ambiguous, symlinked, or live-owner
  locks fail closed; only a valid dead owner can be atomically renamed aside.
- Release validates ownership, then atomically renames the entire lock directory
  out of the active namespace before deleting it. Waiters never observe an
  empty live lock.

## Digest-based crash inference

Let `A` be active, `C` candidate, `B` old backup, `R0` exact old receipt, and
`R1` exact new receipt.

| Receipt | Physical state | Recovery |
|---|---|---|
| `R0` | `A=old`, `C=new` | Delete candidate; old remains authoritative. |
| `R0` | `A=missing`, `B=old`, `C=new` | Restore backup; remove candidate. |
| `R0` | `A=new`, `B=old` | Remove known new active; restore backup. |
| `R0` | fresh install, `A=new`, no backup | Remove known new active. |
| `R1` | `A=new`, `B=old` | Validate and delete backup. |
| `R1` | `A=missing`, `C=new`, `B=old` | Activate candidate, validate, finalize. |
| `R1` | `A=old`, `C=new` | Preserve old as backup, activate candidate, finalize. |
| `R1` | no recoverable new copy | Fail closed; do not rewrite receipt. |
| other | any | Preserve all trees, receipt, and journal for repair. |
| either | any unknown tree digest | Fail closed; never infer from path or phase alone. |

When old and next tree digests are equal, receipt identity remains decisive.
Under `R0`, a known active tree is already valid old content and is preserved;
under `R1`, it is valid new content and recovery finalizes. Every present
active, candidate, and backup tree is validated before the first recovery
mutation, so one unknown digest preserves the entire evidence set.

## Required acceptance tests

Before cross-pin upgrades are considered complete:

1. Kill a real child process after every journal write, rename, receipt replace,
   and cleanup boundary; recover in a fresh offline process.
2. Prove byte-identical old rollback before receipt commit and deterministic new
   roll-forward after it.
3. Prove discovery never observes candidate or backup transaction trees.
4. Race two upgrades and an uninstall against the same workspace.
5. Reject malformed journal/intent/receipt, unknown digests, path escapes,
   symlinked parents, stale-lock ambiguity, host/API mismatch, and all MCP state.
6. Exercise schema-2-to-schema-3 immutable A-to-B migration and same-pin replay.
7. Verify one discovered active install, one matching receipt, one matching
   attestation, and no surviving transaction artifacts.

## Evidence status

Items 1–7 pass in the focused core, CLI, qh2-template, and immutable local-Git
fixtures recorded in [Milestone 6 evidence](milestone-6-evidence.md). The
production remote coordinate, dependency lifecycle policy, release evaluation,
and owner acceptance remain separate release gates; they do not weaken this
filesystem transaction contract.
