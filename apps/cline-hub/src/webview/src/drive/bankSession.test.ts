import type { BankSnapshot } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createDriveBankSession,
	HUB_BANK_DEGRADED_NOTICE,
	hydrateLocalBankFromHubSnapshot,
	mutateBankActivatePlan,
	mutateBankBindNow,
	mutateBankCompleteTask,
	mutateBankCreateTask,
	mutateBankEditPlanTasks,
	mutateBankRecordFailure,
	planTasksFromSnapshot,
	seedBankForJoin,
	seedDemoBank,
} from "./bankSession";

const sampleSnapshot: BankSnapshot = {
	activePlanId: "p-active",
	openTaskIds: ["t-parse", "t-tests"],
	nowTaskId: "t-parse",
	nextTaskId: "t-tests",
	nowTitle: "Fix parser",
	nextTitle: "Rerun tests",
};

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
		dispatch(data: unknown) {
			const event = { data } as MessageEvent;
			for (const listener of [...listeners]) {
				listener(event);
			}
		},
	};
}

async function spyPostToHostSnapshot(
	bus: ReturnType<typeof stubWindowMessageBus>,
	snapshot: BankSnapshot,
) {
	return vi
		.spyOn(await import("../vscode"), "postToHost")
		.mockImplementation((message) => {
			const requestId =
				typeof message === "object" &&
				message &&
				"requestId" in message &&
				typeof message.requestId === "string"
					? message.requestId
					: undefined;
			queueMicrotask(() => {
				bus.dispatch({
					type: "drive_bank_snapshot",
					requestId,
					snapshot,
				});
			});
		});
}

describe("bankSession hub seed helpers", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("planTasksFromSnapshot projects open task titles", () => {
		expect(planTasksFromSnapshot(sampleSnapshot)).toEqual([
			{ id: "t-parse", title: "Fix parser" },
			{ id: "t-tests", title: "Rerun tests" },
		]);
	});

	it("hydrateLocalBankFromHubSnapshot creates plan + tasks once", async () => {
		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const plan = await session.store.getPlan("p-active");
		expect(plan?.taskIds).toEqual(["t-parse", "t-tests"]);
		const task = await session.store.getTask("t-parse");
		expect(task?.title).toBe("Fix parser");

		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const again = await session.store.getPlan("p-active");
		expect(again?.taskIds).toEqual(["t-parse", "t-tests"]);
	});

	it("hydrateLocalBankFromHubSnapshot syncs plan taskIds when plan exists", async () => {
		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		await hydrateLocalBankFromHubSnapshot(session, {
			...sampleSnapshot,
			openTaskIds: ["t-tests", "t-parse", "t-extra"],
			nowTaskId: "t-tests",
			nextTaskId: "t-parse",
			nowTitle: "Rerun tests",
			nextTitle: "Fix parser",
		});
		const plan = await session.store.getPlan("p-active");
		expect(plan?.taskIds).toEqual(["t-tests", "t-parse", "t-extra"]);
		expect(await session.store.getTask("t-extra")).toMatchObject({
			id: "t-extra",
			title: "t-extra",
		});
	});

	it("seedBankForJoin falls back to memory when workspaceRoot is empty", async () => {
		const session = createDriveBankSession();
		const result = await seedBankForJoin(session, "  ");
		expect(result.fromHub).toBe(false);
		expect(result.snapshot.activePlanId).toBe("p-active");
		// No workspaceRoot means a local/demo bank was expected from the
		// start — this is not the hub silently degrading, so no notice.
		expect(result.degradedNotice).toBeNull();
	});

	it("seedBankForJoin uses hub snapshot when drive_bank_snapshot arrives", async () => {
		const bus = stubWindowMessageBus();

		const postSpy = vi
			.spyOn(await import("../vscode"), "postToHost")
			.mockImplementation((message) => {
				const requestId =
					typeof message === "object" &&
					message &&
					"requestId" in message &&
					typeof message.requestId === "string"
						? message.requestId
						: undefined;
				queueMicrotask(() => {
					bus.dispatch({
						type: "drive_bank_snapshot",
						requestId,
						snapshot: sampleSnapshot,
					});
				});
			});

		const session = createDriveBankSession();
		const result = await seedBankForJoin(session, "/tmp/workspace", {
			roomId: "default",
			callSessionId: "cs-1",
		});
		expect(result.fromHub).toBe(true);
		expect(result.snapshot).toEqual(sampleSnapshot);
		// Healthy hub join — no degradation notice, no false alarm.
		expect(result.degradedNotice).toBeNull();
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "drive_bank_seed",
				workspaceRoot: "/tmp/workspace",
				roomId: "default",
				callSessionId: "cs-1",
			}),
		);
		const plan = await session.store.getPlan("p-active");
		expect(plan).not.toBeNull();
	});

	it("seedBankForJoin falls back after hub error reply", async () => {
		const bus = stubWindowMessageBus();

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
					bus.dispatch({
						type: "drive_bank_error",
						requestId,
						text: "Hub is not connected.",
					});
				});
			},
		);

		const session = createDriveBankSession();
		const result = await seedBankForJoin(session, "/tmp/workspace");
		expect(result.fromHub).toBe(false);
		expect(result.snapshot.activePlanId).toBe("p-active");
		// A workspaceRoot was set, so a durable hub bank was expected — the
		// hub error means this join silently fell back to the local bank,
		// which must be flagged rather than shown as the user's saved one.
		// (requestHubBankOp's own timeout rejects the same way, exercising
		// this identical catch path — see bankSession.ts:383-385.)
		expect(result.degradedNotice).toBe(HUB_BANK_DEGRADED_NOTICE);
	});

	it("seedDemoBank is idempotent", async () => {
		const session = createDriveBankSession();
		const first = await seedDemoBank(session);
		const second = await seedDemoBank(session);
		expect(second).toEqual(first);
	});
});

describe("bankSession hub mutation helpers", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("mutateBankCreateTask uses local store when workspaceRoot is empty", async () => {
		const session = createDriveBankSession();
		await seedDemoBank(session);
		const result = await mutateBankCreateTask(session, undefined, {
			id: "t-local",
			title: "Local task",
			planId: "p-active",
		});
		expect(result.fromHub).toBe(false);
		expect(result.snapshot.openTaskIds).toContain("t-local");
		const plan = await session.store.getPlan("p-active");
		expect(plan?.taskIds).toContain("t-local");
	});

	it("mutateBankCreateTask posts hub create_task and hydrates", async () => {
		const bus = stubWindowMessageBus();
		const hubSnapshot: BankSnapshot = {
			...sampleSnapshot,
			openTaskIds: ["t-parse", "t-tests", "t-hub"],
		};

		const postSpy = await spyPostToHostSnapshot(bus, hubSnapshot);

		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const result = await mutateBankCreateTask(
			session,
			"/tmp/workspace",
			{
				id: "t-hub",
				title: "Hub task",
				body: "",
				planId: "p-active",
			},
			{ roomId: "default", callSessionId: "cs-1" },
		);
		expect(result.fromHub).toBe(true);
		expect(result.snapshot).toEqual(hubSnapshot);
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "drive_bank_create_task",
				workspaceRoot: "/tmp/workspace",
				id: "t-hub",
				title: "Hub task",
				planId: "p-active",
				roomId: "default",
				callSessionId: "cs-1",
			}),
		);
		const plan = await session.store.getPlan("p-active");
		expect(plan?.taskIds).toEqual(["t-parse", "t-tests", "t-hub"]);
	});

	it("mutateBankEditPlanTasks posts hub edit and hydrates", async () => {
		const bus = stubWindowMessageBus();
		const hubSnapshot: BankSnapshot = {
			...sampleSnapshot,
			openTaskIds: ["t-tests", "t-parse"],
			nowTaskId: "t-tests",
			nextTaskId: "t-parse",
			nowTitle: "Rerun tests",
			nextTitle: "Fix parser",
		};

		const postSpy = await spyPostToHostSnapshot(bus, hubSnapshot);

		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const result = await mutateBankEditPlanTasks(session, "/tmp/workspace", {
			planId: "p-active",
			taskIds: ["t-tests", "t-parse"],
		});
		expect(result.fromHub).toBe(true);
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "drive_bank_edit_plan_tasks",
				workspaceRoot: "/tmp/workspace",
				planId: "p-active",
				taskIds: ["t-tests", "t-parse"],
			}),
		);
		const plan = await session.store.getPlan("p-active");
		expect(plan?.taskIds).toEqual(["t-tests", "t-parse"]);
	});

	it("mutateBankEditPlanTasks does not mutate local after hub error", async () => {
		const bus = stubWindowMessageBus();
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
					bus.dispatch({
						type: "drive_bank_error",
						requestId,
						text: "disk full",
					});
				});
			},
		);

		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const result = await mutateBankEditPlanTasks(session, "/tmp/workspace", {
			planId: "p-active",
			taskIds: ["t-tests"],
		});
		expect(result.fromHub).toBe(false);
		expect(result.snapshot.openTaskIds).toEqual(["t-parse", "t-tests"]);
		const plan = await session.store.getPlan("p-active");
		expect(plan?.taskIds).toEqual(["t-parse", "t-tests"]);
	});

	it("mutateBankCompleteTask posts hub complete with correlation", async () => {
		const bus = stubWindowMessageBus();
		const hubSnapshot: BankSnapshot = {
			...sampleSnapshot,
			openTaskIds: ["t-tests"],
			nowTaskId: "t-tests",
			nextTaskId: null,
			nowTitle: "Rerun tests",
			nextTitle: null,
		};
		const postSpy = await spyPostToHostSnapshot(bus, hubSnapshot);

		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const result = await mutateBankCompleteTask(
			session,
			"/tmp/workspace",
			{ taskId: "t-parse" },
			{ roomId: "default", callSessionId: "cs-1" },
		);
		expect(result.fromHub).toBe(true);
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "drive_bank_complete_task",
				taskId: "t-parse",
				roomId: "default",
				callSessionId: "cs-1",
			}),
		);
	});

	it("mutateBankCompleteTask uses local store without workspaceRoot", async () => {
		const session = createDriveBankSession();
		await seedDemoBank(session);
		const result = await mutateBankCompleteTask(session, undefined, {
			taskId: "t-parse",
		});
		expect(result.fromHub).toBe(false);
		expect(result.snapshot.openTaskIds).not.toContain("t-parse");
	});

	it("mutateBankBindNow posts hub bind_now", async () => {
		const bus = stubWindowMessageBus();
		const postSpy = await spyPostToHostSnapshot(bus, sampleSnapshot);
		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const result = await mutateBankBindNow(session, "/tmp/workspace", {
			roomId: "default",
			callSessionId: "cs-1",
		});
		expect(result.fromHub).toBe(true);
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "drive_bank_bind_now",
				roomId: "default",
				callSessionId: "cs-1",
			}),
		);
	});

	it("mutateBankActivatePlan posts hub activate_plan", async () => {
		const bus = stubWindowMessageBus();
		const postSpy = await spyPostToHostSnapshot(bus, sampleSnapshot);
		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const result = await mutateBankActivatePlan(
			session,
			"/tmp/workspace",
			{ planId: "p-active" },
			{ callSessionId: "cs-1" },
		);
		expect(result.fromHub).toBe(true);
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "drive_bank_activate_plan",
				planId: "p-active",
				callSessionId: "cs-1",
			}),
		);
	});

	it("mutateBankRecordFailure posts hub record_failure", async () => {
		const bus = stubWindowMessageBus();
		const postSpy = await spyPostToHostSnapshot(bus, sampleSnapshot);
		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const result = await mutateBankRecordFailure(
			session,
			"/tmp/workspace",
			{ taskId: "t-parse", note: "tests red" },
			{ roomId: "default", callSessionId: "cs-1" },
		);
		expect(result.fromHub).toBe(true);
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "drive_bank_record_failure",
				taskId: "t-parse",
				note: "tests red",
				roomId: "default",
				callSessionId: "cs-1",
			}),
		);
	});
});
