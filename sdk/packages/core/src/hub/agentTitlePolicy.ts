import { createHash, verify } from "node:crypto";
import { isTitleGrantActive, titleGrantExclusivityKey } from "@cline/drive";
import type {
	AgentTitle,
	AgentTitleAuthorizationRequest,
	AgentTitleAuthorizationResult,
	AgentTitleDefinition,
	AgentTitleGrant,
	AgentTitlePermission,
	AgentTitleScope,
	RoomSnapshot,
} from "@cline/shared";
import { AgentTitleDefinitionSchema } from "@cline/shared";

const TITLE_POLICY_REF = "drive.agent-titles@1";
const TITLE_RECIPE_DIGEST =
	"7f3c9659b7a09bfefb1b457a4db897cdc77a717d02085419dc6f69222f051388";
const TITLE_POLICY_PAYLOAD = `drive.agent-titles|1|${TITLE_RECIPE_DIGEST}`;
const TITLE_POLICY_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAfyd4mbczGSJp7V2WUrlQnCdku2x5oBp6T8hGyrr/O3E=
-----END PUBLIC KEY-----
`;
const TITLE_POLICY_SIGNATURE =
	"OodyaYPxWCIi9KyW6E5dlp9r0ob6EuaH6xKcBO5ii8PAAv+NgbvxEr3CqvaA5GDP2wZHD+ipktOB06uKLatCCg==";

const TITLE_RECIPES: ReadonlyArray<
	Omit<AgentTitleDefinition, "signatureStatus">
> = [
	{
		definitionRef: "presenter@1",
		title: "presenter",
		purpose: "Controls the typed artifacts and narration the audience sees.",
		riskTier: "moderate",
		capabilityBundleRefs: ["presenter-stage"],
		permissionRefs: ["stage.present"],
		allowedResourceKinds: ["typed-stage", "artifact", "diagram", "narration"],
		concurrencyRule: "exclusive_per_scope",
		prerequisites: ["typed-stage-available"],
		obligations: ["identify-artifact-sources", "emit-presentation-events"],
		delegationPolicy: "none",
		defaultTemporalPolicyRef: "title.presenter.session",
		policyRef: TITLE_POLICY_REF,
		exportable: false,
	},
	{
		definitionRef: "researcher@1",
		title: "researcher",
		purpose:
			"Gathers scoped evidence and clearly cited context without mutation.",
		riskTier: "low",
		capabilityBundleRefs: ["research-evidence"],
		permissionRefs: ["source.read", "source.search", "source.cite"],
		allowedResourceKinds: ["source", "search", "citation", "repository"],
		concurrencyRule: "multiple",
		prerequisites: ["source-scope-resolved"],
		obligations: ["cite-evidence", "separate-evidence-from-inference"],
		delegationPolicy: "subset",
		defaultTemporalPolicyRef: "title.researcher.task",
		policyRef: TITLE_POLICY_REF,
		exportable: false,
	},
	{
		definitionRef: "builder@1",
		title: "builder",
		purpose: "Produces changes inside one explicitly scoped writable target.",
		riskTier: "high",
		capabilityBundleRefs: ["builder-target"],
		permissionRefs: ["target.modify"],
		allowedResourceKinds: [
			"repository",
			"directory",
			"file-set",
			"device-sandbox",
		],
		concurrencyRule: "exclusive_per_resource",
		prerequisites: ["writable-target-resolved", "mutation-approved"],
		obligations: ["report-changed-targets", "report-validation-status"],
		delegationPolicy: "subset",
		defaultTemporalPolicyRef: "title.builder.task",
		policyRef: TITLE_POLICY_REF,
		exportable: false,
	},
	{
		definitionRef: "reviewer@1",
		title: "reviewer",
		purpose:
			"Independently critiques changes and produces evidence-backed findings.",
		riskTier: "moderate",
		capabilityBundleRefs: ["review-findings"],
		permissionRefs: ["review.findings"],
		allowedResourceKinds: ["change-set", "repository"],
		concurrencyRule: "multiple",
		prerequisites: ["review-target-resolved", "independent-from-builder"],
		obligations: [
			"produce-actionable-findings",
			"remain-independent-from-builder",
		],
		delegationPolicy: "none",
		defaultTemporalPolicyRef: "title.reviewer.task",
		policyRef: TITLE_POLICY_REF,
		exportable: false,
	},
	{
		definitionRef: "verifier@1",
		title: "verifier",
		purpose: "Runs bounded tests, builds, simulations, and evaluations.",
		riskTier: "moderate",
		capabilityBundleRefs: ["verification-runtime"],
		permissionRefs: ["verification.run"],
		allowedResourceKinds: ["test", "build", "simulation", "evaluation"],
		concurrencyRule: "multiple",
		prerequisites: ["verification-budget-available"],
		obligations: ["record-command-environment-result", "record-limitations"],
		delegationPolicy: "none",
		defaultTemporalPolicyRef: "title.verifier.task",
		policyRef: TITLE_POLICY_REF,
		exportable: false,
	},
	{
		definitionRef: "scribe@1",
		title: "scribe",
		purpose:
			"Preserves canonical summaries, decisions, actions, and approved memory.",
		riskTier: "moderate",
		capabilityBundleRefs: ["scribe-records"],
		permissionRefs: ["record.summary", "record.decision", "record.memory"],
		allowedResourceKinds: ["room", "task", "memory-namespace"],
		concurrencyRule: "exclusive_per_scope",
		prerequisites: ["retention-policy-resolved"],
		obligations: ["preserve-provenance", "respect-retention-policy"],
		delegationPolicy: "none",
		defaultTemporalPolicyRef: "title.scribe.task",
		policyRef: TITLE_POLICY_REF,
		exportable: false,
	},
];

export function builtInAgentTitleRecipeDigest(): string {
	return createHash("sha256")
		.update(JSON.stringify(TITLE_RECIPES), "utf8")
		.digest("hex");
}

const DEFAULT_DURATION_MS: Record<AgentTitle, number> = {
	presenter: 60 * 60 * 1_000,
	researcher: 30 * 60 * 1_000,
	builder: 60 * 60 * 1_000,
	reviewer: 30 * 60 * 1_000,
	verifier: 30 * 60 * 1_000,
	scribe: 60 * 60 * 1_000,
};
const MAX_DURATION_MS = 8 * 60 * 60 * 1_000;
const ALLOWED_SCOPE_KINDS: Record<
	AgentTitle,
	ReadonlySet<AgentTitleScope["kind"]>
> = {
	presenter: new Set(["stage"]),
	researcher: new Set(["room", "session", "task", "target", "repository"]),
	builder: new Set(["target", "repository"]),
	reviewer: new Set(["task", "target", "repository"]),
	verifier: new Set(["task", "target", "repository"]),
	scribe: new Set(["room", "task", "namespace"]),
};

function assertOpaqueResourceScope(scope: AgentTitleScope): void {
	if (scope.kind !== "target" && scope.kind !== "repository") {
		return;
	}
	if (
		/^(?:\/|~\/|[a-zA-Z]:[\\/]|\\\\)/.test(scope.ref) ||
		scope.ref.startsWith("file:")
	) {
		throw new Error(`title_scope_ref_must_be_opaque:${scope.kind}`);
	}
}

export function verifyBuiltInAgentTitleDefinitions(): boolean {
	if (builtInAgentTitleRecipeDigest() !== TITLE_RECIPE_DIGEST) {
		return false;
	}
	return verify(
		null,
		Buffer.from(TITLE_POLICY_PAYLOAD, "utf8"),
		TITLE_POLICY_PUBLIC_KEY,
		Buffer.from(TITLE_POLICY_SIGNATURE, "base64"),
	);
}

export function builtInAgentTitleDefinitions(): readonly AgentTitleDefinition[] {
	const signatureStatus = verifyBuiltInAgentTitleDefinitions()
		? "verified"
		: "invalid";
	return TITLE_RECIPES.map((definition) =>
		AgentTitleDefinitionSchema.parse({
			...definition,
			signatureStatus,
		}),
	);
}

function definitionFor(title: AgentTitle): AgentTitleDefinition {
	const definition = builtInAgentTitleDefinitions().find(
		(candidate) => candidate.title === title,
	);
	if (definition?.signatureStatus !== "verified") {
		throw new Error(`title_definition_invalid:${title}`);
	}
	return definition;
}

function exclusivityKey(input: {
	title: AgentTitle;
	agentId: string;
	scope: AgentTitleScope;
}): string {
	switch (input.title) {
		case "presenter":
			return `stage/${input.scope.ref}`;
		case "builder":
			return `target/${input.scope.ref}`;
		case "scribe":
			return `${input.scope.kind}/${input.scope.ref}/scribe`;
		default:
			return `${input.scope.kind}/${input.scope.ref}/${input.title}/${input.agentId}`;
	}
}

/** Mint from the host recipe; caller-provided permissions and bundles are ignored. */
export function mintClineAgentTitleGrant(input: {
	title: AgentTitle;
	agentId: string;
	scope: AgentTitleScope;
	taskId?: string;
	durationMs?: number;
	generation?: number;
	grantedBy?: string;
	at?: Date;
}): AgentTitleGrant {
	const definition = definitionFor(input.title);
	if (!ALLOWED_SCOPE_KINDS[input.title].has(input.scope.kind)) {
		throw new Error(
			`title_scope_not_allowed:${input.title}:${input.scope.kind}`,
		);
	}
	assertOpaqueResourceScope(input.scope);
	const at = input.at ?? new Date();
	const durationMs = Math.min(
		MAX_DURATION_MS,
		Math.max(60_000, input.durationMs ?? DEFAULT_DURATION_MS[input.title]),
	);
	const issuedAt = at.toISOString();
	return {
		id: `cline_${input.title}_${crypto.randomUUID()}`,
		agentId: input.agentId,
		title: input.title,
		definitionRef: definition.definitionRef,
		...(input.taskId ? { taskId: input.taskId } : {}),
		scope: input.scope,
		skillBundleRefs: [...definition.capabilityBundleRefs],
		resourceGrantRefs: input.title === "presenter" ? ["typed-stage"] : [],
		delegatedAgentIds: [],
		permissions: [...definition.permissionRefs],
		grantedAt: issuedAt,
		issuedAt,
		notBefore: issuedAt,
		expiresAt: new Date(at.getTime() + durationMs).toISOString(),
		generation: input.generation ?? 1,
		exclusivityKey: exclusivityKey(input),
		grantedBy: input.grantedBy ?? "cline:coordinator",
		policyRef: definition.policyRef,
	};
}

export function mintClinePresenterGrant(input: {
	roomId: string;
	agentId: string;
	durationMs?: number;
	generation?: number;
	at?: Date;
}): AgentTitleGrant {
	return mintClineAgentTitleGrant({
		title: "presenter",
		agentId: input.agentId,
		scope: { kind: "stage", ref: input.roomId },
		durationMs: input.durationMs,
		generation: input.generation,
		at: input.at,
	});
}

function sameScope(a: AgentTitleScope, b: AgentTitleScope): boolean {
	return a.kind === b.kind && a.ref === b.ref;
}

/**
 * Authorize exactly one command with exactly one grant. Permissions are read
 * from that grant only; holding another title cannot widen the result.
 */
export function validateAgentTitleAuthorization(input: {
	snapshot: RoomSnapshot;
	request: AgentTitleAuthorizationRequest;
	at?: string;
}): AgentTitleAuthorizationResult {
	const { request, snapshot } = input;
	const at = input.at ?? new Date().toISOString();
	const grant = snapshot.titleGrantsById[request.grantId];
	if (!grant) {
		return {
			ok: false,
			code: "grant_not_found",
			message: "Grant was not found.",
		};
	}
	if (!isTitleGrantActive(grant, at)) {
		return {
			ok: false,
			code: "grant_not_active",
			message: "Grant is not active.",
		};
	}
	if (grant.agentId !== request.agentId) {
		return {
			ok: false,
			code: "agent_mismatch",
			message: "Grant belongs to another agent.",
		};
	}
	if (!sameScope(grant.scope, request.scope)) {
		return {
			ok: false,
			code: "scope_mismatch",
			message: "Grant does not cover this scope.",
		};
	}
	if (!grant.permissions.includes(request.permission)) {
		return {
			ok: false,
			code: "permission_denied",
			message: "Grant does not carry this permission.",
		};
	}
	if (grant.generation !== request.generation) {
		return {
			ok: false,
			code: "generation_mismatch",
			message: "Grant generation is stale.",
		};
	}
	const definition = builtInAgentTitleDefinitions().find(
		(candidate) => candidate.definitionRef === grant.definitionRef,
	);
	if (
		!definition ||
		definition.title !== grant.title ||
		definition.signatureStatus !== "verified" ||
		grant.policyRef !== definition.policyRef ||
		!definition.permissionRefs.includes(request.permission)
	) {
		return {
			ok: false,
			code: "definition_invalid",
			message: "Grant definition is not trusted.",
		};
	}
	if (grant.title === "reviewer" || grant.title === "builder") {
		const conflictingTitle =
			grant.title === "reviewer" ? "builder" : "reviewer";
		const conflict = Object.values(snapshot.titleGrantsById).find(
			(candidate) =>
				candidate.id !== grant.id &&
				candidate.agentId === grant.agentId &&
				candidate.title === conflictingTitle &&
				candidate.scope.ref === grant.scope.ref &&
				isTitleGrantActive(candidate, at),
		);
		if (conflict) {
			return {
				ok: false,
				code: "independence_lost",
				message:
					"Reviewer and Builder must be independent for the same target.",
			};
		}
	}
	if (definition.concurrencyRule !== "multiple") {
		const key = titleGrantExclusivityKey(grant);
		const competitors = Object.values(snapshot.titleGrantsById).filter(
			(candidate) =>
				candidate.id !== grant.id &&
				titleGrantExclusivityKey(candidate) === key &&
				isTitleGrantActive(candidate, at),
		);
		if (competitors.length > 0) {
			return {
				ok: false,
				code: "exclusivity_lost",
				message: "Another active grant owns this exclusive scope.",
			};
		}
	}
	return {
		ok: true,
		grantId: grant.id,
		definitionRef: definition.definitionRef,
	};
}

export function permissionForTitle(
	title: AgentTitle,
): readonly AgentTitlePermission[] {
	return definitionFor(title).permissionRefs;
}
