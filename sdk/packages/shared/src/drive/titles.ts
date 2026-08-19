import { z } from "zod";
import {
	AgentTitlePermissionSchema,
	AgentTitleSchema,
	AgentTitleScopeSchema,
} from "./room";

export const AgentTitleRiskTierSchema = z.enum(["low", "moderate", "high"]);
export type AgentTitleRiskTier = z.infer<typeof AgentTitleRiskTierSchema>;

export const AgentTitleConcurrencyRuleSchema = z.enum([
	"multiple",
	"exclusive_per_scope",
	"exclusive_per_resource",
]);
export type AgentTitleConcurrencyRule = z.infer<
	typeof AgentTitleConcurrencyRuleSchema
>;

export const AgentTitleDelegationPolicySchema = z.enum(["none", "subset"]);
export type AgentTitleDelegationPolicy = z.infer<
	typeof AgentTitleDelegationPolicySchema
>;

export const AgentTitleResourceKindSchema = z.enum([
	"typed-stage",
	"artifact",
	"diagram",
	"narration",
	"source",
	"search",
	"citation",
	"repository",
	"directory",
	"file-set",
	"device-sandbox",
	"change-set",
	"test",
	"build",
	"simulation",
	"evaluation",
	"room",
	"task",
	"memory-namespace",
]);
export type AgentTitleResourceKind = z.infer<
	typeof AgentTitleResourceKindSchema
>;

export const AgentTitleObligationSchema = z.enum([
	"identify-artifact-sources",
	"emit-presentation-events",
	"cite-evidence",
	"separate-evidence-from-inference",
	"report-changed-targets",
	"report-validation-status",
	"produce-actionable-findings",
	"remain-independent-from-builder",
	"record-command-environment-result",
	"record-limitations",
	"preserve-provenance",
	"respect-retention-policy",
]);
export type AgentTitleObligation = z.infer<typeof AgentTitleObligationSchema>;

/**
 * Sanitized, signed public descriptor for a host-side title recipe. It carries
 * references and accountability rules only — never prompts, routes, model
 * configuration, credentials, endpoints, or full skill contents.
 */
export const AgentTitleDefinitionSchema = z
	.object({
		definitionRef: z.string().regex(/^[a-z][a-z0-9-]*@[1-9][0-9]*$/),
		title: AgentTitleSchema,
		purpose: z.string().min(1),
		riskTier: AgentTitleRiskTierSchema,
		capabilityBundleRefs: z.array(z.string().min(1)).min(1).max(16),
		permissionRefs: z.array(AgentTitlePermissionSchema).min(1).max(16),
		allowedResourceKinds: z.array(AgentTitleResourceKindSchema).min(1).max(32),
		concurrencyRule: AgentTitleConcurrencyRuleSchema,
		prerequisites: z.array(z.string().min(1)).max(16),
		obligations: z.array(AgentTitleObligationSchema).min(1).max(16),
		delegationPolicy: AgentTitleDelegationPolicySchema,
		defaultTemporalPolicyRef: z.string().min(1),
		policyRef: z.string().min(1),
		signatureStatus: z.enum(["verified", "invalid"]),
		exportable: z.literal(false),
	})
	.strict();
export type AgentTitleDefinition = z.infer<typeof AgentTitleDefinitionSchema>;

/** One authorization decision names one grant; no multi-grant form exists. */
export const AgentTitleAuthorizationRequestSchema = z
	.object({
		grantId: z.string().min(1),
		agentId: z.string().min(1),
		permission: AgentTitlePermissionSchema,
		scope: AgentTitleScopeSchema,
		generation: z.number().int().positive(),
	})
	.strict();
export type AgentTitleAuthorizationRequest = z.infer<
	typeof AgentTitleAuthorizationRequestSchema
>;

export type AgentTitleAuthorizationResult =
	| {
			readonly ok: true;
			readonly grantId: string;
			readonly definitionRef: string;
	  }
	| {
			readonly ok: false;
			readonly code:
				| "grant_not_found"
				| "grant_not_active"
				| "agent_mismatch"
				| "scope_mismatch"
				| "permission_denied"
				| "generation_mismatch"
				| "definition_invalid"
				| "independence_lost"
				| "exclusivity_lost";
			readonly message: string;
	  };
