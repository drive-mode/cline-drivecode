import { PRODUCT_VSCODE_LEGACY_OTEL_USE_SHARED_ENV } from "@cline/core"
import { getTelemetryBuildTimeConfig } from "@cline/shared"
import { parseKeyPairsIntoRecord } from "@opentelemetry/core"
import { BUILD_CONSTANTS } from "@/shared/constants"
import { RemoteConfigFields } from "@/shared/storage/state-keys"

export interface OpenTelemetryClientConfig {
	/**
	 * Whether telemetry is enabled via OTEL_TELEMETRY_ENABLED
	 */
	enabled: boolean

	/**
	 * Metrics exporter type(s) - can be comma-separated for multiple exporters
	 * Examples: "console", "otlp", "console,otlp"
	 */
	metricsExporter?: string

	/**
	 * Logs/events exporter type(s) - can be comma-separated for multiple exporters
	 * Examples: "console", "otlp"
	 */
	logsExporter?: string

	/**
	 * Protocol for OTLP exporters: "grpc", "http/json", "http/protobuf"
	 */
	otlpProtocol?: string

	/**
	 * General OTLP endpoint (used if specific endpoints not set)
	 */
	otlpEndpoint?: string

	/**
	 * General OTLP headers
	 */
	otlpHeaders?: Record<string, string>

	/**
	 * Metrics-specific OTLP protocol
	 */
	otlpMetricsProtocol?: string

	/**
	 * Metrics-specific OTLP endpoint
	 */
	otlpMetricsEndpoint?: string

	otlpMetricsHeaders?: Record<string, string>

	/**
	 * Logs-specific OTLP protocol
	 */
	otlpLogsProtocol?: string

	/**
	 * Logs-specific OTLP endpoint
	 */
	otlpLogsEndpoint?: string

	otlpLogsHeaders?: Record<string, string>

	/**
	 * Metric export interval in milliseconds (for console exporter)
	 */
	metricExportInterval?: number

	/**
	 * Whether to use insecure (non-TLS) connections for gRPC OTLP exporters
	 * Set to "true" for local development without TLS
	 * Default: false (uses TLS)
	 */
	otlpInsecure?: boolean

	/**
	 * Maximum batch size for log records (default: 512)
	 */
	logBatchSize?: number

	/**
	 * Maximum time to wait before exporting logs in milliseconds (default: 5000)
	 */
	logBatchTimeout?: number

	/**
	 * Maximum queue size for log records (default: 2048)
	 */
	logMaxQueueSize?: number
}

/**
 * Helper type for a valid OpenTelemetry client configuration.
 * Must have telemetry enabled and at least one exporter configured.
 */
export interface OpenTelemetryClientValidConfig extends OpenTelemetryClientConfig {
	enabled: true
}

const isTestEnv = process.env.E2E_TEST === "true" || process.env.IS_TEST === "true"

export function remoteConfigToOtelConfig(settings: Partial<RemoteConfigFields>): OpenTelemetryClientConfig {
	return {
		enabled: !!settings.openTelemetryEnabled,
		metricsExporter: settings.openTelemetryMetricsExporter,
		logsExporter: settings.openTelemetryLogsExporter,
		otlpProtocol: settings.openTelemetryOtlpProtocol,
		otlpEndpoint: settings.openTelemetryOtlpEndpoint,
		otlpHeaders: settings.openTelemetryOtlpHeaders,
		metricExportInterval: settings.openTelemetryMetricExportInterval,
		otlpInsecure: settings.openTelemetryOtlpInsecure,

		otlpMetricsEndpoint: settings.openTelemetryOtlpMetricsEndpoint,
		otlpMetricsProtocol: settings.openTelemetryOtlpMetricsProtocol,
		otlpMetricsHeaders: settings.otlpMetricsHeaders,
		otlpLogsEndpoint: settings.openTelemetryOtlpLogsEndpoint,
		otlpLogsProtocol: settings.openTelemetryOtlpLogsProtocol,
		otlpLogsHeaders: settings.otlpLogsHeaders,

		logBatchSize: settings.openTelemetryLogBatchSize,
		logBatchTimeout: settings.openTelemetryLogBatchTimeout,
		logMaxQueueSize: settings.openTelemetryLogMaxQueueSize,
	}
}

/**
 * Prefer primary when set; otherwise fall back to shared env reader (BL-8.1).
 * BUILD_CONSTANTS / explicit CLINE_OTEL_* values win when present.
 */
function mergeOtelWithSharedFallback(primary: OpenTelemetryClientConfig): OpenTelemetryClientConfig {
	if (!PRODUCT_VSCODE_LEGACY_OTEL_USE_SHARED_ENV) {
		return primary
	}
	const shared = getTelemetryBuildTimeConfig()
	const pickString = (value: string | undefined, fallback: string | undefined): string | undefined =>
		value !== undefined && value !== "" ? value : fallback
	const pickNumber = (value: number | undefined, fallback: number | undefined): number | undefined =>
		value !== undefined ? value : fallback
	const pickHeaders = (
		value: Record<string, string> | undefined,
		fallback: Record<string, string> | undefined,
	): Record<string, string> | undefined => (value !== undefined ? value : fallback)
	const pickBoolean = (value: boolean | undefined, fallback: boolean | undefined): boolean | undefined =>
		value !== undefined ? value : fallback

	// enabled: primary wins when its source set a value; getOtelConfig / getRuntimeOtelConfig
	// encode that via `enabledSourceSet`.
	return {
		enabled: (primary as OpenTelemetryClientConfig & { enabledSourceSet?: boolean }).enabledSourceSet
			? primary.enabled
			: primary.enabled || shared.enabled,
		metricsExporter: pickString(primary.metricsExporter, shared.metricsExporter),
		logsExporter: pickString(primary.logsExporter, shared.logsExporter),
		otlpProtocol: pickString(primary.otlpProtocol, shared.otlpProtocol),
		otlpEndpoint: pickString(primary.otlpEndpoint, shared.otlpEndpoint),
		otlpHeaders: pickHeaders(primary.otlpHeaders, shared.otlpHeaders),
		otlpMetricsProtocol: pickString(primary.otlpMetricsProtocol, shared.otlpMetricsProtocol),
		otlpMetricsEndpoint: pickString(primary.otlpMetricsEndpoint, shared.otlpMetricsEndpoint),
		otlpLogsProtocol: pickString(primary.otlpLogsProtocol, shared.otlpLogsProtocol),
		otlpLogsEndpoint: pickString(primary.otlpLogsEndpoint, shared.otlpLogsEndpoint),
		metricExportInterval: pickNumber(primary.metricExportInterval, shared.metricExportInterval),
		otlpInsecure: pickBoolean(primary.otlpInsecure, shared.otlpInsecure),
		logBatchSize: pickNumber(primary.logBatchSize, shared.logBatchSize),
		logBatchTimeout: pickNumber(primary.logBatchTimeout, shared.logBatchTimeout),
		logMaxQueueSize: pickNumber(primary.logMaxQueueSize, shared.logMaxQueueSize),
	}
}

function getOtelConfig(): OpenTelemetryClientConfig {
	const enabledRaw = BUILD_CONSTANTS.OTEL_TELEMETRY_ENABLED
	const enabledSourceSet = enabledRaw !== undefined && enabledRaw !== ""
	const primary: OpenTelemetryClientConfig & { enabledSourceSet?: boolean } = {
		enabled: enabledRaw === "1" || enabledRaw === "true",
		enabledSourceSet,
		metricsExporter: BUILD_CONSTANTS.OTEL_METRICS_EXPORTER,
		logsExporter: BUILD_CONSTANTS.OTEL_LOGS_EXPORTER,
		otlpProtocol: BUILD_CONSTANTS.OTEL_EXPORTER_OTLP_PROTOCOL,
		otlpEndpoint: BUILD_CONSTANTS.OTEL_EXPORTER_OTLP_ENDPOINT,
		metricExportInterval: BUILD_CONSTANTS.OTEL_METRIC_EXPORT_INTERVAL
			? Number.parseInt(BUILD_CONSTANTS.OTEL_METRIC_EXPORT_INTERVAL, 10)
			: undefined,
		otlpHeaders: BUILD_CONSTANTS.OTEL_EXPORTER_OTLP_HEADERS
			? parseKeyPairsIntoRecord(BUILD_CONSTANTS.OTEL_EXPORTER_OTLP_HEADERS)
			: undefined,
	}
	return mergeOtelWithSharedFallback(primary)
}

/**
 * Gets or creates the OpenTelemetry configuration from environment variables.
 * Configuration is cached after first access for performance.
 *
 * Configuration Sources:
 * - **Production Build**: Environment variables injected by esbuild at build time
 *   via .github/workflows/ext-vscode-publish-stable.yml
 * - **Development**: Environment variables from .env file loaded by VSCode
 *
 * Supported Environment Variables:
 * - CLINE_OTEL_TELEMETRY_ENABLED: "1" to enable OpenTelemetry (default: off)
 * - CLINE_OTEL_METRICS_EXPORTER: Comma-separated list: "console", "otlp"
 * - CLINE_OTEL_LOGS_EXPORTER: Comma-separated list: "console", "otlp"
 * - CLINE_OTEL_EXPORTER_OTLP_PROTOCOL: "grpc", "http/json", or "http/protobuf"
 * - CLINE_OTEL_EXPORTER_OTLP_ENDPOINT: OTLP collector endpoint (if not using specific endpoints)
 * - CLINE_OTEL_EXPORTER_OTLP_HEADERS: Comma-separated key-value pairs (e.g., "key1=value1,key2=value2")
 * - CLINE_OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: Metrics-specific protocol override
 * - CLINE_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: Metrics-specific endpoint override
 * - CLINE_OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: Logs-specific protocol override
 * - CLINE_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: Logs-specific endpoint override
 * - CLINE_OTEL_METRIC_EXPORT_INTERVAL: Milliseconds between metric exports (default: 60000)
 * - CLINE_OTEL_EXPORTER_OTLP_INSECURE: "true" to disable TLS for gRPC (for local development)
 * - CLINE_OTEL_LOG_BATCH_SIZE: Maximum batch size for log records (default: 512)
 * - CLINE_OTEL_LOG_BATCH_TIMEOUT: Maximum time to wait before exporting logs in ms (default: 5000)
 * - CLINE_OTEL_LOG_MAX_QUEUE_SIZE: Maximum queue size for log records (default: 2048)
 *
 * When PRODUCT_VSCODE_LEGACY_OTEL_USE_SHARED_ENV is true, unset fields also fall
 * back to `@cline/shared` getTelemetryBuildTimeConfig() (OTEL_* then CLINE_OTEL_*).
 *
 * @private
 * @see .env.example for development setup
 * @see .github/workflows/ext-vscode-publish-stable.yml for production environment variable injection
 */
function getRuntimeOtelConfig(): OpenTelemetryClientConfig {
	const enabledRaw = process.env.CLINE_OTEL_TELEMETRY_ENABLED
	const enabledSourceSet = enabledRaw !== undefined && enabledRaw !== ""
	const primary: OpenTelemetryClientConfig & { enabledSourceSet?: boolean } = {
		enabled: enabledRaw === "true",
		enabledSourceSet,
		metricsExporter: process.env.CLINE_OTEL_METRICS_EXPORTER,
		logsExporter: process.env.CLINE_OTEL_LOGS_EXPORTER,
		otlpProtocol: process.env.CLINE_OTEL_EXPORTER_OTLP_PROTOCOL,
		otlpEndpoint: process.env.CLINE_OTEL_EXPORTER_OTLP_ENDPOINT,
		otlpMetricsProtocol: process.env.CLINE_OTEL_EXPORTER_OTLP_METRICS_PROTOCOL,
		otlpMetricsEndpoint: process.env.CLINE_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
		otlpLogsProtocol: process.env.CLINE_OTEL_EXPORTER_OTLP_LOGS_PROTOCOL,
		otlpLogsEndpoint: process.env.CLINE_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
		metricExportInterval: process.env.CLINE_OTEL_METRIC_EXPORT_INTERVAL
			? Number.parseInt(process.env.CLINE_OTEL_METRIC_EXPORT_INTERVAL, 10)
			: undefined,
		otlpInsecure:
			process.env.CLINE_OTEL_EXPORTER_OTLP_INSECURE === "true"
				? true
				: process.env.CLINE_OTEL_EXPORTER_OTLP_INSECURE !== undefined
					? false
					: undefined,
		logBatchSize: process.env.CLINE_OTEL_LOG_BATCH_SIZE
			? Math.max(1, Number.parseInt(process.env.CLINE_OTEL_LOG_BATCH_SIZE, 10))
			: undefined,
		logBatchTimeout: process.env.CLINE_OTEL_LOG_BATCH_TIMEOUT
			? Math.max(1, Number.parseInt(process.env.CLINE_OTEL_LOG_BATCH_TIMEOUT, 10))
			: undefined,
		logMaxQueueSize: process.env.CLINE_OTEL_LOG_MAX_QUEUE_SIZE
			? Math.max(1, Number.parseInt(process.env.CLINE_OTEL_LOG_MAX_QUEUE_SIZE, 10))
			: undefined,
		otlpHeaders: process.env.CLINE_OTEL_EXPORTER_OTLP_HEADERS
			? parseKeyPairsIntoRecord(process.env.CLINE_OTEL_EXPORTER_OTLP_HEADERS)
			: undefined,
	}
	return mergeOtelWithSharedFallback(primary)
}

export function isOpenTelemetryConfigValid(config: OpenTelemetryClientConfig): config is OpenTelemetryClientValidConfig {
	// Disable in test environment to enable mocking and stubbing
	if (isTestEnv) {
		return false
	}

	if (!config.enabled) {
		return false
	}

	const hasOneExporterConfigured = !!(config.metricsExporter || config.logsExporter)
	return hasOneExporterConfigured
}

/**
 * Gets validated OpenTelemetry configuration if available.
 * Returns null if configuration is invalid or disabled.
 *
 * Configuration does not change at runtime - requires VSCode reload to pick up new values.
 *
 * @returns Valid OpenTelemetry configuration or null if disabled/invalid
 * @see .env.example for configuration options
 */
export function getValidOpenTelemetryConfig(): OpenTelemetryClientValidConfig | null {
	const config = getOtelConfig()
	return isOpenTelemetryConfigValid(config) ? config : null
}

export function getValidRuntimeOpenTelemetryConfig(): OpenTelemetryClientValidConfig | null {
	const config = getRuntimeOtelConfig()
	return isOpenTelemetryConfigValid(config) ? config : null
}
