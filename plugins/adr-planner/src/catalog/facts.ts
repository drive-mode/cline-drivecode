import { deepFreeze } from "./integrity";

export type PlanningFactValueKind = "boolean" | "string" | "string_set";
export type PlanningFactAuthority = "repository" | "host_attested";

export interface PlanningFactDefinition {
	valueKind: PlanningFactValueKind;
	authority: readonly PlanningFactAuthority[];
	question: string;
}

function observedBoolean(question: string): PlanningFactDefinition {
	return {
		valueKind: "boolean",
		authority: ["repository", "host_attested"],
		question,
	};
}

function attestedBoolean(question: string): PlanningFactDefinition {
	return { valueKind: "boolean", authority: ["host_attested"], question };
}

export const PLANNING_FACT_REGISTRY = deepFreeze({
	"surface.web": observedBoolean(
		"Will this initiative provide a browser-based product surface?",
	),
	"surface.api": observedBoolean(
		"Will independently deployed consumers call an API owned by this initiative?",
	),
	"surface.cli": observedBoolean(
		"Will this initiative provide a command-line interface?",
	),
	"surface.desktop": observedBoolean(
		"Will this initiative provide a desktop application?",
	),
	"surface.mobile": observedBoolean(
		"Will this initiative provide a mobile application?",
	),
	"surface.library": observedBoolean(
		"Will this initiative publish a reusable library surface?",
	),
	"surface.data_pipeline": observedBoolean(
		"Will this initiative operate a data ingestion or transformation pipeline?",
	),
	"surface.agentic_system": observedBoolean(
		"Will this initiative run an agentic system with delegated actions?",
	),
	"surface.static_content": observedBoolean(
		"Is this initiative limited to static content delivery?",
	),
	"surface.kinds": {
		valueKind: "string_set",
		authority: ["host_attested"],
		question: "Which controlled product surfaces are in scope?",
	},
	"runtime.static_edge": observedBoolean(
		"Will the production runtime be limited to static or edge delivery?",
	),
	"runtime.server": observedBoolean(
		"Will the initiative operate a long-running server runtime?",
	),
	"runtime.worker_jobs": observedBoolean(
		"Will the initiative operate background workers or scheduled jobs?",
	),
	"runtime.event_driven": observedBoolean(
		"Will the initiative process asynchronous events?",
	),
	"runtime.third_party_hosted": observedBoolean(
		"Will a third party own the primary production runtime?",
	),
	"data.persisted": attestedBoolean(
		"Will the initiative become authoritative for persisted data?",
	),
	"data.personal": attestedBoolean(
		"Will the initiative process personal data?",
	),
	"data.sensitive": attestedBoolean(
		"Will the initiative process sensitive, secret, financial, health, or regulated data?",
	),
	"actors.external": attestedBoolean(
		"Will actors outside the owning team or organization directly use the system?",
	),
	"integration.external": attestedBoolean(
		"Will the initiative depend on an externally owned integration?",
	),
	"agent.mutation_capability": attestedBoolean(
		"Can an automated or agentic workflow mutate external or production state?",
	),
	"tenancy.multiple": attestedBoolean(
		"Will more than one tenant share product infrastructure or data paths?",
	),
	"interface.external": attestedBoolean(
		"Will another owner or independently deployed consumer depend on an interface from this initiative?",
	),
	"delivery.production": attestedBoolean(
		"Is this initiative intended for production deployment or real-user operation?",
	),
	"scale.variable": attestedBoolean(
		"Can expected load vary materially over time?",
	),
	"scale.material": attestedBoolean(
		"Is expected load or data volume material enough to constrain the design?",
	),
	"reliability.high_availability": attestedBoolean(
		"Does the initiative require high availability beyond a best-effort service?",
	),
} satisfies Record<string, PlanningFactDefinition>);

export type RegisteredPlanningFactKey = keyof typeof PLANNING_FACT_REGISTRY;

export function planningFactDefinition(
	key: string,
): PlanningFactDefinition | undefined {
	return PLANNING_FACT_REGISTRY[key as RegisteredPlanningFactKey] as
		| PlanningFactDefinition
		| undefined;
}
