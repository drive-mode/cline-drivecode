/**
 * Shared log envelope for room + bank + artifact families (ADR-0013 phase 6).
 * Keeps unions separate while one cursorable stream can carry all three.
 */

import { z } from "zod";
import { BankDriveEventSchema } from "./bankEvents";
import { DriveEventSchema, MediaArtifactEventSchema } from "./events";

export const DriveLogFamilySchema = z.enum(["room", "bank", "artifact"]);
export type DriveLogFamily = z.infer<typeof DriveLogFamilySchema>;

export const DriveLogEnvelopeSchema = z.discriminatedUnion("family", [
	z
		.object({
			family: z.literal("room"),
			seq: z.number().int().positive(),
			roomId: z.string().min(1),
			event: DriveEventSchema,
		})
		.strict(),
	z
		.object({
			family: z.literal("bank"),
			seq: z.number().int().positive(),
			workspaceRoot: z.string().min(1).optional(),
			event: BankDriveEventSchema,
		})
		.strict(),
	/**
	 * Artifact corpus (DRV-ARTIFACTS). Its own family, not a `media.artifact`
	 * on the room family: the room log trims oldest-first at a cap counted in
	 * mixed events, so presence and work traffic would evict the artifacts an
	 * Artifacts page exists to list. `roomId` rides the envelope because corpus
	 * identity is roomId + showItemId — producers content-hash showItemId, so
	 * the same diagram in two rooms is two artifacts.
	 */
	z
		.object({
			family: z.literal("artifact"),
			seq: z.number().int().positive(),
			roomId: z.string().min(1),
			event: MediaArtifactEventSchema,
		})
		.strict(),
]);
export type DriveLogEnvelope = z.infer<typeof DriveLogEnvelopeSchema>;

export function parseDriveLogEnvelope(input: unknown): DriveLogEnvelope {
	return DriveLogEnvelopeSchema.parse(input);
}
