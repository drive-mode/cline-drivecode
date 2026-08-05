import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DRIVE_CREDENTIAL_ONBOARDING_DISMISSED_KEY,
	isLlmProviderConfigured,
	readCredentialOnboardingDismissed,
	shouldShowCredentialOnboardingBanner,
	writeCredentialOnboardingDismissed,
} from "./credentialOnboarding";

function stubLocalStorage(seed?: string) {
	const store = new Map<string, string>();
	if (seed !== undefined) {
		store.set(DRIVE_CREDENTIAL_ONBOARDING_DISMISSED_KEY, seed);
	}
	vi.stubGlobal("window", {
		localStorage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => {
				store.set(key, value);
			},
		},
	});
	return store;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("isLlmProviderConfigured", () => {
	it("is true when any provider has a key, oauth token, or is enabled", () => {
		expect(isLlmProviderConfigured([])).toBe(false);
		expect(isLlmProviderConfigured([{ apiKeyPresent: true }])).toBe(true);
		expect(
			isLlmProviderConfigured([{ oauthAccessTokenPresent: true }]),
		).toBe(true);
		expect(isLlmProviderConfigured([{ enabled: true }])).toBe(true);
		expect(
			isLlmProviderConfigured([
				{ enabled: false, apiKeyPresent: false },
				{ enabled: true },
			]),
		).toBe(true);
	});
});

describe("shouldShowCredentialOnboardingBanner", () => {
	it("stays hidden until the catalog is ready", () => {
		expect(
			shouldShowCredentialOnboardingBanner({
				catalogReady: false,
				configured: false,
				dismissed: false,
			}),
		).toBe(false);
	});

	it("hides when a provider is already configured", () => {
		expect(
			shouldShowCredentialOnboardingBanner({
				catalogReady: true,
				configured: true,
				dismissed: false,
			}),
		).toBe(false);
	});

	it("shows when unconfigured and not dismissed", () => {
		expect(
			shouldShowCredentialOnboardingBanner({
				catalogReady: true,
				configured: false,
				dismissed: false,
			}),
		).toBe(true);
	});

	it("hides after dismiss", () => {
		expect(
			shouldShowCredentialOnboardingBanner({
				catalogReady: true,
				configured: false,
				dismissed: true,
			}),
		).toBe(false);
	});
});

describe("credential onboarding dismiss persistence", () => {
	it("defaults to not dismissed", () => {
		stubLocalStorage();
		expect(readCredentialOnboardingDismissed()).toBe(false);
	});

	it("round-trips the dismiss flag", () => {
		const store = stubLocalStorage();
		writeCredentialOnboardingDismissed(true);
		expect(readCredentialOnboardingDismissed()).toBe(true);
		expect(store.get(DRIVE_CREDENTIAL_ONBOARDING_DISMISSED_KEY)).toBe("1");

		writeCredentialOnboardingDismissed(false);
		expect(readCredentialOnboardingDismissed()).toBe(false);
		expect(store.get(DRIVE_CREDENTIAL_ONBOARDING_DISMISSED_KEY)).toBe("0");
	});

	it("treats only the string 1 as dismissed", () => {
		stubLocalStorage("true");
		expect(readCredentialOnboardingDismissed()).toBe(false);
		stubLocalStorage("1");
		expect(readCredentialOnboardingDismissed()).toBe(true);
	});

	it("survives storage that throws", () => {
		vi.stubGlobal("window", {
			localStorage: {
				getItem: () => {
					throw new Error("blocked");
				},
				setItem: () => {
					throw new Error("blocked");
				},
			},
		});
		expect(readCredentialOnboardingDismissed()).toBe(false);
		expect(() => writeCredentialOnboardingDismissed(true)).not.toThrow();
	});
});
