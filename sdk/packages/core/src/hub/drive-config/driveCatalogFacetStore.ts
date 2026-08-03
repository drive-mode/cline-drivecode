/**
 * Platform catalog facet IO (ADR-0013 / DRV-PLATFORM-CONFIG).
 * Separate from voice `driveFacetsStore` (facets.v1.json).
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	createFacetStore,
	DRIVE_FACET_CATALOG,
	type DriveFacetKey,
	type FacetStore,
} from "@cline/drive";
import type {
	DriveFacetDiskFile,
	DriveFacetDiskSnapshot,
	DriveSubMode,
} from "@cline/shared";
import {
	DRIVE_FACET_SCHEMA_VERSION,
	mergeFacetScopes,
	parseDriveFacetDiskFile,
	resolveDriveConfigDir,
} from "@cline/shared";

export const CATALOG_FACETS_FILE_NAME = "catalog-facets.v1.json";

const stores = new Map<string, FacetStore>();

export function resolveCatalogFacetsPath(configParent: string): string {
	return join(resolveDriveConfigDir(configParent), CATALOG_FACETS_FILE_NAME);
}

function readCatalogFile(configParent: string): DriveFacetDiskFile | null {
	const path = resolveCatalogFacetsPath(configParent);
	if (!existsSync(path)) {
		return null;
	}
	const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
	return parseDriveFacetDiskFile(raw);
}

function writeCatalogFileAtomic(
	configParent: string,
	file: DriveFacetDiskFile,
): void {
	const path = resolveCatalogFacetsPath(configParent);
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
	renameSync(tmp, path);
}

/** Load merged user + workspace catalog snapshots into a FacetStore. */
export function loadCatalogFacetStore(input: {
	workspaceRoot: string;
	userRoot?: string | null;
}): FacetStore {
	const key = input.workspaceRoot;
	const existing = stores.get(key);
	const user = input.userRoot ? readCatalogFile(input.userRoot) : null;
	const workspace = readCatalogFile(input.workspaceRoot);
	const merged = mergeFacetScopes(user, workspace);
	if (existing) {
		existing.reload(merged);
		return existing;
	}
	const store = createFacetStore(merged);
	store.seedLiveFromDurable();
	stores.set(key, store);
	return store;
}

export function getCatalogDefaultSubMode(workspaceRoot: string): DriveSubMode {
	const store = loadCatalogFacetStore({ workspaceRoot });
	return store.get("drive.defaults.subMode");
}

const LIVE_KEYS = new Set(
	(Object.keys(DRIVE_FACET_CATALOG) as DriveFacetKey[]).filter(
		(k) => DRIVE_FACET_CATALOG[k].lane === "live",
	),
);

export type PutCatalogDurableResult =
	| { ok: true; snapshot: DriveFacetDiskSnapshot }
	| { ok: false; code: string; message: string };

/**
 * Durable-only put. Rejects live-lane keys (e.g. room.live.subMode).
 */
export function putCatalogDurableValues(input: {
	workspaceRoot: string;
	values: Record<string, unknown>;
}): PutCatalogDurableResult {
	for (const key of Object.keys(input.values)) {
		if (LIVE_KEYS.has(key as DriveFacetKey)) {
			return {
				ok: false,
				code: "live_key_rejected",
				message: `Cannot put live facet "${key}" to disk`,
			};
		}
		if (!(key in DRIVE_FACET_CATALOG)) {
			return {
				ok: false,
				code: "unknown_facet",
				message: `Unknown catalog facet "${key}"`,
			};
		}
		if (DRIVE_FACET_CATALOG[key as DriveFacetKey].lane !== "durable") {
			return {
				ok: false,
				code: "not_durable",
				message: `Facet "${key}" is not durable`,
			};
		}
	}

	const previous = readCatalogFile(input.workspaceRoot) ?? {
		schemaVersion: DRIVE_FACET_SCHEMA_VERSION,
		entries: {},
	};
	const entries = { ...previous.entries };
	for (const [key, value] of Object.entries(input.values)) {
		entries[key] = { kind: "value", value };
	}
	const next: DriveFacetDiskFile = {
		schemaVersion: DRIVE_FACET_SCHEMA_VERSION,
		entries,
	};
	writeCatalogFileAtomic(input.workspaceRoot, next);
	const store = loadCatalogFacetStore({ workspaceRoot: input.workspaceRoot });
	return { ok: true, snapshot: store.snapshot().durable };
}

export function catalogSnapshotView(workspaceRoot: string): {
	durable: DriveFacetDiskSnapshot;
	live: Readonly<Partial<Record<DriveFacetKey, unknown>>>;
	defs: ReturnType<FacetStore["listDefs"]>;
} {
	const store = loadCatalogFacetStore({ workspaceRoot });
	const snap = store.snapshot();
	return {
		durable: snap.durable,
		live: snap.live,
		defs: store.listDefs(),
	};
}

/** @internal */
export function __resetCatalogFacetStoresForTests(): void {
	stores.clear();
}
