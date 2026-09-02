// @vitest-environment jsdom
import { createEmptyRoomSnapshot } from "@cline/drive";
import { act, type ReactNode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
	DriveCallOp,
	DriveCallReply,
	DriveHubStatus,
	DriveRoomsListReply,
} from "./drive-client";
import type { DriveDataSource } from "./drive-source";
import {
	type DriveHubContextValue,
	DriveHubProvider,
	useDriveHub,
} from "./use-drive-hub";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

type FakeSource = DriveDataSource & {
	calls: Array<{ op: DriveCallOp; roomId: string }>;
	roomsReplies: Array<Deferred<DriveRoomsListReply>>;
};

function callReply(roomId: string): DriveCallReply {
	return {
		roomId,
		snapshot: createEmptyRoomSnapshot({
			roomId,
			createdAt: "2026-09-01T10:00:00.000Z",
		}),
		seq: 1,
	};
}

/** A source whose `listRooms` replies are released by the test. */
function fakeSource(label: string): FakeSource {
	const status: DriveHubStatus = {
		connected: true,
		url: `ws://${label}`,
		error: null,
		workspaceRoot: `/ws/${label}`,
	};
	const source: FakeSource = {
		kind: "demo",
		calls: [],
		roomsReplies: [],
		hubStatus: async () => status,
		call: async (op, roomId) => {
			source.calls.push({ op, roomId });
			return callReply(roomId);
		},
		listRooms: () => {
			const next = deferred<DriveRoomsListReply>();
			source.roomsReplies.push(next);
			return next.promise;
		},
		command: async () => ({}) as never,
		status: async () => ({}) as never,
		bank: async () => ({}) as never,
		sessionRollups: async () => ({ sessions: [] }),
		agentHome: async () => ({}) as never,
		agentProfiles: async () => ({}) as never,
		config: async () => ({}) as never,
		subscribe: () => () => undefined,
		dispose: () => undefined,
	};
	return source;
}

function Probe({
	onValue,
}: {
	onValue: (value: DriveHubContextValue) => void;
}) {
	const value = useDriveHub();
	useEffect(() => {
		onValue(value);
	}, [onValue, value]);
	return null;
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

describe("DriveHubProvider", () => {
	let root: Root;
	let host: HTMLDivElement;
	let latest: DriveHubContextValue | null;
	const onValue = (value: DriveHubContextValue) => {
		latest = value;
	};

	beforeEach(() => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		latest = null;
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		host.remove();
	});

	function mount(source: DriveDataSource, roomId?: string | null) {
		const tree: ReactNode = (
			<DriveHubProvider source={source} roomId={roomId}>
				<Probe onValue={onValue} />
			</DriveHubProvider>
		);
		return act(async () => {
			root.render(tree);
		});
	}

	it("drops an in-flight rooms reply from the previous source after a swap", async () => {
		const first = fakeSource("first");
		const second = fakeSource("second");
		await mount(first);
		await flush();
		expect(first.roomsReplies).toHaveLength(1);

		await mount(second);
		await flush();
		expect(second.roomsReplies).toHaveLength(1);

		// The old source answers late: its rooms must not land on the new one.
		await act(async () => {
			first.roomsReplies[0]?.resolve({
				rooms: [
					{
						roomId: "stale-room",
						status: "live",
					} as DriveRoomsListReply["rooms"][number],
				],
			});
		});
		await flush();
		expect(latest?.rooms).toEqual([]);
		expect(latest?.roomsLoading).toBe(true);

		await act(async () => {
			second.roomsReplies[0]?.resolve({ rooms: [] });
		});
		await flush();
		expect(latest?.roomsLoading).toBe(false);
		expect(latest?.hub.url).toBe("ws://second");
	});

	it("rebinds to the room a successful join seats the user in", async () => {
		const source = fakeSource("only");
		await mount(source, "default");
		await flush();
		expect(latest?.roomId).toBe("default");

		await act(async () => {
			await latest?.join("router-fix");
		});
		await flush();
		expect(latest?.roomId).toBe("router-fix");
		expect(latest?.room.roomId).toBe("router-fix");

		source.calls.length = 0;
		await act(async () => {
			await latest?.refreshRoom();
		});
		expect(source.calls).toEqual([
			{ op: "call_get_room", roomId: "router-fix" },
		]);
	});

	it("follows a new requested room from the shell", async () => {
		const source = fakeSource("only");
		await mount(source, "default");
		await flush();
		await mount(source, "other-room");
		await flush();
		expect(latest?.roomId).toBe("other-room");
		expect(latest?.room.roomId).toBe("other-room");
	});
});
