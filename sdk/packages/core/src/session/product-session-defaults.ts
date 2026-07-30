/**
 * Product-wide defaults for ClineCore session feature flags.
 *
 * Encodes integration-build decisions D1 (multi-agent) and D4 (budgets).
 * Hosts should call this when assembling CoreSessionConfig so CLI / Hub /
 * Desktop / VS Code stay aligned. Explicit overrides always win.
 *
 * @see docs/sdk/architecture/integration-build.mdx
 */

export type ProductSessionHostKind =
	| "cli"
	| "acp"
	| "hub"
	| "desktop"
	| "vscode";

/**
 * Recommended iteration budget for interactive coding sessions when a host
 * opts into applying defaults (Phase 5). Leaving `maxIterations` undefined
 * preserves historical host behavior (runtime/SDK default).
 */
export const PRODUCT_DEFAULT_MAX_ITERATIONS = 50;

export interface ResolveProductSessionFeaturesInput {
	/** YOLO / auto-approve modes disable spawn + teams (CLI semantics). */
	yolo?: boolean;
	/**
	 * Host profile for special-cases. ACP enables spawn but not teams.
	 * Omit for the D1 product default (both on).
	 */
	host?: ProductSessionHostKind;
	/** Explicit override; wins over yolo/host defaults. */
	enableSpawnAgent?: boolean;
	/** Explicit override; wins over yolo/host defaults. */
	enableAgentTeams?: boolean;
	/** Explicit maxIterations; wins over applyDefaultMaxIterations. */
	maxIterations?: number;
	/**
	 * When true and `maxIterations` is unset, apply
	 * {@link PRODUCT_DEFAULT_MAX_ITERATIONS}. Default false so Phase 1 does
	 * not change host behavior until Phase 5 wires it.
	 */
	applyDefaultMaxIterations?: boolean;
}

export interface ProductSessionFeatures {
	enableSpawnAgent: boolean;
	enableAgentTeams: boolean;
	maxIterations?: number;
}

/**
 * Resolve multi-agent flags and optional iteration budget for a product host.
 */
export function resolveProductSessionFeatures(
	input: ResolveProductSessionFeaturesInput = {},
): ProductSessionFeatures {
	const yolo = input.yolo === true;
	const host = input.host;

	let enableSpawnAgent: boolean;
	let enableAgentTeams: boolean;

	if (yolo) {
		enableSpawnAgent = false;
		enableAgentTeams = false;
	} else if (host === "acp") {
		enableSpawnAgent = true;
		enableAgentTeams = false;
	} else {
		// D1 product default (CLI non-YOLO semantics)
		enableSpawnAgent = true;
		enableAgentTeams = true;
	}

	if (typeof input.enableSpawnAgent === "boolean") {
		enableSpawnAgent = input.enableSpawnAgent;
	}
	if (typeof input.enableAgentTeams === "boolean") {
		enableAgentTeams = input.enableAgentTeams;
	}

	let maxIterations: number | undefined;
	if (
		typeof input.maxIterations === "number" &&
		Number.isFinite(input.maxIterations) &&
		input.maxIterations > 0
	) {
		maxIterations = Math.floor(input.maxIterations);
	} else if (input.applyDefaultMaxIterations === true) {
		maxIterations = PRODUCT_DEFAULT_MAX_ITERATIONS;
	}

	return {
		enableSpawnAgent,
		enableAgentTeams,
		...(maxIterations !== undefined ? { maxIterations } : {}),
	};
}
