import { z } from "zod";
import { AgentRefSchema, type AgentRef } from "./agentRef";
import {
	DeploymentProfileSchema,
	EgressClassSchema,
} from "./topology";

/**
 * Minimal facet primitives for Drive settings (DRV-PLATFORM-CONFIG).
 * Full catalog inventory lives in docs; this module owns typed ids used by
 * runtime topology / BYOK provider selection.
 */

export const DriveFacetIdSchema = z.enum([
	"runtime.profile",
	"runtime.egressCeiling",
	"providers.sttId",
	"providers.sttConfig",
	"providers.ttsId",
	"providers.ttsConfig",
	"tts.enabled",
	"tts.maxSpokenSentences",
	"captions.enabled",
	"earcons.taskComplete",
	"earcons.approvalRequired",
	"earcons.join",
	"earcons.leave",
	"drive.defaults.pairAgent",
]);
export type DriveFacetId = z.infer<typeof DriveFacetIdSchema>;

/**
 * Pair-agent facet accepts the locked AgentRef union (driveagent + builtin
 * primary; configured migration-only).
 */
export const PairAgentRefSchema = AgentRefSchema;
export type PairAgentRef = AgentRef;

export const ProviderConfigSchema = z
	.record(z.string(), z.unknown())
	.superRefine((config, ctx) => {
		for (const key of ["apiKey", "token", "accessToken", "secret"] as const) {
			if (Object.prototype.hasOwnProperty.call(config, key)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `secret field '${key}' is forbidden in Drive provider config`,
					path: [key],
				});
			}
		}
	});

export const DriveFacetValuesSchema = z
	.object({
		"runtime.profile": DeploymentProfileSchema,
		"runtime.egressCeiling": EgressClassSchema,
		"providers.sttId": z.string().min(1),
		"providers.sttConfig": ProviderConfigSchema,
		"providers.ttsId": z.string().min(1),
		"providers.ttsConfig": ProviderConfigSchema,
		"tts.enabled": z.boolean(),
		"tts.maxSpokenSentences": z.number().int().positive(),
		"captions.enabled": z.boolean(),
		// Earcons are individually toggleable; they only sound inside an active
		// Drive call, at 25% of partner volume, and mute / reduced-motion
		// silence all of them. Defaulted (not required) so facet files written
		// before this slice still parse. taskComplete defaults off: it is
		// ambient and fires often, and a chime that never means anything
		// trains people to ignore chimes. The rest default on. See
		// docs/drivecode/plans/cline-drivemode/research/22-default-posture.md.
		"earcons.taskComplete": z.boolean().default(false),
		"earcons.approvalRequired": z.boolean().default(true),
		"earcons.join": z.boolean().default(true),
		"earcons.leave": z.boolean().default(true),
		"drive.defaults.pairAgent": PairAgentRefSchema,
	})
	.strict();
export type DriveFacetValues = z.infer<typeof DriveFacetValuesSchema>;

export function parseDriveFacetValues(input: unknown): DriveFacetValues {
	return DriveFacetValuesSchema.parse(input);
}
