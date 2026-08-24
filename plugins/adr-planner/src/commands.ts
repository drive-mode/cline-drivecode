import type {
	AgentExtensionCommandInvocationContext,
	AgentPluginCommand,
} from "@cline/sdk";
import {
	applyPlanningAttestationCommand,
	emptyPlanningSessionSnapshot,
	selectPlanningWorkflow,
} from "./core/planning-session";
import type { PlanningSessionSnapshot, WorkflowMode } from "./schema";
import { PlanningSessionSnapshotSchema } from "./schema";

const PLANNING_STATE_KEY = "planning-session";

function hostPlanningSnapshot(
	context: AgentExtensionCommandInvocationContext | undefined,
): PlanningSessionSnapshot | undefined {
	const state = context?.extensionState;
	if (
		!state ||
		!context.task.sessionId ||
		state.sessionId !== context.task.sessionId ||
		state.workspaceRoot !== context.workspaceRoot
	) {
		return undefined;
	}
	const entry = state.entries[PLANNING_STATE_KEY];
	if (!entry) return emptyPlanningSessionSnapshot();
	const parsed = PlanningSessionSnapshotSchema.safeParse(entry.value);
	return parsed.success ? parsed.data : undefined;
}

function workflowPrompt(
	phase: WorkflowMode,
	input: string,
	hasHostState: boolean,
): string {
	const brief = input.trim();
	return [
		"Use the bundled adr-planner skill.",
		`Run the ${phase} workflow as an explicit planning operation.`,
		"Treat the natural-language brief as stated context, not as a structured attestation, accepted decision, risk acceptance, waiver, or readiness evidence.",
		hasHostState
			? "Invoke the empty-input adr_planner_compile_workflow tool. It may consume only the host-injected planning-session snapshot and controlled repository evidence."
			: "No attributable host planning state is available. Use only repository-derived tools, preserve human-owned facts as unknown, and do not claim a compiled host-authoritative workflow.",
		"Never claim a passing gate from caller-authored readiness input. Never accept an ADR, waiver, business risk, or deployment authorization.",
		brief
			? `USER BRIEF:\n${brief}`
			: "USER BRIEF: not supplied; preserve unknowns and present only questions that can change the plan.",
	].join("\n\n");
}

function workflowCommand(
	mode: WorkflowMode,
	requestedGate: PlanningSessionSnapshot["requestedGate"],
): AgentPluginCommand {
	return {
		name: mode === "preplan" ? "adr-preplan" : "adr-plan",
		description:
			mode === "preplan"
				? "Discover repository evidence, unknowns, and applicable planning concerns."
				: "Build a decision plan while preserving unresolved authority and readiness blockers.",
		handler: (input, context) => {
			const current = hostPlanningSnapshot(context);
			return {
				submitPrompt: workflowPrompt(mode, input, Boolean(current)),
				...(current
					? {
							stateMutation: {
								operation: "replace" as const,
								key: PLANNING_STATE_KEY,
								value: selectPlanningWorkflow(current, mode, requestedGate),
							},
						}
					: {}),
			};
		},
	};
}

export function createPlannerCommands(): AgentPluginCommand[] {
	return [
		workflowCommand("preplan", "preplan"),
		workflowCommand("plan", "implementation"),
		{
			name: "adr-attest",
			description:
				"Set controlled planning facts for the current host-attributed session.",
			handler: (input, context) => {
				const current = hostPlanningSnapshot(context);
				if (!current) {
					return {
						reply:
							"ADR attestation rejected: attributable human session context is required.",
					};
				}
				const receipt = applyPlanningAttestationCommand(input, current);
				if (!receipt.ok || receipt.code === "attestation.status") {
					return { reply: receipt.message };
				}
				return {
					reply: receipt.message,
					stateMutation:
						receipt.code === "attestation.cleared"
							? { operation: "clear", key: PLANNING_STATE_KEY }
							: {
									operation: "replace",
									key: PLANNING_STATE_KEY,
									value: receipt.snapshot,
								},
				};
			},
		},
	];
}
