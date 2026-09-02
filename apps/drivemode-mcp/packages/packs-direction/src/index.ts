import { z } from "zod";

export const DIRECTION_PACK_ID = "direction" as const;

/**
 * Directed-Spotlight annotations: beats group work into a choreographed,
 * replayable program a phone can digest. Events, never pixels — this pack
 * only labels the program structure; the work itself stays in its own
 * events (link via `relatedEventIds`).
 */
export const BeatKindSchema = z.enum([
	"plan",
	"diagram",
	"edit",
	"run",
	"tests",
	"decision",
	"result",
]);
export type BeatKind = z.infer<typeof BeatKindSchema>;

const BeatPayload = z
	.object({
		/** One program per session narrative; beats index into it. */
		programId: z.string().min(1),
		beatIndex: z.number().int().nonnegative(),
		kind: BeatKindSchema,
		title: z.string().min(1),
		/** Participant driving this beat (appearance id, never a model id). */
		directorId: z.string().min(1).optional(),
		/** The caption line the director speaks over the beat. */
		caption: z.string().optional(),
		/** Pacing hint in seconds — clients may ignore. */
		durationSec: z.number().positive().optional(),
		/** Work event ids this beat choreographs. */
		relatedEventIds: z.array(z.string().min(1)).optional(),
		/**
		 * Director-curated stage lines: plan steps, diff summary lines,
		 * command output, test names, metric rows ("label|value"). Typed
		 * text the director chose to stage — events, never pixels; never
		 * raw file contents or transcripts.
		 */
		steps: z.array(z.string()).max(24).optional(),
		/** Indexes into `steps` the stage accents (chosen option, new
		 * node, after-metric). */
		accent: z.array(z.number().int().nonnegative()).max(24).optional(),
		summary: z.string().optional(),
	})
	.strict();

export type ValidatedDirectionWork = {
	type: "work.direction.beat";
	payload: z.infer<typeof BeatPayload>;
};

export function validateDirectionWork(
	type: string,
	payload: unknown,
): ValidatedDirectionWork {
	switch (type) {
		case "work.direction.beat":
			return { type, payload: BeatPayload.parse(payload) };
		default:
			throw new Error(`Unknown direction work type: ${type}`);
	}
}

export const directionPack = {
	id: DIRECTION_PACK_ID,
	schemaVersion: 1 as const,
	validate: validateDirectionWork,
};
