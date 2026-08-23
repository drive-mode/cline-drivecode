import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	INTERACTIVE_CHAT_RUNTIME_CONTRACT_VERSION,
	INTERACTIVE_CHAT_RUNTIME_METHODS,
	type InteractiveChatRuntime,
	type InteractiveRuntimeConfigurationChange,
} from "./interactive-runtime-contract";

const SOURCE_PATH = fileURLToPath(
	new URL("./interactive-runtime-contract.ts", import.meta.url),
);

describe("InteractiveChatRuntime contract", () => {
	it("has a closed semantic method surface without fresh-process resume", () => {
		expect(INTERACTIVE_CHAT_RUNTIME_CONTRACT_VERSION).toBe("v1");
		expect(INTERACTIVE_CHAT_RUNTIME_METHODS).toEqual([
			"getSnapshot",
			"ensureReady",
			"subscribeEvents",
			"runTurn",
			"abortCurrent",
			"listPendingPrompts",
			"updatePendingPrompt",
			"removePendingPrompt",
			"listMessages",
			"listCheckpoints",
			"getUsage",
			"getCompaction",
			"runCompaction",
			"resetForNewSession",
			"restartForConfigurationChange",
			"forkCurrent",
			"restoreCheckpoint",
			"cleanup",
		]);
		expect(INTERACTIVE_CHAT_RUNTIME_METHODS).not.toContain("resume");
		expect(INTERACTIVE_CHAT_RUNTIME_METHODS).not.toContain("reattach");
		expect(INTERACTIVE_CHAT_RUNTIME_METHODS).not.toContain("recover");
	});

	it("contains no generic Core, provider-native, hook, or local-artifact authority", () => {
		const source = readFileSync(SOURCE_PATH, "utf8");
		for (const forbidden of [
			"@cline/core",
			"createCliCore",
			"ClineCore",
			"AgentEvent",
			"AgentHooks",
			"CheckpointEntry",
			"ManagedHubChat",
			"SessionCompactionState",
			"SessionHistoryRecord",
			"SessionRecord",
			"ToolApprovalRequest",
			"deleteSession",
			"messages.json",
			"forceLocalBackend",
			"updateSession",
			"updateSessionConnection",
			"compactInteractiveMessages",
			"loadInteractiveResumeMessages",
		]) {
			expect(source).not.toContain(forbidden);
		}
		expect(source).not.toMatch(/\bMessage(?:WithMetadata)?\b/);
	});

	it("does not accidentally acquire a generic index signature", () => {
		type HasStringIndex = string extends keyof InteractiveChatRuntime
			? true
			: false;
		const hasStringIndex: HasStringIndex = false;
		expect(hasStringIndex).toBe(false);
	});

	it("models configuration changes as a closed discriminated union", () => {
		const changes = [
			{ reason: "mode", mode: "plan" },
			{ reason: "compaction" },
			{ reason: "model" },
		] as const satisfies readonly InteractiveRuntimeConfigurationChange[];

		expect(changes).toEqual([
			{ reason: "mode", mode: "plan" },
			{ reason: "compaction" },
			{ reason: "model" },
		]);
	});
});
