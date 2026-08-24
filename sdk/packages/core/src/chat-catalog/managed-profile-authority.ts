import { createHash } from "node:crypto";
import type { AgentMode } from "@cline/shared";
import { ChatCatalogError } from "./sqlite-chat-catalog-service";

export const MANAGED_PROFILE_AUTHORITY_METADATA_KEY =
	"__clineManagedProfileAuthorityV1" as const;

export interface ManagedProfileAuthority {
	readonly profileId: string;
	readonly profileRevision: number;
	readonly authorityClassId: string;
	readonly policyEpoch: number;
	readonly connectionPolicyDigest: string;
	readonly executionPolicyDigest: string;
	readonly interactive: boolean;
	readonly allowedModes: readonly AgentMode[];
}

const ALLOWED_MODES = new Set<AgentMode>(["act", "plan", "yolo", "zen"]);

function required(value: unknown): string {
	const normalized = typeof value === "string" ? value.trim() : "";
	if (!normalized || normalized.length > 512) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"managed session profile authority is invalid",
		);
	}
	return normalized;
}

function revision(value: unknown, allowZero: boolean): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < (allowZero ? 0 : 1)
	) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"managed session profile authority is invalid",
		);
	}
	return value;
}

function digest(value: unknown): string {
	const normalized =
		typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!/^[a-f0-9]{64}$/.test(normalized)) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"managed session profile authority is invalid",
		);
	}
	return normalized;
}

function canonicalJsonValue(value: unknown, seen: WeakSet<object>): unknown {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (Array.isArray(value)) {
		if (seen.has(value)) throw new Error("cyclic policy");
		seen.add(value);
		const result = value.map((item) => canonicalJsonValue(item, seen));
		seen.delete(value);
		return result;
	}
	if (value && typeof value === "object") {
		if (seen.has(value)) throw new Error("cyclic policy");
		seen.add(value);
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			const item = (value as Record<string, unknown>)[key];
			if (item === undefined) continue;
			result[key] = canonicalJsonValue(item, seen);
		}
		seen.delete(value);
		return result;
	}
	throw new Error("non-data policy");
}

export function digestManagedExecutionPolicy(value: unknown): string {
	try {
		return createHash("sha256")
			.update(JSON.stringify(canonicalJsonValue(value, new WeakSet())))
			.digest("hex");
	} catch {
		throw new ChatCatalogError(
			"unsupported_capability",
			"managed execution policy is invalid",
		);
	}
}

export function normalizeManagedProfileAuthority(
	input: ManagedProfileAuthority,
): ManagedProfileAuthority {
	if (
		!Array.isArray(input.allowedModes) ||
		input.allowedModes.length < 1 ||
		input.allowedModes.length > ALLOWED_MODES.size ||
		input.allowedModes.some((mode) => !ALLOWED_MODES.has(mode)) ||
		new Set(input.allowedModes).size !== input.allowedModes.length
	) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"managed session profile authority is invalid",
		);
	}
	return Object.freeze({
		profileId: required(input.profileId),
		profileRevision: revision(input.profileRevision, false),
		authorityClassId: required(input.authorityClassId),
		policyEpoch: revision(input.policyEpoch, true),
		connectionPolicyDigest: digest(input.connectionPolicyDigest),
		executionPolicyDigest: digest(input.executionPolicyDigest),
		interactive:
			typeof input.interactive === "boolean"
				? input.interactive
				: (() => {
						throw new ChatCatalogError(
							"unsupported_capability",
							"managed session profile authority is invalid",
						);
					})(),
		allowedModes: Object.freeze([...input.allowedModes].sort()),
	});
}

export function managedProfileAuthorityMetadata(
	input: ManagedProfileAuthority,
): Readonly<
	Record<typeof MANAGED_PROFILE_AUTHORITY_METADATA_KEY, ManagedProfileAuthority>
> {
	return Object.freeze({
		[MANAGED_PROFILE_AUTHORITY_METADATA_KEY]:
			normalizeManagedProfileAuthority(input),
	});
}

export function readManagedProfileAuthority(
	metadata: Readonly<Record<string, unknown>> | null | undefined,
): ManagedProfileAuthority | undefined {
	const value = metadata?.[MANAGED_PROFILE_AUTHORITY_METADATA_KEY];
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"managed session profile authority is invalid",
		);
	}
	const record = value as Record<string, unknown>;
	const allowedKeys = new Set([
		"profileId",
		"profileRevision",
		"authorityClassId",
		"policyEpoch",
		"connectionPolicyDigest",
		"executionPolicyDigest",
		"interactive",
		"allowedModes",
	]);
	if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"managed session profile authority is invalid",
		);
	}
	return normalizeManagedProfileAuthority({
		profileId: record.profileId as string,
		profileRevision: record.profileRevision as number,
		authorityClassId: record.authorityClassId as string,
		policyEpoch: record.policyEpoch as number,
		connectionPolicyDigest: record.connectionPolicyDigest as string,
		executionPolicyDigest: record.executionPolicyDigest as string,
		interactive: record.interactive as boolean,
		allowedModes: record.allowedModes as AgentMode[],
	});
}

export function assertManagedProfileContinuity(input: {
	persisted: ManagedProfileAuthority | undefined;
	requested: ManagedProfileAuthority | undefined;
}): void {
	if (!input.persisted && !input.requested) return;
	if (!input.persisted || !input.requested) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"managed session profile authority does not match persisted policy",
		);
	}
	if (JSON.stringify(input.persisted) !== JSON.stringify(input.requested)) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"managed session profile authority does not match persisted policy",
		);
	}
}
