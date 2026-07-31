import * as os from "node:os";
import {
	captureExtensionActivated,
	CORE_BUILD_VERSION,
	createClineTelemetryServiceConfig,
	createConfiguredTelemetryHandle,
	type ITelemetryService,
	identifyAccount,
	ProviderSettingsManager,
} from "@cline/core";

export interface HubTelemetry {
	readonly telemetry: ITelemetryService;
	/**
	 * Present when OpenTelemetry was actually constructed (not opted out /
	 * disabled). Useful for tests and hosts that need to detect the inactive
	 * path without inspecting capture behavior.
	 */
	readonly provider?: unknown;
	dispose(): Promise<void>;
}

/**
 * Telemetry for the Hub dashboard's `ClineCore` client (hub-mode Chat).
 *
 * Mirrors Desktop/CLI: `createConfiguredTelemetryHandle` already honors
 * {@link isTelemetryOptedOutGlobally} via Core, returning an opted-out
 * no-op service when the user has disabled telemetry in settings.
 */
export function createHubTelemetry(): HubTelemetry {
	const handle = createConfiguredTelemetryHandle({
		...createClineTelemetryServiceConfig({
			metadata: {
				extension_version: CORE_BUILD_VERSION,
				cline_type: "hub",
				platform: "Cline Hub",
				platform_version: process.version,
				os_type: os.platform(),
				os_version: os.version(),
			},
		}),
	});
	const telemetry = handle.telemetry;
	try {
		const auth = new ProviderSettingsManager().getProviderSettings("cline")
			?.auth;
		if (auth?.accountId) {
			identifyAccount(telemetry, {
				id: auth.accountId,
				provider: "cline",
				organizationId: auth.organizationId,
				organizationName: auth.organizationName,
				memberId: auth.memberId,
			});
		}
	} catch {
		// Identity enrichment must never block Hub attach.
	}
	captureExtensionActivated(telemetry);

	let disposed = false;
	return {
		telemetry,
		provider: handle.provider,
		async dispose() {
			if (disposed) return;
			disposed = true;
			await handle.dispose();
		},
	};
}
