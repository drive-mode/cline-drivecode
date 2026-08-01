import { describe, expect, it } from "vitest";
import { isChatHostMessage } from "./chatHostMessages";

describe("isChatHostMessage", () => {
	it("accepts status and error text messages", () => {
		expect(isChatHostMessage({ type: "status", text: "Ready" })).toBe(true);
		expect(
			isChatHostMessage({ type: "error", text: "boom", code: "mic_muted" }),
		).toBe(true);
	});

	it("rejects status and error messages without string text", () => {
		expect(isChatHostMessage({ type: "status", text: 42 })).toBe(false);
		expect(isChatHostMessage({ type: "error", text: "x", code: 5 })).toBe(
			false,
		);
	});

	it("requires defaults to be a record of optional strings", () => {
		expect(
			isChatHostMessage({
				type: "defaults",
				defaults: { provider: "anthropic", workspaceRoot: "C:/ws" },
			}),
		).toBe(true);
		expect(isChatHostMessage({ type: "defaults" })).toBe(false);
		expect(
			isChatHostMessage({ type: "defaults", defaults: { provider: 1 } }),
		).toBe(false);
	});

	it("validates session summaries", () => {
		expect(
			isChatHostMessage({
				type: "sessions",
				sessions: [{ sessionId: "s1", title: "Fix bug" }],
			}),
		).toBe(true);
		expect(
			isChatHostMessage({ type: "sessions", sessions: [{ title: "x" }] }),
		).toBe(false);
	});

	it("validates provider and model catalogs", () => {
		expect(
			isChatHostMessage({
				type: "providers",
				providers: [{ id: "anthropic", enabled: true, name: "Anthropic" }],
			}),
		).toBe(true);
		expect(
			isChatHostMessage({
				type: "providers",
				providers: [{ id: "anthropic", enabled: "yes" }],
			}),
		).toBe(false);
		expect(
			isChatHostMessage({
				type: "models",
				providerId: "anthropic",
				models: [{ id: "claude-fable-5" }],
			}),
		).toBe(true);
		expect(
			isChatHostMessage({
				type: "models",
				providerId: "anthropic",
				models: [{}],
			}),
		).toBe(false);
	});

	it("validates session lifecycle messages", () => {
		expect(
			isChatHostMessage({ type: "session_started", sessionId: "s1" }),
		).toBe(true);
		expect(isChatHostMessage({ type: "session_started" })).toBe(false);
		expect(
			isChatHostMessage({
				type: "session_hydrated",
				sessionId: "s1",
				status: "running",
				messages: [{ id: "m1", role: "user", text: "hi" }],
			}),
		).toBe(true);
		expect(
			isChatHostMessage({
				type: "session_hydrated",
				sessionId: "s1",
				messages: [{ id: 1, role: "user" }],
			}),
		).toBe(false);
		expect(isChatHostMessage({ type: "reset_done" })).toBe(true);
	});

	it("validates streaming deltas and tool events", () => {
		expect(isChatHostMessage({ type: "assistant_delta", text: "…" })).toBe(
			true,
		);
		expect(
			isChatHostMessage({ type: "reasoning_delta", text: "…", redacted: true }),
		).toBe(true);
		expect(
			isChatHostMessage({ type: "reasoning_delta", text: "…", redacted: "y" }),
		).toBe(false);
		expect(
			isChatHostMessage({
				type: "tool_event",
				text: "read_file",
				event: { status: "failed", error: "denied" },
			}),
		).toBe(true);
		expect(
			isChatHostMessage({ type: "tool_event", text: "read_file", event: "x" }),
		).toBe(false);
	});

	it("validates approval flow messages", () => {
		expect(
			isChatHostMessage({
				type: "approval_request",
				approvalId: "a1",
				toolName: "execute_command",
			}),
		).toBe(true);
		expect(
			isChatHostMessage({ type: "approval_request", approvalId: "a1" }),
		).toBe(false);
		expect(
			isChatHostMessage({ type: "approval_resolved", approvalId: "a1" }),
		).toBe(true);
	});

	it("validates turn completion and forking", () => {
		expect(
			isChatHostMessage({
				type: "turn_done",
				finishReason: "stop",
				iterations: 3,
			}),
		).toBe(true);
		expect(
			isChatHostMessage({
				type: "turn_done",
				finishReason: "stop",
				iterations: "3",
			}),
		).toBe(false);
		expect(isChatHostMessage({ type: "fork_done", newSessionId: "s2" })).toBe(
			true,
		);
		expect(isChatHostMessage({ type: "fork_error", text: "boom" })).toBe(true);
	});

	it("validates pending prompt payloads", () => {
		expect(
			isChatHostMessage({
				type: "pending_prompts",
				prompts: [{ id: "p1", prompt: "steer left", delivery: "steer" }],
			}),
		).toBe(true);
		expect(
			isChatHostMessage({
				type: "pending_prompts",
				prompts: [{ id: "p1", prompt: "x", delivery: "later" }],
			}),
		).toBe(false);
		expect(
			isChatHostMessage({
				type: "pending_prompt_submitted",
				prompt: { id: "p1", prompt: "steer left", delivery: "steer" },
			}),
		).toBe(true);
		expect(
			isChatHostMessage({ type: "pending_prompt_submitted", prompt: null }),
		).toBe(false);
	});

	it("rejects message types the Chat listener does not consume", () => {
		expect(isChatHostMessage({ type: "hub_state", connected: true })).toBe(
			false,
		);
		expect(isChatHostMessage({ type: "room_snapshot" })).toBe(false);
	});
});
