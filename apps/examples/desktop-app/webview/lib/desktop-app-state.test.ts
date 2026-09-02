import { describe, expect, it } from "vitest";
import { createDesktopAppState, desktopAppReducer } from "./desktop-app-state";
import type { SessionHistoryItem } from "./session-history";

const settingsSection = "General" as const;

function createSession(sessionId: string): SessionHistoryItem {
	return {
		sessionId,
		status: "completed",
		provider: "test-provider",
		model: "test-model",
		cwd: "/workspace",
		workspaceRoot: "/workspace",
		startedAt: "2026-01-01T00:00:00.000Z",
	};
}

describe("desktopAppReducer", () => {
	it("hands an edited prompt to a fork exactly once", () => {
		let state = createDesktopAppState("welcome", settingsSection);
		state = desktopAppReducer(state, {
			type: "open-session",
			session: createSession("forked-session"),
			initialPromptDraft: "Revise this prompt",
		});

		expect(
			state.threads.find((thread) => thread.id === "session_forked-session")
				?.initialPromptDraft,
		).toBe("Revise this prompt");

		state = desktopAppReducer(state, {
			type: "consume-initial-prompt-draft",
			threadId: "session_forked-session",
		});

		expect(
			state.threads.find((thread) => thread.id === "session_forked-session")
				?.initialPromptDraft,
		).toBeUndefined();
	});

	it("keeps both sessions deleted when deletion actions are queued together", () => {
		let state = createDesktopAppState("welcome", settingsSection);
		state = desktopAppReducer(state, {
			type: "open-session",
			session: createSession("session-a"),
		});
		state = desktopAppReducer(state, {
			type: "open-session",
			session: createSession("session-b"),
		});

		state = desktopAppReducer(state, {
			type: "delete-session",
			deletedSessionId: "session-a",
			fallbackThreadId: "fallback-a",
		});
		state = desktopAppReducer(state, {
			type: "delete-session",
			deletedSessionId: "session-b",
			fallbackThreadId: "fallback-b",
		});

		expect(state.threads.map((thread) => thread.id)).toEqual([
			"welcome",
			"fallback-b",
		]);
		expect(state.navigation.current.activeThreadId).toBe("fallback-b");
		expect([
			...state.navigation.back,
			state.navigation.current,
			...state.navigation.forward,
		]).not.toContainEqual(
			expect.objectContaining({ activeThreadId: "session_session-a" }),
		);
		expect([
			...state.navigation.back,
			state.navigation.current,
			...state.navigation.forward,
		]).not.toContainEqual(
			expect.objectContaining({ activeThreadId: "session_session-b" }),
		);
	});

	it("ignores a duplicate deletion after its thread and history are removed", () => {
		let state = createDesktopAppState("welcome", settingsSection);
		state = desktopAppReducer(state, {
			type: "open-session",
			session: createSession("session-a"),
		});
		const deletion = {
			type: "delete-session" as const,
			deletedSessionId: "session-a",
			fallbackThreadId: "fallback-a",
		};

		state = desktopAppReducer(state, deletion);
		expect(desktopAppReducer(state, deletion)).toBe(state);
	});

	it("navigates into Drive sections without losing the active thread", () => {
		let state = createDesktopAppState("welcome", settingsSection);
		expect(state.navigation.current.driveSection).toBe("lobby");
		expect(state.navigation.current.driveRoomId).toBeNull();

		state = desktopAppReducer(state, { type: "navigate-drive" });
		expect(state.navigation.current).toMatchObject({
			view: "drive",
			driveSection: "lobby",
			activeThreadId: "welcome",
		});

		state = desktopAppReducer(state, {
			type: "navigate-drive",
			section: "call",
			roomId: "router-fix",
		});
		expect(state.navigation.current).toMatchObject({
			view: "drive",
			driveSection: "call",
			driveRoomId: "router-fix",
		});
		expect(state.navigation.back).toHaveLength(2);

		// Same destination twice is a no-op, not a history entry.
		expect(
			desktopAppReducer(state, {
				type: "navigate-drive",
				section: "call",
				roomId: "router-fix",
			}),
		).toBe(state);

		state = desktopAppReducer(state, { type: "back" });
		expect(state.navigation.current.driveSection).toBe("lobby");
		expect(state.navigation.current.driveRoomId).toBeNull();
	});

	it("keeps drive locations when the session they were opened from is deleted", () => {
		let state = createDesktopAppState("welcome", settingsSection);
		state = desktopAppReducer(state, {
			type: "open-session",
			session: createSession("session-a"),
		});
		state = desktopAppReducer(state, {
			type: "navigate-drive",
			section: "status",
		});
		state = desktopAppReducer(state, {
			type: "delete-session",
			deletedSessionId: "session-a",
			fallbackThreadId: "fallback-a",
		});

		expect(state.navigation.current).toMatchObject({
			view: "drive",
			driveSection: "status",
			activeThreadId: "fallback-a",
		});
		expect(state.navigation.back).not.toContainEqual(
			expect.objectContaining({ activeThreadId: "session_session-a" }),
		);
	});
});
