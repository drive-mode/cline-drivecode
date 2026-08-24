import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
	analyzeRepositoryMetadata,
	type RepositoryMetadataCandidate,
} from "../core/analyze-repository-metadata";
import {
	compareCodeUnits,
	diagnostic,
	sortDiagnostics,
} from "../core/diagnostics";
import type {
	Diagnostic,
	EvidenceCollectionResult,
	UnsupportedInference,
} from "../schema";

export const REPOSITORY_EVIDENCE_LIMITS = {
	gitOutputBytes: 8 * 1024 * 1024,
	gitTimeoutMs: 5_000,
	listedPaths: 100_000,
	candidatePaths: 64,
	manifestDepth: 3,
	fileBytes: 256 * 1024,
	totalReadBytes: 2 * 1024 * 1024,
} as const;

export type RepositoryCollectionErrorCode =
	| "evidence.cancelled"
	| "evidence.git_unavailable"
	| "evidence.git_timeout"
	| "evidence.git_output_limit"
	| "evidence.path_limit"
	| "evidence.candidate_limit"
	| "evidence.invalid_git_path"
	| "evidence.workspace_unavailable";

export class RepositoryCollectionError extends Error {
	constructor(readonly code: RepositoryCollectionErrorCode) {
		super(code);
	}
}

export interface GitVisiblePathRuntimeOptions {
	command?: string;
	args?: string[];
	timeoutMs?: number;
	outputLimitBytes?: number;
}

export interface RepositoryEvidenceCollectionOptions {
	workspaceRoot?: string;
	signal?: AbortSignal;
	listVisiblePaths?: (
		workspaceRoot: string,
		signal?: AbortSignal,
	) => Promise<string[]>;
	beforeCandidateOpen?: (absolutePath: string) => Promise<void> | void;
	afterCandidateRead?: (
		absolutePath: string,
		bytesRead: number,
	) => Promise<void> | void;
}

function fixedErrorMessage(code: RepositoryCollectionErrorCode): string {
	switch (code) {
		case "evidence.cancelled":
			return "Repository evidence collection was cancelled";
		case "evidence.git_timeout":
			return "Git repository indexing exceeded the collection time limit";
		case "evidence.git_output_limit":
			return "Git repository indexing exceeded the output limit";
		case "evidence.path_limit":
			return "The Git-visible repository index exceeds the path-count limit";
		case "evidence.candidate_limit":
			return "The allowlisted repository candidate set exceeds the collection limit";
		case "evidence.invalid_git_path":
			return "Git returned a path outside the accepted workspace-relative form";
		case "evidence.workspace_unavailable":
			return "ADR Planner requires a host-provided workspace root";
		default:
			return "Git-visible repository evidence is unavailable";
	}
}

function blocked(
	code: RepositoryCollectionErrorCode,
): EvidenceCollectionResult {
	return {
		status: "blocked",
		evidence: [],
		unsupportedInferences: [],
		diagnostics: [diagnostic(code, "error", fixedErrorMessage(code))],
		stats: { listed: 0, candidates: 0, read: 0, emitted: 0, skipped: 0 },
	};
}

export async function listGitVisiblePaths(
	workspaceRoot: string,
	signal?: AbortSignal,
	runtime: GitVisiblePathRuntimeOptions = {},
): Promise<string[]> {
	return await new Promise<string[]>((resolvePromise, rejectPromise) => {
		let settled = false;
		let outputBytes = 0;
		const chunks: Buffer[] = [];
		const child = spawn(
			runtime.command ?? "git",
			runtime.args ?? [
				"-C",
				workspaceRoot,
				"ls-files",
				"--cached",
				"--others",
				"--exclude-standard",
				"-z",
				"--",
			],
			{
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			},
		);

		const settle = (error?: RepositoryCollectionError, paths?: string[]) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
			if (error) rejectPromise(error);
			else resolvePromise(paths ?? []);
		};
		const stop = (error: RepositoryCollectionError) => {
			child.kill();
			settle(error);
		};
		const onAbort = () =>
			stop(new RepositoryCollectionError("evidence.cancelled"));
		const timeout = setTimeout(
			() => stop(new RepositoryCollectionError("evidence.git_timeout")),
			runtime.timeoutMs ?? REPOSITORY_EVIDENCE_LIMITS.gitTimeoutMs,
		);

		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => {
			outputBytes += chunk.byteLength;
			if (
				outputBytes >
				(runtime.outputLimitBytes ?? REPOSITORY_EVIDENCE_LIMITS.gitOutputBytes)
			) {
				stop(new RepositoryCollectionError("evidence.git_output_limit"));
				return;
			}
			chunks.push(chunk);
		});
		// Drain stderr but never retain, return, or log it.
		child.stderr.resume();
		child.on("error", () =>
			settle(new RepositoryCollectionError("evidence.git_unavailable")),
		);
		child.on("close", (code) => {
			if (settled) return;
			if (code !== 0) {
				settle(new RepositoryCollectionError("evidence.git_unavailable"));
				return;
			}
			const paths = Buffer.concat(chunks)
				.toString("utf8")
				.split("\0")
				.filter(Boolean);
			settle(undefined, paths);
		});
	});
}

function normalizedRelativePath(path: string): string | undefined {
	const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
	if (
		!normalized ||
		normalized.includes("\0") ||
		normalized.startsWith("/") ||
		/^[a-zA-Z]:\//.test(normalized) ||
		normalized.split("/").some((part) => part === ".." || part === "")
	)
		return;
	return normalized;
}

function isSecretOrPrivatePath(path: string): boolean {
	const parts = path.toLowerCase().split("/");
	const basename = parts.at(-1) ?? "";
	if (
		parts.some(
			(part) =>
				part === ".env" ||
				part.startsWith(".env.") ||
				/(?:^|[._-])(?:gold|held[._-]?out|private[._-]?evaluator|transcripts?|memories?|secrets?|credentials?)(?:[._-]|$)/i.test(
					part,
				),
		)
	)
		return true;
	if (
		basename === ".env" ||
		basename.startsWith(".env.") ||
		["conversations.json", "memories.json", "secrets.json"].includes(basename)
	)
		return true;
	return (
		/(?:^|[._-])(?:secret|credential|private[_-]?key)(?:[._-]|$)/i.test(
			basename,
		) || /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(basename)
	);
}

function pathDepth(path: string): number {
	return path.split("/").length;
}

function candidateKind(
	path: string,
): RepositoryMetadataCandidate["kind"] | undefined {
	if (isSecretOrPrivatePath(path)) return;
	const lower = path.toLowerCase();
	const basename = lower.split("/").at(-1) ?? lower;
	if (
		basename === "package.json" &&
		pathDepth(path) <= REPOSITORY_EVIDENCE_LIMITS.manifestDepth
	)
		return "package_json";
	if (
		lower.startsWith(".github/workflows/") &&
		pathDepth(path) === 3 &&
		(lower.endsWith(".yml") || lower.endsWith(".yaml"))
	)
		return "presence";
	if (
		pathDepth(path) <= REPOSITORY_EVIDENCE_LIMITS.manifestDepth &&
		[
			"dockerfile",
			"compose.yml",
			"compose.yaml",
			"docker-compose.yml",
			"docker-compose.yaml",
			"vercel.json",
			"netlify.toml",
			"fly.toml",
			"wrangler.toml",
			"serverless.yml",
			"serverless.yaml",
			"procfile",
			"pyproject.toml",
			"requirements.txt",
			"cargo.toml",
			"go.mod",
			"pom.xml",
			"build.gradle",
			"build.gradle.kts",
			"gemfile",
			"codeowners",
			"security.md",
		].includes(basename)
	)
		return "presence";
	if (
		pathDepth(path) <= REPOSITORY_EVIDENCE_LIMITS.manifestDepth &&
		/^licen[cs]e(?:\.[a-z0-9]+)?$/i.test(basename)
	)
		return "presence";
	return;
}

function isContained(root: string, candidate: string): boolean {
	const path = relative(root, candidate);
	return (
		path !== ".." &&
		!path.startsWith(`..${sep}`) &&
		!isAbsolute(path) &&
		resolve(root, path) === candidate
	);
}

function fileDiagnostic(
	code: string,
	message: string,
	path: string,
): Diagnostic {
	return diagnostic(code, "warning", message, { path });
}

class SafeCandidateReadError extends Error {
	constructor(readonly code: "changed" | "size") {
		super(code);
	}
}

function sameFile(left: Stats, right: Stats): boolean {
	return (
		left.isFile() &&
		right.isFile() &&
		left.dev === right.dev &&
		left.ino === right.ino
	);
}

async function readBoundedRegularFile(
	absolutePath: string,
	expected: Stats,
	maxBytes: number,
	options: RepositoryEvidenceCollectionOptions,
): Promise<Buffer> {
	await options.beforeCandidateOpen?.(absolutePath);
	const handle = await open(
		absolutePath,
		constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
	);
	try {
		const opened = await handle.stat();
		if (!sameFile(expected, opened) || opened.size !== expected.size) {
			throw new SafeCandidateReadError("changed");
		}
		if (opened.size > maxBytes) throw new SafeCandidateReadError("size");

		const chunks: Buffer[] = [];
		let total = 0;
		while (total <= maxBytes) {
			const buffer = Buffer.allocUnsafe(
				Math.min(64 * 1024, maxBytes + 1 - total),
			);
			const { bytesRead } = await handle.read(
				buffer,
				0,
				buffer.byteLength,
				null,
			);
			if (bytesRead === 0) break;
			chunks.push(buffer.subarray(0, bytesRead));
			total += bytesRead;
			await options.afterCandidateRead?.(absolutePath, total);
		}
		if (total > maxBytes) throw new SafeCandidateReadError("size");

		const completed = await handle.stat();
		if (
			!sameFile(opened, completed) ||
			completed.size !== opened.size ||
			completed.mtimeMs !== opened.mtimeMs ||
			completed.ctimeMs !== opened.ctimeMs
		) {
			throw new SafeCandidateReadError("changed");
		}
		return Buffer.concat(chunks, total);
	} finally {
		await handle.close();
	}
}

export async function collectRepositoryEvidence(
	options: RepositoryEvidenceCollectionOptions,
): Promise<EvidenceCollectionResult> {
	if (!options.workspaceRoot) return blocked("evidence.workspace_unavailable");

	let root: string;
	let listed: string[];
	try {
		root = await realpath(options.workspaceRoot);
		listed = await (options.listVisiblePaths ?? listGitVisiblePaths)(
			root,
			options.signal,
		);
	} catch (error) {
		return blocked(
			error instanceof RepositoryCollectionError
				? error.code
				: "evidence.git_unavailable",
		);
	}

	if (listed.length > REPOSITORY_EVIDENCE_LIMITS.listedPaths)
		return blocked("evidence.path_limit");
	const normalized: string[] = [];
	for (const path of listed) {
		const value = normalizedRelativePath(path);
		if (!value) return blocked("evidence.invalid_git_path");
		normalized.push(value);
	}
	const uniquePaths = [...new Set(normalized)].sort(compareCodeUnits);
	const selected = uniquePaths.flatMap((path) => {
		const kind = candidateKind(path);
		return kind ? [{ path, kind }] : [];
	});
	if (selected.length > REPOSITORY_EVIDENCE_LIMITS.candidatePaths)
		return blocked("evidence.candidate_limit");

	const diagnostics: Diagnostic[] = [];
	const candidates: RepositoryMetadataCandidate[] = [];
	let totalReadBytes = 0;
	let read = 0;
	let skipped = 0;

	for (const selectedCandidate of selected) {
		if (options.signal?.aborted) return blocked("evidence.cancelled");
		const absolutePath = resolve(root, selectedCandidate.path);
		try {
			const fileInfo = await lstat(absolutePath);
			if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) {
				skipped += 1;
				diagnostics.push(
					fileDiagnostic(
						"evidence.non_regular_candidate",
						"An allowlisted candidate is not a regular file",
						selectedCandidate.path,
					),
				);
				continue;
			}
			const canonicalPath = await realpath(absolutePath);
			if (!isContained(root, canonicalPath)) {
				skipped += 1;
				diagnostics.push(
					fileDiagnostic(
						"evidence.path_escape",
						"An allowlisted candidate resolves outside the workspace",
						selectedCandidate.path,
					),
				);
				continue;
			}

			if (selectedCandidate.kind === "presence") {
				candidates.push(selectedCandidate);
				continue;
			}
			if (
				fileInfo.size > REPOSITORY_EVIDENCE_LIMITS.fileBytes ||
				totalReadBytes + fileInfo.size >
					REPOSITORY_EVIDENCE_LIMITS.totalReadBytes
			) {
				skipped += 1;
				diagnostics.push(
					fileDiagnostic(
						"evidence.manifest_size_limit",
						"An allowlisted package manifest exceeds the read limit",
						selectedCandidate.path,
					),
				);
				continue;
			}

			const bytes = await readBoundedRegularFile(
				absolutePath,
				fileInfo,
				Math.min(
					REPOSITORY_EVIDENCE_LIMITS.fileBytes,
					REPOSITORY_EVIDENCE_LIMITS.totalReadBytes - totalReadBytes,
				),
				options,
			);
			totalReadBytes += bytes.byteLength;
			read += 1;
			candidates.push({
				path: selectedCandidate.path,
				kind: "package_json",
				content: bytes.toString("utf8"),
				digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
			});
		} catch (error) {
			skipped += 1;
			diagnostics.push(
				fileDiagnostic(
					error instanceof SafeCandidateReadError && error.code === "size"
						? "evidence.manifest_size_limit"
						: error instanceof SafeCandidateReadError
							? "evidence.candidate_changed"
							: "evidence.candidate_unreadable",
					error instanceof SafeCandidateReadError && error.code === "size"
						? "An allowlisted package manifest exceeds the read limit"
						: error instanceof SafeCandidateReadError
							? "An allowlisted candidate changed during safe inspection"
							: "An allowlisted candidate could not be inspected safely",
					selectedCandidate.path,
				),
			);
		}
	}

	const analysis = analyzeRepositoryMetadata(candidates);
	const unsupportedInferences: UnsupportedInference[] = [];
	return {
		status: "collected",
		evidence: analysis.evidence,
		unsupportedInferences,
		diagnostics: sortDiagnostics([...diagnostics, ...analysis.diagnostics]),
		stats: {
			listed: uniquePaths.length,
			candidates: selected.length,
			read,
			emitted: analysis.evidence.length,
			skipped,
		},
	};
}
