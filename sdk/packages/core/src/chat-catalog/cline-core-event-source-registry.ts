import type {
	CatalogAudienceChatSource,
	CatalogLifecycleEventSource,
} from "./chat-catalog-event-source";

const sources = new WeakMap<object, CatalogLifecycleEventSource>();
const audienceSources = new WeakMap<object, CatalogAudienceChatSource>();

/** Internal bridge from private local-host composition to the managed Hub adapter. */
export function registerClineCoreCatalogLifecycleEventSource(
	core: object,
	source: CatalogLifecycleEventSource,
): void {
	sources.set(core, source);
}

export function getClineCoreCatalogLifecycleEventSource(
	core: object,
): CatalogLifecycleEventSource | undefined {
	return sources.get(core);
}

export function registerClineCoreCatalogAudienceSource(
	core: object,
	source: CatalogAudienceChatSource,
): void {
	audienceSources.set(core, source);
}

export function getClineCoreCatalogAudienceSource(
	core: object,
): CatalogAudienceChatSource | undefined {
	return audienceSources.get(core);
}

export function unregisterClineCoreCatalogLifecycleEventSource(
	core: object,
): void {
	sources.delete(core);
	audienceSources.delete(core);
}
