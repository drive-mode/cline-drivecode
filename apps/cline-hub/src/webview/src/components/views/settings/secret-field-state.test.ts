import { describe, expect, it } from "vitest";
import {
	canCommitFieldOnBlur,
	createSecretDirtyStore,
	dirtyFieldsFor,
	resolveApiKeyPresent,
} from "./secret-field-state";

const PROVIDER_A = "anthropic";
const PROVIDER_B = "openai";

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
