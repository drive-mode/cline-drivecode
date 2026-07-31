import {
	type BankStore,
	createBankStore,
	createMemoryBankFs,
} from "@cline/drive";
import type { BankSnapshot } from "@cline/shared";
import { postToHost } from "../vscode";

const WORKSPACE = "/hub-drive-bank";
const HUB_BANK_TIMEOUT_MS = 3_000;

export type DriveBankSession = {
	store: BankStore;
	refresh: () => Promise<BankSnapshot>;
};

export type HubBankOpType =
	| "drive_bank_get"
	| "drive_bank_seed"
	| "drive_bank_create_task"
	| "drive_bank_edit_plan_tasks"
	| "drive_bank_complete_task"
	| "drive_bank_bind_now"
	| "drive_bank_activate_plan"
	| "drive_bank_record_failure";

/** Optional room/call session correlation for bank JSONL. */
export type BankOpSessionContext = {
	roomId?: string | null;
	callSessionId?: string | null;
};

export function bankCorrelationFields(
	ctx?: BankOpSessionContext,
): { roomId?: string; callSessionId?: string } {
	const roomId = ctx?.roomId?.trim();
	const callSessionId = ctx?.callSessionId?.trim();
	return {
		...(roomId ? { roomId } : {}),
		...(callSessionId ? { callSessionId } : {}),
	};
}

/**
 * Browser projection of the task bank.
 *
 * Join seed prefers hub durable ops (`drive_bank_seed`) when a workspaceRoot
 * is available; the memory FS is a fallback for seed when hub is unavailable
 * or root is unset. PlanEditor mutations write through hub when root is set
 * and leave the local store unchanged on hub failure (`fromHub: false`).
 */
export function createDriveBankSession(): DriveBankSession {
	const fs = createMemoryBankFs();
	const store = createBankStore(fs, WORKSPACE);
	return {
		store,
		refresh: () => store.getSnapshot(),
	};
}

export async function seedDemoBank(
	session: DriveBankSession,
): Promise<BankSnapshot> {
	const existing = await session.store.getSnapshot();
	if (existing.activePlanId) {
		return existing;
	}
	await session.store.createTask({
		id: "t-parse",
		title: "Fix parser",
		body: "Make the failing parser test green.",
	});
	await session.store.createTask({
		id: "t-tests",
		title: "Rerun tests",
		body: "Confirm the suite is green.",
	});
	await session.store.createPlan({
		id: "p-active",
		title: "Current work",
		taskIds: ["t-parse", "t-tests"],
	});
	return session.refresh();
}

/**
 * Mirror a hub BankSnapshot into the local memory store so PlanEditor can
 * mutate plan refs locally. Syncs plan taskIds and creates missing tasks even
 * when the active plan already exists.
 */
export async function hydrateLocalBankFromHubSnapshot(
	session: DriveBankSession,
	snapshot: BankSnapshot,
): Promise<void> {
	if (!snapshot.activePlanId) {
		return;
	}
	for (const taskId of snapshot.openTaskIds) {
		const existingTask = await session.store.getTask(taskId);
		if (existingTask) {
			continue;
		}
		const title =
			taskId === snapshot.nowTaskId
				? (snapshot.nowTitle ?? taskId)
				: taskId === snapshot.nextTaskId
					? (snapshot.nextTitle ?? taskId)
					: taskId;
		await session.store.createTask({
			id: taskId,
			title,
			body: "",
		});
	}
	const existing = await session.store.getPlan(snapshot.activePlanId);
	if (existing) {
		await session.store.editPlanTaskIds(snapshot.activePlanId, [
			...snapshot.openTaskIds,
		]);
		return;
	}
	await session.store.createPlan({
		id: snapshot.activePlanId,
		title: "Current work",
		taskIds: [...snapshot.openTaskIds],
	});
}

export function planTasksFromSnapshot(
	snapshot: BankSnapshot,
): Array<{ id: string; title: string }> {
	return snapshot.openTaskIds.map((taskId) => {
		const title =
			taskId === snapshot.nowTaskId
				? (snapshot.nowTitle ?? taskId)
				: taskId === snapshot.nextTaskId
					? (snapshot.nextTitle ?? taskId)
					: taskId;
		return { id: taskId, title };
	});
}

export type HubBankOpPayload = {
	workspaceRoot: string;
	id?: string;
	title?: string;
	body?: string;
	planId?: string;
	taskIds?: string[];
	taskId?: string;
	note?: string;
	roomId?: string;
	callSessionId?: string;
	agentId?: string;
};

/**
 * Request a hub `drive_bank_*` op and resolve with the snapshot reply.
 * Rejects on error reply or timeout (~3s).
 */
export function requestHubBankOp(
	type: HubBankOpType,
	payload: HubBankOpPayload,
	options?: { timeoutMs?: number },
): Promise<BankSnapshot> {
	const timeoutMs = options?.timeoutMs ?? HUB_BANK_TIMEOUT_MS;
	const requestId = `drive-bank-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const correlation = bankCorrelationFields(payload);

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			window.removeEventListener("message", onMessage);
			reject(new Error(`${type} timed out`));
		}, timeoutMs);

		function onMessage(event: MessageEvent) {
			const message = event.data as {
				type?: string;
				requestId?: string;
				snapshot?: BankSnapshot;
				text?: string;
			};
			if (
				message.type !== "drive_bank_snapshot" &&
				message.type !== "drive_bank_error"
			) {
				return;
			}
			if (message.requestId !== requestId) {
				return;
			}
			clearTimeout(timer);
			window.removeEventListener("message", onMessage);
			if (message.type === "drive_bank_error") {
				reject(new Error(message.text?.trim() || `${type} failed`));
				return;
			}
			if (!message.snapshot) {
				reject(new Error("drive_bank_snapshot missing snapshot"));
				return;
			}
			resolve(message.snapshot);
		}

		window.addEventListener("message", onMessage);
		switch (type) {
			case "drive_bank_get":
				postToHost({
					type: "drive_bank_get",
					requestId,
					workspaceRoot: payload.workspaceRoot,
					...correlation,
				});
				break;
			case "drive_bank_seed":
				postToHost({
					type: "drive_bank_seed",
					requestId,
					workspaceRoot: payload.workspaceRoot,
					...correlation,
				});
				break;
			case "drive_bank_create_task":
				postToHost({
					type: "drive_bank_create_task",
					requestId,
					workspaceRoot: payload.workspaceRoot,
					id: payload.id ?? "",
					title: payload.title ?? "",
					body: payload.body,
					planId: payload.planId,
					...correlation,
				});
				break;
			case "drive_bank_edit_plan_tasks":
				postToHost({
					type: "drive_bank_edit_plan_tasks",
					requestId,
					workspaceRoot: payload.workspaceRoot,
					planId: payload.planId ?? "",
					taskIds: payload.taskIds ?? [],
					...correlation,
				});
				break;
			case "drive_bank_complete_task":
				postToHost({
					type: "drive_bank_complete_task",
					requestId,
					workspaceRoot: payload.workspaceRoot,
					taskId: payload.taskId ?? "",
					...(payload.agentId?.trim()
						? { agentId: payload.agentId.trim() }
						: {}),
					...correlation,
				});
				break;
			case "drive_bank_bind_now":
				postToHost({
					type: "drive_bank_bind_now",
					requestId,
					workspaceRoot: payload.workspaceRoot,
					...(payload.agentId?.trim()
						? { agentId: payload.agentId.trim() }
						: {}),
					...correlation,
				});
				break;
			case "drive_bank_activate_plan":
				postToHost({
					type: "drive_bank_activate_plan",
					requestId,
					workspaceRoot: payload.workspaceRoot,
					planId: payload.planId ?? "",
					...correlation,
				});
				break;
			case "drive_bank_record_failure":
				postToHost({
					type: "drive_bank_record_failure",
					requestId,
					workspaceRoot: payload.workspaceRoot,
					taskId: payload.taskId ?? "",
					note: payload.note ?? "",
					...correlation,
				});
				break;
			default: {
				const _exhaustive: never = type;
				reject(new Error(`Unknown hub bank op: ${_exhaustive}`));
				return;
			}
		}
	});
}

/** Convenience wrapper around requestHubBankOp("drive_bank_seed", …). */
export function requestHubBankSeed(
	workspaceRoot: string,
	options?: { timeoutMs?: number } & BankOpSessionContext,
): Promise<BankSnapshot> {
	const { timeoutMs, ...correlation } = options ?? {};
	return requestHubBankOp(
		"drive_bank_seed",
		{ workspaceRoot, ...bankCorrelationFields(correlation) },
		{ timeoutMs },
	);
}

/**
 * Prefer hub durable seed when workspaceRoot is set; fall back to in-memory
 * demo seed on missing root, hub error, or timeout.
 */
export async function seedBankForJoin(
	session: DriveBankSession,
	workspaceRoot: string | undefined,
	correlation?: BankOpSessionContext,
): Promise<{ snapshot: BankSnapshot; fromHub: boolean }> {
	const root = workspaceRoot?.trim();
	if (root) {
		try {
			const snapshot = await requestHubBankOp("drive_bank_seed", {
				workspaceRoot: root,
				...bankCorrelationFields(correlation),
			});
			await hydrateLocalBankFromHubSnapshot(session, snapshot);
			return { snapshot, fromHub: true };
		} catch {
			// Hub unavailable / timed out — memory fallback below.
		}
	}
	const snapshot = await seedDemoBank(session);
	return { snapshot, fromHub: false };
}

export type BankMutationResult = {
	snapshot: BankSnapshot;
	/** True when the durable hub bank handled the write. */
	fromHub: boolean;
};

async function hubMutationOrLocal(
	session: DriveBankSession,
	workspaceRoot: string | undefined,
	hubOp: () => Promise<BankSnapshot>,
	localOp: () => Promise<void>,
): Promise<BankMutationResult> {
	const root = workspaceRoot?.trim();
	if (root) {
		try {
			const snapshot = await hubOp();
			await hydrateLocalBankFromHubSnapshot(session, snapshot);
			return { snapshot, fromHub: true };
		} catch {
			const snapshot = await session.refresh();
			return { snapshot, fromHub: false };
		}
	}
	await localOp();
	const snapshot = await session.refresh();
	return { snapshot, fromHub: false };
}

/**
 * Create a task (optionally appending to a plan). Writes through hub when
 * workspaceRoot is set. On hub error returns `{ fromHub: false }` without
 * mutating the local store so callers can surface divergence without
 * presenting a local-only plan as durable. Without workspaceRoot, mutates
 * the in-memory store only.
 */
export async function mutateBankCreateTask(
	session: DriveBankSession,
	workspaceRoot: string | undefined,
	input: {
		id: string;
		title: string;
		body?: string;
		planId?: string;
	},
	correlation?: BankOpSessionContext,
): Promise<BankMutationResult> {
	const body = input.body ?? "";
	return hubMutationOrLocal(
		session,
		workspaceRoot,
		() =>
			requestHubBankOp("drive_bank_create_task", {
				workspaceRoot: workspaceRoot!.trim(),
				id: input.id,
				title: input.title,
				body,
				planId: input.planId,
				...bankCorrelationFields(correlation),
			}),
		async () => {
			await session.store.createTask({
				id: input.id,
				title: input.title,
				body,
			});
			if (input.planId) {
				const plan = await session.store.getPlan(input.planId);
				if (plan) {
					await session.store.editPlanTaskIds(input.planId, [
						...plan.taskIds,
						input.id,
					]);
				}
			}
		},
	);
}

/**
 * Replace a plan's task id list (reorder/remove). Writes through hub when
 * workspaceRoot is set. On hub error returns `{ fromHub: false }` without
 * mutating the local store. Without workspaceRoot, mutates memory only.
 */
export async function mutateBankEditPlanTasks(
	session: DriveBankSession,
	workspaceRoot: string | undefined,
	input: { planId: string; taskIds: string[] },
	correlation?: BankOpSessionContext,
): Promise<BankMutationResult> {
	return hubMutationOrLocal(
		session,
		workspaceRoot,
		() =>
			requestHubBankOp("drive_bank_edit_plan_tasks", {
				workspaceRoot: workspaceRoot!.trim(),
				planId: input.planId,
				taskIds: input.taskIds,
				...bankCorrelationFields(correlation),
			}),
		async () => {
			await session.store.editPlanTaskIds(input.planId, input.taskIds);
		},
	);
}

/** Mark a task done (archive). Prefer over remove-from-plan for product complete. */
export async function mutateBankCompleteTask(
	session: DriveBankSession,
	workspaceRoot: string | undefined,
	input: { taskId: string; agentId?: string },
	correlation?: BankOpSessionContext,
): Promise<BankMutationResult> {
	return hubMutationOrLocal(
		session,
		workspaceRoot,
		() =>
			requestHubBankOp("drive_bank_complete_task", {
				workspaceRoot: workspaceRoot!.trim(),
				taskId: input.taskId,
				...(input.agentId?.trim()
					? { agentId: input.agentId.trim() }
					: {}),
				...bankCorrelationFields(correlation),
			}),
		async () => {
			await session.store.completeTask(
				input.taskId,
				input.agentId?.trim()
					? { agentId: input.agentId.trim() }
					: undefined,
			);
		},
	);
}

/** Bind Agent posture to the bank now-task (emit drive_task_bound). */
export async function mutateBankBindNow(
	session: DriveBankSession,
	workspaceRoot: string | undefined,
	correlation?: BankOpSessionContext & { agentId?: string },
): Promise<BankMutationResult> {
	const agentId = correlation?.agentId?.trim();
	return hubMutationOrLocal(
		session,
		workspaceRoot,
		() =>
			requestHubBankOp("drive_bank_bind_now", {
				workspaceRoot: workspaceRoot!.trim(),
				...(agentId ? { agentId } : {}),
				...bankCorrelationFields(correlation),
			}),
		async () => {
			await session.store.bindNowTask(agentId ? { agentId } : undefined);
		},
	);
}

/** Activate a plan as the bank cursor. */
export async function mutateBankActivatePlan(
	session: DriveBankSession,
	workspaceRoot: string | undefined,
	input: { planId: string },
	correlation?: BankOpSessionContext,
): Promise<BankMutationResult> {
	return hubMutationOrLocal(
		session,
		workspaceRoot,
		() =>
			requestHubBankOp("drive_bank_activate_plan", {
				workspaceRoot: workspaceRoot!.trim(),
				planId: input.planId,
				...bankCorrelationFields(correlation),
			}),
		async () => {
			await session.store.activatePlan(input.planId);
		},
	);
}

/** Record a sticky failure note on the now task. */
export async function mutateBankRecordFailure(
	session: DriveBankSession,
	workspaceRoot: string | undefined,
	input: { taskId: string; note: string },
	correlation?: BankOpSessionContext,
): Promise<BankMutationResult> {
	return hubMutationOrLocal(
		session,
		workspaceRoot,
		() =>
			requestHubBankOp("drive_bank_record_failure", {
				workspaceRoot: workspaceRoot!.trim(),
				taskId: input.taskId,
				note: input.note,
				...bankCorrelationFields(correlation),
			}),
		async () => {
			await session.store.recordTaskFailure(input.taskId, input.note);
		},
	);
}

export async function listPlanTasks(
	session: DriveBankSession,
	planId: string,
): Promise<Array<{ id: string; title: string; lastFailure?: string }>> {
	const plan = await session.store.getPlan(planId);
	if (!plan) {
		return [];
	}
	const tasks: Array<{ id: string; title: string; lastFailure?: string }> =
		[];
	for (const taskId of plan.taskIds) {
		const task = await session.store.getTask(taskId);
		if (task && task.status !== "done") {
			tasks.push({
				id: task.id,
				title: task.title,
				...(task.lastFailure ? { lastFailure: task.lastFailure } : {}),
			});
		}
	}
	return tasks;
}
