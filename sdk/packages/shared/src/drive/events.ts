/**
 * Versioned DriveEvent union (DRV-EVENTS).
 *
 * Five tracks: control, conversation, work, presence, media. No event carries
 * raw audio, full transcripts, or artifact bytes.
 */

import { z } from "zod";
import { AddressSetSchema } from "./address";
import { MediaClassSchema, ShowArtifactKindSchema } from "./director";
import {
	DRIVE_SCHEMA_VERSION,
	DriveSubModeSchema,
	ParticipantSchema,
	StagePinSchema,
	StageSharerSchema,
} from "./room";

export const DriveEventTrackSchema = z.enum([
	"control",
	"conversation",
	"work",
	"presence",
	"media",
]);
export type DriveEventTrack = z.infer<typeof DriveEventTrackSchema>;

const IsoTimestampSchema = z.preprocess(
	(value) => (value instanceof Date ? value.toISOString() : value),
	z.string().datetime(),
);

/**
 * Forbidden payload keys — privacy gate for DRV-PRIVACY / DRV-EVENTS.
 *
 * Audio/transcript keys keep speech out of the log; the media keys keep
 * artifact bytes (base64 data URIs, raw SVG) out of it. Producers hold those
 * in memory; the log carries only the recipe needed to reproduce them.
 */
export const DRIVE_EVENT_FORBIDDEN_KEYS = [
	"audio",
	"rawAudio",
	"pcm",
	"wav",
	"transcript",
	"fullTranscript",
	"rawTranscript",
	"speechAudio",
	"uri",
	"dataUri",
	"svg",
	"image",
	"bytes",
	"thumbnail",
] as const;

const DriveEventBaseSchema = z.object({
	schemaVersion: z.literal(DRIVE_SCHEMA_VERSION),
	id: z.string().min(1),
	roomId: z.string().min(1),
	at: IsoTimestampSchema,
	actorId: z.string().min(1).optional(),
	/** Correlates room events with a call join→leave window (DRV-CALL-SESSION). */
	callSessionId: z.string().min(1).optional(),
});

// ── control ──────────────────────────────────────────────────────────────

export const ControlJoinEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.join"),
	track: z.literal("control"),
	participant: ParticipantSchema,
}).strict();

export const ControlLeaveEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.leave"),
	track: z.literal("control"),
	participantId: z.string().min(1),
	reason: z.string().optional(),
	/** Present when this leave closes the measurable call session. */
	durationMs: z.number().int().nonnegative().optional(),
}).strict();

/**
 * Session end (DRV-LEAVE-END / DRV-RETURN-LOOP). Distinct from leave:
 * leave persists the room; end closes after Tier-0 handoff narration.
 */
export const ControlEndEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.end"),
	track: z.literal("control"),
	reason: z.string().optional(),
	/** Present when this end closes the measurable call session. */
	durationMs: z.number().int().nonnegative().optional(),
}).strict();

export const ControlMuteEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.mute"),
	track: z.literal("control"),
	participantId: z.string().min(1),
	muted: z.boolean(),
}).strict();

export const ControlStageEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.stage"),
	track: z.literal("control"),
	sharer: StageSharerSchema.nullable(),
	pin: StagePinSchema.nullable().optional(),
}).strict();

export const ControlModeEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.mode"),
	track: z.literal("control"),
	subMode: DriveSubModeSchema,
	driveActive: z.boolean().optional(),
}).strict();

export const ControlRaiseHandEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.raise_hand"),
	track: z.literal("control"),
	participantId: z.string().min(1),
	raised: z.boolean(),
}).strict();

export const ControlRenameEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.rename"),
	track: z.literal("control"),
	participantId: z.string().min(1),
	displayName: z.string().min(1),
}).strict();

export const ControlAddressEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.address"),
	track: z.literal("control"),
	addressSet: AddressSetSchema,
}).strict();

// ── conversation ─────────────────────────────────────────────────────────

export const ConversationMessageEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("conversation.message"),
	track: z.literal("conversation"),
	text: z.string(),
	addressSet: AddressSetSchema.optional(),
}).strict();

export const ConversationNarrationEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("conversation.narration"),
	track: z.literal("conversation"),
	text: z.string().min(1),
	/** Work event this narration explains (DRV-NARRATION). */
	relatedWorkEventId: z.string().min(1).optional(),
}).strict();

// ── work ─────────────────────────────────────────────────────────────────

export const WorkEditEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("work.edit"),
	track: z.literal("work"),
	path: z.string().min(1),
	summary: z.string().optional(),
}).strict();

export const WorkCommandEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("work.command"),
	track: z.literal("work"),
	command: z.string().min(1),
	exitCode: z.number().int().optional(),
	failed: z.boolean().optional(),
	/** Optional stage/card copy; reduceRoom falls back to ok/failed. */
	summary: z.string().optional(),
}).strict();

export const WorkTestResultEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("work.test_result"),
	track: z.literal("work"),
	label: z.string().min(1),
	passed: z.boolean(),
	summary: z.string().optional(),
}).strict();

export const WorkPlanStepEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("work.plan_step"),
	track: z.literal("work"),
	title: z.string().min(1),
	status: z.enum(["pending", "in_progress", "done", "blocked"]),
	summary: z.string().optional(),
}).strict();

export const WorkDecisionEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("work.decision"),
	track: z.literal("work"),
	title: z.string().min(1),
	choice: z.string().min(1),
	summary: z.string().optional(),
}).strict();

// ── presence ─────────────────────────────────────────────────────────────

export const PresenceSpeakingEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("presence.speaking"),
	track: z.literal("presence"),
	participantId: z.string().min(1),
	speaking: z.boolean(),
}).strict();

export const PresenceTypingEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("presence.typing"),
	track: z.literal("presence"),
	participantId: z.string().min(1),
	typing: z.boolean(),
}).strict();

export const PresenceStatusEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("presence.status"),
	track: z.literal("presence"),
	participantId: z.string().min(1),
	status: z.enum(["idle", "working", "speaking", "away"]),
}).strict();

// ── media ────────────────────────────────────────────────────────────────

export const MediaArtifactStatusSchema = z.enum([
	"planned",
	"ready",
	"showing",
	"shown",
	"cancelled",
]);
export type MediaArtifactStatus = z.infer<typeof MediaArtifactStatusSchema>;

const MediaArtifactProduceSchema = z
	.object({
		tool: z.string().min(1),
		templateId: z.string().min(1).optional(),
		args: z.record(z.string(), z.unknown()).superRefine((args, ctx) => {
			for (const key of Object.keys(args)) {
				if ((DRIVE_EVENT_FORBIDDEN_KEYS as readonly string[]).includes(key)) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: [key],
						message: `produce.args must not include forbidden key "${key}"`,
					});
				}
			}
		}),
	})
	.strict();

/**
 * Durable artifact record (DRV-ARTIFACTS). Bytes-free by construction: the
 * produce recipe reproduces the artifact, so `uri` / `svg` and friends are
 * rejected by `.strict()` rather than persisted into the JSONL event log.
 */
export const MediaArtifactEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("media.artifact"),
	track: z.literal("media"),
	/** Show backlog item this artifact was produced for. */
	showItemId: z.string().min(1),
	artifactKind: ShowArtifactKindSchema,
	mediaClass: MediaClassSchema,
	title: z.string().min(1),
	caption: z.string(),
	ownerParticipantId: z.string().min(1),
	produce: MediaArtifactProduceSchema,
	tags: z.array(z.string().min(1)).optional(),
	status: MediaArtifactStatusSchema,
}).strict();

export const DriveEventSchema = z.discriminatedUnion("type", [
	ControlJoinEventSchema,
	ControlLeaveEventSchema,
	ControlEndEventSchema,
	ControlMuteEventSchema,
	ControlStageEventSchema,
	ControlModeEventSchema,
	ControlRaiseHandEventSchema,
	ControlRenameEventSchema,
	ControlAddressEventSchema,
	ConversationMessageEventSchema,
	ConversationNarrationEventSchema,
	WorkEditEventSchema,
	WorkCommandEventSchema,
	WorkTestResultEventSchema,
	WorkPlanStepEventSchema,
	WorkDecisionEventSchema,
	PresenceSpeakingEventSchema,
	PresenceTypingEventSchema,
	PresenceStatusEventSchema,
	MediaArtifactEventSchema,
]);

export type DriveEvent = z.infer<typeof DriveEventSchema>;
export type DriveEventType = DriveEvent["type"];

export function parseDriveEvent(input: unknown): DriveEvent {
	return DriveEventSchema.parse(input);
}

/**
 * Exhaustive handler helper. Call sites that switch on `event.type` should
 * use a `never` default; this helper documents the closed set.
 */
export function assertNeverDriveEvent(event: never): never {
	throw new Error(
		`Unhandled DriveEvent: ${JSON.stringify(event satisfies never)}`,
	);
}
