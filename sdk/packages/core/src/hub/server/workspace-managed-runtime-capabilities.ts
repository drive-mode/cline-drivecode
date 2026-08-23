import { z } from "zod";
import { ChatCatalogError } from "../../chat-catalog/sqlite-chat-catalog-service";

export const HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY =
	"tool_executor.askQuestion" as const;

export const HUB_MANAGED_RUNTIME_CALLBACK_CAPABILITY_NAMES = Object.freeze([
	HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
] as const);

export type HubManagedRuntimeCallbackCapabilityName =
	(typeof HUB_MANAGED_RUNTIME_CALLBACK_CAPABILITY_NAMES)[number];

export interface HubManagedRuntimeCapabilityManifest {
	readonly callbacks: readonly HubManagedRuntimeCallbackCapabilityName[];
}

export const EMPTY_HUB_MANAGED_RUNTIME_CAPABILITY_MANIFEST: HubManagedRuntimeCapabilityManifest =
	Object.freeze({ callbacks: Object.freeze([]) });

const CALLBACK_CAPABILITY_NAMES = new Set<string>(
	HUB_MANAGED_RUNTIME_CALLBACK_CAPABILITY_NAMES,
);
const encoder = new TextEncoder();

function boundedUtf8String(maximumBytes: number) {
	return z
		.string()
		.min(1)
		.max(maximumBytes)
		.refine(
			(value) => encoder.encode(value).byteLength <= maximumBytes,
			`text exceeds ${maximumBytes} UTF-8 bytes`,
		);
}

const ASK_QUESTION_REQUEST_SCHEMA = z.strictObject({
	question: boundedUtf8String(16 * 1024),
	options: z
		.array(boundedUtf8String(4 * 1024))
		.min(2)
		.max(5),
});

const ASK_QUESTION_RESULT_SCHEMA = z.strictObject({
	answer: boundedUtf8String(16 * 1024),
});

function invalidCapability(message: string): ChatCatalogError {
	return new ChatCatalogError("unsupported_capability", message);
}

/**
 * Normalizes the only client-callback authority a managed profile may grant.
 * The manifest is immutable data: callers cannot add handlers or unknown names.
 */
export function normalizeHubManagedRuntimeCapabilityManifest(
	input: unknown,
): HubManagedRuntimeCapabilityManifest {
	if (input === undefined) {
		return EMPTY_HUB_MANAGED_RUNTIME_CAPABILITY_MANIFEST;
	}
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw invalidCapability("managed runtime capability manifest is invalid");
	}
	const record = input as Record<string, unknown>;
	if (
		Object.keys(record).length !== 1 ||
		!("callbacks" in record) ||
		!Array.isArray(record.callbacks) ||
		record.callbacks.length >
			HUB_MANAGED_RUNTIME_CALLBACK_CAPABILITY_NAMES.length
	) {
		throw invalidCapability("managed runtime capability manifest is invalid");
	}
	const callbacks: HubManagedRuntimeCallbackCapabilityName[] = [];
	for (const value of record.callbacks) {
		if (typeof value !== "string" || !CALLBACK_CAPABILITY_NAMES.has(value)) {
			throw invalidCapability("managed runtime capability manifest is invalid");
		}
		callbacks.push(value as HubManagedRuntimeCallbackCapabilityName);
	}
	if (new Set(callbacks).size !== callbacks.length) {
		throw invalidCapability("managed runtime capability manifest is invalid");
	}
	return Object.freeze({
		callbacks: Object.freeze([...callbacks].sort()),
	});
}

export function parseHubManagedRuntimeCapabilityRequest(
	capability: HubManagedRuntimeCallbackCapabilityName,
	input: unknown,
): Readonly<Record<string, unknown>> {
	try {
		switch (capability) {
			case HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY:
				return Object.freeze(ASK_QUESTION_REQUEST_SCHEMA.parse(input));
		}
	} catch {
		throw new ChatCatalogError(
			"invalid_input",
			"managed runtime capability request is invalid",
		);
	}
}

export function parseHubManagedRuntimeCapabilityResult(
	capability: HubManagedRuntimeCallbackCapabilityName,
	input: unknown,
): string {
	try {
		switch (capability) {
			case HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY:
				return ASK_QUESTION_RESULT_SCHEMA.parse(input).answer;
		}
	} catch {
		throw new ChatCatalogError(
			"invalid_input",
			"managed runtime capability result is invalid",
		);
	}
}
