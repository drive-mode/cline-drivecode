import { afterEach, describe, expect, it, vi } from "vitest";
import {
	HubStatusTeamsSource,
	isStatusTasksSnapshotResult,
} from "./hub-status-teams-source";

function stubWindowMessageBus() {
	const listeners = new Set<(event: MessageEvent) => void>();
	vi.stubGlobal("window", {
		addEventListener: (
			_type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			if (typeof listener === "function") {
				listeners.add(listener as (event: MessageEvent) => void);
			}
		},
		removeEventListener: (
			_type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			listeners.delete(listener as (event: MessageEvent) => void);
		},
	});
	return {
		listenerCount: () => listeners.size,
		dispatch(data: unknown) {
			const event = { data } as MessageEvent;
			for (const listener of [...listeners]) {
				listener(event);
			}
		},
	};
}

describe("isStatusTasksSnapshotResult", () => {
	it("accepts snapshot results with and without teams", () => {
		expect(
			isStatusTasksSnapshotResult({
				type: "status_tasks_snapshot_result",
				requestId: "req-1",
				teams: [],
			}),
		).toBe(true);
		expect(
			isStatusTasksSnapshotResult({ type: "status_tasks_snapshot_result" }),
		).toBe(true);
	});

	it("rejects malformed payloads and other types", () => {
		expect(
			isStatusTasksSnapshotResult({
				type: "status_tasks_snapshot_result",
				teams: "boom",
			}),
		).toBe(false);
		expect(
			isStatusTasksSnapshotResult({
				type: "status_tasks_snapshot_result",
				requestId: 7,
			}),
		).toBe(false);
		expect(isStatusTasksSnapshotResult({ type: "team_progress" })).toBe(false);
	});
});

describe("HubStatusTeamsSource", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("resolves teams for the matching request and unsubscribes", async () => {
		const bus = stubWindowMessageBus();
		const teams = [{ teamId: "t1" }];
		vi.spyOn(await import("../vscode"), "postToHost").mockImplementation(
			(message) => {
				const requestId =
					typeof message === "object" &&
					message &&
					"requestId" in message &&
					typeof message.requestId === "string"
						? message.requestId
						: undefined;
				queueMicrotask(() => {
					// A reply for someone else's request must be ignored.
					bus.dispatch({
						type: "status_tasks_snapshot_result",
						requestId: "someone-else",
						teams: [{ teamId: "other" }],
					});
					bus.dispatch({
						type: "status_tasks_snapshot_result",
						requestId,
						teams,
					});
				});
			},
		);

		const loaded = await new HubStatusTeamsSource().loadTeams();
		expect(loaded).toEqual(teams);
		expect(bus.listenerCount()).toBe(0);
	});

	it("drops malformed replies and resolves [] when teams are missing", async () => {
		const bus = stubWindowMessageBus();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(await import("../vscode"), "postToHost").mockImplementation(
			(message) => {
				const requestId =
					typeof message === "object" &&
					message &&
					"requestId" in message &&
					typeof message.requestId === "string"
						? message.requestId
						: undefined;
				queueMicrotask(() => {
					// Malformed reply is rejected by the shape guard...
					bus.dispatch({
						type: "status_tasks_snapshot_result",
						requestId,
						teams: "boom",
					});
					// ...so only this teams-free reply resolves the request.
					bus.dispatch({ type: "status_tasks_snapshot_result", requestId });
				});
			},
		);

		const loaded = await new HubStatusTeamsSource().loadTeams();
		expect(loaded).toEqual([]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('malformed "status_tasks_snapshot_result"'),
		);
	});
});
