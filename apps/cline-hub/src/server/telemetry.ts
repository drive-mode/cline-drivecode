import * as os from "node:os";
import {
	type BasicLogger,
	CORE_BUILD_VERSION,
	captureExtensionActivated,
	createClineTelemetryServiceConfig,
	createConfiguredTelemetryHandle,
	type ITelemetryService,
	identifyAccount,
	PRODUCT_HUB_CHAT_CLINE_TYPE,
	PRODUCT_HUB_CHAT_PLATFORM,
	ProviderSettingsManager,
	setSdkLogger,
} from "@cline/core";

export interface HubTelemetry {
	readonly logger: BasicLogger;
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
 * Thin console-backed {@link BasicLogger} for Hub Chat. Mirrors Desktop/CLI
 * injection (`setSdkLogger` + telemetry `logger`) without pulling in a file
 * logger stack for the dashboard process.
 */
function createHubBasicLogger(): BasicLogger {
	const write = (
		level: "debug" | "info" | "warn" | "error",
		message: string,
		metadata?: Record<string, unknown>,
	): void => {
		const suffix =
			metadata && Object.keys(metadata).length > 0
				? ` ${safeJson(metadata)}`
				: "";
		const line = `[cline-hub] [${level}] ${message}${suffix}`;
		if (level === "error") {
			console.error(line);
			return;
		}
		if (level === "warn") {
			console.warn(line);
			return;
		}
		if (level === "debug") {
			console.debug(line);
			return;
		}
		console.log(line);
	};

	return {
		debug: (message, metadata) => write("debug", message, metadata),
		log: (message, metadata) => {
			const severity = metadata?.severity;
			const level =
				severity === "warn" ? "warn" : severity === "error" ? "error" : "info";
			const { severity: _s, ...rest } = metadata ?? {};
			write(level, message, Object.keys(rest).length > 0 ? rest : undefined);
		},
		error: (message, metadata) => write("error", message, metadata),
	};
}

function safeJson(value: Record<string, unknown>): string {
	try {
		return JSON.stringify(value);
	} catch {
		return "[unserializable metadata]";
	}
}

/**
 * Telemetry for the Hub dashboard's `ClineCore` client (hub-mode Chat).
 *
 * Mirrors Desktop/CLI: `createConfiguredTelemetryHandle` already honors
 * {@link isTelemetryOptedOutGlobally} via Core, returning an opted-out
 * no-op service when the user has disabled telemetry in settings. Also wires
 * {@link setSdkLogger} so Core early-logger call sites share the same sink.
 */
export function createHubTelemetry(): HubTelemetry {
	const logger = createHubBasicLogger();
	setSdkLogger(logger);

	const handle = createConfiguredTelemetryHandle({
		...createClineTelemetryServiceConfig({
			metadata: {
				extension_version: CORE_BUILD_VERSION,
				cline_type: PRODUCT_HUB_CHAT_CLINE_TYPE,
				platform: PRODUCT_HUB_CHAT_PLATFORM,
				platform_version: process.version,
				os_type: os.platform(),
				os_version: os.version(),
			},
		}),
		logger,
	});
	const telemetry = handle.telemetry;
	try {
		const auth = new ProviderSettingsManager().getProviderSettings(
			"cline",
		)?.auth;
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
		logger,
		telemetry,
		provider: handle.provider,
		async dispose() {
			if (disposed) return;
			disposed = true;
			await handle.dispose();
			setSdkLogger(undefined);
		},
	};
}
