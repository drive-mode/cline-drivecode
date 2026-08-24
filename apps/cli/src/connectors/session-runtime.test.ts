import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockGetLastUsedProviderSettings,
	mockGetProviderSettings,
	mockResolveSystemPrompt,
	mockGetProviderCollection,
	mockGetBooleanFlagEnabled,
	mockListSessions,
	mockStopRuntimeSession,
	mockDeleteSession,
	mockHubClose,
} = vi.hoisted(() => ({
	mockGetLastUsedProviderSettings: vi.fn(),
	mockGetProviderSettings: vi.fn(),
	mockResolveSystemPrompt: vi.fn(),
	mockGetProviderCollection: vi.fn(),
	mockGetBooleanFlagEnabled: vi.fn(),
	mockListSessions: vi.fn(),
	mockStopRuntimeSession: vi.fn(),
	mockDeleteSession: vi.fn(),
	mockHubClose: vi.fn(),
}));

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		ProviderSettingsManager: class {
			getLastUsedProviderSettings(options?: unknown) {
				return mockGetLastUsedProviderSettings(options);
			}

			getProviderSettings(providerId: string) {
				return mockGetProviderSettings(providerId);
			}
		},
		HubSessionClient: class {
			listSessions = mockListSessions;
			stopRuntimeSession = mockStopRuntimeSession;
			deleteSession = mockDeleteSession;
			close = mockHubClose;
		},
		CoreSessionService: class {},
		SqliteSessionStore: class {},
		Llms: {
			...actual.Llms,
			getProviderCollection: mockGetProviderCollection,
		},
	};
});

vi.mock("../runtime/prompt", () => ({
	resolveSystemPrompt: mockResolveSystemPrompt,
}));

vi.mock("../utils/helpers", () => ({
	resolveWorkspaceRoot: vi.fn((cwd: string) => cwd),
}));

vi.mock("../utils/feature-flags", () => ({
	getCliFeatureFlagsService: () => ({
		getBooleanFlagEnabled: mockGetBooleanFlagEnabled,
	}),
}));

vi.mock("../commands/auth", async () => {
	const actual =
		await vi.importActual<typeof import("../commands/auth")>(
			"../commands/auth",
		);
	return {
		...actual,
		ensureOAuthProviderApiKey: vi.fn(),
	};
});

import {
	buildConnectorStartRequest,
	stopConnectorSessions,
} from "./session-runtime";

describe("buildConnectorStartRequest", () => {
	beforeEach(() => {
		mockGetBooleanFlagEnabled.mockReturnValue(false);
	});

	afterEach(() => {
		vi.clearAllMocks();
		delete process.env.OPENROUTER_API_KEY;
	});

	it("falls back to provider env vars when persisted settings have no api key", async () => {
		mockGetLastUsedProviderSettings.mockReturnValue({ provider: "openrouter" });
		mockGetProviderSettings.mockReturnValue({
			provider: "openrouter",
			model: "anthropic/claude-sonnet-4.6",
		});
		mockGetProviderCollection.mockReturnValue({
			provider: { env: ["OPENROUTER_API_KEY"] },
		});
		mockResolveSystemPrompt.mockResolvedValue("system");
		process.env.OPENROUTER_API_KEY = "env-openrouter-key";

		const request = await buildConnectorStartRequest({
			options: {
				cwd: "/tmp/work",
				mode: "act",
				enableTools: false,
			},
			io: { writeln: vi.fn(), writeErr: vi.fn() },
			loggerConfig: { enabled: false, level: "info", destination: "stdout" },
			systemRules: "Rules",
		});

		expect(request.provider).toBe("openrouter");
		expect(request.apiKey).toBe("env-openrouter-key");
		expect(request.model).toBe("anthropic/claude-sonnet-4.6");
		expect(mockGetLastUsedProviderSettings).toHaveBeenCalledWith({
			isClinePassEnabled: true,
		});
	});

	it("uses auth material resolved by provider settings manager", async () => {
		mockGetLastUsedProviderSettings.mockReturnValue({ provider: "cline-pass" });
		mockGetProviderSettings.mockReturnValue({
			provider: "cline-pass",
			auth: { accessToken: "workos:resolved-token" },
		});
		mockGetProviderCollection.mockReturnValue({
			provider: { env: ["CLINE_API_KEY"] },
		});
		mockResolveSystemPrompt.mockResolvedValue("system");

		const request = await buildConnectorStartRequest({
			options: {
				cwd: "/tmp/work",
				mode: "act",
				enableTools: false,
			},
			io: { writeln: vi.fn(), writeErr: vi.fn() },
			loggerConfig: { enabled: false, level: "info", destination: "stdout" },
			systemRules: "Rules",
			defaultModel: "cline-pass/glm-5.2",
		});

		expect(request.provider).toBe("cline-pass");
		expect(request.apiKey).toBe("workos:resolved-token");
		expect(request.model).toBe("cline-pass/glm-5.2");
	});

	it("uses auth material resolved by provider settings manager", async () => {
		mockGetLastUsedProviderSettings.mockReturnValue({ provider: "cline-pass" });
		mockGetProviderSettings.mockReturnValue({
			provider: "cline-pass",
			auth: { accessToken: "workos:resolved-token" },
		});
		mockGetProviderCollection.mockReturnValue({
			provider: { env: ["CLINE_API_KEY"] },
		});
		mockResolveSystemPrompt.mockResolvedValue("system");

		const request = await buildConnectorStartRequest({
			options: {
				cwd: "/tmp/work",
				mode: "act",
				enableTools: false,
			},
			io: { writeln: vi.fn(), writeErr: vi.fn() },
			loggerConfig: { enabled: false, level: "info", destination: "stdout" },
			systemRules: "Rules",
			defaultModel: "cline-pass/glm-5.2",
		});

		expect(request.provider).toBe("cline-pass");
		expect(request.apiKey).toBe("workos:resolved-token");
		expect(request.model).toBe("cline-pass/glm-5.2");
	});
});

describe("stopConnectorSessions", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("stops matching live sessions without deleting their history", async () => {
		mockListSessions.mockResolvedValue([
			{ sessionId: "session-1", metadata: { connector: "target" } },
			{ sessionId: "session-2", metadata: { connector: "other" } },
		]);
		mockStopRuntimeSession.mockResolvedValue({ applied: true });

		await expect(
			stopConnectorSessions({
				rpcAddress: "ws://test",
				localMatcher: () => true,
				rpcMatcher: (metadata) => metadata?.connector === "target",
			}),
		).resolves.toBe(1);
		expect(mockStopRuntimeSession).toHaveBeenCalledWith("session-1");
		expect(mockDeleteSession).not.toHaveBeenCalled();
		expect(mockHubClose).toHaveBeenCalledOnce();
	});

	it("does not mutate local history when runtime authority is unavailable", async () => {
		mockListSessions.mockRejectedValue(new Error("hub unavailable"));

		await expect(
			stopConnectorSessions({
				rpcAddress: "ws://test",
				localMatcher: () => true,
				rpcMatcher: () => true,
			}),
		).resolves.toBe(0);
		expect(mockStopRuntimeSession).not.toHaveBeenCalled();
		expect(mockHubClose).toHaveBeenCalledOnce();
	});
});
