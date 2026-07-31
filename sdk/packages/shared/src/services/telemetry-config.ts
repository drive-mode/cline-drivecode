import { parseKeyPairsIntoRecord } from "../parse/headers/utils";
import type { OpenTelemetryClientConfig, TelemetryMetadata } from "./telemetry";

export interface ClineTelemetryServiceConfig extends OpenTelemetryClientConfig {
	metadata: TelemetryMetadata;
}

/**
 * Reads the first non-empty env value among `keys` (left → right priority).
 * Used so SDK hosts honor standard `OTEL_*` vars and fall back to enterprise
 * `CLINE_OTEL_*` aliases documented for VS Code / self-hosted deployments.
 */
export function readTelemetryEnv(...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = process.env[key];
		if (value !== undefined && value !== "") {
			return value;
		}
	}
	return undefined;
}

function isEnvEnabled(value: string | undefined): boolean {
	return value === "1" || value === "true";
}

/**
 * Parse a positive integer from env. Non-finite / ≤0 / empty → undefined so
 * callers keep their defaults (aligned with VS Code legacy `Math.max(1, …)`).
 */
function parsePositiveInt(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return undefined;
	}
	return parsed;
}

/**
 * Build-time OTEL config from process env.
 *
 * Priority per field: standard OpenTelemetry / SDK `OTEL_*`, then enterprise
 * `CLINE_OTEL_*` (same names as VS Code legacy + Mintlify override docs).
 * Does not rewrite host telemetry stacks — only shared env normalization for
 * `createClineTelemetryServiceConfig` → `createConfiguredTelemetryHandle`.
 */
export function getTelemetryBuildTimeConfig(): OpenTelemetryClientConfig {
	if (!process.env) {
		return {
			enabled: false,
		};
	}

	const enabledRaw = readTelemetryEnv(
		"OTEL_TELEMETRY_ENABLED",
		"CLINE_OTEL_TELEMETRY_ENABLED",
	);
	const headersRaw = readTelemetryEnv(
		"OTEL_EXPORTER_OTLP_HEADERS",
		"CLINE_OTEL_EXPORTER_OTLP_HEADERS",
	);
	const metricIntervalRaw = readTelemetryEnv(
		"OTEL_METRIC_EXPORT_INTERVAL",
		"CLINE_OTEL_METRIC_EXPORT_INTERVAL",
	);
	const otlpInsecureRaw = readTelemetryEnv(
		"OTEL_EXPORTER_OTLP_INSECURE",
		"CLINE_OTEL_EXPORTER_OTLP_INSECURE",
	);
	const logBatchSizeRaw = readTelemetryEnv(
		"OTEL_LOG_BATCH_SIZE",
		"CLINE_OTEL_LOG_BATCH_SIZE",
	);
	const logBatchTimeoutRaw = readTelemetryEnv(
		"OTEL_LOG_BATCH_TIMEOUT",
		"CLINE_OTEL_LOG_BATCH_TIMEOUT",
	);
	const logMaxQueueSizeRaw = readTelemetryEnv(
		"OTEL_LOG_MAX_QUEUE_SIZE",
		"CLINE_OTEL_LOG_MAX_QUEUE_SIZE",
	);

	return {
		enabled: isEnvEnabled(enabledRaw),
		metricsExporter:
			readTelemetryEnv(
				"OTEL_METRICS_EXPORTER",
				"CLINE_OTEL_METRICS_EXPORTER",
			) || "otlp",
		logsExporter:
			readTelemetryEnv("OTEL_LOGS_EXPORTER", "CLINE_OTEL_LOGS_EXPORTER") ||
			"otlp",
		tracesExporter: readTelemetryEnv(
			"OTEL_TRACES_EXPORTER",
			"CLINE_OTEL_TRACES_EXPORTER",
		),
		otlpProtocol:
			readTelemetryEnv(
				"OTEL_EXPORTER_OTLP_PROTOCOL",
				"CLINE_OTEL_EXPORTER_OTLP_PROTOCOL",
			) || "http/json",
		otlpEndpoint: readTelemetryEnv(
			"OTEL_EXPORTER_OTLP_ENDPOINT",
			"CLINE_OTEL_EXPORTER_OTLP_ENDPOINT",
		),
		otlpMetricsProtocol: readTelemetryEnv(
			"OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
			"CLINE_OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
		),
		otlpMetricsEndpoint: readTelemetryEnv(
			"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
			"CLINE_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
		),
		otlpLogsProtocol: readTelemetryEnv(
			"OTEL_EXPORTER_OTLP_LOGS_PROTOCOL",
			"CLINE_OTEL_EXPORTER_OTLP_LOGS_PROTOCOL",
		),
		otlpLogsEndpoint: readTelemetryEnv(
			"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
			"CLINE_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
		),
		otlpTracesProtocol: readTelemetryEnv(
			"OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
			"CLINE_OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
		),
		otlpTracesEndpoint: readTelemetryEnv(
			"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
			"CLINE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
		),
		otlpTracesHeaders: (() => {
			const tracesHeadersRaw = readTelemetryEnv(
				"OTEL_EXPORTER_OTLP_TRACES_HEADERS",
				"CLINE_OTEL_EXPORTER_OTLP_TRACES_HEADERS",
			);
			return tracesHeadersRaw
				? parseKeyPairsIntoRecord(tracesHeadersRaw)
				: undefined;
		})(),
		metricExportInterval: parsePositiveInt(metricIntervalRaw),
		otlpHeaders: headersRaw
			? parseKeyPairsIntoRecord(headersRaw)
			: undefined,
		otlpInsecure: otlpInsecureRaw === "true",
		logBatchSize: parsePositiveInt(logBatchSizeRaw),
		logBatchTimeout: parsePositiveInt(logBatchTimeoutRaw),
		logMaxQueueSize: parsePositiveInt(logMaxQueueSizeRaw),
	};
}

export function createClineTelemetryServiceMetadata(
	overrides: Partial<TelemetryMetadata> = {},
): TelemetryMetadata {
	return {
		extension_version: "unknown",
		cline_type: "unknown",
		platform: "terminal",
		platform_version: process?.version || "unknown",
		os_type: process?.platform || "unknown",
		os_version:
			process?.platform === "win32"
				? (process?.env?.OS ?? "unknown")
				: "unknown",
		...overrides,
	};
}

export function createClineTelemetryServiceConfig(
	configOverrides: Partial<ClineTelemetryServiceConfig> = {},
): ClineTelemetryServiceConfig {
	return {
		...getTelemetryBuildTimeConfig(),
		...configOverrides,
		metadata: createClineTelemetryServiceMetadata(configOverrides.metadata),
	};
}
