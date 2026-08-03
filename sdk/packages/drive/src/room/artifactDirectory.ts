/**
 * Artifact directory projection — the Artifacts surface over ADR-0013 lane 1.
 *
 * Artifacts today live only in hub memory and vanish when the room stops.
 * `media.artifact` records them on the durable log instead, and this module
 * folds those records into the summary the Artifacts page lists, sorts and
 * filters by kind and tag.
 *
 * Privacy (DRV-PRIVACY): entries carry ids, kinds, tags, timestamps and the
 * produce recipe — never the rendered bytes. The four hub producers all build
 * a base64 data URI, so the event schema refuses `uri` and friends outright;
 * an entry therefore cannot smuggle an image into UI state. Captions are
 * deliberately absent for the same reason roomDirectory omits them: an entry
 * held in UI state must not accumulate into a transcript.
 */

import type {
	DriveEvent,
	MediaArtifactStatus,
	MediaClass,
	ShowArtifactKind,
} from "@cline/shared";

type MediaArtifactEvent = Extract<DriveEvent, { type: "media.artifact" }>;

export type DriveArtifactDirectoryEntry = {
	readonly showItemId: string;
	readonly roomId: string;
	readonly artifactKind: ShowArtifactKind;
	readonly mediaClass: MediaClass;
	readonly title: string;
	readonly ownerParticipantId: string;
	/** The recipe that reproduces the artifact — the log's stand-in for bytes. */
	readonly produce: MediaArtifactEvent["produce"];
	readonly tags: readonly string[];
	readonly status: MediaArtifactStatus;
	/** `at` of the first record for this artifact. */
	readonly createdAt: string;
	/** `at` of the newest record; equals createdAt for a one-record artifact. */
	readonly updatedAt: string;
};

/**
 * Corpus identity. Producers derive `showItemId` from a content hash
 * (`produceMermaid` keys on the mermaid source), so the same diagram rendered
 * in two rooms shares one id — the room qualifies it so one room's record
 * never overwrites another's.
 */
function keyOf(entry: { roomId: string; showItemId: string }): string {
	return `${entry.roomId} ${entry.showItemId}`;
}

function entryFromEvent(
	event: MediaArtifactEvent,
	createdAt: string,
): DriveArtifactDirectoryEntry {
	return {
		showItemId: event.showItemId,
		roomId: event.roomId,
		artifactKind: event.artifactKind,
		mediaClass: event.mediaClass,
		title: event.title,
		ownerParticipantId: event.ownerParticipantId,
		produce: event.produce,
		tags: [...(event.tags ?? [])],
		status: event.status,
		createdAt,
		updatedAt: event.at,
	};
}

/**
 * Fold durable records into one entry per artifact.
 *
 * An artifact is re-recorded as it moves through the show lifecycle
 * (planned → ready → shown), so the newest record wins for every field while
 * `createdAt` and list position stay with the first — the corpus keeps the
 * order artifacts were first produced in, not the order they were last shown.
 * Non-artifact records pass through untouched.
 */
export function projectArtifactDirectory(input: {
	events: readonly DriveEvent[];
}): DriveArtifactDirectoryEntry[] {
	const entries: DriveArtifactDirectoryEntry[] = [];
	const indexByKey = new Map<string, number>();

	for (const event of input.events) {
		if (event.type !== "media.artifact") {
			continue;
		}
		const key = keyOf(event);
		const index = indexByKey.get(key);
		if (index === undefined) {
			indexByKey.set(key, entries.length);
			entries.push(entryFromEvent(event, event.at));
			continue;
		}
		const existing = entries[index];
		entries[index] = entryFromEvent(event, existing?.createdAt ?? event.at);
	}

	return entries;
}

/** Newest first — an Artifacts page leads with what was just produced. */
export function sortArtifactDirectory(
	entries: readonly DriveArtifactDirectoryEntry[],
): DriveArtifactDirectoryEntry[] {
	return [...entries].sort((a, b) => {
		const byRecency = b.updatedAt.localeCompare(a.updatedAt);
		return byRecency !== 0 ? byRecency : keyOf(a).localeCompare(keyOf(b));
	});
}

/**
 * Facet filter for the Artifacts page. An omitted facet does not narrow;
 * supplying both requires the entry to match each.
 */
export function filterArtifactDirectory(
	entries: readonly DriveArtifactDirectoryEntry[],
	facets: { kind?: ShowArtifactKind; tag?: string },
): DriveArtifactDirectoryEntry[] {
	return entries.filter((entry) => {
		if (facets.kind !== undefined && entry.artifactKind !== facets.kind) {
			return false;
		}
		return facets.tag === undefined || entry.tags.includes(facets.tag);
	});
}

/** Every tag in the corpus, sorted — the filter chips the page offers. */
export function artifactDirectoryTags(
	entries: readonly DriveArtifactDirectoryEntry[],
): string[] {
	const tags = new Set<string>();
	for (const entry of entries) {
		for (const tag of entry.tags) {
			tags.add(tag);
		}
	}
	return [...tags].sort();
}
