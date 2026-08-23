import type { AgentTool } from "@cline/sdk";
import { collectRepositoryEvidence } from "./adapters";
import { NUCLEUS_CATALOG } from "./catalog";
import {
	calculateReadiness,
	compileWorkflowPlan,
	derivePlanningFacts,
	profileProject,
	validateArtifact,
} from "./core";
import {
	planHostComposedConcerns,
	planRepositoryConcerns,
} from "./core/plan-concerns";
import {
	type ConcernPlanningResult,
	ConcernPlanningResultSchema,
	type Diagnostic,
	PlanningSessionSnapshotSchema,
	WorkflowCompilationResultSchema,
} from "./schema";

const PLANNING_STATE_KEY = "planning-session";

export interface PlannerToolOptions {
	workspaceRoot?: string;
}

function requireEmptyObject(input: unknown, toolName: string): void {
	if (
		typeof input !== "object" ||
		input === null ||
		Array.isArray(input) ||
		Object.keys(input).length > 0
	) {
		throw new TypeError(`${toolName} accepts only an empty object`);
	}
}

function blockedConcernPlan(diagnostics: Diagnostic[]): ConcernPlanningResult {
	return ConcernPlanningResultSchema.parse({
		status: "blocked",
		authority: "repository-derived",
		catalogVersion: NUCLEUS_CATALOG.version,
		catalogDigest: NUCLEUS_CATALOG.catalogDigest,
		concerns: [],
		traces: [],
		adrCandidates: [],
		orderedConcernIds: [],
		unknownConcernIds: [],
		notApplicableConcernIds: [],
		diagnostics,
	});
}

export function createPlannerTools(
	options: PlannerToolOptions = {},
): AgentTool<unknown, unknown>[] {
	return [
		{
			name: "adr_planner_collect_evidence",
			description:
				"Collect controlled planning signals from Git-visible, allowlisted repository metadata. Accepts no paths, returns no raw source, and fails closed without host workspace context.",
			inputSchema: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
			timeoutMs: 30_000,
			retryable: false,
			maxRetries: 3,
			async execute(input, context) {
				requireEmptyObject(input, "adr_planner_collect_evidence");
				return collectRepositoryEvidence({
					workspaceRoot: options.workspaceRoot,
					signal: context.signal,
				});
			},
		},
		{
			name: "adr_planner_profile",
			description:
				"Collect controlled repository evidence and build a deterministic six-dimension project profile. Accepts no evidence or assertions from the caller; missing dimensions remain unknown.",
			inputSchema: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
			timeoutMs: 30_000,
			retryable: false,
			maxRetries: 3,
			async execute(input: unknown, context) {
				requireEmptyObject(input, "adr_planner_profile");
				const evidenceCollection = await collectRepositoryEvidence({
					workspaceRoot: options.workspaceRoot,
					signal: context.signal,
				});
				return {
					evidenceCollection,
					projectProfile: profileProject({
						evidence: evidenceCollection.evidence,
					}),
				};
			},
		},
		{
			name: "adr_planner_plan_concerns",
			description:
				"Collect bounded repository evidence, derive positive open-world planning facts, and evaluate the package-owned concern catalog with deterministic three-valued rules. Accepts no caller evidence, facts, catalog, rules, paths, routes, or decisions.",
			inputSchema: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
			timeoutMs: 30_000,
			retryable: false,
			maxRetries: 3,
			async execute(input: unknown, context) {
				requireEmptyObject(input, "adr_planner_plan_concerns");
				const evidenceCollection = await collectRepositoryEvidence({
					workspaceRoot: options.workspaceRoot,
					signal: context.signal,
				});
				const projectProfile = profileProject({
					evidence: evidenceCollection.evidence,
				});
				const planningFacts = derivePlanningFacts(
					projectProfile.profile,
					evidenceCollection.evidence,
				);
				const concernPlan =
					evidenceCollection.status === "blocked"
						? blockedConcernPlan(evidenceCollection.diagnostics)
						: planRepositoryConcerns({
								profile: projectProfile.profile,
								evidence: evidenceCollection.evidence,
								facts: planningFacts,
								unsupportedInferences: projectProfile.unsupportedInferences,
							});
				return {
					evidenceCollection,
					projectProfile,
					planningFacts,
					concernPlan,
				};
			},
		},
		{
			name: "adr_planner_validate",
			description:
				"Validate, normalize, and verify the digest of one ADR Planner machine artifact. Returns deterministic diagnostics and never repairs raw input silently.",
			inputSchema: {
				type: "object",
				properties: {
					artifact: {
						type: "object",
						description: "Complete versioned ADR Planner artifact envelope.",
					},
				},
				required: ["artifact"],
				additionalProperties: false,
			},
			timeoutMs: 30_000,
			retryable: false,
			maxRetries: 3,
			async execute(input: unknown) {
				const artifact = (input as { artifact?: unknown })?.artifact;
				return validateArtifact(artifact);
			},
		},
		{
			name: "adr_planner_readiness",
			description:
				"Calculate a lifecycle-gate verdict from supplied evidence, unsupported inferences, and concern state. Invalid or unsafe inputs fail closed with diagnostics.",
			inputSchema: {
				type: "object",
				properties: {
					request: {
						type: "object",
						description:
							"Complete readiness request containing policy version, requested gate, gate applicability, evidence, inferences, and concerns.",
					},
				},
				required: ["request"],
				additionalProperties: false,
			},
			timeoutMs: 30_000,
			retryable: false,
			maxRetries: 3,
			async execute(input: unknown) {
				const request = (input as { request?: unknown })?.request;
				const result = calculateReadiness(request);
				if (result.status !== "pass") return result;
				return {
					...result,
					status: "blocked" as const,
					diagnostics: [
						...result.diagnostics,
						{
							code: "readiness.untrusted_tool_input",
							severity: "error" as const,
							message:
								"Model-facing caller input cannot produce an authoritative passing readiness verdict.",
							concernIds: [],
						},
					],
				};
			},
		},
		{
			name: "adr_planner_compile_workflow",
			description:
				"Compile a canonical pre-plan or plan from controlled repository evidence and a fresh host-injected planning-session snapshot. Accepts no caller facts, gates, evidence, policy, or decisions.",
			inputSchema: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
			timeoutMs: 30_000,
			retryable: false,
			maxRetries: 3,
			async execute(input: unknown, context) {
				requireEmptyObject(input, "adr_planner_compile_workflow");
				const hostState = context.extensionState;
				const entry = hostState?.entries[PLANNING_STATE_KEY];
				const snapshot = PlanningSessionSnapshotSchema.safeParse(entry?.value);
				if (
					!hostState ||
					!context.sessionId ||
					hostState.sessionId !== context.sessionId ||
					!options.workspaceRoot ||
					hostState.workspaceRoot !== options.workspaceRoot ||
					!snapshot.success
				) {
					return {
						evidenceCollection: null,
						projectProfile: null,
						planningFacts: [],
						concernPlan: null,
						workflow: WorkflowCompilationResultSchema.parse({
							status: "blocked",
							plan: null,
							canonicalJson: null,
							markdown: null,
							diagnostics: [
								{
									code: "workflow.host_state_unavailable",
									severity: "error",
									message:
										"A fresh host-owned planning-session snapshot is required.",
									concernIds: [],
								},
							],
						}),
					};
				}

				const evidenceCollection = await collectRepositoryEvidence({
					workspaceRoot: options.workspaceRoot,
					signal: context.signal,
				});
				const projectProfile = profileProject({
					evidence: evidenceCollection.evidence,
				});
				const repositoryFacts = derivePlanningFacts(
					projectProfile.profile,
					evidenceCollection.evidence,
				);
				const attestedFacts = snapshot.data.attestations.map(
					(attestation) => attestation.fact,
				);
				const planningFacts = [...repositoryFacts, ...attestedFacts];
				const concernPlan = planHostComposedConcerns({
					profile: projectProfile.profile,
					evidence: [
						...evidenceCollection.evidence,
						...snapshot.data.attestations.map(
							(attestation) => attestation.evidence,
						),
					],
					facts: planningFacts,
					unsupportedInferences: projectProfile.unsupportedInferences,
				});
				const workflow = compileWorkflowPlan({
					mode: snapshot.data.mode,
					requestedGate: snapshot.data.requestedGate,
					profile: projectProfile.profile,
					planningFacts,
					concernPlan,
				});
				return {
					evidenceCollection,
					projectProfile,
					planningFacts,
					concernPlan,
					workflow,
				};
			},
		},
	];
}
