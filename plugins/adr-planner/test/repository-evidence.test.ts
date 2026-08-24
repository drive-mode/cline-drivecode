import { afterEach, describe, expect, it } from "bun:test";
import {
	appendFile,
	mkdir,
	mkdtemp,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	collectRepositoryEvidence,
	listGitVisiblePaths,
	REPOSITORY_EVIDENCE_LIMITS,
} from "../src/adapters";
import { canonicalJson } from "../src/core";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

async function runGit(root: string, ...args: string[]): Promise<void> {
	const process = Bun.spawn(["git", "-C", root, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if ((await process.exited) !== 0) {
		throw new Error(await new Response(process.stderr).text());
	}
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("repository evidence adapter", () => {
	it("fails closed without host workspace context", async () => {
		const result = await collectRepositoryEvidence({});
		expect(result.status).toBe("blocked");
		expect(result.diagnostics[0]?.code).toBe("evidence.workspace_unavailable");
	});

	it("uses Git visibility, skips symlinks, and never emits raw content", async () => {
		const root = await temporaryDirectory("adr-evidence-");
		const outside = await temporaryDirectory("adr-outside-");
		await runGit(root, "init", "-q");
		await mkdir(join(root, ".github", "workflows"), { recursive: true });
		await mkdir(join(root, "ignored"), { recursive: true });
		await mkdir(join(root, "apps", "link"), { recursive: true });
		await mkdir(join(root, "secrets"), { recursive: true });
		await mkdir(join(root, "src"), { recursive: true });
		await writeFile(join(root, ".gitignore"), "ignored/\n.env\n", "utf8");
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "private-root-name-canary",
				scripts: { deploy: "secret-script-canary" },
				dependencies: {
					react: "private-react-version-canary",
					"private-dependency-canary": "1.0.0",
				},
			}),
			"utf8",
		);
		await writeFile(
			join(root, "ignored", "package.json"),
			'{"dependencies":{"express":"ignored-secret-canary"}}',
			"utf8",
		);
		await writeFile(join(root, ".env"), "TOKEN=tracked-secret-canary", "utf8");
		await writeFile(
			join(root, "secrets", "package.json"),
			'{"dependencies":{"express":"tracked-secret-package-canary"}}',
			"utf8",
		);
		await writeFile(
			join(root, "src", "private.ts"),
			"raw-source-secret-canary",
			"utf8",
		);
		await writeFile(join(root, "Dockerfile"), "raw-docker-canary", "utf8");
		await writeFile(
			join(root, ".github", "workflows", "ci.yml"),
			"raw-workflow-secret-canary",
			"utf8",
		);
		await writeFile(join(outside, "package.json"), '{"name":"outside-canary"}');
		await symlink(
			join(outside, "package.json"),
			join(root, "apps", "link", "package.json"),
		);
		await runGit(root, "add", "-f", ".env", "secrets/package.json");

		const result = await collectRepositoryEvidence({ workspaceRoot: root });
		expect(result.status).toBe("collected");
		expect(
			result.evidence.some((entry) => entry.source === "package.json"),
		).toBe(true);
		expect(
			result.evidence.some(
				(entry) => entry.source === ".github/workflows/ci.yml",
			),
		).toBe(true);
		expect(
			result.evidence.some((entry) => entry.source.startsWith("ignored/")),
		).toBe(false);
		expect(
			result.evidence.some(
				(entry) => entry.source === "apps/link/package.json",
			),
		).toBe(false);
		expect(result.diagnostics.map((entry) => entry.code)).toContain(
			"evidence.non_regular_candidate",
		);

		const serialized = JSON.stringify(result);
		for (const canary of [
			root,
			outside,
			"private-root-name-canary",
			"secret-script-canary",
			"private-react-version-canary",
			"private-dependency-canary",
			"ignored-secret-canary",
			"tracked-secret-canary",
			"tracked-secret-package-canary",
			"raw-source-secret-canary",
			"raw-docker-canary",
			"raw-workflow-secret-canary",
			"outside-canary",
		]) {
			expect(serialized).not.toContain(canary);
		}
	});

	it("blocks non-Git workspaces and cancelled collection", async () => {
		const root = await temporaryDirectory("adr-evidence-");
		const nonGit = await collectRepositoryEvidence({ workspaceRoot: root });
		expect(nonGit.status).toBe("blocked");
		expect(nonGit.diagnostics[0]?.code).toBe("evidence.git_unavailable");
		expect(JSON.stringify(nonGit)).not.toContain(root);

		await runGit(root, "init", "-q");
		const controller = new AbortController();
		controller.abort();
		const cancelled = await collectRepositoryEvidence({
			workspaceRoot: root,
			signal: controller.signal,
		});
		expect(cancelled.status).toBe("blocked");
		expect(cancelled.diagnostics[0]?.code).toBe("evidence.cancelled");
	});

	it("enforces Git subprocess timeout and output limits", async () => {
		const root = await temporaryDirectory("adr-evidence-");
		await expect(
			listGitVisiblePaths(root, undefined, {
				command: process.execPath,
				args: ["-e", "setTimeout(() => {}, 1000)"],
				timeoutMs: 10,
			}),
		).rejects.toMatchObject({ code: "evidence.git_timeout" });
		await expect(
			listGitVisiblePaths(root, undefined, {
				command: process.execPath,
				args: ["-e", "process.stdout.write('x'.repeat(1024))"],
				outputLimitBytes: 32,
			}),
		).rejects.toMatchObject({ code: "evidence.git_output_limit" });
	});

	it("blocks path and candidate count overflow without partial evidence", async () => {
		const root = await temporaryDirectory("adr-evidence-");
		const tooManyPaths = await collectRepositoryEvidence({
			workspaceRoot: root,
			listVisiblePaths: async () =>
				Array.from(
					{ length: REPOSITORY_EVIDENCE_LIMITS.listedPaths + 1 },
					(_, index) => `src/file-${index}.ts`,
				),
		});
		expect(tooManyPaths.status).toBe("blocked");
		expect(tooManyPaths.diagnostics[0]?.code).toBe("evidence.path_limit");

		const tooManyCandidates = await collectRepositoryEvidence({
			workspaceRoot: root,
			listVisiblePaths: async () =>
				Array.from(
					{ length: REPOSITORY_EVIDENCE_LIMITS.candidatePaths + 1 },
					(_, index) => `app-${index}/package.json`,
				),
		});
		expect(tooManyCandidates.status).toBe("blocked");
		expect(tooManyCandidates.evidence).toEqual([]);
		expect(tooManyCandidates.diagnostics[0]?.code).toBe(
			"evidence.candidate_limit",
		);
	});

	it("blocks invalid Git paths rather than resolving them", async () => {
		const root = await temporaryDirectory("adr-evidence-");
		const result = await collectRepositoryEvidence({
			workspaceRoot: root,
			listVisiblePaths: async () => ["../outside/package.json"],
		});
		expect(result.status).toBe("blocked");
		expect(result.diagnostics[0]?.code).toBe("evidence.invalid_git_path");
	});

	it("denies secret and evaluator path variants in every segment", async () => {
		const root = await temporaryDirectory("adr-evidence-");
		const paths = [
			"private-evaluator-v2/package.json",
			"held-out-2026/package.json",
			"customer-secrets/package.json",
			"credentials-prod/package.json",
			".env/package.json",
			"Gold_Set/package.json",
		];
		const result = await collectRepositoryEvidence({
			workspaceRoot: root,
			listVisiblePaths: async () => paths,
		});
		expect(result.status).toBe("collected");
		expect(result.stats.listed).toBe(paths.length);
		expect(result.stats.candidates).toBe(0);
		expect(result.evidence).toEqual([]);
	});

	it("does not read oversized package manifests", async () => {
		const root = await temporaryDirectory("adr-evidence-");
		await writeFile(
			join(root, "package.json"),
			`{"secret":"${"oversized-secret-canary".repeat(
				Math.ceil(REPOSITORY_EVIDENCE_LIMITS.fileBytes / 20),
			)}"}`,
			"utf8",
		);
		const result = await collectRepositoryEvidence({
			workspaceRoot: root,
			listVisiblePaths: async () => ["package.json"],
		});
		expect(result.status).toBe("collected");
		expect(result.stats.read).toBe(0);
		expect(result.evidence).toEqual([]);
		expect(result.diagnostics[0]?.code).toBe("evidence.manifest_size_limit");
		expect(JSON.stringify(result)).not.toContain("oversized-secret-canary");
	});

	it("rejects parent swaps and same-sized replacement files", async () => {
		const root = await temporaryDirectory("adr-evidence-");
		const outside = await temporaryDirectory("adr-outside-");
		await mkdir(join(root, "apps", "service"), { recursive: true });
		await mkdir(join(outside, "service"), { recursive: true });
		const original = '{"bin":"inside"}';
		const replacement = '{"bin":"extern"}';
		expect(Buffer.byteLength(original)).toBe(Buffer.byteLength(replacement));
		await writeFile(join(root, "apps", "service", "package.json"), original);
		await writeFile(join(outside, "service", "package.json"), replacement);
		let swappedParent = false;
		const parentSwap = await collectRepositoryEvidence({
			workspaceRoot: root,
			listVisiblePaths: async () => ["apps/service/package.json"],
			beforeCandidateOpen: async () => {
				if (swappedParent) return;
				swappedParent = true;
				await rename(join(root, "apps"), join(root, "apps-original"));
				await symlink(outside, join(root, "apps"));
			},
		});
		expect(parentSwap.evidence).toEqual([]);
		expect(parentSwap.diagnostics[0]?.code).toBe("evidence.candidate_changed");

		const secondRoot = await temporaryDirectory("adr-evidence-");
		await writeFile(join(secondRoot, "package.json"), original);
		let replaced = false;
		const finalSwap = await collectRepositoryEvidence({
			workspaceRoot: secondRoot,
			listVisiblePaths: async () => ["package.json"],
			beforeCandidateOpen: async (path) => {
				if (replaced) return;
				replaced = true;
				await rename(path, `${path}.original`);
				await writeFile(path, replacement);
			},
		});
		expect(finalSwap.evidence).toEqual([]);
		expect(finalSwap.diagnostics[0]?.code).toBe("evidence.candidate_changed");
	});

	it("rejects a manifest that grows while its descriptor is read", async () => {
		const root = await temporaryDirectory("adr-evidence-");
		const path = join(root, "package.json");
		await writeFile(path, JSON.stringify({ padding: "x".repeat(70_000) }));
		let appended = false;
		const result = await collectRepositoryEvidence({
			workspaceRoot: root,
			listVisiblePaths: async () => ["package.json"],
			afterCandidateRead: async () => {
				if (appended) return;
				appended = true;
				await appendFile(path, "concurrent-append-canary");
			},
		});
		expect(result.evidence).toEqual([]);
		expect(result.diagnostics[0]?.code).toBe("evidence.candidate_changed");
		expect(JSON.stringify(result)).not.toContain("concurrent-append-canary");
	});

	it("enforces the aggregate manifest read budget", async () => {
		const root = await temporaryDirectory("adr-evidence-");
		const paths: string[] = [];
		const content = JSON.stringify({
			padding: "aggregate-secret-canary".repeat(10_500),
		});
		for (let index = 0; index < 10; index += 1) {
			const directory = join(root, `app-${index}`);
			await mkdir(directory, { recursive: true });
			const path = `app-${index}/package.json`;
			paths.push(path);
			await writeFile(join(root, path), content, "utf8");
		}
		const result = await collectRepositoryEvidence({
			workspaceRoot: root,
			listVisiblePaths: async () => paths,
		});
		expect(result.status).toBe("collected");
		expect(result.stats.read).toBeLessThan(paths.length);
		expect(result.stats.skipped).toBeGreaterThan(0);
		expect(result.diagnostics.map((entry) => entry.code)).toContain(
			"evidence.manifest_size_limit",
		);
		expect(JSON.stringify(result)).not.toContain("aggregate-secret-canary");
	});

	it("is byte stable across ten collections", async () => {
		const root = await temporaryDirectory("adr-evidence-");
		await writeFile(
			join(root, "package.json"),
			'{"dependencies":{"react":"1"}}',
		);
		const collect = () =>
			collectRepositoryEvidence({
				workspaceRoot: root,
				listVisiblePaths: async () => ["package.json", "package.json"],
			});
		const baseline = canonicalJson(await collect());
		for (let index = 0; index < 10; index += 1) {
			expect(canonicalJson(await collect())).toBe(baseline);
		}
	});
});
