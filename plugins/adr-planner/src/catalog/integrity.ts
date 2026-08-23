import { createHash } from "node:crypto";
import { canonicalJson } from "../core/canonical-json";
import type { ConcernCatalog } from "../schema";

export const UNKNOWN_CATALOG_DIGEST = `sha256:${"0".repeat(64)}`;

export function computeCatalogDigest(
	catalog: Omit<ConcernCatalog, "catalogDigest"> | ConcernCatalog,
): string {
	const { catalogDigest: _catalogDigest, ...content } =
		catalog as ConcernCatalog;
	return `sha256:${createHash("sha256").update(canonicalJson(content)).digest("hex")}`;
}

export function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}
