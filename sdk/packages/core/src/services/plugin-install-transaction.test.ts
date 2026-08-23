import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	discoverPluginModulePaths,
	setClineDir,
	setHomeDir,
} from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installPlugin } from "./plugin-install";
import {
	hashPluginReceiptPackageContent,
	type PluginInstallTransactionOptions,
	recoverPluginInstallTransactions,
	withPluginInstallMutationLock,
} from "./plugin-install-transaction";

describe("transactional plugin install", () => {
	let root = "";
	let workspace = "";
	let source = "";
	let npmCommand = "";
	let originalHome: string | undefined;
	let originalClineDir: string | undefined;

	function runChild(args: string[]): Promise<{
		code: number | null;
		signal: NodeJS.Signals | null;
		stderr: string;
	}> {
		return new Promise((resolveResult, reject) => {
			const child = spawn("bun", ["--conditions=development", ...args], {
				env: {
					...process.env,
					CLINE_PLUGIN_IMPORT_TIMEOUT_MS: "20000",
				},
				stdio: ["ignore", "ignore", "pipe"],
			});
			let stderr = "";
			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (chunk: string) => {
				stderr += chunk;
			});
			child.on("error", reject);
			child.on("close", (code, signal) => {
				resolveResult({ code, signal, stderr });
			});
		});
	}

	async function waitForPath(path: string): Promise<void> {
		const started = Date.now();
		while (!existsSync(path)) {
			if (Date.now() - started > 20_000) {
				throw new Error(`Timed out waiting for fixture path: ${path}`);
			}
			await new Promise((resolveWait) => setTimeout(resolveWait, 10));
		}
	}

	async function waitForReadyOrChildFailure(
		path: string,
		childResult: Promise<{ code: number | null; stderr: string }>,
	): Promise<void> {
		await Promise.race([
			waitForPath(path),
			childResult.then((result) => {
				throw new Error(
					`Child exited before reaching race barrier (code ${result.code}): ${result.stderr}`,
				);
			}),
		]);
	}

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "plugin-install-transaction-"));
		workspace = join(root, "workspace");
		source = join(root, "source");
		originalHome = process.env.HOME;
		originalClineDir = process.env.CLINE_DIR;
		process.env.HOME = join(root, "home");
		process.env.CLINE_DIR = join(root, "home", ".cline");
		setHomeDir(process.env.HOME);
		setClineDir(process.env.CLINE_DIR);
		await mkdir(join(workspace, ".qh2"), { recursive: true });
		await mkdir(source, { recursive: true });
		npmCommand = join(root, "npm-stub.sh");
		writeFileSync(npmCommand, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		await writePlugin("first");
	});

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		if (originalClineDir === undefined) delete process.env.CLINE_DIR;
		else process.env.CLINE_DIR = originalClineDir;
		rmSync(root, { recursive: true, force: true });
	});

	async function writePlugin(
		marker: string,
		capabilities: readonly string[] = ["tools"],
	): Promise<void> {
		await writeFile(
			join(source, "package.json"),
			JSON.stringify({
				name: "@cline/adr-planner",
				cline: {
					plugins: [{ paths: ["./index.ts"], capabilities }],
				},
			}),
			"utf8",
		);
		await writeFile(
			join(source, "index.ts"),
			`export default { name: "adr-planner", marker: "${marker}", manifest: { capabilities: ${JSON.stringify(capabilities)} } };`,
			"utf8",
		);
	}

	function writeIntent(): { intentPath: string; transactionId: string } {
		const manifestSha = createHash("sha256")
			.update(readFileSync(join(source, "package.json")))
			.digest("hex");
		const intentPath = join(workspace, ".qh2", "receipt-intent");
		const transactionId = hashPluginReceiptPackageContent(source);
		writeFileSync(
			intentPath,
			[
				"schema_version=3",
				"source_kind=local-development",
				"source=local-checkout",
				"ref=unversioned",
				"subdir=.",
				`package_manifest_sha256=${manifestSha}`,
				"source_dirty=true",
				`package_content_sha256=${transactionId}`,
				"",
			].join("\n"),
			"utf8",
		);
		return { intentPath, transactionId };
	}

	async function install(
		force = false,
		transactionOverrides: Partial<PluginInstallTransactionOptions> = {},
	) {
		const intent = writeIntent();
		return installPlugin({
			source,
			cwd: workspace,
			force,
			npmCommand,
			verification: {
				packageName: "@cline/adr-planner",
				pluginNames: ["adr-planner"],
				capabilities: ["tools"],
				commandNames: [],
				toolNames: [],
				skillNames: [],
			},
			transaction: {
				receiptPath: ".qh2/adr-planner.lock",
				receiptIntentPath: intent.intentPath,
				hostVersion: "test-build",
				...transactionOverrides,
			},
		});
	}

	function receiptField(receipt: string, key: string): string {
		const prefix = `${key}=`;
		const line = receipt
			.split("\n")
			.find((candidate) => candidate.startsWith(prefix));
		if (!line) throw new Error(`Missing receipt field: ${key}`);
		return line.slice(prefix.length);
	}

	function crashInstall(point: string) {
		const childScript = fileURLToPath(
			new URL(
				"./test-fixtures/plugin-install-transaction-child.ts",
				import.meta.url,
			),
		);
		return spawnSync(
			"bun",
			[
				"--conditions=development",
				childScript,
				workspace,
				source,
				npmCommand,
				point,
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					CLINE_PLUGIN_IMPORT_TIMEOUT_MS: "20000",
				},
				timeout: 30_000,
			},
		);
	}

	it("atomically migrates and replaces a verified install with one receipt", async () => {
		const first = await install();
		const firstId = first.transaction?.transactionId ?? "";
		const receiptPath = join(workspace, ".qh2", "adr-planner.lock");
		const firstReceipt = readFileSync(receiptPath, "utf8");
		expect(firstReceipt).toContain("schema_version=3\n");
		expect(firstReceipt).toContain(`install_transaction_id=${firstId}\n`);
		expect(first.transaction?.transactionId).toBe(firstId);
		expect(existsSync(first.transaction?.attestationPath ?? "")).toBe(true);
		expect(
			discoverPluginModulePaths(join(workspace, ".cline", "plugins")),
		).toEqual(first.entryPaths);

		await writePlugin("second");
		const second = await install(true);
		const secondId = second.transaction?.transactionId ?? "";
		const secondReceipt = readFileSync(receiptPath, "utf8");
		expect(secondReceipt).not.toBe(firstReceipt);
		expect(secondReceipt).toContain(`install_transaction_id=${secondId}\n`);
		expect(readFileSync(second.entryPaths[0] ?? "", "utf8")).toContain(
			'marker: "second"',
		);
		expect(
			discoverPluginModulePaths(join(workspace, ".cline", "plugins")),
		).toEqual(second.entryPaths);
		const transactionRoot = join(
			workspace,
			".cline",
			"plugin-install-transactions",
		);
		expect(
			readdirSync(transactionRoot, { withFileTypes: true }).filter(
				(entry) => entry.isDirectory() && /^[0-9a-f]{64}$/.test(entry.name),
			),
		).toEqual([]);
	});

	it("treats an exact same-pin replay as a no-op", async () => {
		const first = await install();
		const receiptPath = join(workspace, ".qh2", "adr-planner.lock");
		const receiptBytes = readFileSync(receiptPath, "utf8");
		const attestationPath = first.transaction?.attestationPath ?? "";
		const attestationBytes = readFileSync(attestationPath, "utf8");
		const installedBytes = readFileSync(first.entryPaths[0] ?? "", "utf8");
		let faultHookCalls = 0;

		const replay = await install(true, {
			testFaultInjector: () => {
				faultHookCalls += 1;
			},
		});

		expect(faultHookCalls).toBe(0);
		expect(replay.transaction?.attestationPath).toBe(attestationPath);
		expect(readFileSync(receiptPath, "utf8")).toBe(receiptBytes);
		expect(readFileSync(attestationPath, "utf8")).toBe(attestationBytes);
		expect(readFileSync(first.entryPaths[0] ?? "", "utf8")).toBe(
			installedBytes,
		);
		expect(recoverPluginInstallTransactions(workspace)).toEqual([]);
	});

	it("rejects a malformed old receipt before swapping and cleans the orphan", async () => {
		const first = await install();
		const installedEntry = first.entryPaths[0] ?? "";
		const oldBytes = readFileSync(installedEntry, "utf8");
		writeFileSync(
			join(workspace, ".qh2", "adr-planner.lock"),
			"schema_version=3\nunknown=value\n",
			"utf8",
		);
		await writePlugin("must-not-activate");
		const newId = hashPluginReceiptPackageContent(source);
		await expect(install(true)).rejects.toThrow(
			/receipt.*(canonical|field|unexpected|unsupported)/i,
		);
		expect(readFileSync(installedEntry, "utf8")).toBe(oldBytes);
		expect(recoverPluginInstallTransactions(workspace)).toEqual([
			{ transactionId: newId, action: "rolled-back" },
		]);
	});

	it("rejects a receipt intent that does not match the copied source package", async () => {
		const { intentPath, transactionId } = writeIntent();
		writeFileSync(
			intentPath,
			readFileSync(intentPath, "utf8").replace(
				`package_content_sha256=${transactionId}`,
				`package_content_sha256=${"0".repeat(64)}`,
			),
			"utf8",
		);
		await expect(
			installPlugin({
				source,
				cwd: workspace,
				npmCommand,
				verification: {},
				transaction: {
					receiptPath: ".qh2/adr-planner.lock",
					receiptIntentPath: intentPath,
				},
			}),
		).rejects.toThrow(
			/does not match the copied pre-dependency source package/,
		);
		expect(existsSync(join(workspace, ".qh2", "adr-planner.lock"))).toBe(false);
		expect(
			discoverPluginModulePaths(join(workspace, ".cline", "plugins")),
		).toEqual([]);
	});

	it("rejects MCP capabilities from the coordinated receipt transaction", async () => {
		await writePlugin("mcp-is-out-of-scope", ["mcp"]);
		const { intentPath } = writeIntent();
		await expect(
			installPlugin({
				source,
				cwd: workspace,
				npmCommand,
				verification: {
					packageName: "@cline/adr-planner",
					pluginNames: ["adr-planner"],
					capabilities: ["mcp"],
					commandNames: [],
					toolNames: [],
					skillNames: [],
				},
				transaction: {
					receiptPath: ".qh2/adr-planner.lock",
					receiptIntentPath: intentPath,
				},
			}),
		).rejects.toThrow(/do not support MCP contributions/);
		expect(existsSync(join(workspace, ".qh2", "adr-planner.lock"))).toBe(false);
		expect(
			discoverPluginModulePaths(join(workspace, ".cline", "plugins")),
		).toEqual([]);
	});

	it("recovers in a fresh process after every durable swap boundary", async () => {
		const points = [
			"prepared",
			"old-moved",
			"candidate-active",
			"attestation-written",
			"receipt-committed",
			"backup-deleted",
		] as const;
		for (const point of points) {
			workspace = join(root, `crash-${point}`);
			await mkdir(join(workspace, ".qh2"), { recursive: true });
			await writePlugin(`old-${point}`);
			const old = await install();
			const oldEntryBytes = readFileSync(old.entryPaths[0] ?? "", "utf8");
			const receiptPath = join(workspace, ".qh2", "adr-planner.lock");
			const oldReceiptBytes = readFileSync(receiptPath, "utf8");
			await writePlugin(`new-${point}`);
			const { transactionId: newId } = writeIntent();

			const child = crashInstall(point);
			expect(child.status).not.toBe(0);
			expect(child.signal).toBe("SIGKILL");
			expect(recoverPluginInstallTransactions(workspace)).toEqual([
				{
					transactionId: newId,
					action:
						point === "receipt-committed" || point === "backup-deleted"
							? "finalized"
							: "rolled-back",
				},
			]);

			if (point === "receipt-committed" || point === "backup-deleted") {
				expect(readFileSync(receiptPath, "utf8")).toContain(
					`install_transaction_id=${newId}\n`,
				);
				expect(readFileSync(old.entryPaths[0] ?? "", "utf8")).toContain(
					`marker: "new-${point}"`,
				);
			} else {
				expect(readFileSync(receiptPath, "utf8")).toBe(oldReceiptBytes);
				expect(readFileSync(old.entryPaths[0] ?? "", "utf8")).toBe(
					oldEntryBytes,
				);
			}
		}
	});

	it("recovers same-tree host changes without confusing old and next authority", async () => {
		const points = [
			"prepared",
			"candidate-active",
			"attestation-written",
			"receipt-committed",
		] as const;
		for (const point of points) {
			workspace = join(root, `same-tree-${point}`);
			await mkdir(join(workspace, ".qh2"), { recursive: true });
			await writePlugin(`same-tree-${point}`);
			const old = await install();
			const receiptPath = join(workspace, ".qh2", "adr-planner.lock");
			const oldReceipt = readFileSync(receiptPath, "utf8");
			const oldAttestationRelativePath = receiptField(
				oldReceipt,
				"install_attestation_path",
			);
			writeIntent();

			const child = crashInstall(point);
			expect(child.signal).toBe("SIGKILL");
			expect(recoverPluginInstallTransactions(workspace)).toEqual([
				{
					transactionId: old.transaction?.transactionId,
					action: point === "receipt-committed" ? "finalized" : "rolled-back",
				},
			]);
			const recoveredReceipt = readFileSync(receiptPath, "utf8");
			const recoveredAttestationRelativePath = receiptField(
				recoveredReceipt,
				"install_attestation_path",
			);
			if (point === "receipt-committed") {
				expect(recoveredReceipt).not.toBe(oldReceipt);
				expect(recoveredAttestationRelativePath).not.toBe(
					oldAttestationRelativePath,
				);
				expect(
					existsSync(join(workspace, recoveredAttestationRelativePath)),
				).toBe(true);
				expect(existsSync(join(workspace, oldAttestationRelativePath))).toBe(
					true,
				);
			} else {
				expect(recoveredReceipt).toBe(oldReceipt);
				expect(recoveredAttestationRelativePath).toBe(
					oldAttestationRelativePath,
				);
			}
			expect(readFileSync(old.entryPaths[0] ?? "", "utf8")).toContain(
				`marker: "same-tree-${point}"`,
			);
		}
	});

	it("fails closed and preserves evidence for a duplicate journal field", async () => {
		const initial = await install();
		const oldBytes = readFileSync(initial.entryPaths[0] ?? "", "utf8");
		await writePlugin("duplicate-journal");
		const { transactionId } = writeIntent();
		expect(crashInstall("prepared").signal).toBe("SIGKILL");
		const journalPath = join(
			workspace,
			".cline",
			"plugin-install-transactions",
			transactionId,
			"journal.json",
		);
		writeFileSync(
			journalPath,
			readFileSync(journalPath, "utf8").replace(
				'  "schemaVersion": 1,',
				'  "schemaVersion": 1,\n  "schemaVersion": 1,',
			),
			"utf8",
		);
		expect(() => recoverPluginInstallTransactions(workspace)).toThrow(
			/Noncanonical.*journal/,
		);
		expect(readFileSync(initial.entryPaths[0] ?? "", "utf8")).toBe(oldBytes);
		expect(existsSync(dirname(journalPath))).toBe(true);
	});

	it.skipIf(process.platform === "win32")(
		"rejects symlinked transaction evidence",
		async () => {
			await install();
			await writePlugin("symlinked-evidence");
			const { transactionId } = writeIntent();
			expect(crashInstall("prepared").signal).toBe("SIGKILL");
			const transactionRoot = join(
				workspace,
				".cline",
				"plugin-install-transactions",
				transactionId,
			);
			const newReceiptPath = join(transactionRoot, "new-receipt");
			rmSync(newReceiptPath);
			symlinkSync("attestation.json", newReceiptPath);
			expect(() => recoverPluginInstallTransactions(workspace)).toThrow(
				/New receipt evidence must be a regular file/,
			);
			expect(lstatSync(newReceiptPath).isSymbolicLink()).toBe(true);
			expect(existsSync(transactionRoot)).toBe(true);
		},
	);

	it.skipIf(process.platform === "win32")(
		"rejects a symlinked transaction candidate before recovery mutation",
		async () => {
			const initial = await install();
			const oldBytes = readFileSync(initial.entryPaths[0] ?? "", "utf8");
			const oldReceipt = readFileSync(
				join(workspace, ".qh2", "adr-planner.lock"),
				"utf8",
			);
			await writePlugin("symlinked-candidate");
			const { transactionId } = writeIntent();
			expect(crashInstall("prepared").signal).toBe("SIGKILL");
			const candidate = join(
				workspace,
				".cline",
				"plugin-install-transactions",
				transactionId,
				"candidate",
			);
			rmSync(candidate, { recursive: true, force: true });
			symlinkSync(source, candidate, "dir");

			expect(() => recoverPluginInstallTransactions(workspace)).toThrow(
				/tree root must be a regular directory/,
			);
			expect(lstatSync(candidate).isSymbolicLink()).toBe(true);
			expect(readFileSync(initial.entryPaths[0] ?? "", "utf8")).toBe(oldBytes);
			expect(
				readFileSync(join(workspace, ".qh2", "adr-planner.lock"), "utf8"),
			).toBe(oldReceipt);
		},
	);

	it("fails closed on path escape and unknown active content", async () => {
		const initial = await install();
		await writePlugin("unknown-active");
		const { transactionId } = writeIntent();
		expect(crashInstall("candidate-active").signal).toBe("SIGKILL");
		const transactionRoot = join(
			workspace,
			".cline",
			"plugin-install-transactions",
			transactionId,
		);
		writeFileSync(
			initial.entryPaths[0] ?? "",
			"tampered active bytes\n",
			"utf8",
		);
		expect(() => recoverPluginInstallTransactions(workspace)).toThrow(
			/Unknown active install digest/,
		);
		expect(existsSync(transactionRoot)).toBe(true);

		const journalPath = join(transactionRoot, "journal.json");
		const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Record<
			string,
			unknown
		>;
		journal.installRelativePath = "../outside";
		writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
		expect(() => recoverPluginInstallTransactions(workspace)).toThrow(
			/canonical workspace-relative path/,
		);
		expect(existsSync(transactionRoot)).toBe(true);
	});

	it("rejects noncanonical and untrusted journal role paths", async () => {
		await install();
		await writePlugin("untrusted-role-paths");
		const { transactionId } = writeIntent();
		expect(crashInstall("prepared").signal).toBe("SIGKILL");
		const journalPath = join(
			workspace,
			".cline",
			"plugin-install-transactions",
			transactionId,
			"journal.json",
		);
		const original = JSON.parse(readFileSync(journalPath, "utf8")) as Record<
			string,
			unknown
		>;

		writeFileSync(
			journalPath,
			`${JSON.stringify(
				{ ...original, receiptRelativePath: ".qh2/alternate.lock" },
				null,
				2,
			)}\n`,
			"utf8",
		);
		expect(() => recoverPluginInstallTransactions(workspace)).toThrow(
			/receiptRelativePath must be \.qh2\/adr-planner\.lock/,
		);

		writeFileSync(
			journalPath,
			`${JSON.stringify(
				{
					...original,
					installRelativePath: ".cline/plugins/_installed/../escaped",
				},
				null,
				2,
			)}\n`,
			"utf8",
		);
		expect(() => recoverPluginInstallTransactions(workspace)).toThrow(
			/canonical workspace-relative path/,
		);

		writeFileSync(
			journalPath,
			`${JSON.stringify(
				{ ...original, attestationRelativePath: ".qh2/not-attestations/x" },
				null,
				2,
			)}\n`,
			"utf8",
		);
		expect(() => recoverPluginInstallTransactions(workspace)).toThrow(
			/must be beneath \.qh2\/attestations\//,
		);
		expect(existsSync(dirname(journalPath))).toBe(true);
	});

	it("prevalidates unknown candidate and backup trees before any recovery mutation", async () => {
		const initial = await install();
		const receiptPath = join(workspace, ".qh2", "adr-planner.lock");
		const oldReceipt = readFileSync(receiptPath, "utf8");
		const oldActive = readFileSync(initial.entryPaths[0] ?? "", "utf8");
		await writePlugin("unknown-candidate");
		let { transactionId } = writeIntent();
		expect(crashInstall("prepared").signal).toBe("SIGKILL");
		let transactionRoot = join(
			workspace,
			".cline",
			"plugin-install-transactions",
			transactionId,
		);
		const candidateEntry = join(
			transactionRoot,
			"candidate",
			relative(initial.installPath, initial.entryPaths[0] ?? ""),
		);
		writeFileSync(candidateEntry, "tampered candidate bytes\n", "utf8");
		const tamperedCandidate = readFileSync(candidateEntry, "utf8");

		expect(() => recoverPluginInstallTransactions(workspace)).toThrow(
			/Unknown candidate digest/,
		);
		expect(readFileSync(receiptPath, "utf8")).toBe(oldReceipt);
		expect(readFileSync(initial.entryPaths[0] ?? "", "utf8")).toBe(oldActive);
		expect(readFileSync(candidateEntry, "utf8")).toBe(tamperedCandidate);
		expect(existsSync(transactionRoot)).toBe(true);

		rmSync(transactionRoot, { recursive: true, force: true });
		await writePlugin("unknown-backup");
		({ transactionId } = writeIntent());
		expect(crashInstall("receipt-committed").signal).toBe("SIGKILL");
		transactionRoot = join(
			workspace,
			".cline",
			"plugin-install-transactions",
			transactionId,
		);
		const backupEntry = join(
			transactionRoot,
			"backup",
			relative(initial.installPath, initial.entryPaths[0] ?? ""),
		);
		writeFileSync(backupEntry, "tampered backup bytes\n", "utf8");
		const committedReceipt = readFileSync(receiptPath, "utf8");
		const committedActive = readFileSync(initial.entryPaths[0] ?? "", "utf8");

		expect(() => recoverPluginInstallTransactions(workspace)).toThrow(
			/Unknown backup digest/,
		);
		expect(readFileSync(receiptPath, "utf8")).toBe(committedReceipt);
		expect(readFileSync(initial.entryPaths[0] ?? "", "utf8")).toBe(
			committedActive,
		);
		expect(readFileSync(backupEntry, "utf8")).toBe("tampered backup bytes\n");
		expect(existsSync(transactionRoot)).toBe(true);
	});

	it("rejects unknown transaction artifacts and reclaims a dead-owner lock", async () => {
		const transactionBase = join(
			workspace,
			".cline",
			"plugin-install-transactions",
		);
		await mkdir(join(transactionBase, "unexpected-artifact"), {
			recursive: true,
		});
		expect(() => recoverPluginInstallTransactions(workspace)).toThrow(
			/Unknown plugin transaction artifact/,
		);
		expect(existsSync(join(transactionBase, "unexpected-artifact"))).toBe(true);
		rmSync(join(transactionBase, "unexpected-artifact"), {
			recursive: true,
			force: true,
		});
		const lockDir = join(transactionBase, ".mutation.lock");
		await mkdir(lockDir, { recursive: true });
		writeFileSync(
			join(lockDir, "owner.99999999.00000000-0000-4000-8000-000000000000"),
			"99999999\n",
			"utf8",
		);
		expect(recoverPluginInstallTransactions(workspace)).toEqual([]);
		expect(existsSync(lockDir)).toBe(false);
	});

	it("fails closed immediately for malformed or ambiguous lock ownership", async () => {
		const lockDir = join(
			workspace,
			".cline",
			"plugin-install-transactions",
			".mutation.lock",
		);
		await mkdir(lockDir, { recursive: true });
		writeFileSync(join(lockDir, "owner.invalid"), `${process.pid}\n`, "utf8");
		const malformedStarted = Date.now();
		expect(() => recoverPluginInstallTransactions(workspace)).toThrow(
			/Malformed plugin mutation lock owner marker/,
		);
		expect(Date.now() - malformedStarted).toBeLessThan(1_000);
		expect(existsSync(lockDir)).toBe(true);

		rmSync(lockDir, { recursive: true, force: true });
		await mkdir(lockDir, { recursive: true });
		for (const suffix of [
			"00000000-0000-4000-8000-000000000001",
			"00000000-0000-4000-8000-000000000002",
		]) {
			writeFileSync(
				join(lockDir, `owner.${process.pid}.${suffix}`),
				`${process.pid}\n`,
				"utf8",
			);
		}
		expect(() => recoverPluginInstallTransactions(workspace)).toThrow(
			/expected exactly one owner marker/,
		);
		expect(readdirSync(lockDir)).toHaveLength(2);
	});

	it("fails closed if lock ownership disappears before release", () => {
		const lockDir = join(
			workspace,
			".cline",
			"plugin-install-transactions",
			".mutation.lock",
		);
		expect(() =>
			withPluginInstallMutationLock(workspace, () => {
				const owner = readdirSync(lockDir).find((entry) =>
					entry.startsWith("owner."),
				);
				if (!owner) throw new Error("test lock owner was not created");
				rmSync(join(lockDir, owner));
			}),
		).toThrow(/lock owner disappeared before release/);
		expect(existsSync(lockDir)).toBe(true);
	});

	it.skipIf(process.platform === "win32")(
		"rejects symlinked transaction storage parents",
		async () => {
			const outside = join(root, "outside-cline");
			await mkdir(outside, { recursive: true });
			await mkdir(workspace, { recursive: true });
			symlinkSync(outside, join(workspace, ".cline"), "dir");
			expect(() => recoverPluginInstallTransactions(workspace)).toThrow(
				/symlinked parent/,
			);
			await expect(install()).rejects.toThrow(/symlinked parent/);
			expect(existsSync(join(workspace, ".qh2", "adr-planner.lock"))).toBe(
				false,
			);
			expect(readdirSync(outside)).toEqual([]);
		},
	);

	it("rechecks force under the lock so only one fresh non-force install commits", async () => {
		writeIntent();
		const installChild = fileURLToPath(
			new URL(
				"./test-fixtures/plugin-install-transaction-child.ts",
				import.meta.url,
			),
		);
		const firstReady = join(root, "first-fresh.ready");
		const secondReady = join(root, "second-fresh.ready");
		const release = join(root, "fresh.release");
		const common = [installChild, workspace, source, npmCommand, "none"];
		const firstPromise = runChild([...common, firstReady, release, "false"]);
		await waitForReadyOrChildFailure(firstReady, firstPromise);
		const secondPromise = runChild([...common, secondReady, release, "false"]);
		await waitForReadyOrChildFailure(secondReady, secondPromise);
		writeFileSync(release, "release\n", "utf8");
		const results = await Promise.all([firstPromise, secondPromise]);
		const succeeded = results.filter((result) => result.code === 0);
		const failed = results.filter((result) => result.code !== 0);

		expect(succeeded).toHaveLength(1);
		expect(failed).toHaveLength(1);
		expect(failed[0]?.stderr).toMatch(/already installed.*--force/i);
		expect(recoverPluginInstallTransactions(workspace)).toEqual([]);
		expect(
			discoverPluginModulePaths(join(workspace, ".cline", "plugins")),
		).toHaveLength(1);
		expect(existsSync(join(workspace, ".qh2", "adr-planner.lock"))).toBe(true);
	}, 30_000);

	it("serializes two upgrades against a receipt-bound uninstall", async () => {
		const initial = await install();
		await writePlugin("concurrent-new");
		const { transactionId: newId } = writeIntent();
		const installChild = fileURLToPath(
			new URL(
				"./test-fixtures/plugin-install-transaction-child.ts",
				import.meta.url,
			),
		);
		const uninstallChild = fileURLToPath(
			new URL("./test-fixtures/plugin-uninstall-child.ts", import.meta.url),
		);
		const installArgs = [installChild, workspace, source, npmCommand, "none"];
		const firstReady = join(root, "first-upgrade.ready");
		const secondReady = join(root, "second-upgrade.ready");
		const release = join(root, "upgrades.release");
		const firstUpgradePromise = runChild([...installArgs, firstReady, release]);
		await waitForReadyOrChildFailure(firstReady, firstUpgradePromise);
		const secondUpgradePromise = runChild([
			...installArgs,
			secondReady,
			release,
		]);
		await waitForReadyOrChildFailure(secondReady, secondUpgradePromise);
		const uninstallPromise = runChild([
			uninstallChild,
			workspace,
			initial.installPath,
		]);
		writeFileSync(release, "release\n", "utf8");
		const [firstUpgrade, secondUpgrade, uninstall] = await Promise.all([
			firstUpgradePromise,
			secondUpgradePromise,
			uninstallPromise,
		]);

		expect(firstUpgrade.code, firstUpgrade.stderr).toBe(0);
		expect(firstUpgrade.signal).toBeNull();
		expect(secondUpgrade.code, secondUpgrade.stderr).toBe(0);
		expect(secondUpgrade.signal).toBeNull();
		expect(uninstall.code).not.toBe(0);
		expect(uninstall.stderr).toMatch(/receipt-bound/);
		expect(recoverPluginInstallTransactions(workspace)).toEqual([]);
		const receipt = readFileSync(
			join(workspace, ".qh2", "adr-planner.lock"),
			"utf8",
		);
		expect(receipt).toContain(`install_transaction_id=${newId}\n`);
		expect(readFileSync(initial.entryPaths[0] ?? "", "utf8")).toContain(
			'marker: "concurrent-new"',
		);
		expect(
			discoverPluginModulePaths(join(workspace, ".cline", "plugins")),
		).toEqual(initial.entryPaths);
	}, 30_000);
});
