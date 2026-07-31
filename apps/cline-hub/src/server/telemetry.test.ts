import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	captureExtensionActivated: vi.fn(),
	createClineTelemetryServiceConfig: vi.fn((config: unknown) => config),
	createConfiguredTelemetryHandle: vi.fn(),
	disposeTelemetry: vi.fn(async () => {}),
	identifyAccount: vi.fn(),
}));

const telemetry = { capture: vi.fn() };

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		captureExtensionActivated: mocks.captureExtensionActivated,
		createClineTelemetryServiceConfig: mocks.createClineTelemetryServiceConfig,
		createConfiguredTelemetryHandle: mocks.createConfiguredTelemetryHandle,
		identifyAccount: mocks.identifyAccount,
		ProviderSettingsManager: class {
			getProviderSettings() {
				return {
					auth: {
						accountId: "account-1",
						organizationId: "org-1",
						organizationName: "Org",
						memberId: "member-1",
					},
				};
			}
		},
	};
});

describe("createHubTelemetry (SDK-6.1)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createConfiguredTelemetryHandle.mockReturnValue({
			telemetry,
			provider: { kind: "otel" },
			dispose: mocks.disposeTelemetry,
		});
	});

	it("configures hub telemetry metadata, identity, and activation", async () => {
		const { createHubTelemetry } = await import("./telemetry");
		const handle = createHubTelemetry();

		expect(mocks.createClineTelemetryServiceConfig).toHaveBeenCalledWith({
			metadata: expect.objectContaining({
				cline_type: "hub",
				platform: "Cline Hub",
			}),
		});
		expect(mocks.createConfiguredTelemetryHandle).toHaveBeenCalled();
		expect(mocks.identifyAccount).toHaveBeenCalledWith(telemetry, {
			id: "account-1",
			provider: "cline",
			organizationId: "org-1",
			organizationName: "Org",
			memberId: "member-1",
		});
		expect(mocks.captureExtensionActivated).toHaveBeenCalledWith(telemetry);
		expect(handle.telemetry).toBe(telemetry);
		expect(handle.provider).toEqual({ kind: "otel" });

		await handle.dispose();
		await handle.dispose();
		expect(mocks.disposeTelemetry).toHaveBeenCalledTimes(1);
	});

	it("exposes no provider when Core returns an opted-out handle", async () => {
		mocks.createConfiguredTelemetryHandle.mockReturnValue({
			telemetry,
			provider: undefined,
			dispose: mocks.disposeTelemetry,
		});
		const { createHubTelemetry } = await import("./telemetry");
		const handle = createHubTelemetry();
		expect(handle.telemetry).toBe(telemetry);
		expect(handle.provider).toBeUndefined();
	});
});

describe("buildHubClineCoreCreateOptions (SDK-6.1)", () => {
	it("passes the telemetry handle into ClineCore.create options", async () => {
		const { buildHubClineCoreCreateOptions } = await import("./hub");
		const requestToolApproval = vi.fn();
		const options = buildHubClineCoreCreateOptions({
			hubUrl: "ws://127.0.0.1:9",
			hubAuthToken: "token",
			workspaceRoot: "/tmp/ws",
			telemetry: telemetry as never,
			requestToolApproval,
		});
		expect(options.telemetry).toBe(telemetry);
		expect(options.clientName).toBe("cline-hub");
		expect(options.backendMode).toBe("hub");
		expect(options.capabilities?.requestToolApproval).toBe(
			requestToolApproval,
		);
	});
});
