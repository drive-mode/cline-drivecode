import { z } from "zod";

export const DEMO_OPS_PACK_ID = "demo-ops" as const;

const AlertPayload = z
	.object({
		title: z.string().min(1),
		severity: z.enum(["p1", "p2", "p3", "p4"]).default("p2"),
		summary: z.string().optional(),
		service: z.string().optional(),
	})
	.strict();

const RunbookStepPayload = z
	.object({
		title: z.string().min(1),
		step: z.string().min(1),
		status: z.enum(["pending", "in_progress", "done", "blocked"]),
		summary: z.string().optional(),
	})
	.strict();

export type ValidatedDemoOpsWork =
	| {
			type: "work.ops.alert";
			payload: z.infer<typeof AlertPayload>;
	  }
	| {
			type: "work.ops.runbook_step";
			payload: z.infer<typeof RunbookStepPayload>;
	  };

export function validateDemoOpsWork(
	type: string,
	payload: unknown,
): ValidatedDemoOpsWork {
	switch (type) {
		case "work.ops.alert":
			return { type, payload: AlertPayload.parse(payload) };
		case "work.ops.runbook_step":
			return { type, payload: RunbookStepPayload.parse(payload) };
		default:
			throw new Error(`Unknown demo-ops work type: ${type}`);
	}
}

export const demoOpsPack = {
	id: DEMO_OPS_PACK_ID,
	schemaVersion: 1 as const,
	validate: validateDemoOpsWork,
};
