import { describe, expect, it } from "vitest";
import {
	canCommitFieldOnBlur,
	createSecretDirtyStore,
	dirtyFieldsFor,
	fieldValuesFor,
	type ProviderFieldValueStore,
	resolveApiKeyPresent,
	withFieldValue,
} from "./secret-field-state";

const PROVIDER_A = "anthropic";
const PROVIDER_B = "openai";

/**
 * The detail panel as the component drives it: one mounted form whose dirty
 * flags and edited values both live in stores keyed by provider id, with the
 * rendered provider switching underneath. Nothing here re-implements the
 * module — every decision comes from the exported functions.
 */
function openProviderPanel() {
	const dirtyStore = createSecretDirtyStore();
	let valueStore: ProviderFieldValueStore<string> = {};
	let providerId = PROVIDER_A;
	// Secret fields are never prefilled, so an untouched provider starts blank.
	const initialValues: Record<string, string> = {};

	const valuesForRenderedProvider = () =>
		fieldValuesFor(valueStore, providerId, initialValues);

	return {
		switchTo(nextProviderId: string) {
			providerId = nextProviderId;
		},
		/** What the input renders for the provider currently on screen. */
		renderedValue(fieldPath: string) {
			return valuesForRenderedProvider()[fieldPath] ?? "";
		},
		type(fieldPath: string, value: string) {
			dirtyFieldsFor(dirtyStore, providerId).add(fieldPath);
			valueStore = withFieldValue(
				valueStore,
				providerId,
				initialValues,
				fieldPath,
				value,
			);
		},
		/** What blurring the field sends to the server, or null for no commit. */
		blur(fieldPath: string) {
			if (
				!canCommitFieldOnBlur({
					isSecret: true,
					fieldPath,
					dirtyFields: dirtyFieldsFor(dirtyStore, providerId),
				})
			) {
				return null;
			}
			return this.renderedValue(fieldPath);
		},
		apiKeyPresent(serverPresent: boolean | undefined) {
			return resolveApiKeyPresent({
				serverPresent,
				dirtyFields: dirtyFieldsFor(dirtyStore, providerId),
				apiKeyValue: this.renderedValue("apiKey"),
			});
		},
	};
}

describe("canCommitFieldOnBlur", () => {
	it("refuses to commit an untouched secret field on a freshly opened provider", () => {
		const store = createSecretDirtyStore();

		expect(
			canCommitFieldOnBlur({
				isSecret: true,
				fieldPath: "apiKey",
				dirtyFields: dirtyFieldsFor(store, PROVIDER_A),
			}),
		).toBe(false);
	});

	it("commits a secret field the user edited", () => {
		const store = createSecretDirtyStore();
		dirtyFieldsFor(store, PROVIDER_A).add("apiKey");

		expect(
			canCommitFieldOnBlur({
				isSecret: true,
				fieldPath: "apiKey",
				dirtyFields: dirtyFieldsFor(store, PROVIDER_A),
			}),
		).toBe(true);
	});

	it("always commits non-secret fields", () => {
		const store = createSecretDirtyStore();

		expect(
			canCommitFieldOnBlur({
				isSecret: false,
				fieldPath: "baseUrl",
				dirtyFields: dirtyFieldsFor(store, PROVIDER_A),
			}),
		).toBe(true);
	});

	it("does not let a dirty apiKey on one provider commit a blank apiKey on another", () => {
		const store = createSecretDirtyStore();
		dirtyFieldsFor(store, PROVIDER_A).add("apiKey");

		expect(
			canCommitFieldOnBlur({
				isSecret: true,
				fieldPath: "apiKey",
				dirtyFields: dirtyFieldsFor(store, PROVIDER_B),
			}),
		).toBe(false);
	});
});

describe("resolveApiKeyPresent", () => {
	it("reports the saved key while the user has not touched the field", () => {
		const store = createSecretDirtyStore();

		expect(
			resolveApiKeyPresent({
				serverPresent: true,
				dirtyFields: dirtyFieldsFor(store, PROVIDER_A),
				apiKeyValue: "",
			}),
		).toBe(true);
	});

	it("reports absent once the user clears the field", () => {
		const store = createSecretDirtyStore();
		dirtyFieldsFor(store, PROVIDER_A).add("apiKey");

		expect(
			resolveApiKeyPresent({
				serverPresent: true,
				dirtyFields: dirtyFieldsFor(store, PROVIDER_A),
				apiKeyValue: "",
			}),
		).toBe(false);
	});

	it("still reports present when the user typed a replacement key", () => {
		const store = createSecretDirtyStore();
		dirtyFieldsFor(store, PROVIDER_A).add("apiKey");

		expect(
			resolveApiKeyPresent({
				serverPresent: true,
				dirtyFields: dirtyFieldsFor(store, PROVIDER_A),
				apiKeyValue: "sk-new",
			}),
		).toBe(true);
	});

	it("keeps a cleared key absent after switching provider and back", () => {
		const store = createSecretDirtyStore();
		// Clear the key on provider A and commit it.
		dirtyFieldsFor(store, PROVIDER_A).add("apiKey");
		// Visit provider B, then come back to A. Server presence is stale until
		// a catalog reload, so it still claims the deleted key is saved.
		dirtyFieldsFor(store, PROVIDER_B);

		expect(
			resolveApiKeyPresent({
				serverPresent: true,
				dirtyFields: dirtyFieldsFor(store, PROVIDER_A),
				apiKeyValue: "",
			}),
		).toBe(false);
	});

	it("does not report a provider's untouched key as cleared because another provider's was", () => {
		const store = createSecretDirtyStore();
		dirtyFieldsFor(store, PROVIDER_A).add("apiKey");

		expect(
			resolveApiKeyPresent({
				serverPresent: true,
				dirtyFields: dirtyFieldsFor(store, PROVIDER_B),
				apiKeyValue: "",
			}),
		).toBe(true);
	});

	it("reports absent when the server has no key at all", () => {
		const store = createSecretDirtyStore();

		expect(
			resolveApiKeyPresent({
				serverPresent: undefined,
				dirtyFields: dirtyFieldsFor(store, PROVIDER_A),
				apiKeyValue: "",
			}),
		).toBe(false);
	});
});

describe("per-provider field values", () => {
	it("shows a provider its own defaults, not the last provider's edits", () => {
		const store = withFieldValue<string>({}, PROVIDER_A, {}, "apiKey", "sk-a");

		expect(fieldValuesFor(store, PROVIDER_B, {}).apiKey).toBeUndefined();
	});

	it("leaves other providers untouched when one field is set", () => {
		const withA = withFieldValue<string>({}, PROVIDER_A, {}, "apiKey", "sk-a");
		const withBoth = withFieldValue(withA, PROVIDER_B, {}, "apiKey", "sk-b");

		expect(fieldValuesFor(withBoth, PROVIDER_A, {}).apiKey).toBe("sk-a");
		expect(fieldValuesFor(withBoth, PROVIDER_B, {}).apiKey).toBe("sk-b");
	});

	it("keeps an edit made before a provider switch when the user returns", () => {
		const store = withFieldValue<string>({}, PROVIDER_A, {}, "apiKey", "sk-a");

		expect(fieldValuesFor(store, PROVIDER_B, {}).apiKey).toBeUndefined();
		expect(fieldValuesFor(store, PROVIDER_A, {}).apiKey).toBe("sk-a");
	});
});

describe("provider detail panel across provider switches", () => {
	it("does not carry a typed key into the next provider's field", () => {
		const panel = openProviderPanel();
		panel.type("apiKey", "sk-a");

		panel.switchTo(PROVIDER_B);

		expect(panel.renderedValue("apiKey")).toBe("");
		expect(panel.blur("apiKey")).toBeNull();
	});

	it("commits a provider's own key, never a blank left on another provider", () => {
		const panel = openProviderPanel();
		panel.type("apiKey", "sk-a");
		// Provider B shows blank, and the user clears the field there anyway.
		panel.switchTo(PROVIDER_B);
		panel.type("apiKey", "");
		expect(panel.blur("apiKey")).toBe("");

		// Back on A the field is dirty from the earlier edit, so a focus and blur
		// with no typing still commits — it has to be A's key, not B's blank.
		panel.switchTo(PROVIDER_A);

		expect(panel.renderedValue("apiKey")).toBe("sk-a");
		expect(panel.blur("apiKey")).toBe("sk-a");
	});

	it("never commits one provider's key over another's", () => {
		const panel = openProviderPanel();
		panel.type("apiKey", "sk-a");
		panel.switchTo(PROVIDER_B);
		panel.type("apiKey", "sk-b");

		panel.switchTo(PROVIDER_A);

		expect(panel.blur("apiKey")).toBe("sk-a");
	});

	it("keeps a cleared key absent after a round trip, without affecting the other provider", () => {
		const panel = openProviderPanel();
		panel.type("apiKey", "");
		expect(panel.apiKeyPresent(true)).toBe(false);

		panel.switchTo(PROVIDER_B);
		expect(panel.apiKeyPresent(true)).toBe(true);

		panel.switchTo(PROVIDER_A);
		expect(panel.apiKeyPresent(true)).toBe(false);
	});
});
