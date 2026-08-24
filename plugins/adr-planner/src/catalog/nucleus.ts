import type { ConcernCatalog } from "../schema";
import { computeCatalogDigest, deepFreeze } from "./integrity";

const NUCLEUS_DEFINITION = {
	version: "m3-nucleus.1",
	sources: [
		{
			id: "govuk-discovery",
			title: "GOV.UK Service Manual: How the discovery phase works",
			url: "https://www.gov.uk/service-manual/agile-delivery/how-the-discovery-phase-works",
		},
		{
			id: "azure-architecture",
			title: "Microsoft: Design architecture specifications",
			url: "https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-design-specification",
		},
		{
			id: "azure-well-architected",
			title: "Microsoft Azure Well-Architected Framework",
			url: "https://learn.microsoft.com/en-us/azure/well-architected/what-is-well-architected-framework",
		},
		{
			id: "nist-privacy",
			title: "NIST Privacy Framework",
			url: "https://www.nist.gov/privacy-framework/using-privacy-framework-11",
		},
		{
			id: "nist-ssdf",
			title: "NIST Secure Software Development Framework",
			url: "https://csrc.nist.gov/pubs/sp/800/218/final",
		},
		{
			id: "google-sre-launch",
			title: "Google SRE: Reliable product launches at scale",
			url: "https://sre.google/sre-book/reliable-product-launches/",
		},
		{
			id: "google-sre-slo",
			title: "Google SRE: Service level objectives",
			url: "https://sre.google/sre-book/service-level-objectives/",
		},
	],
	concerns: [
		{
			id: "product-boundary",
			title: "Product boundary and explicit exclusions",
			question:
				"What outcome, users, scope, and exclusions define the product boundary?",
			area: "product",
			sequenceBand: 10,
			applicabilityRule: { op: "constant", value: true },
			classification: {
				resolution: "decision",
				urgency: "now",
				artifactRoute: "requirement",
				lifecycleGate: "preplan",
				criticality: "critical",
				significanceReasons: [],
				readinessEffect: "blocks",
			},
			prerequisites: [],
			rationale:
				"Architecture choices cannot be evaluated before the intended outcome and system scope are bounded.",
			reactivationCondition:
				"Always applies to a production-intent initiative.",
			sourceRefs: ["govuk-discovery", "azure-architecture"],
		},
		{
			id: "quality-priorities",
			title: "Ranked quality priorities and measurable trade-offs",
			question:
				"Which quality attributes matter, how are they measured, and what trade-offs are acceptable?",
			area: "quality",
			sequenceBand: 10,
			applicabilityRule: { op: "constant", value: true },
			classification: {
				resolution: "decision",
				urgency: "now",
				artifactRoute: "plan",
				lifecycleGate: "preplan",
				criticality: "major",
				significanceReasons: [],
				readinessEffect: "blocks",
			},
			prerequisites: ["product-boundary"],
			rationale:
				"Security, reliability, cost, performance, and operability choices are coupled trade-offs rather than independent polish.",
			reactivationCondition:
				"Always applies; evidence burden scales with risk.",
			sourceRefs: ["azure-well-architected", "google-sre-slo"],
		},
		{
			id: "system-boundary",
			title: "System, deployment, and responsibility boundary",
			question:
				"What belongs inside the system, what remains external, and where do responsibility and failure boundaries lie?",
			area: "system",
			sequenceBand: 20,
			applicabilityRule: { op: "constant", value: true },
			classification: {
				resolution: "decision",
				urgency: "now",
				artifactRoute: "adr",
				lifecycleGate: "implementation",
				criticality: "critical",
				significanceReasons: ["cross_cutting", "costly_to_reverse"],
				readinessEffect: "blocks",
			},
			prerequisites: ["product-boundary", "quality-priorities"],
			rationale:
				"The responsibility boundary constrains ownership, interfaces, trust, deployment, and later decomposition.",
			reactivationCondition:
				"Always applies; a small system may document a deliberately simple boundary.",
			sourceRefs: ["azure-architecture", "google-sre-launch"],
		},
		{
			id: "data-authority",
			title: "Data authority, ownership, and canonical identity",
			question:
				"Which component and owner are authoritative for persisted or tenant-scoped information?",
			area: "data",
			sequenceBand: 30,
			applicabilityRule: {
				op: "any",
				rules: [
					{ op: "equals", fact: "data.persisted", value: true },
					{ op: "equals", fact: "tenancy.multiple", value: true },
				],
			},
			classification: {
				resolution: "decision",
				urgency: "now",
				artifactRoute: "adr",
				lifecycleGate: "implementation",
				criticality: "critical",
				significanceReasons: ["data_lifecycle", "cross_cutting"],
				readinessEffect: "blocks",
			},
			prerequisites: ["system-boundary"],
			rationale:
				"Persisted or tenant-scoped state needs one authoritative meaning, owner, and identity model before storage and access decisions can be safe.",
			reactivationCondition:
				"Reactivates when the product persists or owns tenant-scoped information.",
			sourceRefs: ["azure-architecture", "nist-privacy"],
		},
		{
			id: "retention-deletion",
			title: "Retention, deletion, export, and disposal semantics",
			question:
				"What information is retained, deleted, exported, archived, or disposed, and how is completion proven?",
			area: "data",
			sequenceBand: 30,
			applicabilityRule: {
				op: "any",
				rules: [
					{ op: "equals", fact: "data.persisted", value: true },
					{ op: "equals", fact: "data.personal", value: true },
				],
			},
			classification: {
				resolution: "decision",
				urgency: "next",
				artifactRoute: "requirement",
				lifecycleGate: "pilot",
				criticality: "critical",
				significanceReasons: [],
				readinessEffect: "blocks",
			},
			prerequisites: ["product-boundary"],
			rationale:
				"Data lifecycle obligations shape schemas, backups, support, contracts, and decommissioning behavior.",
			reactivationCondition:
				"Reactivates when any durable or personal data enters the system.",
			sourceRefs: ["nist-privacy"],
		},
		{
			id: "trust-boundaries",
			title: "Trust boundaries, privileged actions, and abuse resistance",
			question:
				"Where does untrusted input or authority cross a boundary, and which actions require isolation, least privilege, confirmation, or recovery?",
			area: "trust",
			sequenceBand: 40,
			applicabilityRule: {
				op: "any",
				rules: [
					{ op: "equals", fact: "data.sensitive", value: true },
					{ op: "equals", fact: "actors.external", value: true },
					{ op: "equals", fact: "integration.external", value: true },
					{ op: "equals", fact: "agent.mutation_capability", value: true },
					{ op: "equals", fact: "tenancy.multiple", value: true },
				],
			},
			classification: {
				resolution: "decision",
				urgency: "now",
				artifactRoute: "adr",
				lifecycleGate: "implementation",
				criticality: "critical",
				significanceReasons: ["security_boundary"],
				readinessEffect: "blocks",
			},
			prerequisites: ["system-boundary"],
			rationale:
				"Sensitive data, external actors, integrations, autonomous mutation, or tenancy create consequential authority boundaries.",
			reactivationCondition:
				"Reactivates when external trust or privileged capability enters the system.",
			sourceRefs: ["nist-ssdf", "nist-privacy"],
		},
		{
			id: "tenancy-isolation",
			title: "Tenant identity, authorization, and isolation",
			question:
				"How are tenant identity, authorization, data, execution, and operator access isolated?",
			area: "trust",
			sequenceBand: 40,
			applicabilityRule: {
				op: "equals",
				fact: "tenancy.multiple",
				value: true,
			},
			classification: {
				resolution: "decision",
				urgency: "now",
				artifactRoute: "adr",
				lifecycleGate: "implementation",
				criticality: "critical",
				significanceReasons: ["security_boundary", "cross_cutting"],
				readinessEffect: "blocks",
			},
			prerequisites: ["data-authority", "trust-boundaries"],
			rationale:
				"Cross-tenant access failure has a broad security and data impact and constrains the domain and authorization model.",
			reactivationCondition:
				"Reactivates when more than one tenant shares product infrastructure or data paths.",
			sourceRefs: ["nist-ssdf", "nist-privacy"],
		},
		{
			id: "external-interface",
			title: "External interface compatibility and ownership",
			question:
				"Which consumers depend on the interface, and what semantics, compatibility, versioning, and retirement promises apply?",
			area: "interfaces",
			sequenceBand: 50,
			applicabilityRule: {
				op: "equals",
				fact: "interface.external",
				value: true,
			},
			classification: {
				resolution: "decision",
				urgency: "now",
				artifactRoute: "adr",
				lifecycleGate: "implementation",
				criticality: "major",
				significanceReasons: ["public_contract"],
				readinessEffect: "blocks",
			},
			prerequisites: ["system-boundary"],
			rationale:
				"Externally consumed contracts outlive local implementation choices and cannot be upgraded atomically with every consumer.",
			reactivationCondition:
				"Reactivates when another owner or independently deployed consumer depends on an interface.",
			sourceRefs: ["azure-architecture", "google-sre-launch"],
		},
		{
			id: "deployment-rollback",
			title: "Deployment, rollout, rollback, and migration strategy",
			question:
				"How does a production change roll out, fail safely, roll back, and preserve state compatibility?",
			area: "delivery",
			sequenceBand: 60,
			applicabilityRule: {
				op: "equals",
				fact: "delivery.production",
				value: true,
			},
			classification: {
				resolution: "decision",
				urgency: "next",
				artifactRoute: "plan",
				lifecycleGate: "pilot",
				criticality: "critical",
				significanceReasons: [],
				readinessEffect: "blocks",
			},
			prerequisites: ["system-boundary", "quality-priorities"],
			rationale:
				"A production design is incomplete without a safe change and recovery path.",
			reactivationCondition:
				"Reactivates before the first production deployment or durable migration.",
			sourceRefs: ["google-sre-launch", "nist-ssdf"],
		},
		{
			id: "observability",
			title: "Observability and operational signals",
			question:
				"Which user and system signals show correct behavior, degradation, failure, and unsafe operation?",
			area: "operations",
			sequenceBand: 70,
			applicabilityRule: {
				op: "equals",
				fact: "delivery.production",
				value: true,
			},
			classification: {
				resolution: "task",
				urgency: "next",
				artifactRoute: "runbook",
				lifecycleGate: "pilot",
				criticality: "major",
				significanceReasons: [],
				readinessEffect: "blocks",
			},
			prerequisites: ["deployment-rollback", "quality-priorities"],
			rationale:
				"Production behavior cannot be verified, supported, or improved without outcome and failure signals.",
			reactivationCondition:
				"Reactivates before production operation or external pilot exposure.",
			sourceRefs: ["google-sre-launch", "google-sre-slo"],
		},
		{
			id: "backup-restore",
			title: "Backup, restore, reconciliation, and recovery semantics",
			question:
				"What must survive loss or corruption, and how will restore correctness and recovery time be proven?",
			area: "operations",
			sequenceBand: 70,
			applicabilityRule: {
				op: "equals",
				fact: "data.persisted",
				value: true,
			},
			classification: {
				resolution: "decision",
				urgency: "next",
				artifactRoute: "runbook",
				lifecycleGate: "release",
				criticality: "critical",
				significanceReasons: [],
				readinessEffect: "blocks",
			},
			prerequisites: ["data-authority"],
			rationale:
				"Durable state needs explicit loss, corruption, restore, and reconciliation behavior rather than an assumed backup checkbox.",
			reactivationCondition:
				"Reactivates when the system becomes authoritative for durable state.",
			sourceRefs: ["azure-well-architected", "google-sre-launch"],
		},
		{
			id: "scale-triggers",
			title: "Scale, capacity, and service-extraction triggers",
			question:
				"Which measured load or ownership conditions justify scaling, distribution, or service extraction?",
			area: "evolution",
			sequenceBand: 80,
			applicabilityRule: {
				op: "any",
				rules: [
					{ op: "equals", fact: "scale.variable", value: true },
					{ op: "equals", fact: "scale.material", value: true },
					{
						op: "equals",
						fact: "reliability.high_availability",
						value: true,
					},
				],
			},
			classification: {
				resolution: "decision",
				urgency: "later",
				artifactRoute: "adr",
				lifecycleGate: "operate",
				criticality: "standard",
				significanceReasons: ["operational_model", "costly_to_reverse"],
				readinessEffect: "warns",
			},
			prerequisites: ["quality-priorities", "system-boundary"],
			rationale:
				"Measured triggers avoid both premature distribution and unplanned capacity failure.",
			reactivationCondition:
				"Reactivates when measured scale, availability, ownership, or fault-isolation pressure becomes material.",
			sourceRefs: ["azure-well-architected", "google-sre-slo"],
		},
	],
} satisfies Omit<ConcernCatalog, "catalogDigest">;

export const NUCLEUS_CATALOG: ConcernCatalog = deepFreeze({
	...NUCLEUS_DEFINITION,
	catalogDigest: computeCatalogDigest(NUCLEUS_DEFINITION),
});
