import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	assertFacetProviderSelection,
	defaultFacetValuesFromProfile,
} from "@cline/drive";
import {
	DRIVE_FACET_SCHEMA_VERSION,
	type DriveFacetDiskFile,
	type DriveFacetValues,
	type FacetDiskEntry,
	parseDriveFacetDiskFile,
	parseDriveFacetValues,
	type ResolvedLlmEgress,
	resolveDriveFacetsPath,
} from "@cline/shared";

const FACET_IDS = [
	"runtime.profile",
	"runtime.egressCeiling",
	"providers.sttId",
	"providers.sttConfig",
	"providers.ttsId",
	"providers.ttsConfig",
	"tts.enabled",
	"tts.maxSpokenSentences",
	"captions.enabled",
	"earcons.taskComplete",
	"earcons.approvalRequired",
	"earcons.join",
	"earcons.leave",
	"drive.defaults.pairAgent",
] as const satisfies ReadonlyArray<keyof DriveFacetValues>;

/**
 * Flat runtime values → on-disk envelope (ADR-0013 / D7).
 *
 * `previous` is not optional in spirit: the write below atomically replaces the
 * whole file, and `DriveFacetValues` only covers `FACET_IDS`. Rebuilding
 * `entries` from `FACET_IDS` alone would drop every other entry in the file —
 * silently, since `diskFileToFacetValues` also ignores anything that is not a
 * `kind: "value"`. Carrying the rest forward keeps an unrelated put (a user
 * changing their TTS provider) from deleting data it never read.
 */
export function facetValuesToDiskFile(
	facets: DriveFacetValues,
	previous?: DriveFacetDiskFile | null,
): DriveFacetDiskFile {
	const entries: DriveFacetDiskFile["entries"] = { ...previous?.entries };
	for (const id of FACET_IDS) {
		entries[id] = { kind: "value", value: facets[id] };
	}
	return {
		schemaVersion: DRIVE_FACET_SCHEMA_VERSION,
		entries,
	};
}

/**
 * Raw envelope on disk, or null when there is nothing to carry forward.
 *
 * Unparseable bytes yield null so a corrupt file is still repaired by the next
 * write, as it was before this merge existed — an unreadable file holds no
 * entries worth preserving anyway. A *future* schemaVersion is different, and
 * `parseDriveFacetDiskFile` is left to throw on it: overwriting a v2 file with
 * a v1 one is the exact silent downgrade this merge exists to prevent.
 */
function readDriveFacetsDiskFile(
	configParent: string,
): DriveFacetDiskFile | null {
	const path = resolveDriveFacetsPath(configParent);
	if (!existsSync(path)) {
		return null;
	}
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
	} catch {
		return null;
	}
	if (
		raw === null ||
		typeof raw !== "object" ||
		!("schemaVersion" in raw) ||
		!("entries" in raw)
	) {
		// Legacy flat JSON carries no extra entries to preserve.
		return null;
	}
	return parseDriveFacetDiskFile(raw);
}

/** Envelope or legacy flat JSON → flat DriveFacetValues. */
export function diskFileToFacetValues(raw: unknown): DriveFacetValues {
	if (
		raw !== null &&
		typeof raw === "object" &&
		"schemaVersion" in raw &&
		"entries" in raw
	) {
		const file = parseDriveFacetDiskFile(raw);
		const flat: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(file.entries) as Array<
			[string, FacetDiskEntry]
		>) {
			if (entry.kind === "value") {
				flat[key] = entry.value;
			}
		}
		return parseDriveFacetValues(flat);
	}
	return parseDriveFacetValues(raw);
}

export function readDriveFacetsFile(
	configParent: string,
): DriveFacetValues | null {
	const path = resolveDriveFacetsPath(configParent);
	if (!existsSync(path)) {
		return null;
	}
	const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
	return diskFileToFacetValues(raw);
}

export function writeDriveFacetsFile(
	configParent: string,
	facets: DriveFacetValues,
): void {
	const path = resolveDriveFacetsPath(configParent);
	const previous = readDriveFacetsDiskFile(configParent);
	mkdirSync(dirname(path), { recursive: true });
	const envelope = facetValuesToDiskFile(facets, previous);
	const tmp = join(dirname(path), `.facets.v1.${process.pid}.tmp.json`);
	writeFileSync(tmp, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
	renameSync(tmp, path);
}

/**
 * Validate provider selection against topology, then atomically persist facets.
 */
export function setDriveFacets(input: {
	configParent: string;
	facets: DriveFacetValues;
	llm: ResolvedLlmEgress;
}):
	| {
			ok: true;
			facets: DriveFacetValues;
			/** Payload for hub CONFIG_SNAPSHOT broadcast (no secrets). */
			snapshot: {
				profile: DriveFacetValues["runtime.profile"];
				sttId: string;
				ttsId: string;
				egressCeiling: DriveFacetValues["runtime.egressCeiling"];
			};
	  }
	| { ok: false; message: string } {
	const check = assertFacetProviderSelection({
		facets: input.facets,
		llm: input.llm,
	});
	if (!check.ok) {
		return check;
	}
	writeDriveFacetsFile(input.configParent, input.facets);
	return {
		ok: true,
		facets: input.facets,
		snapshot: {
			profile: input.facets["runtime.profile"],
			sttId: input.facets["providers.sttId"],
			ttsId: input.facets["providers.ttsId"],
			egressCeiling: input.facets["runtime.egressCeiling"],
		},
	};
}

export function loadOrSeedDriveFacets(input: {
	configParent: string;
	profile?: DriveFacetValues["runtime.profile"];
}): DriveFacetValues {
	const existing = readDriveFacetsFile(input.configParent);
	if (existing) {
		return existing;
	}
	const seeded = defaultFacetValuesFromProfile(input.profile ?? "cloud");
	writeDriveFacetsFile(input.configParent, seeded);
	return seeded;
}
