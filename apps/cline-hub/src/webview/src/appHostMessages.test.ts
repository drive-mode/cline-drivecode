import { describe, expect, it } from "vitest";
import { isAppHostMessage } from "./appHostMessages";

const validHubState = {
	type: "hub_state",
	connected: true,
	clients: [],
	connectors: [],
	sessions: [],
	clientSummaries: [],
	sessionSummaries: [],
	events: [
		{
			id: "e1",
			title: "Hub started",
			body: "Listening on port 7777",
			severity: "info",
			timestamp: 1_722_500_000_000,
		},
	],
};

describe("isAppHostMessage", () => {
	it("accepts a valid hub_state message", () => {
		expect(isAppHostMessage(validHubState)).toBe(true);
	});

	it("accepts hub_state with optional lists omitted", () => {
		expect(
			isAppHostMessage({ type: "hub_state", connected: false, events: [] }),
		).toBe(true);
	});

	it("rejects hub_state without a boolean connected flag", () => {
		expect(isAppHostMessage({ ...validHubState, connected: "yes" })).toBe(
			false,
		);
	});

	it("rejects hub_state whose events are not renderable records", () => {
		expect(isAppHostMessage({ ...validHubState, events: "boom" })).toBe(false);
		expect(
			isAppHostMessage({
				...validHubState,
				events: [{ id: "e1", title: 42, body: "x", timestamp: 1 }],
			}),
		).toBe(false);
	});

	it("rejects hub_state whose client list holds non-records", () => {
		expect(isAppHostMessage({ ...validHubState, clients: ["evil"] })).toBe(
			false,
		);
	});

	it("accepts defaults with and without a workspace root", () => {
		expect(
			isAppHostMessage({
				type: "defaults",
				defaults: { workspaceRoot: "C:/ws", cwd: "C:/ws" },
			}),
		).toBe(true);
		expect(isAppHostMessage({ type: "defaults" })).toBe(true);
	});

	it("rejects defaults with a malformed payload", () => {
		expect(isAppHostMessage({ type: "defaults", defaults: "boom" })).toBe(
			false,
		);
		expect(
			isAppHostMessage({ type: "defaults", defaults: { workspaceRoot: 42 } }),
		).toBe(false);
	});

	it("accepts a sessions list and rejects malformed entries", () => {
		expect(
			isAppHostMessage({
				type: "sessions",
				sessions: [{ sessionId: "s1", workspaceRoot: "C:/ws" }],
			}),
		).toBe(true);
		expect(isAppHostMessage({ type: "sessions", sessions: "boom" })).toBe(
			false,
		);
		expect(
			isAppHostMessage({ type: "sessions", sessions: [{ sessionId: 42 }] }),
		).toBe(false);
	});

	it("rejects unrelated message types", () => {
		expect(isAppHostMessage({ type: "status", text: "hi" })).toBe(false);
	});
});
