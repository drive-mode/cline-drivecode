import { createHash } from "node:crypto";
import { planningFactDefinition } from "../catalog/facts";
import type {
	CanonicalWorkflowPlan,
	ConcernPlanningResult,
	Diagnostic,
	MaterialQuestion,
	PlanningFact,
	ProjectProfile,
	WorkflowCompilationResult,
	WorkflowExperiment,
	WorkflowMode,
	WorkflowReadinessObligation,
	WorkflowRoutedOutput,
} from "../schema";
import {
	CanonicalWorkflowPlanSchema,
	LIFECYCLE_GATE_ORDER,
	PlanningFactSchema,
	WorkflowCompilationResultSchema,
} from "../schema";
import { canonicalJson } from "./canonical-json";
import { compareCodeUnits, diagnostic, sortDiagnostics } from "./diagnostics";

const MAX_QUESTIONS = 8;
const MAX_NEXT_WAVE = 3;

export interface CompileWorkflowInput {
	mode: WorkflowMode;
	requestedGate: CanonicalWorkflowPlan["requestedGate"];
	profile: ProjectProfile;
	planningFacts: PlanningFact[];
	concernPlan: ConcernPlanningResult;
}

function stableId(prefix: string, value: string): string {
	return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function canonicalStringArray<T extends string>(values: readonly T[]): T[] {
	return [...new Set(values)].sort(compareCodeUnits);
}

function canonicalProfile(profile: ProjectProfile): ProjectProfile {
	return {
		productSurface: canonicalStringArray(profile.productSurface),
		lifecycleChange: canonicalStringArray(profile.lifecycleChange),
		dataTrust: canonicalStringArray(profile.dataTrust),
		runtimeTopology: canonicalStringArray(profile.runtimeTopology),
		scaleReliability: canonicalStringArray(profile.scaleReliability),
		deliveryGovernance: canonicalStringArray(profile.deliveryGovernance),
		evidenceRefs: canonicalStringArray(profile.evidenceRefs),
		unknowns: canonicalStringArray(profile.unknowns),
	};
}

function canonicalPlanningFacts(
	facts: readonly PlanningFact[],
): PlanningFact[] {
	return facts
		.map((fact) => PlanningFactSchema.parse(fact))
		.sort((left, right) => {
			const leftKey = `${left.key}:${left.id}:${canonicalJson(left)}`;
			const rightKey = `${right.key}:${right.id}:${canonicalJson(right)}`;
			return compareCodeUnits(leftKey, rightKey);
		});
}

function compileQuestions(
	plan: ConcernPlanningResult,
): CanonicalWorkflowPlan["questionQueue"] {
	const orderedIndex = new Map(
		plan.orderedConcernIds.map((id, index) => [id, index]),
	);
	const concernsByFact = new Map<string, Set<string>>();
	for (const trace of plan.traces) {
		if (trace.result !== "unknown") continue;
		for (const key of trace.missingFactKeys) {
			const definition = planningFactDefinition(key);
			if (
				!definition ||
				definition.valueKind !== "boolean" ||
				!definition.authority.includes("host_attested")
			) {
				continue;
			}
			const concerns = concernsByFact.get(key) ?? new Set<string>();
			concerns.add(trace.concernId);
			concernsByFact.set(key, concerns);
		}
	}
	const candidates: MaterialQuestion[] = [...concernsByFact.entries()].map(
		([key, concernIds]) => {
			const definition = planningFactDefinition(key);
			if (!definition)
				throw new Error("Question fact disappeared from registry");
			const orderedConcernIds = [...concernIds].sort(
				(left, right) =>
					(orderedIndex.get(left) ?? Number.MAX_SAFE_INTEGER) -
						(orderedIndex.get(right) ?? Number.MAX_SAFE_INTEGER) ||
					compareCodeUnits(left, right),
			);
			return {
				id: stableId("question", key),
				factKey: key,
				question: definition.question,
				changesConcernIds: orderedConcernIds,
				changes: ["applicability", "readiness"],
				answerCommand: `/adr-attest ${key}=true|false`,
			};
		},
	);
	candidates.sort((left, right) => {
		const leftIndex = Math.min(
			...left.changesConcernIds.map(
				(id) => orderedIndex.get(id) ?? Number.MAX_SAFE_INTEGER,
			),
		);
		const rightIndex = Math.min(
			...right.changesConcernIds.map(
				(id) => orderedIndex.get(id) ?? Number.MAX_SAFE_INTEGER,
			),
		);
		return (
			leftIndex - rightIndex || compareCodeUnits(left.factKey, right.factKey)
		);
	});
	const questions = candidates.slice(0, MAX_QUESTIONS);
	return {
		maxQuestions: MAX_QUESTIONS,
		truncated: candidates.length > questions.length,
		omittedCount: candidates.length - questions.length,
		questions,
	};
}

function compileExperiments(
	plan: ConcernPlanningResult,
	questions: readonly MaterialQuestion[],
): WorkflowExperiment[] {
	const orderedIndex = new Map(
		plan.orderedConcernIds.map((id, index) => [id, index]),
	);
	return plan.concerns
		.filter(
			(concern) =>
				concern.applicability !== "not_applicable" &&
				concern.resolution === "experiment",
		)
		.map((concern) => {
			const question = questions.find((entry) =>
				entry.changesConcernIds.includes(concern.id),
			);
			return {
				id: stableId("experiment", concern.id),
				concernId: concern.id,
				...(question ? { questionId: question.id } : {}),
				hypothesis: `Evidence can resolve the planning concern: ${concern.concern}`,
				method: `Run a bounded test that directly evaluates: ${concern.concern}`,
				metric:
					"Record the predeclared acceptance measure and observed result.",
				timebox: "One planning cycle",
				ownerState: "unassigned" as const,
				decisionRule:
					"Proceed only when the predeclared measure is satisfied; otherwise stop and revisit the concern.",
				requiredEvidence: [`Reproducible result for concern ${concern.id}`],
			};
		})
		.sort(
			(left, right) =>
				(orderedIndex.get(left.concernId) ?? Number.MAX_SAFE_INTEGER) -
					(orderedIndex.get(right.concernId) ?? Number.MAX_SAFE_INTEGER) ||
				compareCodeUnits(left.concernId, right.concernId),
		);
}

function compileRoutedOutputs(
	plan: ConcernPlanningResult,
): WorkflowRoutedOutput[] {
	return plan.concerns
		.filter(
			(concern) =>
				concern.applicability === "applicable" &&
				concern.artifactRoute !== "adr" &&
				concern.artifactRoute !== "none",
		)
		.map((concern) => ({
			id: stableId("output", `${concern.artifactRoute}:${concern.id}`),
			concernId: concern.id,
			route: concern.artifactRoute as WorkflowRoutedOutput["route"],
			state: "unresolved" as const,
			statement: concern.concern,
			evidenceRefs: [...concern.evidenceRefs],
		}));
}

function compileObligations(
	plan: ConcernPlanningResult,
	requestedGate: CanonicalWorkflowPlan["requestedGate"],
): WorkflowReadinessObligation[] {
	const orderedIndex = new Map(
		plan.orderedConcernIds.map((id, index) => [id, index]),
	);
	return plan.concerns
		.filter(
			(concern) =>
				concern.applicability !== "not_applicable" &&
				concern.lifecycleGate !== "not_applicable" &&
				concern.readinessEffect !== "none" &&
				LIFECYCLE_GATE_ORDER[concern.lifecycleGate] <=
					LIFECYCLE_GATE_ORDER[requestedGate],
		)
		.map((concern) => {
			if (concern.lifecycleGate === "not_applicable") {
				throw new Error("Inactive concern entered readiness compilation");
			}
			const status: WorkflowReadinessObligation["status"] =
				concern.state === "accepted_risk" && concern.acceptance
					? "waived"
					: concern.state === "resolved" &&
							concern.resolutionEvidenceRefs.length > 0
						? "pass"
						: "unknown";
			return {
				id: `obligation-${concern.id}`,
				concernId: concern.id,
				gate: concern.lifecycleGate,
				ownerState: "unassigned" as const,
				requiredEvidence: [
					`Resolution and verification evidence for concern ${concern.id}`,
				],
				freshness: "same-plan" as const,
				blocking: concern.readinessEffect === "blocks",
				status,
				evidenceRefs: [...concern.resolutionEvidenceRefs],
				rationale:
					status === "unknown"
						? "The concern is unresolved or lacks verification evidence; project facts alone cannot satisfy it."
						: "The concern carries explicit resolution or risk-acceptance evidence.",
			};
		})
		.sort(
			(left, right) =>
				(orderedIndex.get(left.concernId) ?? Number.MAX_SAFE_INTEGER) -
					(orderedIndex.get(right.concernId) ?? Number.MAX_SAFE_INTEGER) ||
				compareCodeUnits(left.concernId, right.concernId),
		);
}

function compileNextWave(plan: ConcernPlanningResult): string[] {
	const concerns = new Map(plan.concerns.map((entry) => [entry.id, entry]));
	return plan.orderedConcernIds
		.filter((id) => {
			const concern = concerns.get(id);
			if (!concern || concern.applicability !== "applicable") return false;
			return concern.prerequisites.every((prerequisiteId) => {
				const prerequisite = concerns.get(prerequisiteId);
				return (
					!prerequisite ||
					prerequisite.applicability === "not_applicable" ||
					prerequisite.state === "resolved" ||
					prerequisite.state === "accepted_risk"
				);
			});
		})
		.slice(0, MAX_NEXT_WAVE);
}

function renderMarkdown(plan: CanonicalWorkflowPlan): string {
	const lines = [
		"# ADR planning workflow preview",
		"",
		`- Mode: ${plan.mode}`,
		`- Requested gate: ${plan.requestedGate}`,
		`- Readiness: ${plan.readiness.status}`,
		`- Catalog: ${plan.catalogVersion}`,
		"",
		"## Next wave",
		"",
		...(plan.nextWaveConcernIds.length > 0
			? plan.nextWaveConcernIds.map((id) => `- ${id}`)
			: ["- No applicable concern is currently dependency-unblocked."]),
		"",
		"## Material questions",
		"",
		...(plan.questionQueue.questions.length > 0
			? plan.questionQueue.questions.flatMap((question) => [
					`- ${question.question}`,
					`  - Changes: ${question.changesConcernIds.join(", ")}`,
					`  - Answer explicitly: \`${question.answerCommand}\``,
				])
			: ["- No decisive material questions remain in the current nucleus."]),
		"",
		"## Proposed ADR candidates",
		"",
		...(plan.concernPlan.adrCandidates.length > 0
			? plan.concernPlan.adrCandidates.map(
					(candidate) =>
						`- ${candidate.title} (${candidate.significanceReasons.join(", ")})`,
				)
			: ["- None."]),
		"",
		"## Routed planning work",
		"",
		...(plan.routedOutputs.length > 0
			? plan.routedOutputs.map(
					(output) => `- [${output.route}] ${output.statement}`,
				)
			: ["- None."]),
		"",
		"## Readiness obligations",
		"",
		...(plan.readinessObligations.length > 0
			? plan.readinessObligations.map(
					(obligation) =>
						`- [${obligation.status}] ${obligation.concernId} (${obligation.gate})`,
				)
			: ["- No obligations target this gate."]),
	];
	return `${lines.join("\n")}\n`;
}

function blocked(diagnostics: Diagnostic[]): WorkflowCompilationResult {
	return WorkflowCompilationResultSchema.parse({
		status: "blocked",
		plan: null,
		canonicalJson: null,
		markdown: null,
		diagnostics: sortDiagnostics(diagnostics),
	});
}

export function compileWorkflowPlan(
	input: CompileWorkflowInput,
): WorkflowCompilationResult {
	if (
		input.concernPlan.status !== "evaluated" ||
		input.concernPlan.authority !== "host-composed"
	) {
		return blocked([
			diagnostic(
				"workflow.invalid_concern_authority",
				"error",
				"Workflow compilation requires an evaluated host-composed concern plan",
			),
		]);
	}

	const questionQueue = compileQuestions(input.concernPlan);
	const diagnostics: Diagnostic[] = [];
	if (questionQueue.truncated) {
		diagnostics.push(
			diagnostic(
				"workflow.question_limit",
				"warning",
				`${questionQueue.omittedCount} material question(s) exceeded the bounded queue`,
			),
		);
	}
	const experiments = compileExperiments(
		input.concernPlan,
		questionQueue.questions,
	);
	const routedOutputs = compileRoutedOutputs(input.concernPlan);
	const readinessObligations = compileObligations(
		input.concernPlan,
		input.requestedGate,
	);
	const blockerIds = readinessObligations
		.filter(
			(entry) =>
				entry.blocking &&
				(entry.status === "unknown" || entry.status === "fail"),
		)
		.map((entry) => entry.id)
		.sort(compareCodeUnits);
	const warningIds = readinessObligations
		.filter(
			(entry) =>
				!entry.blocking &&
				(entry.status === "unknown" || entry.status === "fail"),
		)
		.map((entry) => entry.id)
		.sort(compareCodeUnits);
	const plan = CanonicalWorkflowPlanSchema.safeParse({
		schemaVersion: "m4.1",
		policyVersion: "m4-workflow.1",
		mode: input.mode,
		requestedGate: input.requestedGate,
		authority: "host-composed",
		catalogVersion: input.concernPlan.catalogVersion,
		catalogDigest: input.concernPlan.catalogDigest,
		profile: canonicalProfile(input.profile),
		planningFacts: canonicalPlanningFacts(input.planningFacts),
		concernPlan: input.concernPlan,
		questionQueue,
		experiments,
		routedOutputs,
		readinessObligations,
		readiness: {
			requestedGate: input.requestedGate,
			status:
				readinessObligations.length === 0
					? "not_applicable"
					: blockerIds.length > 0
						? "blocked"
						: "pass",
			blockerIds,
			warningIds,
		},
		nextWaveConcernIds: compileNextWave(input.concernPlan),
		diagnostics: sortDiagnostics(diagnostics),
	});
	if (!plan.success) {
		return blocked(
			plan.error.issues.map((issue) =>
				diagnostic("workflow.schema", "error", issue.message, {
					path: issue.path.map(String).join("."),
				}),
			),
		);
	}
	const canonical = canonicalJson(plan.data);
	return WorkflowCompilationResultSchema.parse({
		status: "compiled",
		plan: plan.data,
		canonicalJson: canonical,
		markdown: renderMarkdown(plan.data),
		diagnostics: sortDiagnostics(diagnostics),
	});
}
