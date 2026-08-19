#!/usr/bin/env bun
/**
 * Evidence-backed Done gate (ADR-0026).
 *
 * Fails when cold-start surfaces claim Shipped/Landed without claim:<id>,
 * when a cited claim is missing or status-mismatched, or when
 * verified_shipped lacks existing evidence paths.
 *
 * Usage:
 *   bun sdk/scripts/check-drivecode-done.ts
 *   bun run check:drivecode-docs
 */

import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export type DoneIssue = { path: string; message: string };

export type ClaimStatus =
	| "scaffold"
	| "active_partial"
	| "verified_shipped"
	| "blocked"
	| "planned";

export type ClaimEvidence = {
	kind: string;
	path: string;
	command: string;
};

export type ClaimAc = {
	id: string;
	evidence?: ClaimEvidence[];
};

export const PROJECT_MAP_LANES = ["now", "next", "release"] as const;
export type ProjectMapLane = (typeof PROJECT_MAP_LANES)[number];

export const PROJECT_MAP_SYSTEMS = [
	"people",
	"data",
	"hardware",
	"software",
	"processes",
	"networks",
] as const;
export type ProjectMapSystem = (typeof PROJECT_MAP_SYSTEMS)[number];

export type Claim = {
	id: string;
	status: ClaimStatus;
	title?: string;
	note?: string;
	acs?: ClaimAc[];
	consumers?: string[];
	displayId?: string;
	lane?: ProjectMapLane;
	dependsOn?: string[];
	owner?: string;
	systems?: ProjectMapSystem[];
	acceptance?: string;
};

export type ClaimsRegistry = {
	claims: Claim[];
};

export type CheckDrivecodeDoneOptions = {
	/** Absolute path to docs/drivecode. */
	nestPath: string;
	/** Absolute path to claims-registry.yaml. */
	registryPath: string;
	/** Absolute repo root (for evidence path resolution). */
	repoRoot: string;
	reportPrefix?: string;
};

const STATUS_VALUES = new Set<ClaimStatus>([
	"scaffold",
	"active_partial",
	"verified_shipped",
	"blocked",
	"planned",
]);
const PROJECT_MAP_LANE_VALUES = new Set<string>(PROJECT_MAP_LANES);
const PROJECT_MAP_SYSTEM_VALUES = new Set<string>(PROJECT_MAP_SYSTEMS);
const PROJECT_MAP_FIELDS = [
	"displayId",
	"lane",
	"dependsOn",
	"owner",
	"systems",
	"acceptance",
] as const;
const GOLDEN_PATH_DISPLAY_ID_RE = /^GP[0-9]$/;

/** Adjective in prose → required claim status. */
export const ADJECTIVE_TO_STATUS: Record<string, ClaimStatus> = {
	Shipped: "verified_shipped",
	Landed: "verified_shipped",
	"Verified shipped": "verified_shipped",
	Partial: "active_partial",
	Scaffold: "scaffold",
	Blocked: "blocked",
	Planned: "planned",
};

const BARE_STATUS_RE =
	/\*\*(Shipped|Landed|Partial|Scaffold|Blocked|Planned|Verified shipped)\*\*/g;
const CLAIM_ID_RE = /claim:([a-z0-9][a-z0-9-]*)/gi;

const SURFACES = [
	{ rel: "HANDOFF.md", label: "docs/drivecode/HANDOFF.md" },
	{
		rel: "plans/cline-drivemode/README.md",
		label: "docs/drivecode/plans/cline-drivemode/README.md",
	},
] as const;

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export function parseClaimsRegistry(raw: unknown): {
	registry: ClaimsRegistry | null;
	issues: DoneIssue[];
} {
	const issues: DoneIssue[] = [];
	if (!raw || typeof raw !== "object") {
		issues.push({
			path: "claims-registry.yaml",
			message: "registry root must be an object with claims[]",
		});
		return { registry: null, issues };
	}
	const claimsRaw = (raw as { claims?: unknown }).claims;
	if (!Array.isArray(claimsRaw)) {
		issues.push({
			path: "claims-registry.yaml",
			message: "registry.claims must be an array",
		});
		return { registry: null, issues };
	}

	const claims: Claim[] = [];
	const seen = new Set<string>();
	for (const [i, entry] of claimsRaw.entries()) {
		if (!entry || typeof entry !== "object") {
			issues.push({
				path: "claims-registry.yaml",
				message: `claims[${i}] must be an object`,
			});
			continue;
		}
		const row = entry as Record<string, unknown>;
		const id = typeof row.id === "string" ? row.id : "";
		const status = row.status as ClaimStatus;
		if (!id) {
			issues.push({
				path: "claims-registry.yaml",
				message: `claims[${i}] missing id`,
			});
			continue;
		}
		if (seen.has(id)) {
			issues.push({
				path: "claims-registry.yaml",
				message: `duplicate claim id '${id}'`,
			});
			continue;
		}
		seen.add(id);
		if (!STATUS_VALUES.has(status)) {
			issues.push({
				path: "claims-registry.yaml",
				message: `claim '${id}' has invalid status '${String(row.status)}'`,
			});
			continue;
		}
		const presentProjectFields = PROJECT_MAP_FIELDS.filter(
			(field) => row[field] !== undefined,
		);
		const hasProjectMapMetadata = presentProjectFields.length > 0;
		if (
			hasProjectMapMetadata &&
			presentProjectFields.length !== PROJECT_MAP_FIELDS.length
		) {
			issues.push({
				path: "claims-registry.yaml",
				message: `claim '${id}' project-map metadata must provide displayId, lane, dependsOn, owner, systems, and acceptance together`,
			});
		}

		const displayId =
			typeof row.displayId === "string" ? row.displayId.trim() : undefined;
		const lane =
			typeof row.lane === "string" && PROJECT_MAP_LANE_VALUES.has(row.lane)
				? (row.lane as ProjectMapLane)
				: undefined;
		const dependsOn = Array.isArray(row.dependsOn)
			? row.dependsOn.filter(
					(value): value is string => typeof value === "string",
				)
			: undefined;
		const owner = typeof row.owner === "string" ? row.owner.trim() : undefined;
		const systems = Array.isArray(row.systems)
			? row.systems.filter((value): value is ProjectMapSystem =>
					PROJECT_MAP_SYSTEM_VALUES.has(String(value)),
				)
			: undefined;
		const acceptance =
			typeof row.acceptance === "string" ? row.acceptance.trim() : undefined;

		if (hasProjectMapMetadata) {
			if (!displayId || !GOLDEN_PATH_DISPLAY_ID_RE.test(displayId)) {
				issues.push({
					path: "claims-registry.yaml",
					message: `claim '${id}' displayId must match GP0 through GP9`,
				});
			}
			if (!lane) {
				issues.push({
					path: "claims-registry.yaml",
					message: `claim '${id}' lane must be one of: ${PROJECT_MAP_LANES.join(", ")}`,
				});
			}
			if (
				!Array.isArray(row.dependsOn) ||
				!row.dependsOn.every(
					(value) => typeof value === "string" && value.trim(),
				)
			) {
				issues.push({
					path: "claims-registry.yaml",
					message: `claim '${id}' dependsOn must be an array of non-empty claim ids`,
				});
			} else if (new Set(dependsOn).size !== dependsOn.length) {
				issues.push({
					path: "claims-registry.yaml",
					message: `claim '${id}' dependsOn contains duplicates`,
				});
			}
			if (!owner) {
				issues.push({
					path: "claims-registry.yaml",
					message: `claim '${id}' owner must be a non-empty string`,
				});
			}
			if (
				!Array.isArray(row.systems) ||
				row.systems.length === 0 ||
				row.systems.some(
					(value) =>
						typeof value !== "string" || !PROJECT_MAP_SYSTEM_VALUES.has(value),
				)
			) {
				issues.push({
					path: "claims-registry.yaml",
					message: `claim '${id}' systems must use: ${PROJECT_MAP_SYSTEMS.join(", ")}`,
				});
			} else if (new Set(systems).size !== systems.length) {
				issues.push({
					path: "claims-registry.yaml",
					message: `claim '${id}' systems contains duplicates`,
				});
			}
			if (!acceptance) {
				issues.push({
					path: "claims-registry.yaml",
					message: `claim '${id}' acceptance must be a non-empty string`,
				});
			}
		}

		claims.push({
			id,
			status,
			title: typeof row.title === "string" ? row.title : undefined,
			note: typeof row.note === "string" ? row.note : undefined,
			acs: Array.isArray(row.acs) ? (row.acs as ClaimAc[]) : [],
			consumers: Array.isArray(row.consumers)
				? (row.consumers as string[])
				: [],
			...(hasProjectMapMetadata
				? {
						displayId,
						lane,
						dependsOn,
						owner,
						systems,
						acceptance,
					}
				: {}),
		});
	}

	const projectClaims = claims.filter((claim) => claim.displayId !== undefined);
	if (projectClaims.length > 0) {
		const byId = new Map(claims.map((claim) => [claim.id, claim]));
		const displayIds = new Set<string>();
		for (const claim of projectClaims) {
			if (claim.displayId && displayIds.has(claim.displayId)) {
				issues.push({
					path: "claims-registry.yaml",
					message: `duplicate project-map displayId '${claim.displayId}'`,
				});
			}
			if (claim.displayId) displayIds.add(claim.displayId);
			for (const dependencyId of claim.dependsOn ?? []) {
				const dependency = byId.get(dependencyId);
				if (!dependency) {
					issues.push({
						path: "claims-registry.yaml",
						message: `claim '${claim.id}' depends on unknown claim '${dependencyId}'`,
					});
					continue;
				}
				if (!dependency.displayId) {
					issues.push({
						path: "claims-registry.yaml",
						message: `claim '${claim.id}' depends on '${dependencyId}', which is outside the project map`,
					});
					continue;
				}
				if (!dependency.lane || !claim.lane) continue;
				const dependencyLane = PROJECT_MAP_LANES.indexOf(dependency.lane);
				const claimLane = PROJECT_MAP_LANES.indexOf(claim.lane);
				if (dependencyLane > claimLane) {
					issues.push({
						path: "claims-registry.yaml",
						message: `claim '${claim.id}' in lane '${claim.lane}' cannot depend on later lane '${dependency.lane}'`,
					});
				}
			}
		}

		const visiting = new Set<string>();
		const visited = new Set<string>();
		const visit = (claim: Claim): void => {
			if (visited.has(claim.id)) return;
			if (visiting.has(claim.id)) {
				issues.push({
					path: "claims-registry.yaml",
					message: `project-map dependency cycle includes '${claim.id}'`,
				});
				return;
			}
			visiting.add(claim.id);
			for (const dependencyId of claim.dependsOn ?? []) {
				const dependency = byId.get(dependencyId);
				if (dependency?.displayId) visit(dependency);
			}
			visiting.delete(claim.id);
			visited.add(claim.id);
		};
		projectClaims.forEach(visit);
	}

	return { registry: { claims }, issues };
}

function findClaimCitationsAfter(
	text: string,
	matchIndex: number,
	matchLength: number,
): string[] {
	const lineEnd = text.indexOf("\n", matchIndex);
	const end = lineEnd === -1 ? text.length : lineEnd;
	const window = text.slice(matchIndex + matchLength, end);
	const ids: string[] = [];
	for (const m of window.matchAll(CLAIM_ID_RE)) {
		if (m[1]) ids.push(m[1].toLowerCase());
	}
	return ids;
}

/**
 * Validate claims registry + cold-start Done citations. Empty = OK.
 */
export async function checkDrivecodeDone(
	options: CheckDrivecodeDoneOptions,
): Promise<DoneIssue[]> {
	const issues: DoneIssue[] = [];
	const prefix = options.reportPrefix ?? "docs/drivecode";

	if (!(await exists(options.registryPath))) {
		issues.push({
			path: `${prefix}/plans/cline-drivemode/delivery/claims-registry.yaml`,
			message: "claims registry missing (ADR-0026)",
		});
		return issues;
	}

	const yamlText = await readFile(options.registryPath, "utf8");
	let parsed: unknown;
	try {
		parsed = Bun.YAML.parse(yamlText);
	} catch (err) {
		issues.push({
			path: "claims-registry.yaml",
			message: `YAML parse failed: ${err instanceof Error ? err.message : String(err)}`,
		});
		return issues;
	}

	const { registry, issues: schemaIssues } = parseClaimsRegistry(parsed);
	issues.push(...schemaIssues);
	if (!registry) return issues;

	const byId = new Map(registry.claims.map((c) => [c.id, c]));

	for (const claim of registry.claims) {
		if (claim.status !== "verified_shipped") continue;
		const evidence = (claim.acs ?? []).flatMap((ac) => ac.evidence ?? []);
		if (evidence.length === 0) {
			issues.push({
				path: "claims-registry.yaml",
				message: `claim '${claim.id}' is verified_shipped but has no evidence entries`,
			});
			continue;
		}
		for (const ev of evidence) {
			if (!ev.path || !ev.command?.trim()) {
				issues.push({
					path: "claims-registry.yaml",
					message: `claim '${claim.id}' evidence needs path and command`,
				});
				continue;
			}
			const abs = join(options.repoRoot, ev.path);
			if (!(await exists(abs))) {
				issues.push({
					path: "claims-registry.yaml",
					message: `claim '${claim.id}' evidence path missing: ${ev.path}`,
				});
			}
		}
	}

	for (const surface of SURFACES) {
		const abs = join(options.nestPath, surface.rel);
		if (!(await exists(abs))) {
			issues.push({
				path: surface.label,
				message: "required cold-start surface missing",
			});
			continue;
		}
		const text = await readFile(abs, "utf8");
		for (const match of text.matchAll(BARE_STATUS_RE)) {
			const adjective = match[1];
			if (!adjective || match.index === undefined) continue;
			const required = ADJECTIVE_TO_STATUS[adjective];
			if (!required) continue;
			const cites = findClaimCitationsAfter(text, match.index, match[0].length);
			if (cites.length === 0) {
				issues.push({
					path: surface.label,
					message: `bare **${adjective}** without claim:<id> (ADR-0026). Example: **${adjective}** (claim:drv-example)`,
				});
				continue;
			}
			for (const id of cites) {
				const claim = byId.get(id);
				if (!claim) {
					issues.push({
						path: surface.label,
						message: `cites unknown claim:${id}`,
					});
					continue;
				}
				if (claim.status !== required) {
					issues.push({
						path: surface.label,
						message: `claim:${id} is '${claim.status}' but prose says **${adjective}** (needs '${required}')`,
					});
				}
			}
		}
	}

	return issues;
}

async function main(): Promise<void> {
	const repoRoot = resolve(import.meta.dirname, "..", "..");
	const nest = join(repoRoot, "docs", "drivecode");
	const registryPath = join(
		nest,
		"plans",
		"cline-drivemode",
		"delivery",
		"claims-registry.yaml",
	);
	const issues = await checkDrivecodeDone({
		nestPath: nest,
		registryPath,
		repoRoot,
	});

	if (issues.length === 0) {
		console.log("docs/drivecode Done claims OK");
		return;
	}

	console.error(
		`docs/drivecode Done check failed (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n`,
	);
	for (const issue of issues) {
		console.error(`  ${issue.path}`);
		console.error(`    ${issue.message}\n`);
	}
	console.error("See ADR-0026 and delivery/claims-registry.yaml.");
	process.exit(1);
}

if (import.meta.main) {
	await main();
}
