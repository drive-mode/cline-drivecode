import { createHash } from "node:crypto";
import type { Diagnostic, EvidenceRef, RepositorySignal } from "../schema";
import { RepositorySignalSchema } from "../schema";
import { canonicalJson } from "./canonical-json";
import { compareCodeUnits, diagnostic, sortDiagnostics } from "./diagnostics";

export const REPOSITORY_SIGNAL_CLAIM_PREFIX = "repository.signal:";

export interface RepositoryMetadataCandidate {
	path: string;
	kind: "presence" | "package_json";
	content?: string;
	digest?: string;
}

export interface RepositoryMetadataAnalysis {
	evidence: EvidenceRef[];
	diagnostics: Diagnostic[];
}

const DEPENDENCY_SIGNALS = new Map<string, readonly RepositorySignal[]>([
	["react", ["candidate.surface.web"]],
	["react-dom", ["candidate.surface.web"]],
	["next", ["candidate.surface.web"]],
	["vue", ["candidate.surface.web"]],
	["svelte", ["candidate.surface.web"]],
	["@sveltejs/kit", ["candidate.surface.web"]],
	["@angular/core", ["candidate.surface.web"]],
	["astro", ["candidate.surface.web", "candidate.surface.static_content"]],
	["@11ty/eleventy", ["candidate.surface.static_content"]],
	["express", ["candidate.surface.api", "candidate.runtime.server"]],
	["fastify", ["candidate.surface.api", "candidate.runtime.server"]],
	["koa", ["candidate.surface.api", "candidate.runtime.server"]],
	["@nestjs/core", ["candidate.surface.api", "candidate.runtime.server"]],
	["hono", ["candidate.surface.api"]],
	["commander", ["candidate.surface.cli"]],
	["yargs", ["candidate.surface.cli"]],
	["oclif", ["candidate.surface.cli"]],
	["clipanion", ["candidate.surface.cli"]],
	["electron", ["candidate.surface.desktop"]],
	["@tauri-apps/api", ["candidate.surface.desktop"]],
	["react-native", ["candidate.surface.mobile"]],
	["expo", ["candidate.surface.mobile"]],
	["@capacitor/core", ["candidate.surface.mobile"]],
	[
		"@temporalio/worker",
		["candidate.surface.data_pipeline", "candidate.runtime.worker_jobs"],
	],
	[
		"bullmq",
		["candidate.surface.data_pipeline", "candidate.runtime.worker_jobs"],
	],
	[
		"pg-boss",
		["candidate.surface.data_pipeline", "candidate.runtime.worker_jobs"],
	],
	["kafkajs", ["candidate.runtime.event_driven"]],
	["nats", ["candidate.runtime.event_driven"]],
	["amqplib", ["candidate.runtime.event_driven"]],
	["@cline/sdk", ["candidate.surface.agentic_system"]],
	["@langchain/langgraph", ["candidate.surface.agentic_system"]],
	["@anthropic-ai/claude-agent-sdk", ["candidate.surface.agentic_system"]],
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	return value as Record<string, unknown>;
}

export function repositoryEvidenceId(
	path: string,
	signal: RepositorySignal,
): string {
	const digest = createHash("sha256")
		.update(path)
		.update("\0")
		.update(signal)
		.digest("hex")
		.slice(0, 24);
	return `repo-${digest}`;
}

export function repositorySignalsFromPresence(
	path: string,
): RepositorySignal[] {
	const lower = path.toLowerCase();
	const basename = lower.split("/").at(-1) ?? lower;
	const signals = new Set<RepositorySignal>();

	if (basename === "package.json") signals.add("context.ecosystem.node");
	if (basename === "pyproject.toml" || basename === "requirements.txt")
		signals.add("context.ecosystem.python");
	if (basename === "cargo.toml") signals.add("context.ecosystem.rust");
	if (basename === "go.mod") signals.add("context.ecosystem.go");
	if (
		basename === "pom.xml" ||
		basename === "build.gradle" ||
		basename === "build.gradle.kts"
	)
		signals.add("context.ecosystem.jvm");
	if (basename === "gemfile") signals.add("context.ecosystem.ruby");

	if (
		lower.startsWith(".github/workflows/") &&
		(lower.endsWith(".yml") || lower.endsWith(".yaml"))
	)
		signals.add("context.ci_present");
	if (basename === "codeowners") signals.add("context.ownership_present");
	if (basename === "security.md")
		signals.add("context.security_policy_present");
	if (/^licen[cs]e(?:\.[a-z0-9]+)?$/i.test(basename))
		signals.add("context.license_candidate");

	if (
		basename === "dockerfile" ||
		basename === "compose.yml" ||
		basename === "compose.yaml" ||
		basename === "docker-compose.yml" ||
		basename === "docker-compose.yaml"
	)
		signals.add("context.container");

	if (
		[
			"vercel.json",
			"netlify.toml",
			"fly.toml",
			"serverless.yml",
			"serverless.yaml",
			"procfile",
		].includes(basename)
	) {
		signals.add("context.deployment_descriptor");
		signals.add("runtime.third_party_hosted");
	}
	if (basename === "wrangler.toml") {
		signals.add("context.deployment_descriptor");
		signals.add("runtime.static_edge");
		signals.add("runtime.third_party_hosted");
	}

	return [...signals].sort(compareCodeUnits);
}

function hasMeaningfulBin(value: unknown): boolean {
	if (typeof value === "string") return value.length > 0;
	const record = asRecord(value);
	return (
		record !== undefined &&
		Object.values(record).some(
			(entry) => typeof entry === "string" && entry.length > 0,
		)
	);
}

function hasMeaningfulExports(value: unknown): boolean {
	if (typeof value === "string") return value.length > 0;
	if (Array.isArray(value)) return value.length > 0;
	const record = asRecord(value);
	return record !== undefined && Object.keys(record).length > 0;
}

function hasMeaningfulWorkspaces(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some((entry) => typeof entry === "string" && entry.length > 0);
	}
	const packages = asRecord(value)?.packages;
	return (
		Array.isArray(packages) &&
		packages.some((entry) => typeof entry === "string" && entry.length > 0)
	);
}

function dependencyNames(value: unknown): string[] {
	const record = asRecord(value) ?? {};
	return Object.entries(record)
		.filter(
			([name, version]) =>
				name.length > 0 && typeof version === "string" && version.length > 0,
		)
		.map(([name]) => name)
		.sort(compareCodeUnits);
}

function packageSignals(
	candidate: RepositoryMetadataCandidate,
	diagnostics: Diagnostic[],
): RepositorySignal[] {
	const signals = new Set(repositorySignalsFromPresence(candidate.path));
	if (candidate.content === undefined)
		return [...signals].sort(compareCodeUnits);

	let manifest: Record<string, unknown>;
	try {
		manifest = asRecord(JSON.parse(candidate.content)) ?? {};
	} catch {
		diagnostics.push(
			diagnostic(
				"evidence.invalid_package_manifest",
				"warning",
				"An allowlisted package manifest is not valid JSON",
				{ path: candidate.path },
			),
		);
		return [...signals].sort(compareCodeUnits);
	}

	if (hasMeaningfulBin(manifest.bin)) signals.add("surface.cli");
	if (hasMeaningfulExports(manifest.exports)) signals.add("surface.library");
	if (hasMeaningfulWorkspaces(manifest.workspaces))
		signals.add("context.monorepo");

	const runtimeDependencyNames = new Set<string>();
	for (const field of ["dependencies", "optionalDependencies"]) {
		for (const name of dependencyNames(manifest[field])) {
			runtimeDependencyNames.add(name);
		}
	}
	for (const name of [...runtimeDependencyNames].sort(compareCodeUnits)) {
		for (const signal of DEPENDENCY_SIGNALS.get(name) ?? [])
			signals.add(signal);
	}
	for (const name of dependencyNames(manifest.peerDependencies)) {
		for (const signal of DEPENDENCY_SIGNALS.get(name) ?? []) {
			if (signal.startsWith("candidate.surface.")) signals.add(signal);
		}
	}

	return [...signals].sort(compareCodeUnits);
}

function canonicalCandidates(
	candidates: readonly RepositoryMetadataCandidate[],
	diagnostics: Diagnostic[],
): RepositoryMetadataCandidate[] {
	const byPath = new Map<string, RepositoryMetadataCandidate[]>();
	for (const candidate of candidates) {
		const group = byPath.get(candidate.path) ?? [];
		group.push(candidate);
		byPath.set(candidate.path, group);
	}

	const result: RepositoryMetadataCandidate[] = [];
	for (const path of [...byPath.keys()].sort(compareCodeUnits)) {
		const group = byPath.get(path) ?? [];
		const fingerprints = new Map(
			group.map((candidate) => [canonicalJson(candidate), candidate]),
		);
		if (fingerprints.size !== 1) {
			diagnostics.push(
				diagnostic(
					"evidence.conflicting_candidate",
					"error",
					"Conflicting repository metadata candidates share one path",
					{ path },
				),
			);
			continue;
		}
		const candidate = fingerprints.values().next().value;
		if (candidate) result.push(candidate);
	}
	return result;
}

export function analyzeRepositoryMetadata(
	candidates: readonly RepositoryMetadataCandidate[],
): RepositoryMetadataAnalysis {
	const diagnostics: Diagnostic[] = [];
	const evidence: EvidenceRef[] = [];

	for (const candidate of canonicalCandidates(candidates, diagnostics)) {
		const signals =
			candidate.kind === "package_json"
				? packageSignals(candidate, diagnostics)
				: repositorySignalsFromPresence(candidate.path);
		for (const signal of signals) {
			evidence.push({
				id: repositoryEvidenceId(candidate.path, signal),
				sourceType: "repository",
				source: candidate.path,
				locator:
					candidate.kind === "package_json" ? "/structural-metadata" : "$file",
				...(candidate.digest ? { digest: candidate.digest } : {}),
				claim: `${REPOSITORY_SIGNAL_CLAIM_PREFIX}${signal}`,
			});
		}
	}

	evidence.sort((left, right) =>
		compareCodeUnits(
			`${left.source}\0${left.claim}`,
			`${right.source}\0${right.claim}`,
		),
	);
	return { evidence, diagnostics: sortDiagnostics(diagnostics) };
}

export function repositorySignalFromEvidence(
	evidence: EvidenceRef,
): RepositorySignal | undefined {
	if (
		evidence.sourceType !== "repository" ||
		!evidence.claim.startsWith(REPOSITORY_SIGNAL_CLAIM_PREFIX)
	)
		return;
	const signal = evidence.claim.slice(REPOSITORY_SIGNAL_CLAIM_PREFIX.length);
	const parsed = RepositorySignalSchema.safeParse(signal);
	return parsed.success ? parsed.data : undefined;
}

export function isAuthenticRepositoryEvidence(evidence: EvidenceRef): boolean {
	const signal = repositorySignalFromEvidence(evidence);
	if (!signal) return false;
	const normalized = evidence.source.replace(/\\/g, "/");
	if (
		normalized !== evidence.source ||
		normalized.startsWith("/") ||
		normalized
			.split("/")
			.some((part) => !part || part === "." || part === "..") ||
		evidence.id !== repositoryEvidenceId(evidence.source, signal)
	)
		return false;

	if (evidence.locator === "$file") {
		return (
			evidence.digest === undefined &&
			repositorySignalsFromPresence(evidence.source).includes(signal)
		);
	}
	if (evidence.locator === "/structural-metadata") {
		return (
			evidence.source.toLowerCase().split("/").at(-1) === "package.json" &&
			evidence.digest !== undefined
		);
	}
	return false;
}
