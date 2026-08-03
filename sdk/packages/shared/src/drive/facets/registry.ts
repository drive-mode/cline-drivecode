/**
 * Durable Drive registry envelope (roster packs) — registry.v1.json.
 *
 * Agent appearance profiles are *not* here: they live in the `agent.appearance`
 * map of the catalog facet envelope, keyed by `agentProfileId(ref)`.
 */

import { z } from "zod";
import { RosterPackSchema } from "./rosterPack";

export const DRIVE_REGISTRY_SCHEMA_VERSION = 1 as const;

export const DriveRegistrySchema = z
	.object({
		schemaVersion: z.literal(DRIVE_REGISTRY_SCHEMA_VERSION),
		packs: z.record(z.string().min(1), RosterPackSchema).default({}),
	})
	.strict();

export type DriveRegistry = z.infer<typeof DriveRegistrySchema>;

export function parseDriveRegistry(input: unknown): DriveRegistry {
	return DriveRegistrySchema.parse(input);
}

export function emptyDriveRegistry(): DriveRegistry {
	return {
		schemaVersion: DRIVE_REGISTRY_SCHEMA_VERSION,
		packs: {},
	};
}

/** Lookup by pack id (map key or pack.id) or slug. */
export function lookupRosterPack(
	registry: DriveRegistry,
	packIdOrSlug: string,
): z.infer<typeof RosterPackSchema> | null {
	const trimmed = packIdOrSlug.trim();
	if (!trimmed) {
		return null;
	}
	const byKey = registry.packs[trimmed];
	if (byKey) {
		return byKey;
	}
	for (const pack of Object.values(registry.packs)) {
		if (pack.id === trimmed || pack.slug === trimmed) {
			return pack;
		}
	}
	return null;
}
