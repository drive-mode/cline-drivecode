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
