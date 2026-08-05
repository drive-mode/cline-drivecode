import { readStoredValue, writeStoredValue } from "../lib/safe-storage";

export const DRIVE_CREDENTIAL_ONBOARDING_DISMISSED_KEY =
	"cline.drive.credentialOnboarding.dismissed";

export type CredentialCatalogProvider = {
	enabled?: boolean;
	apiKeyPresent?: boolean;
	oauthAccessTokenPresent?: boolean;
};

export function isLlmProviderConfigured(
	providers: readonly CredentialCatalogProvider[],
): boolean {
	return providers.some(
		(provider) =>
			Boolean(provider.apiKeyPresent) ||
			Boolean(provider.oauthAccessTokenPresent) ||
			Boolean(provider.enabled),
	);
}

export function shouldShowCredentialOnboardingBanner(input: {
	catalogReady: boolean;
	configured: boolean;
	dismissed: boolean;
}): boolean {
	if (!input.catalogReady) {
		return false;
	}
	return !input.configured && !input.dismissed;
}

export function readCredentialOnboardingDismissed(): boolean {
	return readStoredValue(DRIVE_CREDENTIAL_ONBOARDING_DISMISSED_KEY) === "1";
}

export function writeCredentialOnboardingDismissed(dismissed: boolean): void {
	writeStoredValue(
		DRIVE_CREDENTIAL_ONBOARDING_DISMISSED_KEY,
		dismissed ? "1" : "0",
	);
}
