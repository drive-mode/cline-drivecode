/**
 * Facet value + disk envelope schemas (DRV-PLATFORM-CONFIG).
 */

import { z } from "zod";
import {
	type AgentRef,
	AgentRefSchema,
	DriveagentSlugSchema,
} from "../agentRef";
import { DriveSubModeSchema } from "../room";
import {
	DRIVE_FACET_SCHEMA_VERSION,
	UnknownFacetSchemaVersionError,
} from "./types";

export const DriveInkTokenSchema = z.enum([
	"foreground",
	"muted",
	"success",
	"warning",
	"info",
]);
export type DriveInkToken = z.infer<typeof DriveInkTokenSchema>;

export const InkRefSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("token"),
			token: DriveInkTokenSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("palette"),
			index: z.union([
				z.literal(0),
				z.literal(1),
				z.literal(2),
				z.literal(3),
				z.literal(4),
				z.literal(5),
				z.literal(6),
				z.literal(7),
			]),
		})
		.strict(),
]);
export type InkRef = z.infer<typeof InkRefSchema>;

/** Appearance overlay — no prompts, tools, provider, or model fields. */
export const AgentAppearanceSchema = z
	.object({
		displayName: z.string().min(1).optional(),
		nameInk: InkRefSchema,
		bodyInk: InkRefSchema,
	})
	.strict();
export type AgentAppearance = z.infer<typeof AgentAppearanceSchema>;

/**
 * Appearance-only AgentProfile overlay (DEC-agent-SoT / DRV-AGENT-PROFILE).
 * Definition fields live in `.driveagent/<slug>/`, never here.
 */
export const AgentProfileSchema = z
	.object({
		id: z.string().min(1),
		ref: AgentRefSchema,
		displayName: z.string().min(1).optional(),
		nameInk: InkRefSchema,
		bodyInk: InkRefSchema,
	})
	.strict();
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export function parseAgentAppearance(input: unknown): AgentAppearance {
	return AgentAppearanceSchema.parse(input);
}

/**
 * Profile id the facet store falls back to when a reader asks for appearance
 * without naming an agent.
 *
 * Equals `agentProfileId({ kind: "builtin", id: "pair_partner" })`. The store
 * lives in `@cline/drive`, which may only type-import this package, so it
 * repeats the literal rather than importing this. `driveAgentProfileStore.test`
 * pins the two together from `@cline/core`, where both are visible.
 */
export const DEFAULT_AGENT_PROFILE_ID = "builtin.pair_partner";

/**
 * Canonical durable key for an agent's appearance profile.
 *
 * The id *is* the ref, flattened — `agentProfileId` and `parseAgentProfileId`
 * round-trip, so the `agent.appearance` map needs no second file to remember
 * which agent a stored appearance paints. `kind` never contains a `.`, and the
 * split is on the first one, so ids with dots in them survive the round trip.
 */
export function agentProfileId(ref: AgentRef): string {
	return ref.kind === "driveagent"
		? `driveagent.${ref.slug}`
		: `${ref.kind}.${ref.id}`;
}

/** Inverse of `agentProfileId`; null when the id is not a canonical ref key. */
export function parseAgentProfileId(id: string): AgentRef | null {
	const separator = id.indexOf(".");
	if (separator <= 0) {
		return null;
	}
	const kind = id.slice(0, separator);
	const rest = id.slice(separator + 1);
	if (!rest) {
		return null;
	}
	if (kind === "driveagent") {
		return DriveagentSlugSchema.safeParse(rest).success
			? { kind: "driveagent", slug: rest }
			: null;
	}
	if (kind === "builtin" || kind === "configured") {
		return { kind, id: rest };
	}
	return null;
}

/** Rebuild the full profile from its durable key + stored appearance. */
export function toAgentProfile(
	id: string,
	appearance: AgentAppearance,
): AgentProfile | null {
	const ref = parseAgentProfileId(id);
	return ref ? { id, ref, ...appearance } : null;
}

export const DriveDefaultsSubModeSchema = DriveSubModeSchema;
export type DriveDefaultsSubMode = z.infer<typeof DriveDefaultsSubModeSchema>;

/** Forbidden keys on durable Drive facet / profile-shaped values (DEC-agent-SoT). */
export const DRIVE_FACET_FORBIDDEN_PROMPT_KEYS = [
	"systemPrompt",
	"prompt",
	"tools",
	"skills",
	"providerId",
	"modelId",
	"provider",
	"model",
	"maxIterations",
] as const;

const FacetScalarEntrySchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("value"),
			value: z.unknown(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("tombstone"),
		})
		.strict(),
]);

const FacetMapEntrySchema = z
	.object({
		kind: z.literal("map"),
		entries: z.record(z.string(), FacetScalarEntrySchema),
	})
	.strict();

export const FacetDiskEntrySchema = z.union([
	FacetScalarEntrySchema,
	FacetMapEntrySchema,
]);
export type FacetDiskEntry = z.infer<typeof FacetDiskEntrySchema>;

export const DriveFacetDiskFileSchema = z
	.object({
		schemaVersion: z.literal(DRIVE_FACET_SCHEMA_VERSION),
		entries: z.record(z.string(), FacetDiskEntrySchema).default({}),
	})
	.strict();
export type DriveFacetDiskFile = z.infer<typeof DriveFacetDiskFileSchema>;

/** Merged durable view consumed by the pure facet store. */
export type DriveFacetDiskSnapshot = {
	readonly schemaVersion: typeof DRIVE_FACET_SCHEMA_VERSION;
	readonly values: Readonly<Record<string, unknown>>;
	/** Per-entity maps (e.g. agent.appearance by profile id). */
	readonly maps: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
};

export function parseDriveFacetDiskFile(input: unknown): DriveFacetDiskFile {
	if (
		input !== null &&
		typeof input === "object" &&
		"schemaVersion" in input &&
		(input as { schemaVersion: unknown }).schemaVersion !==
			DRIVE_FACET_SCHEMA_VERSION
	) {
		throw new UnknownFacetSchemaVersionError(
			(input as { schemaVersion: unknown }).schemaVersion,
		);
	}
	return DriveFacetDiskFileSchema.parse(input);
}

/** v1 migration is identity (applied at hub parse boundary). */
export function migrateDriveFacetDiskFile(
	file: DriveFacetDiskFile,
): DriveFacetDiskFile {
	return file;
}
