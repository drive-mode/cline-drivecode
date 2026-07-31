import { describe, expect, it } from "vitest";
import {
	PRODUCT_HUB_CHAT_CLINE_TYPE,
	PRODUCT_HUB_DAEMON_CLINE_TYPE,
	PRODUCT_HUB_HOST_AGENT_HOOKS_DEFAULT,
	PRODUCT_MAX_SESSION_COST_ENV,
	PRODUCT_VSCODE_PRECOMPACT_HOOKS,
	readProductMaxSessionCostUsd,
	resolveHubHostAgentHooksEnabled,
} from "./product-host-policy";

describe("product-host-policy", () => {
	it("keeps Hub host AgentHooks off by default (Desktop parity)", () => {
		expect(PRODUCT_HUB_HOST_AGENT_HOOKS_DEFAULT).toBe(false);
		expect(resolveHubHostAgentHooksEnabled({})).toBe(false);
	});

	it("allows CLINE_HUB_HOST_AGENT_HOOKS env override", () => {
		expect(
			resolveHubHostAgentHooksEnabled({ CLINE_HUB_HOST_AGENT_HOOKS: "1" }),
		).toBe(true);
		expect(
			resolveHubHostAgentHooksEnabled({ CLINE_HUB_HOST_AGENT_HOOKS: "0" }),
		).toBe(false);
	});

	it("hard-splits Hub Chat vs daemon cline_type by default", () => {
		expect(PRODUCT_HUB_CHAT_CLINE_TYPE).toBe("hub-chat");
		expect(PRODUCT_HUB_DAEMON_CLINE_TYPE).toBe("hub");
	});

	it("reads CLINE_MAX_SESSION_COST as a positive USD budget", () => {
		expect(PRODUCT_MAX_SESSION_COST_ENV).toBe("CLINE_MAX_SESSION_COST");
		expect(readProductMaxSessionCostUsd({ CLINE_MAX_SESSION_COST: "12.5" })).toBe(
			12.5,
		);
		expect(readProductMaxSessionCostUsd({ CLINE_MAX_SESSION_COST: "0" })).toBe(
			undefined,
		);
	});

	it("enables VS Code PreCompact host hooks by default", () => {
		expect(PRODUCT_VSCODE_PRECOMPACT_HOOKS).toBe(true);
	});
});
