import { z } from "zod";

export const ARTIFACTS_PACK_ID = "artifacts" as const;

/**
 * Artifact lifecycle events. Purpose decides lifespan: ephemeral artifacts
 * carry a TTL and file to the archive when it passes; permanent ones keep
 * until superseded. Rides `work.generic`.
 */
export const ArtifactKindSchema = z.enum([
	"plan",
	"diff",
	"report",
	"replay",
	"doc",
	"capture",
]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

/** Permanent (until superseded) or ephemeral with a TTL in days. */
export const ArtifactLifeSchema = z.union([
	z.object({ permanent: z.literal(true) }).strict(),
	z.object({ ttlDays: z.number().int().positive() }).strict(),
]);
export type ArtifactLife = z.infer<typeof ArtifactLifeSchema>;

const CreatedPayload = z
	.object({
		artifactId: z.string().min(1),
		title: z.string().min(1),
		kind: ArtifactKindSchema,
		life: ArtifactLifeSchema,
		sizeKb: z.number().int().nonnegative().optional(),
		repo: z.string().optional(),
		summary: z.string().optional(),
	})
	.strict();

const SupersededPayload = z
	.object({
		artifactId: z.string().min(1),
		supersededBy: z.string().min(1),
		title: z.string().min(1).optional(),
		summary: z.string().optional(),
	})
	.strict();

const LifecyclePayload = z
	.object({
		artifactId: z.string().min(1),
		action: z.enum(["archived", "restored", "expired"]),
		title: z.string().min(1).optional(),
		summary: z.string().optional(),
	})
	.strict();

export type ValidatedArtifactsWork =
	| { type: "work.artifact.created"; payload: z.infer<typeof CreatedPayload> }
	| {
			type: "work.artifact.superseded";
			payload: z.infer<typeof SupersededPayload>;
	  }
	| {
			type: "work.artifact.lifecycle";
			payload: z.infer<typeof LifecyclePayload>;
	  };

export function validateArtifactsWork(
	type: string,
	payload: unknown,
): ValidatedArtifactsWork {
	switch (type) {
		case "work.artifact.created":
			return { type, payload: CreatedPayload.parse(payload) };
		case "work.artifact.superseded":
			return { type, payload: SupersededPayload.parse(payload) };
		case "work.artifact.lifecycle":
			return { type, payload: LifecyclePayload.parse(payload) };
		default:
			throw new Error(`Unknown artifacts work type: ${type}`);
	}
}

export const artifactsPack = {
	id: ARTIFACTS_PACK_ID,
	schemaVersion: 1 as const,
	validate: validateArtifactsWork,
};
