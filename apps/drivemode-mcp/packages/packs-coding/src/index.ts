import { z } from "zod";

export const CODING_PACK_ID = "coding" as const;

export const CodingWorkTypeSchema = z.enum([
	"work.edit",
	"work.command",
	"work.test",
	"work.plan",
	"work.decision",
	"work.generic",
]);
export type CodingWorkType = z.infer<typeof CodingWorkTypeSchema>;

const EditPayload = z
	.object({
		path: z.string().min(1),
		summary: z.string().optional(),
	})
	.strict();

const CommandPayload = z
	.object({
		command: z.string().min(1),
		exitCode: z.number().int().optional(),
		failed: z.boolean().optional(),
		summary: z.string().optional(),
	})
	.strict();

const TestPayload = z
	.object({
		label: z.string().min(1),
		passed: z.boolean(),
		summary: z.string().optional(),
	})
	.strict();

const PlanPayload = z
	.object({
		title: z.string().min(1),
		status: z.enum(["pending", "in_progress", "done", "blocked"]),
		summary: z.string().optional(),
	})
	.strict();

const DecisionPayload = z
	.object({
		title: z.string().min(1),
		choice: z.string().min(1),
		options: z.array(z.string().min(1)).optional(),
		summary: z.string().optional(),
	})
	.strict();

const GenericPayload = z
	.object({
		kind: z.string().min(1),
		title: z.string().min(1),
		summary: z.string().optional(),
		payload: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export type ValidatedCodingWork =
	| { type: "work.edit"; payload: z.infer<typeof EditPayload> }
	| { type: "work.command"; payload: z.infer<typeof CommandPayload> }
	| { type: "work.test"; payload: z.infer<typeof TestPayload> }
	| { type: "work.plan"; payload: z.infer<typeof PlanPayload> }
	| { type: "work.decision"; payload: z.infer<typeof DecisionPayload> }
	| { type: "work.generic"; payload: z.infer<typeof GenericPayload> };

export function validateCodingWork(
	type: string,
	payload: unknown,
): ValidatedCodingWork {
	switch (type) {
		case "work.edit":
			return { type, payload: EditPayload.parse(payload) };
		case "work.command":
			return { type, payload: CommandPayload.parse(payload) };
		case "work.test":
			return { type, payload: TestPayload.parse(payload) };
		case "work.plan":
			return { type, payload: PlanPayload.parse(payload) };
		case "work.decision":
			return { type, payload: DecisionPayload.parse(payload) };
		case "work.generic":
			return { type, payload: GenericPayload.parse(payload) };
		default:
			throw new Error(`Unknown coding work type: ${type}`);
	}
}

export const codingPack = {
	id: CODING_PACK_ID,
	schemaVersion: 1 as const,
	validate: validateCodingWork,
};
