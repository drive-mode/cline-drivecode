import { isClineProvider } from "@cline/shared";

export type ProviderOptionsPatch = Record<string, Record<string, unknown>>;

/**
 * AI SDK 7 `@ai-sdk/openai-compatible` deprecates the kebab-case
 * `providerOptions` bucket in favor of camelCase `openaiCompatible`.
 * Never emit the deprecated key — only the stable alias.
 */
const DEPRECATED_PROVIDER_OPTION_KEYS = new Set(["openai-compatible"]);

export function toProviderOptionsKey(providerId: string): string {
	return providerId.replace(/-([a-z0-9])/gi, (_match, char: string) =>
		char.toUpperCase(),
	);
}

export function createEphemeralCacheControl() {
	return {
		cache_control: { type: "ephemeral" as const },
	};
}

/**
 * Target the AI SDK provider-name bucket for the provider id and, when
 * distinct, its camelCase alias bucket (e.g. `vercel-ai-gateway` +
 * `vercelAiGateway`).
 *
 * The bucket name must match the AI SDK provider `name`, because the
 * openai-compatible model only applies request-body passthrough from
 * `providerOptions[<name>]` (and its camelCase alias). For almost every
 * provider the name is the gateway provider id, but both Cline gateway ids
 * (`cline` and `cline-pass`) are served by the shared "cline" AI SDK provider
 * (see `createClineProviderModule`) and hit the same Cline API, so their
 * options key to the shared `cline` bucket.
 *
 * Exception: `openai-compatible` only emits `openaiCompatible` because AI
 * SDK 7 deprecates the kebab-case bucket.
 */
export function buildProviderAndAliasPatch(options: {
	providerId: string;
	providerOptionsKey: string;
	bucketOptions: Record<string, unknown>;
}): ProviderOptionsPatch {
	const { bucketOptions } = options;
	const providerId = isClineProvider(options.providerId)
		? "cline"
		: options.providerId;
	const providerOptionsKey = isClineProvider(options.providerId)
		? "cline"
		: options.providerOptionsKey;
	if (DEPRECATED_PROVIDER_OPTION_KEYS.has(options.providerId)) {
		return { [providerOptionsKey]: bucketOptions };
	}
	const needsAlias =
		providerOptionsKey !== providerId && providerOptionsKey !== "anthropic";
	return {
		[providerId]: bucketOptions,
		...(needsAlias ? { [providerOptionsKey]: bucketOptions } : {}),
	};
}

export function buildThinkingPatch(options: {
	providerId: string;
	providerOptionsKey: string;
	thinkingType: "enabled" | "disabled";
}): ProviderOptionsPatch {
	const bucketOptions = { thinking: { type: options.thinkingType } };
	return {
		...buildProviderAndAliasPatch({
			providerId: options.providerId,
			providerOptionsKey: options.providerOptionsKey,
			bucketOptions,
		}),
		openaiCompatible: bucketOptions,
	};
}
