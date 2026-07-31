import { afterEach, describe, expect, it } from "vitest";
import {
	createClineTelemetryServiceConfig,
	getTelemetryBuildTimeConfig,
	readTelemetryEnv,
} from "./telemetry-config";

const MANAGED_KEYS = [
	"OTEL_TELEMETRY_ENABLED",
	"CLINE_OTEL_TELEMETRY_ENABLED",
	"OTEL_METRICS_EXPORTER",
	"CLINE_OTEL_METRICS_EXPORTER",
	"OTEL_LOGS_EXPORTER",
	"CLINE_OTEL_LOGS_EXPORTER",
	"OTEL_TRACES_EXPORTER",
	"CLINE_OTEL_TRACES_EXPORTER",
	"OTEL_EXPORTER_OTLP_PROTOCOL",
	"CLINE_OTEL_EXPORTER_OTLP_PROTOCOL",
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"CLINE_OTEL_EXPORTER_OTLP_ENDPOINT",
	"OTEL_EXPORTER_OTLP_HEADERS",
	"CLINE_OTEL_EXPORTER_OTLP_HEADERS",
	"OTEL_METRIC_EXPORT_INTERVAL",
	"CLINE_OTEL_METRIC_EXPORT_INTERVAL",
	"OTEL_EXPORTER_OTLP_INSECURE",
	"CLINE_OTEL_EXPORTER_OTLP_INSECURE",
	"OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
	"CLINE_OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
	"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
	"CLINE_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
	"OTEL_EXPORTER_OTLP_LOGS_PROTOCOL",
	"CLINE_OTEL_EXPORTER_OTLP_LOGS_PROTOCOL",
	"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
	"CLINE_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
	"OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
	"CLINE_OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
	"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
	"CLINE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
	"OTEL_EXPORTER_OTLP_TRACES_HEADERS",
	"CLINE_OTEL_EXPORTER_OTLP_TRACES_HEADERS",
	"OTEL_LOG_BATCH_SIZE",
	"CLINE_OTEL_LOG_BATCH_SIZE",
	"OTEL_LOG_BATCH_TIMEOUT",
	"CLINE_OTEL_LOG_BATCH_TIMEOUT",
	"OTEL_LOG_MAX_QUEUE_SIZE",
	"CLINE_OTEL_LOG_MAX_QUEUE_SIZE",
] as const;

const saved: Record<string, string | undefined> = {};

function stashEnv(): void {
	for (const key of MANAGED_KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
}

function restoreEnv(): void {
	for (const key of MANAGED_KEYS) {
		const value = saved[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

describe("readTelemetryEnv", () => {
	afterEach(() => {
		restoreEnv();
	});

	it("returns the first non-empty key", () => {
		stashEnv();
		process.env.CLINE_OTEL_TELEMETRY_ENABLED = "true";
		process.env.OTEL_TELEMETRY_ENABLED = "1";
		expect(
			readTelemetryEnv(
				"OTEL_TELEMETRY_ENABLED",
				"CLINE_OTEL_TELEMETRY_ENABLED",
			),
		).toBe("1");
	});

	it("falls back when the preferred key is unset", () => {
		stashEnv();
		process.env.CLINE_OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318";
		expect(
			readTelemetryEnv(
				"OTEL_EXPORTER_OTLP_ENDPOINT",
				"CLINE_OTEL_EXPORTER_OTLP_ENDPOINT",
			),
		).toBe("http://collector:4318");
	});

	it("skips empty preferred values and uses the next key", () => {
		stashEnv();
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "";
		process.env.CLINE_OTEL_EXPORTER_OTLP_ENDPOINT = "http://cline-fallback:4318";
		expect(
			readTelemetryEnv(
				"OTEL_EXPORTER_OTLP_ENDPOINT",
				"CLINE_OTEL_EXPORTER_OTLP_ENDPOINT",
			),
		).toBe("http://cline-fallback:4318");
	});
});

describe("getTelemetryBuildTimeConfig / createClineTelemetryServiceConfig", () => {
	afterEach(() => {
		restoreEnv();
	});

	it("defaults to disabled with otlp exporters when no OTEL env is set", () => {
		stashEnv();
		const config = getTelemetryBuildTimeConfig();
		expect(config.enabled).toBe(false);
		expect(config.metricsExporter).toBe("otlp");
		expect(config.logsExporter).toBe("otlp");
		expect(config.otlpProtocol).toBe("http/json");
		expect(config.otlpEndpoint).toBeUndefined();
	});

	it("honors standard OTEL_* env vars", () => {
		stashEnv();
		process.env.OTEL_TELEMETRY_ENABLED = "true";
		process.env.OTEL_METRICS_EXPORTER = "console";
		process.env.OTEL_LOGS_EXPORTER = "otlp";
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otel.example/v1";
		process.env.OTEL_EXPORTER_OTLP_HEADERS = "x-api-key=secret";
		process.env.OTEL_METRIC_EXPORT_INTERVAL = "15000";

		const config = getTelemetryBuildTimeConfig();
		expect(config.enabled).toBe(true);
		expect(config.metricsExporter).toBe("console");
		expect(config.logsExporter).toBe("otlp");
		expect(config.otlpEndpoint).toBe("https://otel.example/v1");
		expect(config.otlpHeaders).toEqual({ "x-api-key": "secret" });
		expect(config.metricExportInterval).toBe(15000);
	});

	it("falls back to CLINE_OTEL_* when OTEL_* is unset (SDK-8.1)", () => {
		stashEnv();
		process.env.CLINE_OTEL_TELEMETRY_ENABLED = "true";
		process.env.CLINE_OTEL_METRICS_EXPORTER = "otlp";
		process.env.CLINE_OTEL_LOGS_EXPORTER = "console";
		process.env.CLINE_OTEL_EXPORTER_OTLP_PROTOCOL = "http/json";
		process.env.CLINE_OTEL_EXPORTER_OTLP_ENDPOINT =
			"https://enterprise.example:4318";
		process.env.CLINE_OTEL_EXPORTER_OTLP_HEADERS = "dd-api-key=abc";
		process.env.CLINE_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT =
			"https://metrics.example";
		process.env.CLINE_OTEL_EXPORTER_OTLP_INSECURE = "true";
		process.env.CLINE_OTEL_LOG_BATCH_SIZE = "256";

		const config = createClineTelemetryServiceConfig({
			metadata: { cline_type: "cli", extension_version: "test" },
		});
		expect(config.enabled).toBe(true);
		expect(config.metricsExporter).toBe("otlp");
		expect(config.logsExporter).toBe("console");
		expect(config.otlpProtocol).toBe("http/json");
		expect(config.otlpEndpoint).toBe("https://enterprise.example:4318");
		expect(config.otlpHeaders).toEqual({ "dd-api-key": "abc" });
		expect(config.otlpMetricsEndpoint).toBe("https://metrics.example");
		expect(config.otlpInsecure).toBe(true);
		expect(config.logBatchSize).toBe(256);
		expect(config.metadata.cline_type).toBe("cli");
	});

	it("prefers OTEL_* over CLINE_OTEL_* when both are set", () => {
		stashEnv();
		process.env.OTEL_TELEMETRY_ENABLED = "1";
		process.env.CLINE_OTEL_TELEMETRY_ENABLED = "false";
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otel-first";
		process.env.CLINE_OTEL_EXPORTER_OTLP_ENDPOINT = "https://cline-second";

		const config = getTelemetryBuildTimeConfig();
		expect(config.enabled).toBe(true);
		expect(config.otlpEndpoint).toBe("https://otel-first");
	});

	it("falls back to remaining CLINE_OTEL_* secondary fields when OTEL_* unset", () => {
		stashEnv();
		process.env.CLINE_OTEL_TRACES_EXPORTER = "otlp";
		process.env.CLINE_OTEL_EXPORTER_OTLP_METRICS_PROTOCOL = "grpc";
		process.env.CLINE_OTEL_EXPORTER_OTLP_LOGS_PROTOCOL = "http/protobuf";
		process.env.CLINE_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT =
			"https://logs.example:4318";
		process.env.CLINE_OTEL_METRIC_EXPORT_INTERVAL = "12000";
		process.env.CLINE_OTEL_LOG_BATCH_TIMEOUT = "3500";
		process.env.CLINE_OTEL_LOG_MAX_QUEUE_SIZE = "1024";

		const config = getTelemetryBuildTimeConfig();
		expect(config.tracesExporter).toBe("otlp");
		expect(config.otlpMetricsProtocol).toBe("grpc");
		expect(config.otlpLogsProtocol).toBe("http/protobuf");
		expect(config.otlpLogsEndpoint).toBe("https://logs.example:4318");
		expect(config.metricExportInterval).toBe(12000);
		expect(config.logBatchTimeout).toBe(3500);
		expect(config.logMaxQueueSize).toBe(1024);
	});

	it("maps OTEL_EXPORTER_OTLP_TRACES_* (and CLINE_OTEL_* fallback)", () => {
		stashEnv();
		process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = "http/protobuf";
		process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT =
			"https://traces.example:4318";
		process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = "x-trace-key=t1";

		const config = getTelemetryBuildTimeConfig();
		expect(config.otlpTracesProtocol).toBe("http/protobuf");
		expect(config.otlpTracesEndpoint).toBe("https://traces.example:4318");
		expect(config.otlpTracesHeaders).toEqual({ "x-trace-key": "t1" });
	});

	it("falls back to CLINE_OTEL_EXPORTER_OTLP_TRACES_* when OTEL_* unset", () => {
		stashEnv();
		process.env.CLINE_OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = "grpc";
		process.env.CLINE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT =
			"https://cline-traces.example";
		process.env.CLINE_OTEL_EXPORTER_OTLP_TRACES_HEADERS = "auth=cline";

		const config = getTelemetryBuildTimeConfig();
		expect(config.otlpTracesProtocol).toBe("grpc");
		expect(config.otlpTracesEndpoint).toBe("https://cline-traces.example");
		expect(config.otlpTracesHeaders).toEqual({ auth: "cline" });
	});

	it("ignores non-finite and non-positive OTEL numeric env values", () => {
		stashEnv();
		process.env.OTEL_METRIC_EXPORT_INTERVAL = "NaN";
		process.env.OTEL_LOG_BATCH_SIZE = "0";
		process.env.OTEL_LOG_BATCH_TIMEOUT = "-1";
		process.env.OTEL_LOG_MAX_QUEUE_SIZE = "not-a-number";

		const config = getTelemetryBuildTimeConfig();
		expect(config.metricExportInterval).toBeUndefined();
		expect(config.logBatchSize).toBeUndefined();
		expect(config.logBatchTimeout).toBeUndefined();
		expect(config.logMaxQueueSize).toBeUndefined();
	});
});
