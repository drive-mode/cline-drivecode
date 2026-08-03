/**
 * Dirty-tracking for write-only secret fields in the provider detail form.
 *
 * The server sends presence, never the secret itself, so the form renders
 * blank and shows a "saved" placeholder instead. Two invariants have to hold
 * at once, and they pull in opposite directions:
 *
 *  a) Blurring a secret field the user never typed into must not commit the
 *     blank value and wipe the credential stored server-side. Field paths
 *     repeat across providers ("apiKey"), so dirtiness must never leak from
 *     one provider to another.
 *  b) Once the user has cleared a key, it must keep reading as absent — even
 *     after switching to another provider and back — because presence is
 *     server state that only refreshes on a catalog reload.
 *
 * Keying the dirty sets by provider id satisfies both: nothing is ever wiped
 * on a provider switch, so (b) survives, and a lookup can only ever see the
 * paths dirtied for that one provider, so (a) holds structurally.
 */

const API_KEY_FIELD = "apiKey";

/** Dirty secret field paths, keyed by provider id. */
export type SecretDirtyStore = Map<string, Set<string>>;

export function createSecretDirtyStore(): SecretDirtyStore {
	return new Map();
}

/**
 * The dirty set for one provider, created on first use. The returned set is
 * stable across calls so callers may hold on to it and mutate it later.
 */
export function dirtyFieldsFor(
	store: SecretDirtyStore,
	providerId: string,
): Set<string> {
	const existing = store.get(providerId);
	if (existing) return existing;
	const created = new Set<string>();
	store.set(providerId, created);
	return created;
}

/**
 * Whether blurring a field should commit its value. Non-secret fields always
 * commit; a secret field only commits once the user has actually edited it.
 */
export function canCommitFieldOnBlur({
	isSecret,
	fieldPath,
	dirtyFields,
}: {
	isSecret: boolean;
	fieldPath: string;
	dirtyFields: ReadonlySet<string>;
}): boolean {
	if (!isSecret) return true;
	return dirtyFields.has(fieldPath);
}

/**
 * Locally edited field values, keyed by provider id and then by field path.
 *
 * The values have to be scoped exactly like the dirty flags above, for the same
 * reason. A flag saying "the user edited apiKey on this provider" is only safe
 * to act on if the value the blur then commits belongs to that provider too.
 * With one shared value map the two can disagree: the panel stays mounted
 * across a provider switch, so provider B's apiKey input would render whatever
 * was last typed on A, and blurring A's field after visiting B would commit B's
 * value — or the blank left behind by clearing B's — over A's stored key.
 */
export type ProviderFieldValueStore<T> = Record<string, Record<string, T>>;

/** One provider's field values, falling back to its untouched defaults. */
export function fieldValuesFor<T>(
	store: ProviderFieldValueStore<T>,
	providerId: string,
	initialValues: Record<string, T>,
): Record<string, T> {
	return store[providerId] ?? initialValues;
}

/** The store with one field of one provider set, leaving the others alone. */
export function withFieldValue<T>(
	store: ProviderFieldValueStore<T>,
	providerId: string,
	initialValues: Record<string, T>,
	fieldPath: string,
	value: T,
): ProviderFieldValueStore<T> {
	return {
		...store,
		[providerId]: {
			...(store[providerId] ?? initialValues),
			[fieldPath]: value,
		},
	};
}

/**
 * Whether the provider should be treated as having a stored API key. Falls
 * back to server presence unless the user has cleared the field locally.
 */
export function resolveApiKeyPresent({
	serverPresent,
	dirtyFields,
	apiKeyValue,
}: {
	serverPresent: boolean | undefined;
	dirtyFields: ReadonlySet<string>;
	apiKeyValue: string;
}): boolean {
	if (serverPresent !== true) return false;
	const clearedLocally =
		dirtyFields.has(API_KEY_FIELD) && apiKeyValue.length === 0;
	return !clearedLocally;
}
