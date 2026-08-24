import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	posix,
	relative,
	resolve,
	sep,
} from "node:path";
import type { PluginInstallVerificationResult } from "./plugin-install";

const TRANSACTION_SCHEMA_VERSION = 1;
const RECEIPT_SCHEMA_VERSION = 3;
const PLUGIN_API_VERSION = "1";
const TREE_DIGEST_ALGORITHM = "cline-install-tree-v1";
const TRANSACTION_DIRECTORY_NAME = "plugin-install-transactions";
const LOCK_DIRECTORY_NAME = ".mutation.lock";
const LOCK_STALE_MS = 60_000;
const LOCK_POLL_MS = 25;
const RECEIPT_INTENT_KEYS = [
	"schema_version",
	"source_kind",
	"source",
	"ref",
	"subdir",
	"package_manifest_sha256",
	"source_dirty",
	"package_content_sha256",
] as const;
const RECEIPT_ATTESTATION_KEYS = [
	"install_transaction_id",
	"install_attestation_path",
	"install_attestation_sha256",
	"installed_content_sha256",
	"plugin_api_version",
	"host_version",
] as const;
const INSTALL_ATTESTATION_KEYS = [
	"schemaVersion",
	"transactionId",
	"status",
	"installRelativePath",
	"entryRelativePaths",
	"installedContentSha256",
	"installTreeAlgorithm",
	"pluginApiVersion",
	"hostVersion",
	"verification",
] as const;

export interface PluginInstallReceiptIntent {
	schemaVersion: 3;
	sourceKind: "git" | "local-development";
	source: string;
	ref: string;
	subdir: string;
	packageManifestSha256: string;
	sourceDirty: boolean;
	packageContentSha256: string;
}

export interface PluginInstallTransactionOptions {
	receiptPath: string;
	receiptIntentPath: string;
	hostVersion?: string;
	/** Test-only crash injection; CLI callers cannot configure this hook. */
	testFaultInjector?: (point: PluginInstallTransactionFaultPoint) => void;
	/** Test-only barrier after verification and before mutation-lock acquisition. */
	testBeforeMutationLock?: () => void;
}

export type PluginInstallTransactionFaultPoint =
	| "prepared"
	| "old-moved"
	| "candidate-active"
	| "attestation-written"
	| "receipt-committed"
	| "backup-deleted";

export interface PluginInstallTransactionResult {
	transactionId: string;
	receiptPath: string;
	attestationPath: string;
	attestationSha256: string;
	installedContentSha256: string;
	pluginApiVersion: string;
	hostVersion: string;
}

export interface PluginInstallRecoveryResult {
	transactionId: string;
	action: "rolled-back" | "finalized";
}

interface PluginInstallAttestationV1 {
	schemaVersion: 1;
	transactionId: string;
	status: "committed";
	installRelativePath: string;
	entryRelativePaths: string[];
	installedContentSha256: string;
	installTreeAlgorithm: typeof TREE_DIGEST_ALGORITHM;
	pluginApiVersion: string;
	hostVersion: string;
	verification: PluginInstallVerificationResult;
}

interface PluginInstallJournalV1 {
	schemaVersion: 1;
	transactionId: string;
	phase:
		| "prepared"
		| "old-moved"
		| "candidate-active"
		| "receipt-committed"
		| "finalizing";
	workspaceIdentity: string;
	installRelativePath: string;
	receiptRelativePath: string;
	attestationRelativePath: string;
	oldInstallPresent: boolean;
	oldInstallTreeSha256?: string;
	oldReceiptPresent: boolean;
	oldReceiptSha256?: string;
	nextInstallTreeSha256: string;
	nextReceiptSha256: string;
	attestationSha256: string;
	installTreeAlgorithm: typeof TREE_DIGEST_ALGORITHM;
	createdAt: string;
}

interface TransactionPaths {
	root: string;
	journal: string;
	candidate: string;
	backup: string;
	oldReceipt: string;
	newReceipt: string;
	attestation: string;
}

interface AcquiredMutationLock {
	lockDir: string;
	ownerFile: string;
	ownerContents: string;
}

function sha256Bytes(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function toPosixPath(value: string): string {
	return value.split(sep).join("/");
}

function isContainedPath(root: string, candidate: string): boolean {
	const child = relative(root, candidate);
	return (
		child !== "" &&
		child !== ".." &&
		!child.startsWith(`..${sep}`) &&
		!isAbsolute(child)
	);
}

function assertHexSha256(value: string, label: string): void {
	if (!/^[0-9a-f]{64}$/.test(value)) {
		throw new Error(`${label} must be a lowercase SHA-256 digest`);
	}
}

function parseStrictKeyValueFile(
	filePath: string,
	expectedKeys: readonly string[],
): Map<string, string> {
	const text = readFileSync(filePath, "utf8");
	if (!text.endsWith("\n") || text.includes("\r") || text.includes("\0")) {
		throw new Error(`Receipt intent is not canonical: ${filePath}`);
	}
	const lines = text.slice(0, -1).split("\n");
	if (lines.length !== expectedKeys.length) {
		throw new Error(
			`Receipt intent has an unexpected field count: ${filePath}`,
		);
	}
	const values = new Map<string, string>();
	for (let index = 0; index < expectedKeys.length; index += 1) {
		const key = expectedKeys[index];
		const line = lines[index] ?? "";
		if (!line.startsWith(`${key}=`)) {
			throw new Error(`Receipt intent expected ${key} at line ${index + 1}`);
		}
		values.set(key, line.slice(key.length + 1));
	}
	return values;
}

export function readPluginInstallReceiptIntent(
	filePath: string,
): PluginInstallReceiptIntent {
	const values = parseStrictKeyValueFile(filePath, RECEIPT_INTENT_KEYS);
	const schemaVersion = values.get("schema_version");
	if (schemaVersion !== String(RECEIPT_SCHEMA_VERSION)) {
		throw new Error(
			`Receipt intent schema_version must be ${RECEIPT_SCHEMA_VERSION}`,
		);
	}
	const sourceKind = values.get("source_kind");
	if (sourceKind !== "git" && sourceKind !== "local-development") {
		throw new Error("Receipt intent source_kind is unsupported");
	}
	const sourceDirty = values.get("source_dirty");
	if (sourceDirty !== "true" && sourceDirty !== "false") {
		throw new Error("Receipt intent source_dirty must be true or false");
	}
	const packageManifestSha256 = values.get("package_manifest_sha256") ?? "";
	const packageContentSha256 = values.get("package_content_sha256") ?? "";
	assertHexSha256(packageManifestSha256, "package_manifest_sha256");
	assertHexSha256(packageContentSha256, "package_content_sha256");
	const source = values.get("source") ?? "";
	const ref = values.get("ref") ?? "";
	const subdir = values.get("subdir") ?? "";
	for (const [label, value] of [
		["source", source],
		["ref", ref],
		["subdir", subdir],
	] as const) {
		if (!value || value.includes("\n") || value.includes("\r")) {
			throw new Error(
				`Receipt intent ${label} must be a non-empty single line`,
			);
		}
	}
	return {
		schemaVersion: 3,
		sourceKind,
		source,
		ref,
		subdir,
		packageManifestSha256,
		sourceDirty: sourceDirty === "true",
		packageContentSha256,
	};
}

function assertExistingReceiptCanonical(filePath: string): void {
	if (!existsSync(filePath)) return;
	const text = readFileSync(filePath, "utf8");
	if (!text.endsWith("\n") || text.includes("\r") || text.includes("\0")) {
		throw new Error(
			`Existing transaction receipt is not canonical: ${filePath}`,
		);
	}
	const firstLine = text.split("\n", 1)[0];
	const schema = firstLine?.startsWith("schema_version=")
		? firstLine.slice("schema_version=".length)
		: "";
	const expected =
		schema === "1"
			? RECEIPT_INTENT_KEYS.slice(0, 7)
			: schema === "2"
				? RECEIPT_INTENT_KEYS
				: schema === "3"
					? [...RECEIPT_INTENT_KEYS, ...RECEIPT_ATTESTATION_KEYS]
					: undefined;
	if (!expected) {
		throw new Error(
			`Existing transaction receipt schema is unsupported: ${filePath}`,
		);
	}
	parseStrictKeyValueFile(filePath, expected);
}

export function hashPluginInstallTree(root: string): string {
	const rootStats = lstatSync(root);
	if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
		throw new Error(
			`Plugin install tree root must be a regular directory: ${root}`,
		);
	}
	const digest = createHash("sha256");
	const realRoot = realpathSync(root);
	const visit = (directory: string): void => {
		const entries = readdirSync(directory, { withFileTypes: true }).sort(
			(a, b) =>
				Buffer.compare(
					Buffer.from(a.name, "utf8"),
					Buffer.from(b.name, "utf8"),
				),
		);
		for (const entry of entries) {
			const entryPath = join(directory, entry.name);
			const relativePath = toPosixPath(relative(root, entryPath));
			const stats = lstatSync(entryPath);
			const mode = (stats.mode & 0o777).toString(8).padStart(3, "0");
			if (stats.isDirectory()) {
				digest.update(`D\0${relativePath}\0${mode}\0`);
				visit(entryPath);
				continue;
			}
			if (stats.isFile()) {
				digest.update(`F\0${relativePath}\0${mode}\0`);
				digest.update(readFileSync(entryPath));
				digest.update("\0");
				continue;
			}
			if (stats.isSymbolicLink()) {
				const resolvedTarget = realpathSync(entryPath);
				if (!isContainedPath(realRoot, resolvedTarget)) {
					throw new Error(
						`Plugin install tree symlink escapes its root: ${relativePath}`,
					);
				}
				digest.update(
					`L\0${relativePath}\0${mode}\0${readlinkSync(entryPath)}\0`,
				);
				continue;
			}
			throw new Error(
				`Plugin install tree contains a special file: ${relativePath}`,
			);
		}
	};
	visit(root);
	return digest.digest("hex");
}

export function hashPluginReceiptPackageContent(root: string): string {
	const files: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(path);
			} else if (entry.isFile()) {
				files.push(path);
			} else {
				throw new Error(
					`Receipt source package contains a symlink or special file: ${path}`,
				);
			}
		}
	};
	visit(root);
	files.sort((left, right) =>
		Buffer.compare(
			Buffer.from(toPosixPath(relative(root, left)), "utf8"),
			Buffer.from(toPosixPath(relative(root, right)), "utf8"),
		),
	);
	const manifest = files
		.map((path) => {
			const relativePath = toPosixPath(relative(root, path));
			if (/[\r\n\t]/.test(relativePath)) {
				throw new Error(
					`Receipt source package path contains an unsupported control character: ${relativePath}`,
				);
			}
			return `${relativePath}\t${sha256Bytes(readFileSync(path))}\n`;
		})
		.join("");
	return sha256Bytes(manifest);
}

function fsyncPath(path: string): void {
	let fd: number | undefined;
	try {
		fd = openSync(path, "r");
		fsyncSync(fd);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "EINVAL" && code !== "EPERM" && code !== "EISDIR") {
			throw error;
		}
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function fsyncTree(root: string): void {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) fsyncTree(path);
		else if (entry.isFile()) fsyncPath(path);
	}
	fsyncPath(root);
}

function atomicWriteDurable(filePath: string, contents: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
	const tempPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
	try {
		writeFileSync(tempPath, contents, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		fsyncPath(tempPath);
		renameSync(tempPath, filePath);
		fsyncPath(dirname(filePath));
	} catch (error) {
		rmSync(tempPath, { force: true });
		throw error;
	}
}

function transactionBase(workspace: string): string {
	return assertContainedWorkspacePath(
		workspace,
		join(".cline", TRANSACTION_DIRECTORY_NAME),
		"plugin transaction storage",
	);
}

export function createPluginInstallStagingPath(
	workspace: string,
	transactionId?: string,
): string {
	const resolvedWorkspace = resolve(workspace);
	mkdirSync(resolvedWorkspace, { recursive: true });
	const canonicalWorkspace = realpathSync(resolvedWorkspace);
	const base = assertContainedWorkspacePath(
		canonicalWorkspace,
		join(".cline", TRANSACTION_DIRECTORY_NAME),
		"plugin transaction storage",
	);
	return join(
		base,
		".staging",
		`${transactionId ?? "ordinary"}.${process.pid}.${randomUUID()}`,
	);
}

function transactionPaths(
	workspace: string,
	transactionId: string,
): TransactionPaths {
	const root = join(transactionBase(workspace), transactionId);
	return {
		root,
		journal: join(root, "journal.json"),
		candidate: join(root, "candidate"),
		backup: join(root, "backup"),
		oldReceipt: join(root, "old-receipt"),
		newReceipt: join(root, "new-receipt"),
		attestation: join(root, "attestation.json"),
	};
}

function assertContainedWorkspacePath(
	workspace: string,
	value: string,
	label: string,
): string {
	const unresolved = resolve(workspace, value);
	if (existsSync(unresolved) && lstatSync(unresolved).isSymbolicLink()) {
		throw new Error(`${label} cannot be a symbolic link: ${unresolved}`);
	}
	if (isContainedPath(workspace, unresolved)) {
		let lexicalParent = dirname(unresolved);
		while (lexicalParent !== workspace) {
			if (
				existsSync(lexicalParent) &&
				lstatSync(lexicalParent).isSymbolicLink()
			) {
				throw new Error(`${label} has a symlinked parent: ${lexicalParent}`);
			}
			const parent = dirname(lexicalParent);
			if (parent === lexicalParent) break;
			lexicalParent = parent;
		}
	}
	const missing: string[] = [];
	let existingParent = unresolved;
	while (!existsSync(existingParent)) {
		missing.push(basename(existingParent));
		const parent = dirname(existingParent);
		if (parent === existingParent) break;
		existingParent = parent;
	}
	const absolute = resolve(realpathSync(existingParent), ...missing.reverse());
	if (!isContainedPath(workspace, absolute)) {
		throw new Error(`${label} must be contained by the workspace`);
	}
	return absolute;
}

function assertCanonicalRelativePath(value: string, label: string): void {
	if (
		!value ||
		/[\0\r\n\t]/.test(value) ||
		value.includes("\\") ||
		isAbsolute(value) ||
		value === "." ||
		posix.normalize(value) !== value ||
		value
			.split("/")
			.some((segment) => !segment || segment === "." || segment === "..")
	) {
		throw new Error(`${label} must be a canonical workspace-relative path`);
	}
}

function assertTrustedInstallRelativePath(value: string, label: string): void {
	assertCanonicalRelativePath(value, label);
	if (!value.startsWith(".cline/plugins/_installed/")) {
		throw new Error(`${label} must be beneath .cline/plugins/_installed/`);
	}
}

function assertTrustedAttestationRelativePath(
	value: string,
	label: string,
): void {
	assertCanonicalRelativePath(value, label);
	if (!value.startsWith(".qh2/attestations/")) {
		throw new Error(`${label} must be beneath .qh2/attestations/`);
	}
}

function stableJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJournal(
	paths: TransactionPaths,
	journal: PluginInstallJournalV1,
): void {
	atomicWriteDurable(paths.journal, stableJson(journal));
}

function assertJournal(
	value: unknown,
	expectedId: string,
): PluginInstallJournalV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(
			`Malformed plugin install transaction journal for ${expectedId}`,
		);
	}
	const journal = value as Record<string, unknown>;
	const allowed = new Set([
		"schemaVersion",
		"transactionId",
		"phase",
		"workspaceIdentity",
		"installRelativePath",
		"receiptRelativePath",
		"attestationRelativePath",
		"oldInstallPresent",
		"oldInstallTreeSha256",
		"oldReceiptPresent",
		"oldReceiptSha256",
		"nextInstallTreeSha256",
		"nextReceiptSha256",
		"attestationSha256",
		"installTreeAlgorithm",
		"createdAt",
	]);
	if (Object.keys(journal).some((key) => !allowed.has(key))) {
		throw new Error(
			`Unknown field in plugin install transaction ${expectedId}`,
		);
	}
	if (
		journal.schemaVersion !== TRANSACTION_SCHEMA_VERSION ||
		journal.transactionId !== expectedId ||
		typeof journal.workspaceIdentity !== "string" ||
		typeof journal.installRelativePath !== "string" ||
		typeof journal.receiptRelativePath !== "string" ||
		typeof journal.attestationRelativePath !== "string" ||
		typeof journal.oldInstallPresent !== "boolean" ||
		typeof journal.oldReceiptPresent !== "boolean" ||
		typeof journal.nextInstallTreeSha256 !== "string" ||
		typeof journal.nextReceiptSha256 !== "string" ||
		typeof journal.attestationSha256 !== "string" ||
		journal.installTreeAlgorithm !== TREE_DIGEST_ALGORITHM ||
		typeof journal.createdAt !== "string" ||
		![
			"prepared",
			"old-moved",
			"candidate-active",
			"receipt-committed",
			"finalizing",
		].includes(String(journal.phase))
	) {
		throw new Error(
			`Malformed plugin install transaction journal for ${expectedId}`,
		);
	}
	for (const [valueToCheck, label] of [
		[journal.nextInstallTreeSha256, "nextInstallTreeSha256"],
		[journal.nextReceiptSha256, "nextReceiptSha256"],
		[journal.attestationSha256, "attestationSha256"],
	] as const)
		assertHexSha256(valueToCheck as string, label);
	if (
		journal.oldInstallPresent !==
		(typeof journal.oldInstallTreeSha256 === "string")
	) {
		throw new Error(
			`Malformed old install identity for transaction ${expectedId}`,
		);
	}
	if (
		journal.oldReceiptPresent !==
		(typeof journal.oldReceiptSha256 === "string")
	) {
		throw new Error(
			`Malformed old receipt identity for transaction ${expectedId}`,
		);
	}
	if (typeof journal.oldInstallTreeSha256 === "string") {
		assertHexSha256(journal.oldInstallTreeSha256, "oldInstallTreeSha256");
	}
	if (typeof journal.oldReceiptSha256 === "string") {
		assertHexSha256(journal.oldReceiptSha256, "oldReceiptSha256");
	}
	assertTrustedInstallRelativePath(
		journal.installRelativePath as string,
		"installRelativePath",
	);
	assertCanonicalRelativePath(
		journal.receiptRelativePath as string,
		"receiptRelativePath",
	);
	if (journal.receiptRelativePath !== ".qh2/adr-planner.lock") {
		throw new Error(
			`receiptRelativePath must be .qh2/adr-planner.lock for transaction ${expectedId}`,
		);
	}
	assertTrustedAttestationRelativePath(
		journal.attestationRelativePath as string,
		"attestationRelativePath",
	);
	return journal as unknown as PluginInstallJournalV1;
}

function readJournal(
	paths: TransactionPaths,
	transactionId: string,
): PluginInstallJournalV1 {
	const stats = lstatSync(paths.journal);
	if (stats.isSymbolicLink() || !stats.isFile()) {
		throw new Error(
			`Plugin install transaction journal must be a regular file: ${paths.journal}`,
		);
	}
	const text = readFileSync(paths.journal, "utf8");
	const journal = assertJournal(JSON.parse(text), transactionId);
	if (text !== stableJson(journal)) {
		throw new Error(
			`Noncanonical plugin install transaction journal for ${transactionId}`,
		);
	}
	return journal;
}

function pathDigest(path: string): string | undefined {
	return existsSync(path) ? hashPluginInstallTree(path) : undefined;
}

function fileDigest(path: string): string | undefined {
	return existsSync(path) ? sha256Bytes(readFileSync(path)) : undefined;
}

function assertRegularEvidenceFile(path: string, label: string): void {
	if (!existsSync(path)) {
		throw new Error(`${label} is unavailable: ${path}`);
	}
	const stats = lstatSync(path);
	if (stats.isSymbolicLink() || !stats.isFile()) {
		throw new Error(`${label} must be a regular file: ${path}`);
	}
}

function receiptAuthority(
	receiptPath: string,
	journal: PluginInstallJournalV1,
): "old" | "next" {
	const currentPresent = existsSync(receiptPath);
	const currentDigest = currentPresent ? fileDigest(receiptPath) : undefined;
	if (currentPresent && currentDigest === journal.nextReceiptSha256)
		return "next";
	if (
		currentPresent === journal.oldReceiptPresent &&
		currentDigest === journal.oldReceiptSha256
	)
		return "old";
	throw new Error(
		`Plugin install transaction ${journal.transactionId} has an unknown or malformed receipt; preserving recovery evidence`,
	);
}

function removeTreeWithDigest(path: string, expectedDigest: string): void {
	if (!existsSync(path)) return;
	const actual = hashPluginInstallTree(path);
	if (actual !== expectedDigest) {
		throw new Error(
			`Refusing to remove an install tree with unknown digest at ${path}`,
		);
	}
	rmSync(path, { recursive: true, force: true });
}

function recoverOneLocked(
	workspace: string,
	transactionId: string,
): PluginInstallRecoveryResult {
	assertHexSha256(transactionId, "transactionId");
	const paths = transactionPaths(workspace, transactionId);
	if (!existsSync(paths.journal)) {
		if (existsSync(paths.backup)) {
			throw new Error(
				`Transaction ${transactionId} has a backup but no journal; preserving recovery evidence`,
			);
		}
		rmSync(paths.root, { recursive: true, force: true });
		fsyncPath(dirname(paths.root));
		return { transactionId, action: "rolled-back" };
	}
	const journal = readJournal(paths, transactionId);
	if (journal.workspaceIdentity !== workspace) {
		throw new Error(
			`Transaction ${transactionId} belongs to another workspace`,
		);
	}
	const installPath = assertContainedWorkspacePath(
		workspace,
		journal.installRelativePath,
		"install path",
	);
	const receiptPath = assertContainedWorkspacePath(
		workspace,
		journal.receiptRelativePath,
		"receipt path",
	);
	const attestationPath = assertContainedWorkspacePath(
		workspace,
		journal.attestationRelativePath,
		"attestation path",
	);
	assertRegularEvidenceFile(paths.newReceipt, "New receipt evidence");
	assertRegularEvidenceFile(paths.attestation, "Attestation evidence");
	if (journal.oldReceiptPresent) {
		assertRegularEvidenceFile(paths.oldReceipt, "Old receipt evidence");
	} else if (existsSync(paths.oldReceipt)) {
		throw new Error(
			`Unexpected old receipt evidence for transaction ${transactionId}`,
		);
	}
	if (fileDigest(paths.newReceipt) !== journal.nextReceiptSha256) {
		throw new Error(
			`New receipt evidence does not match transaction ${transactionId}`,
		);
	}
	if (fileDigest(paths.attestation) !== journal.attestationSha256) {
		throw new Error(
			`Attestation evidence does not match transaction ${transactionId}`,
		);
	}
	if (
		journal.oldReceiptPresent &&
		fileDigest(paths.oldReceipt) !== journal.oldReceiptSha256
	) {
		throw new Error(
			`Old receipt evidence does not match transaction ${transactionId}`,
		);
	}
	const authority = receiptAuthority(receiptPath, journal);
	const activeDigest = pathDigest(installPath);
	const candidateDigest = pathDigest(paths.candidate);
	const backupDigest = pathDigest(paths.backup);
	if (
		activeDigest !== undefined &&
		activeDigest !== journal.oldInstallTreeSha256 &&
		activeDigest !== journal.nextInstallTreeSha256
	) {
		throw new Error(
			`Unknown active install digest for transaction ${transactionId}`,
		);
	}
	if (
		candidateDigest !== undefined &&
		candidateDigest !== journal.nextInstallTreeSha256
	) {
		throw new Error(
			`Unknown candidate digest for transaction ${transactionId}`,
		);
	}
	if (
		backupDigest !== undefined &&
		(!journal.oldInstallPresent ||
			backupDigest !== journal.oldInstallTreeSha256)
	) {
		throw new Error(`Unknown backup digest for transaction ${transactionId}`);
	}

	if (authority === "old") {
		if (
			activeDigest === journal.nextInstallTreeSha256 &&
			(!journal.oldInstallPresent ||
				journal.oldInstallTreeSha256 !== journal.nextInstallTreeSha256)
		) {
			removeTreeWithDigest(installPath, journal.nextInstallTreeSha256);
		} else if (
			activeDigest !== undefined &&
			activeDigest !== journal.oldInstallTreeSha256
		) {
			throw new Error(
				`Unknown active install digest for transaction ${transactionId}`,
			);
		}
		if (journal.oldInstallPresent && !existsSync(installPath)) {
			if (backupDigest !== journal.oldInstallTreeSha256) {
				throw new Error(
					`Old install backup is unavailable for transaction ${transactionId}`,
				);
			}
			renameSync(paths.backup, installPath);
			fsyncPath(dirname(installPath));
		}
		if (!journal.oldInstallPresent && existsSync(installPath)) {
			throw new Error(
				`Fresh-install rollback left an unexpected active tree for ${transactionId}`,
			);
		}
		if (
			candidateDigest !== undefined &&
			candidateDigest !== journal.nextInstallTreeSha256
		) {
			throw new Error(
				`Unknown candidate digest for transaction ${transactionId}`,
			);
		}
		if (
			backupDigest !== undefined &&
			backupDigest !== journal.oldInstallTreeSha256
		) {
			throw new Error(`Unknown backup digest for transaction ${transactionId}`);
		}
		if (
			existsSync(attestationPath) &&
			fileDigest(attestationPath) === journal.attestationSha256
		) {
			rmSync(attestationPath, { force: true });
		}
		rmSync(paths.root, { recursive: true, force: true });
		fsyncPath(dirname(paths.root));
		return { transactionId, action: "rolled-back" };
	}

	if (activeDigest !== journal.nextInstallTreeSha256) {
		if (
			activeDigest !== undefined &&
			activeDigest !== journal.oldInstallTreeSha256
		) {
			throw new Error(
				`Unknown active install digest for transaction ${transactionId}`,
			);
		}
		if (candidateDigest !== journal.nextInstallTreeSha256) {
			throw new Error(
				`New install is unavailable for committed transaction ${transactionId}`,
			);
		}
		if (activeDigest === journal.oldInstallTreeSha256) {
			if (existsSync(paths.backup)) {
				if (backupDigest !== journal.oldInstallTreeSha256) {
					throw new Error(
						`Unknown backup digest for transaction ${transactionId}`,
					);
				}
				removeTreeWithDigest(
					installPath,
					journal.oldInstallTreeSha256 as string,
				);
			} else {
				renameSync(installPath, paths.backup);
			}
		}
		renameSync(paths.candidate, installPath);
		fsyncPath(dirname(installPath));
	}
	if (hashPluginInstallTree(installPath) !== journal.nextInstallTreeSha256) {
		throw new Error(
			`Committed install digest mismatch for transaction ${transactionId}`,
		);
	}
	if (
		!existsSync(attestationPath) ||
		fileDigest(attestationPath) !== journal.attestationSha256
	) {
		if (fileDigest(paths.attestation) !== journal.attestationSha256) {
			throw new Error(
				`Attestation is unavailable for transaction ${transactionId}`,
			);
		}
		atomicWriteDurable(
			attestationPath,
			readFileSync(paths.attestation, "utf8"),
		);
	}
	journal.phase = "finalizing";
	writeJournal(paths, journal);
	if (existsSync(paths.backup)) {
		removeTreeWithDigest(paths.backup, journal.oldInstallTreeSha256 as string);
	}
	rmSync(paths.root, { recursive: true, force: true });
	fsyncPath(dirname(paths.root));
	return { transactionId, action: "finalized" };
}

function acquireMutationLock(workspace: string): AcquiredMutationLock {
	const base = transactionBase(workspace);
	mkdirSync(base, { recursive: true });
	const lockDir = join(base, LOCK_DIRECTORY_NAME);
	const started = Date.now();
	while (true) {
		const token = `${process.pid}.${randomUUID()}`;
		const stagingLock = `${lockDir}.tmp.${token}`;
		try {
			mkdirSync(stagingLock);
			const ownerContents = `${process.pid}\n`;
			writeFileSync(join(stagingLock, `owner.${token}`), ownerContents, {
				flag: "wx",
			});
			fsyncPath(stagingLock);
			renameSync(stagingLock, lockDir);
			const ownerFile = join(lockDir, `owner.${token}`);
			fsyncPath(lockDir);
			return { lockDir, ownerFile, ownerContents };
		} catch (error) {
			rmSync(stagingLock, { recursive: true, force: true });
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
			let ownerEntries: string[];
			try {
				const lockStats = lstatSync(lockDir);
				if (lockStats.isSymbolicLink() || !lockStats.isDirectory()) {
					throw new Error(
						`Plugin mutation lock must be a regular directory: ${lockDir}`,
					);
				}
				ownerEntries = readdirSync(lockDir);
			} catch (readLockError) {
				if ((readLockError as NodeJS.ErrnoException).code === "ENOENT")
					continue;
				throw readLockError;
			}
			if (ownerEntries.length !== 1) {
				throw new Error(
					`Malformed plugin mutation lock owner at ${lockDir}; expected exactly one owner marker`,
				);
			}
			const owner = ownerEntries[0] ?? "";
			const ownerMatch =
				/^owner\.([1-9][0-9]*)\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(
					owner,
				);
			if (!ownerMatch) {
				throw new Error(
					`Malformed plugin mutation lock owner marker at ${join(lockDir, owner)}`,
				);
			}
			const ownerFile = join(lockDir, owner);
			const ownerPid = Number(ownerMatch[1]);
			let ownerStats: ReturnType<typeof lstatSync>;
			let ownerContents: string;
			try {
				ownerStats = lstatSync(ownerFile);
				ownerContents = readFileSync(ownerFile, "utf8");
			} catch (ownerReadError) {
				if ((ownerReadError as NodeJS.ErrnoException).code === "ENOENT") {
					continue;
				}
				throw ownerReadError;
			}
			if (
				ownerStats.isSymbolicLink() ||
				!ownerStats.isFile() ||
				!Number.isSafeInteger(ownerPid) ||
				ownerContents !== `${ownerPid}\n`
			) {
				throw new Error(
					`Malformed plugin mutation lock owner marker at ${ownerFile}`,
				);
			}
			let ownerAlive = true;
			if (ownerAlive) {
				try {
					process.kill(ownerPid, 0);
				} catch (ownerError) {
					if ((ownerError as NodeJS.ErrnoException).code === "ESRCH")
						ownerAlive = false;
					else if ((ownerError as NodeJS.ErrnoException).code !== "EPERM")
						throw ownerError;
				}
			}
			if (!ownerAlive) {
				const stale = `${lockDir}.stale.${process.pid}.${randomUUID()}`;
				try {
					renameSync(lockDir, stale);
					rmSync(stale, { recursive: true, force: true });
				} catch (reclaimError) {
					if ((reclaimError as NodeJS.ErrnoException).code !== "ENOENT")
						throw reclaimError;
				}
				continue;
			}
			if (Date.now() - started > LOCK_STALE_MS) {
				throw new Error(
					`Timed out waiting for plugin mutation lock at ${lockDir}`,
				);
			}
			Atomics.wait(
				new Int32Array(new SharedArrayBuffer(4)),
				0,
				0,
				LOCK_POLL_MS,
			);
		}
	}
}

function releaseMutationLock(lock: AcquiredMutationLock): void {
	if (!existsSync(lock.ownerFile)) {
		throw new Error(
			`Plugin mutation lock owner disappeared before release: ${lock.ownerFile}`,
		);
	}
	const ownerStats = lstatSync(lock.ownerFile);
	if (
		ownerStats.isSymbolicLink() ||
		!ownerStats.isFile() ||
		readFileSync(lock.ownerFile, "utf8") !== lock.ownerContents
	) {
		throw new Error(
			`Plugin mutation lock ownership changed unexpectedly at ${lock.ownerFile}`,
		);
	}
	const entries = readdirSync(lock.lockDir);
	if (
		entries.length !== 1 ||
		join(lock.lockDir, entries[0] ?? "") !== lock.ownerFile
	) {
		throw new Error(
			`Plugin mutation lock contains unexpected artifacts at ${lock.lockDir}`,
		);
	}
	const releasedDir = `${lock.lockDir}.stale.${process.pid}.${randomUUID()}`;
	renameSync(lock.lockDir, releasedDir);
	rmSync(join(releasedDir, basename(lock.ownerFile)), { force: true });
	rmdirSync(releasedDir);
}

function withMutationLock<T>(workspace: string, body: () => T): T {
	const lock = acquireMutationLock(workspace);
	try {
		return body();
	} finally {
		releaseMutationLock(lock);
	}
}

function transactionIds(workspace: string): string[] {
	const base = transactionBase(workspace);
	if (!existsSync(base)) return [];
	const ids: string[] = [];
	for (const entry of readdirSync(base, { withFileTypes: true })) {
		if (entry.name === ".staging" && entry.isDirectory()) {
			continue;
		}
		if (entry.name === LOCK_DIRECTORY_NAME) continue;
		if (
			entry.isDirectory() &&
			/^\.mutation\.lock\.(?:tmp|stale)\.[1-9][0-9]*\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
				entry.name,
			)
		) {
			continue;
		}
		if (entry.isDirectory() && /^[0-9a-f]{64}$/.test(entry.name)) {
			ids.push(entry.name);
			continue;
		}
		throw new Error(
			`Unknown plugin transaction artifact at ${join(base, entry.name)}; preserving it for repair`,
		);
	}
	return ids.sort();
}

function recoverAllLocked(workspace: string): PluginInstallRecoveryResult[] {
	return transactionIds(workspace).map((id) => recoverOneLocked(workspace, id));
}

export function recoverPluginInstallTransactions(
	workspacePath: string,
): PluginInstallRecoveryResult[] {
	const workspace = realpathSync(resolve(workspacePath));
	return withMutationLock(workspace, () => recoverAllLocked(workspace));
}

export function withPluginInstallMutationLock<T>(
	workspacePath: string,
	body: () => T,
): T {
	const workspace = realpathSync(resolve(workspacePath));
	return withMutationLock(workspace, () => {
		recoverAllLocked(workspace);
		return body();
	});
}

function assertReceiptBoundAttestation(
	workspace: string,
	receiptValues: Map<string, string>,
): PluginInstallAttestationV1 {
	const transactionId = receiptValues.get("install_transaction_id") ?? "";
	const packageContentSha256 =
		receiptValues.get("package_content_sha256") ?? "";
	const attestationRelativePath =
		receiptValues.get("install_attestation_path") ?? "";
	const attestationSha256 =
		receiptValues.get("install_attestation_sha256") ?? "";
	const installedContentSha256 =
		receiptValues.get("installed_content_sha256") ?? "";
	for (const [value, label] of [
		[
			receiptValues.get("package_manifest_sha256") ?? "",
			"package_manifest_sha256",
		],
		[packageContentSha256, "package_content_sha256"],
		[transactionId, "install_transaction_id"],
		[attestationSha256, "install_attestation_sha256"],
		[installedContentSha256, "installed_content_sha256"],
	] as const) {
		assertHexSha256(value, label);
	}
	if (transactionId !== packageContentSha256) {
		throw new Error(
			"Receipt install_transaction_id must match package_content_sha256",
		);
	}
	assertTrustedAttestationRelativePath(
		attestationRelativePath,
		"install_attestation_path",
	);
	const attestationPath = assertContainedWorkspacePath(
		workspace,
		attestationRelativePath,
		"receipt attestation",
	);
	assertRegularEvidenceFile(attestationPath, "Receipt attestation");
	if (fileDigest(attestationPath) !== attestationSha256) {
		throw new Error("Receipt attestation digest does not match its receipt");
	}
	const text = readFileSync(attestationPath, "utf8");
	const parsed = JSON.parse(text) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Receipt attestation must be a JSON object");
	}
	const value = parsed as Record<string, unknown>;
	if (
		Object.keys(value).length !== INSTALL_ATTESTATION_KEYS.length ||
		Object.keys(value).some(
			(key) => !(INSTALL_ATTESTATION_KEYS as readonly string[]).includes(key),
		)
	) {
		throw new Error("Receipt attestation has unknown or missing fields");
	}
	if (text !== stableJson(value)) {
		throw new Error("Receipt attestation is not canonical JSON");
	}
	if (
		value.schemaVersion !== 1 ||
		value.transactionId !== transactionId ||
		value.status !== "committed" ||
		typeof value.installRelativePath !== "string" ||
		!Array.isArray(value.entryRelativePaths) ||
		value.entryRelativePaths.some((entry) => typeof entry !== "string") ||
		value.installedContentSha256 !== installedContentSha256 ||
		value.installTreeAlgorithm !== TREE_DIGEST_ALGORITHM ||
		value.pluginApiVersion !== receiptValues.get("plugin_api_version") ||
		value.hostVersion !== receiptValues.get("host_version") ||
		!value.verification ||
		typeof value.verification !== "object" ||
		Array.isArray(value.verification)
	) {
		throw new Error("Receipt attestation does not match its receipt");
	}
	assertTrustedInstallRelativePath(
		value.installRelativePath,
		"attestation installRelativePath",
	);
	for (const entry of value.entryRelativePaths as string[]) {
		assertCanonicalRelativePath(entry, "attestation entryRelativePath");
		if (!entry.startsWith(`${value.installRelativePath}/`)) {
			throw new Error(
				"Attestation entry paths must be descendants of its install path",
			);
		}
	}
	return value as unknown as PluginInstallAttestationV1;
}

/**
 * Refuses generic removal when the workspace receipt structurally binds the
 * target install. Legacy schema-1/2 receipts have no attestation, so the
 * plugin names are used only as a conservative compatibility fallback.
 */
export function assertPluginInstallPathNotReceiptBound(
	workspacePath: string,
	installPath: string,
	pluginNames: readonly string[] = [],
): void {
	const workspace = realpathSync(resolve(workspacePath));
	const resolvedInstallPath = resolve(installPath);
	const absoluteInstallPath = existsSync(resolvedInstallPath)
		? realpathSync(resolvedInstallPath)
		: resolvedInstallPath;
	if (!isContainedPath(workspace, absoluteInstallPath)) return;
	const receiptPath = assertContainedWorkspacePath(
		workspace,
		".qh2/adr-planner.lock",
		"ADR Planner receipt",
	);
	if (!existsSync(receiptPath)) return;
	try {
		assertExistingReceiptCanonical(receiptPath);
		const schema = readFileSync(receiptPath, "utf8").split("\n", 1)[0];
		if (schema !== "schema_version=3") {
			const isAdrPlanner = pluginNames.some((name) => {
				const normalized = name.trim().toLowerCase();
				return (
					normalized === "adr-planner" || normalized === "@cline/adr-planner"
				);
			});
			if (!isAdrPlanner) return;
			throw new Error("legacy receipt binds this ADR Planner install");
		}
		const values = parseStrictKeyValueFile(receiptPath, [
			...RECEIPT_INTENT_KEYS,
			...RECEIPT_ATTESTATION_KEYS,
		]);
		const attestation = assertReceiptBoundAttestation(workspace, values);
		const boundInstallPath = assertContainedWorkspacePath(
			workspace,
			attestation.installRelativePath,
			"attested install path",
		);
		if (boundInstallPath !== absoluteInstallPath) return;
		throw new Error("receipt attestation binds this install path");
	} catch (error) {
		throw new Error(
			"ADR Planner is receipt-bound, or its receipt evidence is invalid, and cannot be removed by generic plugin uninstall. Use the receipt-aware uninstall workflow so install and receipt remain consistent.",
			{ cause: error },
		);
	}
}

function buildReceipt(
	intent: PluginInstallReceiptIntent,
	input: {
		transactionId: string;
		attestationRelativePath: string;
		attestationSha256: string;
		installedContentSha256: string;
		pluginApiVersion: string;
		hostVersion: string;
	},
): string {
	return [
		`schema_version=${intent.schemaVersion}`,
		`source_kind=${intent.sourceKind}`,
		`source=${intent.source}`,
		`ref=${intent.ref}`,
		`subdir=${intent.subdir}`,
		`package_manifest_sha256=${intent.packageManifestSha256}`,
		`source_dirty=${String(intent.sourceDirty)}`,
		`package_content_sha256=${intent.packageContentSha256}`,
		`install_transaction_id=${input.transactionId}`,
		`install_attestation_path=${input.attestationRelativePath}`,
		`install_attestation_sha256=${input.attestationSha256}`,
		`installed_content_sha256=${input.installedContentSha256}`,
		`plugin_api_version=${input.pluginApiVersion}`,
		`host_version=${input.hostVersion}`,
		"",
	].join("\n");
}

export function commitPluginInstallTransaction(input: {
	workspacePath: string;
	stagingRoot: string;
	installPath: string;
	entryPaths: readonly string[];
	verification: PluginInstallVerificationResult;
	force: boolean;
	transaction: PluginInstallTransactionOptions;
	sourceIdentity: {
		packageManifestSha256: string;
		packageContentSha256: string;
	};
}): PluginInstallTransactionResult {
	const workspace = realpathSync(resolve(input.workspacePath));
	const intentPath = assertContainedWorkspacePath(
		workspace,
		input.transaction.receiptIntentPath,
		"receipt intent",
	);
	const receiptPath = assertContainedWorkspacePath(
		workspace,
		input.transaction.receiptPath,
		"transaction receipt",
	);
	const intent = readPluginInstallReceiptIntent(intentPath);
	if (
		intent.packageManifestSha256 !==
			input.sourceIdentity.packageManifestSha256 ||
		intent.packageContentSha256 !== input.sourceIdentity.packageContentSha256
	) {
		throw new Error(
			"Receipt intent does not match the copied pre-dependency source package",
		);
	}
	const transactionId = intent.packageContentSha256;
	const paths = transactionPaths(workspace, transactionId);
	const installPath = assertContainedWorkspacePath(
		workspace,
		input.installPath,
		"install path",
	);
	const installRelativePath = toPosixPath(relative(workspace, installPath));
	assertTrustedInstallRelativePath(installRelativePath, "install path");
	const receiptRelativePath = toPosixPath(relative(workspace, receiptPath));
	assertCanonicalRelativePath(receiptRelativePath, "transaction receipt");
	if (receiptRelativePath !== ".qh2/adr-planner.lock") {
		throw new Error(
			"Transactional ADR Planner installs require receiptPath=.qh2/adr-planner.lock",
		);
	}
	const hostVersion = input.transaction.hostVersion?.trim() || "unknown";
	if (hostVersion.includes("\n") || hostVersion.includes("\r")) {
		throw new Error("hostVersion must be a single line");
	}
	if (input.verification.capabilities.includes("mcp")) {
		throw new Error(
			"Transactional plugin installs do not support MCP contributions",
		);
	}
	const stagedDigest = hashPluginInstallTree(input.stagingRoot);
	if (stagedDigest !== input.verification.stagedContentSha256) {
		throw new Error(
			"Plugin transaction candidate differs from verified staging content",
		);
	}
	input.transaction.testBeforeMutationLock?.();

	return withMutationLock(workspace, () => {
		recoverAllLocked(workspace);
		if (existsSync(installPath) && !input.force) {
			throw new Error(
				`Plugin is already installed at ${installPath}. Use --force to replace it.`,
			);
		}
		if (existsSync(paths.root)) {
			throw new Error(
				`Plugin install transaction already exists: ${transactionId}`,
			);
		}
		mkdirSync(paths.root, { recursive: true });
		const installParent = dirname(installPath);
		mkdirSync(installParent, { recursive: true });
		if (statSync(paths.root).dev !== statSync(installParent).dev) {
			throw new Error(
				"Plugin transaction and install paths must be on the same filesystem",
			);
		}
		renameSync(input.stagingRoot, paths.candidate);
		fsyncTree(paths.candidate);
		fsyncPath(paths.root);

		const oldInstallPresent = existsSync(installPath);
		const oldInstallTreeSha256 = oldInstallPresent
			? hashPluginInstallTree(installPath)
			: undefined;
		assertExistingReceiptCanonical(receiptPath);
		const oldReceiptPresent = existsSync(receiptPath);
		const oldReceiptBytes = oldReceiptPresent
			? readFileSync(receiptPath)
			: undefined;
		const oldReceiptSha256 = oldReceiptBytes
			? sha256Bytes(oldReceiptBytes)
			: undefined;
		if (oldReceiptBytes) {
			writeFileSync(paths.oldReceipt, oldReceiptBytes, {
				flag: "wx",
				mode: 0o600,
			});
			fsyncPath(paths.oldReceipt);
		}
		const attestation: PluginInstallAttestationV1 = {
			schemaVersion: 1,
			transactionId,
			status: "committed",
			installRelativePath,
			entryRelativePaths: input.entryPaths.map((entry) =>
				toPosixPath(relative(workspace, resolve(installPath, entry))),
			),
			installedContentSha256: stagedDigest,
			installTreeAlgorithm: TREE_DIGEST_ALGORITHM,
			pluginApiVersion: PLUGIN_API_VERSION,
			hostVersion,
			verification: input.verification,
		};
		const attestationBytes = stableJson(attestation);
		const attestationSha256 = sha256Bytes(attestationBytes);
		const attestationRelativePath = `.qh2/attestations/${transactionId}-${attestationSha256}.json`;
		const attestationPath = assertContainedWorkspacePath(
			workspace,
			attestationRelativePath,
			"attestation path",
		);
		writeFileSync(paths.attestation, attestationBytes, {
			flag: "wx",
			mode: 0o600,
		});
		fsyncPath(paths.attestation);
		const receiptBytes = buildReceipt(intent, {
			transactionId,
			attestationRelativePath,
			attestationSha256,
			installedContentSha256: stagedDigest,
			pluginApiVersion: PLUGIN_API_VERSION,
			hostVersion,
		});
		if (
			oldInstallTreeSha256 === stagedDigest &&
			oldReceiptBytes?.equals(Buffer.from(receiptBytes, "utf8"))
		) {
			if (fileDigest(attestationPath) !== attestationSha256) {
				throw new Error(
					"Same-pin receipt is authoritative but its attestation is missing or mismatched",
				);
			}
			rmSync(paths.root, { recursive: true, force: true });
			fsyncPath(dirname(paths.root));
			return {
				transactionId,
				receiptPath,
				attestationPath,
				attestationSha256,
				installedContentSha256: stagedDigest,
				pluginApiVersion: PLUGIN_API_VERSION,
				hostVersion,
			};
		}
		writeFileSync(paths.newReceipt, receiptBytes, { flag: "wx", mode: 0o600 });
		fsyncPath(paths.newReceipt);
		const journal: PluginInstallJournalV1 = {
			schemaVersion: 1,
			transactionId,
			phase: "prepared",
			workspaceIdentity: workspace,
			installRelativePath,
			receiptRelativePath,
			attestationRelativePath,
			oldInstallPresent,
			...(oldInstallTreeSha256 ? { oldInstallTreeSha256 } : {}),
			oldReceiptPresent,
			...(oldReceiptSha256 ? { oldReceiptSha256 } : {}),
			nextInstallTreeSha256: stagedDigest,
			nextReceiptSha256: sha256Bytes(receiptBytes),
			attestationSha256,
			installTreeAlgorithm: TREE_DIGEST_ALGORITHM,
			createdAt: new Date().toISOString(),
		};
		writeJournal(paths, journal);
		input.transaction.testFaultInjector?.("prepared");

		try {
			if (oldInstallPresent) {
				renameSync(installPath, paths.backup);
				fsyncPath(installParent);
			}
			journal.phase = "old-moved";
			writeJournal(paths, journal);
			input.transaction.testFaultInjector?.("old-moved");
			renameSync(paths.candidate, installPath);
			fsyncPath(installParent);
			if (hashPluginInstallTree(installPath) !== stagedDigest) {
				throw new Error(
					"Installed package content does not match verified transaction candidate",
				);
			}
			journal.phase = "candidate-active";
			writeJournal(paths, journal);
			input.transaction.testFaultInjector?.("candidate-active");
			atomicWriteDurable(attestationPath, attestationBytes);
			input.transaction.testFaultInjector?.("attestation-written");
			atomicWriteDurable(receiptPath, receiptBytes);
			journal.phase = "receipt-committed";
			writeJournal(paths, journal);
			input.transaction.testFaultInjector?.("receipt-committed");
			if (
				hashPluginInstallTree(installPath) !== stagedDigest ||
				fileDigest(receiptPath) !== journal.nextReceiptSha256 ||
				fileDigest(attestationPath) !== attestationSha256
			)
				throw new Error(
					"Transactional plugin install failed final on-disk validation",
				);
			journal.phase = "finalizing";
			writeJournal(paths, journal);
			if (oldInstallTreeSha256 && existsSync(paths.backup)) {
				removeTreeWithDigest(paths.backup, oldInstallTreeSha256);
			}
			input.transaction.testFaultInjector?.("backup-deleted");
			rmSync(paths.root, { recursive: true, force: true });
			fsyncPath(dirname(paths.root));
		} catch (error) {
			try {
				recoverOneLocked(workspace, transactionId);
			} catch (recoveryError) {
				throw new AggregateError(
					[error, recoveryError],
					`Plugin install transaction ${transactionId} failed and automatic recovery could not converge`,
				);
			}
			throw error;
		}
		return {
			transactionId,
			receiptPath,
			attestationPath,
			attestationSha256,
			installedContentSha256: stagedDigest,
			pluginApiVersion: PLUGIN_API_VERSION,
			hostVersion,
		};
	});
}
