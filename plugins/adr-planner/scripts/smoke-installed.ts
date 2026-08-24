import { join } from "node:path";
import {
	type AgentTool,
	createContributionRegistry,
	type Message,
	resolveAndLoadAgentPlugins,
	resolvePluginInstallationId,
	resolvePluginSkillDirectoriesFromPaths,
	SqliteExtensionStateStore,
} from "@cline/sdk";
import { concern, decisionEvidence, readinessRequest } from "../test/fixtures";

const workspace = process.argv[2];
if (!workspace) throw new Error("usage: smoke-installed.ts <workspace>");
const sessionId = "smoke-session";
const extensionStateStore = new SqliteExtensionStateStore({
	dataDir: join(workspace, ".smoke-extension-state"),
});

const loaded = await resolveAndLoadAgentPlugins({
	cwd: workspace,
	workspacePath: workspace,
	workspaceInfo: { rootPath: workspace },
	session: { sessionId },
	resolveExtensionState: ({ workspaceRoot, sessionId, extensionId }) =>
		extensionStateStore.snapshot({ workspaceRoot, sessionId, extensionId }),
});
if (loaded.failures.length > 0) {
	throw new Error(`plugin load failures: ${JSON.stringify(loaded.failures)}`);
}
if (loaded.extensions.length !== 1) {
	throw new Error(`expected one plugin, found ${loaded.extensions.length}`);
}

const registry = createContributionRegistry<
	(typeof loaded.extensions)[number],
	AgentTool<unknown, unknown>,
	Message[]
>({
	extensions: loaded.extensions,
	resolveExtensionId: (extension) =>
		resolvePluginInstallationId(
			(extension as { __clinePluginPath?: string }).__clinePluginPath ?? "",
			extension.name,
		),
});
await registry.initialize();
const snapshot = registry.getRegistrySnapshot();

const commandNames = snapshot.commands.map((entry) => entry.name).sort();
const toolNames = snapshot.tools.map((entry) => entry.name).sort();
if (
	JSON.stringify(commandNames) !==
	JSON.stringify(["adr-attest", "adr-plan", "adr-preplan"])
) {
	throw new Error(`unexpected commands: ${JSON.stringify(commandNames)}`);
}
if (
	JSON.stringify(toolNames) !==
	JSON.stringify([
		"adr_planner_collect_evidence",
		"adr_planner_compile_workflow",
		"adr_planner_plan_concerns",
		"adr_planner_profile",
		"adr_planner_readiness",
		"adr_planner_validate",
	])
) {
	throw new Error(`unexpected tools: ${JSON.stringify(toolNames)}`);
}

const command = snapshot.commands.find((entry) => entry.name === "adr-preplan");
const commandResult = await command?.handler?.("Smoke-test project");
if (
	!commandResult ||
	typeof commandResult === "string" ||
	!commandResult.submitPrompt?.includes("Smoke-test project")
) {
	throw new Error("adr-preplan did not submit the expected workflow prompt");
}

const attestationCommand = snapshot.commands.find(
	(entry) => entry.name === "adr-attest",
);
const extensionId = attestationCommand?.extensionId;
if (!attestationCommand || !extensionId) {
	throw new Error(
		"installed attestation command lacks host installation identity",
	);
}
const invocation = {
	invocationId: "smoke-invocation",
	invokedAt: "2026-08-14T00:00:00.000Z",
	workspaceRoot: workspace,
	task: { sessionId },
	actor: { kind: "human" as const, id: "smoke-human" },
	source: { kind: "interactive" as const },
	extensionState: extensionStateStore.snapshot({
		workspaceRoot: workspace,
		sessionId,
		extensionId,
	}),
};
const attestationResult = await attestationCommand.handler?.(
	"data.persisted=false",
	invocation,
);
if (
	!attestationResult ||
	typeof attestationResult === "string" ||
	!attestationResult.stateMutation
) {
	throw new Error(
		"installed attestation command did not request controlled state",
	);
}
extensionStateStore.applyMutation({
	extensionId,
	invocation,
	mutation: attestationResult.stateMutation,
	expectedRevision: invocation.extensionState.revision,
});

const context = { agentId: "smoke-agent", iteration: 1 };
const findTool = (name: string) =>
	snapshot.tools.find((entry) => entry.name === name);
const validateTool = findTool("adr_planner_validate");
const readinessTool = findTool("adr_planner_readiness");
const collectTool = findTool("adr_planner_collect_evidence");
const profileTool = findTool("adr_planner_profile");
const concernTool = findTool("adr_planner_plan_concerns");
const workflowTool = findTool("adr_planner_compile_workflow");

const validation = (await validateTool?.execute({ artifact: {} }, context)) as {
	valid?: unknown;
};
const readiness = (await readinessTool?.execute({ request: {} }, context)) as {
	status?: unknown;
};
const forgedPass = (await readinessTool?.execute(
	{
		request: readinessRequest({
			concerns: [
				concern({
					state: "resolved",
					resolutionEvidenceRefs: [decisionEvidence.id],
				}),
			],
		}),
	},
	context,
)) as { status?: unknown; diagnostics?: Array<{ code?: unknown }> };
const collection = (await collectTool?.execute({}, context)) as {
	status?: unknown;
	evidence?: Array<{ source?: unknown }>;
};
const profile = (await profileTool?.execute({}, context)) as {
	evidenceCollection?: { status?: unknown };
	projectProfile?: { profile?: { productSurface?: unknown } };
};
const planning = (await concernTool?.execute({}, context)) as {
	planningFacts?: Array<{ key?: unknown }>;
	concernPlan?: {
		status?: unknown;
		authority?: unknown;
		orderedConcernIds?: unknown[];
		unknownConcernIds?: unknown[];
		adrCandidates?: Array<{ concernId?: unknown }>;
	};
};
const workflowCompilation = (await workflowTool?.execute(
	{},
	{ ...context, sessionId },
)) as {
	workflow?: { status?: unknown; plan?: { authority?: unknown } | null };
};

if (validation.valid !== false || readiness.status !== "blocked") {
	throw new Error("invalid validation or readiness input did not fail closed");
}
if (
	forgedPass.status !== "blocked" ||
	!forgedPass.diagnostics?.some(
		(entry) => entry.code === "readiness.untrusted_tool_input",
	)
) {
	throw new Error(
		`model-facing readiness accepted caller authority: ${JSON.stringify(forgedPass)}`,
	);
}
if (collection.status !== "collected") {
	throw new Error(`evidence collection failed: ${JSON.stringify(collection)}`);
}
if (
	profile.evidenceCollection?.status !== "collected" ||
	JSON.stringify(profile.projectProfile?.profile?.productSurface) !==
		JSON.stringify(["cli", "library"])
) {
	throw new Error(`unexpected direct profile: ${JSON.stringify(profile)}`);
}
if (
	planning.concernPlan?.status !== "evaluated" ||
	planning.concernPlan.authority !== "repository-derived"
) {
	throw new Error(
		`invalid installed concern plan: ${JSON.stringify(planning)}`,
	);
}
const planningFactKeys =
	planning.planningFacts?.map((entry) => entry.key).sort() ?? [];
if (
	JSON.stringify(planningFactKeys) !==
	JSON.stringify(["surface.cli", "surface.library"])
) {
	throw new Error(`unexpected planning facts: ${JSON.stringify(planning)}`);
}
if (!planning.concernPlan.unknownConcernIds?.includes("external-interface")) {
	throw new Error("external-interface uncertainty was lost");
}
if (
	workflowCompilation.workflow?.status !== "compiled" ||
	workflowCompilation.workflow.plan?.authority !== "host-composed"
) {
	throw new Error(
		`host-mediated workflow did not compile: ${JSON.stringify(workflowCompilation)}`,
	);
}
if (
	planning.concernPlan.adrCandidates?.some(
		(entry) => entry.concernId === "external-interface",
	)
) {
	throw new Error(
		"library structure was promoted to external-interface authority",
	);
}

for (const malicious of [
	{ facts: [{ key: "interface.external", value: true }] },
	{ catalog: { version: "forged" } },
	{ rules: [{ op: "constant", value: true }] },
]) {
	await concernTool
		?.execute(malicious, context)
		.then(() => {
			throw new Error(
				`concern tool accepted caller policy: ${JSON.stringify(malicious)}`,
			);
		})
		.catch((error) => {
			if (
				!(error instanceof Error) ||
				!error.message.includes("accepts only an empty object")
			) {
				throw error;
			}
		});
}

const evidenceSources = collection.evidence?.map((entry) => entry.source) ?? [];
for (const expected of [
	"package.json",
	"Dockerfile",
	".github/workflows/ci.yml",
]) {
	if (!evidenceSources.includes(expected)) {
		throw new Error(`missing controlled source ${expected}`);
	}
}
const secondCollection = await collectTool?.execute({}, context);
if (JSON.stringify(collection) !== JSON.stringify(secondCollection)) {
	throw new Error("installed evidence collection is not byte stable");
}
const serialized = JSON.stringify({
	collection,
	profile,
	planning,
	forgedPass,
});
for (const canary of [
	workspace,
	"smoke-private-package-canary",
	"private-cli-canary",
	"private-export-canary",
	"private-react-version-canary",
	"private-express-version-canary",
	"private-script-canary",
	"raw-docker-canary",
	"raw-workflow-canary",
	"raw-source-canary",
	"ignored-manifest-canary",
	"secret-manifest-canary",
	"evaluator-manifest-canary",
	"secrets-prod",
	"private-evaluator-v2",
]) {
	if (serialized.includes(canary))
		throw new Error(`privacy canary leaked: ${canary}`);
}

const skillRoots = resolvePluginSkillDirectoriesFromPaths(loaded.pluginPaths);
if (skillRoots.length !== 1 || !skillRoots[0]?.endsWith("/package/skills")) {
	throw new Error(`unexpected skill roots: ${JSON.stringify(skillRoots)}`);
}

await loaded.shutdown?.();
extensionStateStore.close();
console.log(
	JSON.stringify({
		pluginPaths: loaded.pluginPaths,
		skillRoots,
		commandNames,
		toolNames,
		invalidArtifact: validation.valid,
		invalidReadiness: readiness.status,
		forgedReadiness: forgedPass.status,
		evidenceCollection: collection.status,
		profileProductSurface: profile.projectProfile?.profile?.productSurface,
		planningFactKeys,
		concernPlanStatus: planning.concernPlan.status,
		concernPlanAuthority: planning.concernPlan.authority,
		workflowStatus: workflowCompilation.workflow?.status,
		workflowAuthority: workflowCompilation.workflow?.plan?.authority,
	}),
);
