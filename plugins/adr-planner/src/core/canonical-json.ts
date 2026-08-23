import { createHash } from "node:crypto";

type JsonPrimitive = string | number | boolean | null;
export type CanonicalJsonValue =
	| JsonPrimitive
	| CanonicalJsonValue[]
	| { [key: string]: CanonicalJsonValue };

function normalizeJsonValue(
	value: unknown,
	path: string,
	ancestors: Set<object>,
): CanonicalJsonValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError(`Non-finite number at ${path}`);
		}
		return Object.is(value, -0) ? 0 : value;
	}
	if (typeof value !== "object") {
		throw new TypeError(`Non-JSON value at ${path}: ${typeof value}`);
	}
	if (ancestors.has(value)) {
		throw new TypeError(`Circular reference at ${path}`);
	}

	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			return value.map((entry, index) =>
				normalizeJsonValue(entry, `${path}[${index}]`, ancestors),
			);
		}

		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError(`Non-plain object at ${path}`);
		}

		const normalized: Record<string, CanonicalJsonValue> = {};
		for (const key of Object.keys(value).sort()) {
			normalized[key] = normalizeJsonValue(
				(value as Record<string, unknown>)[key],
				`${path}.${key}`,
				ancestors,
			);
		}
		return normalized;
	} finally {
		ancestors.delete(value);
	}
}

export function canonicalizeJson(value: unknown): CanonicalJsonValue {
	return normalizeJsonValue(value, "$", new Set());
}

export function canonicalJson(value: unknown): string {
	return `${JSON.stringify(canonicalizeJson(value))}\n`;
}

export function digestCanonicalJson(value: unknown): string {
	return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
