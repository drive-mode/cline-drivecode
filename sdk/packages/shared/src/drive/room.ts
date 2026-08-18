/**
 * Drive room / roster / stage shapes (DRV-EVENTS).
 *
 * Parseable at hub and app boundaries. Live fields (addressSet, sharer)
 * are room state — not durable workspace facets.
 */

import { z } from "zod";
import { AddressSetSchema, EVERYONE_ADDRESS } from "./address";
import { AgentRefSchema } from "./agentRef";

export const DRIVE_SCHEMA_VERSION = 1 as const;

/**
 * Effective permission ceiling at seat time (DRV-ROSTER-PACK / home intents).
 * Lives here (not in facets) so the participant shape stays cycle-free;
 * `facets/rosterPack` re-exports it as the roster-pack public surface.
 */
export const PermissionPresetSchema = z.enum(["readonly", "standard", "full"]);
export type PermissionPreset = z.infer<typeof PermissionPresetSchema>;

export const DriveSubModeSchema = z.enum(["plan", "act", "ask", "debug"]);
export type DriveSubMode = z.infer<typeof DriveSubModeSchema>;

export const DriveHumanRoleSchema = z.enum(["host", "participant", "observer"]);
export type DriveHumanRole = z.infer<typeof DriveHumanRoleSchema>;

export const DriveAgentRoleSchema = z.enum([
	"partner",
	"specialist",
	"recorder",
]);
export type DriveAgentRole = z.infer<typeof DriveAgentRoleSchema>;

export const ParticipantStatusSchema = z.enum([
	"idle",
	"working",
	"speaking",
	"away",
]);
export type ParticipantStatus = z.infer<typeof ParticipantStatusSchema>;

/** Why an agent is seated (DRV-ROSTER-PACK). Never empty while seated. */
export const SeatSourceSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("manual"),
		})
		.strict(),
	z
		.object({
			kind: z.literal("pack"),
			packId: z.string().min(1),
		})
		.strict(),
	z
		.object({
			kind: z.literal("spawn"),
			parentId: z.string().min(1),
		})
		.strict(),
]);
export type SeatSource = z.infer<typeof SeatSourceSchema>;

/** Coerce legacy pack-id strings into structured SeatSource values. */
export function coerceSeatSources(input: unknown): SeatSource[] {
	if (!Array.isArray(input)) {
		return [];
	}
	return input.map((entry) => {
		if (typeof entry === "string" && entry.trim()) {
			return { kind: "pack" as const, packId: entry.trim() };
		}
		return SeatSourceSchema.parse(entry);
	});
}

export function parseSeatSource(input: unknown): SeatSource {
	return SeatSourceSchema.parse(input);
}

export const HumanParticipantSchema = z
	.object({
		id: z.string().min(1),
		kind: z.literal("human"),
		displayName: z.string().min(1),
		role: DriveHumanRoleSchema,
		status: ParticipantStatusSchema.default("idle"),
	})
	.strict();

export const AgentParticipantSchema = z
	.object({
		id: z.string().min(1),
		kind: z.literal("agent"),
		displayName: z.string().min(1),
		role: DriveAgentRoleSchema,
		status: ParticipantStatusSchema.default("idle"),
		/**
		 * Identity spine (DEC-agent-source-of-truth). Optional forever: join
		 * events persisted by earlier builds have no `ref`, and a required
		 * field would make those event logs unparseable.
		 */
		ref: AgentRefSchema.optional(),
		/**
		 * Permission ceiling recorded at seat time (DRV-ROSTER-PACK). Storage
		 * only — enforcement happens at the approval point. Optional for the
		 * same backward-compatibility reason as `ref`.
		 */
		capPreset: PermissionPresetSchema.optional(),
		/** Seat provenance (DRV-ROSTER-PACK). Never empty while seated. */
		seatSources: z.preprocess(
			(value) => (value === undefined ? undefined : coerceSeatSources(value)),
			z.array(SeatSourceSchema).default([]),
		),
	})
	.strict();

export const ParticipantSchema = z.discriminatedUnion("kind", [
	HumanParticipantSchema,
	AgentParticipantSchema,
]);
export type Participant = z.infer<typeof ParticipantSchema>;
export type HumanParticipant = z.infer<typeof HumanParticipantSchema>;
export type AgentParticipant = z.infer<typeof AgentParticipantSchema>;

export const StageSharerSchema = z
	.object({
		kind: z.enum(["human", "agent"]),
		participantId: z.string().min(1),
	})
	.strict();
export type StageSharer = z.infer<typeof StageSharerSchema>;

/** Structured human share pin (DRV-SHARE MVP). No WebRTC pixels. */
export const StagePinSchema = z
	.object({
		kind: z.enum(["selection", "file", "terminal"]),
		label: z.string().min(1),
		ref: z.string().min(1).optional(),
	})
	.strict();
export type StagePin = z.infer<typeof StagePinSchema>;

export const StageCardSchema = z
	.object({
		id: z.string().min(1),
		category: z.enum(["edit", "command", "test", "plan", "decision", "other"]),
		title: z.string().min(1),
		summary: z.string().optional(),
		workEventId: z.string().min(1).optional(),
		updatedAt: z.string().datetime(),
	})
	.strict();
export type StageCard = z.infer<typeof StageCardSchema>;

export const AgentTitleSchema = z.enum(["presenter"]);
export type AgentTitle = z.infer<typeof AgentTitleSchema>;

export const AgentTitleScopeSchema = z
	.object({
		kind: z.enum(["room", "session", "stage"]),
		ref: z.string().min(1),
	})
	.strict();
export type AgentTitleScope = z.infer<typeof AgentTitleScopeSchema>;

export const AgentTitlePermissionSchema = z.enum(["stage.present"]);
export type AgentTitlePermission = z.infer<typeof AgentTitlePermissionSchema>;

/**
 * Temporary, reference-only authority. Skill/resource bodies, prompts, model
 * configuration and tool policy remain on the host and cannot cross here.
 */
export const AgentTitleGrantSchema = z
	.object({
		id: z.string().min(1),
		agentId: z.string().min(1),
		title: AgentTitleSchema,
		scope: AgentTitleScopeSchema,
		skillBundleRefs: z.array(z.string().min(1)).max(32).default([]),
		resourceGrantRefs: z.array(z.string().min(1)).max(64).default([]),
		delegatedAgentIds: z.array(z.string().min(1)).max(32).default([]),
		permissions: z.array(AgentTitlePermissionSchema).min(1).max(16),
		grantedAt: z.string().datetime(),
		expiresAt: z.string().datetime(),
		revokedAt: z.string().datetime().optional(),
	})
	.strict()
	.refine(
		(grant) => Date.parse(grant.expiresAt) > Date.parse(grant.grantedAt),
		{
			message: "expiresAt must be after grantedAt",
			path: ["expiresAt"],
		},
	)
	.refine(
		(grant) =>
			grant.title !== "presenter" ||
			grant.permissions.includes("stage.present"),
		{
			message: "Presenter grants require stage.present",
			path: ["permissions"],
		},
	);
export type AgentTitleGrant = z.infer<typeof AgentTitleGrantSchema>;

export const StageStateSchema = z
	.object({
		sharer: StageSharerSchema.nullable().default(null),
		pin: StagePinSchema.nullable().default(null),
		cards: z.array(StageCardSchema).default([]),
		/** Active temporary authority for an agent stage sharer. */
		presenterGrantId: z.string().min(1).nullable().default(null),
	})
	.strict();
export type StageState = z.infer<typeof StageStateSchema>;

export const RoomSnapshotSchema = z
	.object({
		schemaVersion: z.literal(DRIVE_SCHEMA_VERSION),
		roomId: z.string().min(1),
		createdAt: z.string().datetime(),
		driveActive: z.boolean(),
		subMode: DriveSubModeSchema,
		participants: z.array(ParticipantSchema),
		stage: StageStateSchema,
		titleGrantsById: z.record(z.string(), AgentTitleGrantSchema).default({}),
		addressSet: AddressSetSchema.default(EVERYONE_ADDRESS),
		muteByParticipantId: z.record(z.string(), z.boolean()).default({}),
		raisedHandByParticipantId: z.record(z.string(), z.boolean()).default({}),
		/** Ring of applied event ids for idempotent reduce. */
		appliedEventIds: z.array(z.string().min(1)).default([]),
	})
	.strict();
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;

export function parseRoomSnapshot(input: unknown): RoomSnapshot {
	return RoomSnapshotSchema.parse(input);
}

export function parseParticipant(input: unknown): Participant {
	return ParticipantSchema.parse(input);
}
