/**
 * Hub drive_bank_* durable task bank ops under .drive/bank/.
 */

import { unlink } from "node:fs/promises";
import { taskPath } from "@cline/drive";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { appendBankLogEvent } from "../../collaboration/bankEventLog";
import { getDriveRoomStore } from "../../collaboration/room";
import { openWorkspaceBankStore } from "../../collaboration/workspaceBankStore";
import { errorReply, type HubTransportContext, okReply } from "./context";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(
	payload: Record<string, unknown> | undefined,
	key: string,
): string[] | undefined {
	const value = payload?.[key];
	if (!Array.isArray(value)) {
		return undefined;
	}
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== "string" || !item.trim()) {
			return undefined;
		}
		out.push(item.trim());
	}
	return out;
}

function openLoggedBankStore(
	workspaceRoot: string,
	payload: Record<string, unknown> | undefined,
) {
	const roomId = readString(payload, "roomId");
	const callSessionId =
		readString(payload, "callSessionId") ??
		(roomId
			? getDriveRoomStore().getActiveCallSessionId(roomId)
			: undefined);
	return openWorkspaceBankStore(workspaceRoot, {
		roomId: roomId ?? "bank",
		callSessionId,
		onBankEvent: (event) => {
			appendBankLogEvent(workspaceRoot, event);
		},
	});
}

async function seedDemoIfEmpty(
	workspaceRoot: string,
	payload: Record<string, unknown> | undefined,
) {
	const store = openLoggedBankStore(workspaceRoot, payload);
	const existing = await store.getSnapshot();
	if (existing.activePlanId) {
		return existing;
	}
	await store.createTask({
		id: "t-parse",
		title: "Fix parser",
		body: "Make the failing parser test green.",
	});
	await store.createTask({
		id: "t-tests",
		title: "Rerun tests",
		body: "Confirm the suite is green.",
	});
	await store.createPlan({
		id: "p-active",
		title: "Current work",
		taskIds: ["t-parse", "t-tests"],
	});
	return store.getSnapshot();
}

export async function handleDriveBankCommand(
	_ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const workspaceRoot =
		readString(envelope.payload, "workspaceRoot") ??
		readString(envelope.payload, "configParent");
	if (!workspaceRoot) {
		return errorReply(
			envelope,
			"invalid_payload",
			"workspaceRoot or configParent is required",
		);
	}

	switch (envelope.command) {
		case "drive_bank_get": {
			const store = openLoggedBankStore(workspaceRoot, envelope.payload);
			const snapshot = await store.getSnapshot();
			return okReply(envelope, { snapshot });
		}
		case "drive_bank_seed": {
			const snapshot = await seedDemoIfEmpty(
				workspaceRoot,
				envelope.payload,
			);
			return okReply(envelope, { snapshot });
		}
		case "drive_bank_create_task": {
			const id = readString(envelope.payload, "id");
			const title = readString(envelope.payload, "title");
			if (!id || !title) {
				return errorReply(
					envelope,
					"invalid_payload",
					"id and title are required",
				);
			}
			const bodyRaw = envelope.payload?.body;
			const body = typeof bodyRaw === "string" ? bodyRaw : "";
			const planId = readString(envelope.payload, "planId");
			try {
				const store = openLoggedBankStore(
					workspaceRoot,
					envelope.payload,
				);
				if (planId) {
					const plan = await store.getPlan(planId);
					if (!plan) {
						return errorReply(
							envelope,
							"not_found",
							`Plan not found: ${planId}`,
						);
					}
					await store.createTask({ id, title, body });
					try {
						await store.editPlanTaskIds(planId, [
							...plan.taskIds,
							id,
						]);
					} catch (error) {
						// Roll back the orphan task file so the durable bank
						// stays consistent when the plan update fails.
						try {
							await unlink(taskPath(workspaceRoot, id));
						} catch {
							// Best-effort cleanup; rethrow the plan error.
						}
						throw error;
					}
				} else {
					await store.createTask({ id, title, body });
				}
				const snapshot = await store.getSnapshot();
				return okReply(envelope, { snapshot });
			} catch (error) {
				return errorReply(
					envelope,
					"drive_bank_create_task_failed",
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		case "drive_bank_edit_plan_tasks": {
			const planId = readString(envelope.payload, "planId");
			const taskIds = readStringArray(envelope.payload, "taskIds");
			if (!planId || !taskIds) {
				return errorReply(
					envelope,
					"invalid_payload",
					"planId and taskIds (string[]) are required",
				);
			}
			try {
				const store = openLoggedBankStore(
					workspaceRoot,
					envelope.payload,
				);
				await store.editPlanTaskIds(planId, taskIds);
				const snapshot = await store.getSnapshot();
				return okReply(envelope, { snapshot });
			} catch (error) {
				return errorReply(
					envelope,
					"drive_bank_edit_plan_tasks_failed",
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		case "drive_bank_complete_task": {
			const taskId = readString(envelope.payload, "taskId");
			if (!taskId) {
				return errorReply(
					envelope,
					"invalid_payload",
					"taskId is required",
				);
			}
			const agentId = readString(envelope.payload, "agentId");
			try {
				const store = openLoggedBankStore(
					workspaceRoot,
					envelope.payload,
				);
				await store.completeTask(
					taskId,
					agentId ? { agentId } : undefined,
				);
				const snapshot = await store.getSnapshot();
				return okReply(envelope, { snapshot });
			} catch (error) {
				return errorReply(
					envelope,
					"drive_bank_complete_task_failed",
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		case "drive_bank_bind_now": {
			const agentId = readString(envelope.payload, "agentId");
			try {
				const store = openLoggedBankStore(
					workspaceRoot,
					envelope.payload,
				);
				const bound = await store.bindNowTask(
					agentId ? { agentId } : undefined,
				);
				const snapshot = await store.getSnapshot();
				return okReply(envelope, {
					snapshot,
					task: bound?.task ?? null,
					plan: bound?.plan ?? null,
				});
			} catch (error) {
				return errorReply(
					envelope,
					"drive_bank_bind_now_failed",
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		case "drive_bank_activate_plan": {
			const planId = readString(envelope.payload, "planId");
			if (!planId) {
				return errorReply(
					envelope,
					"invalid_payload",
					"planId is required",
				);
			}
			try {
				const store = openLoggedBankStore(
					workspaceRoot,
					envelope.payload,
				);
				await store.activatePlan(planId);
				const snapshot = await store.getSnapshot();
				return okReply(envelope, { snapshot });
			} catch (error) {
				return errorReply(
					envelope,
					"drive_bank_activate_plan_failed",
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		case "drive_bank_record_failure": {
			const taskId = readString(envelope.payload, "taskId");
			const note = readString(envelope.payload, "note");
			if (!taskId || !note) {
				return errorReply(
					envelope,
					"invalid_payload",
					"taskId and note are required",
				);
			}
			try {
				const store = openLoggedBankStore(
					workspaceRoot,
					envelope.payload,
				);
				const task = await store.recordTaskFailure(taskId, note);
				const snapshot = await store.getSnapshot();
				return okReply(envelope, { snapshot, task });
			} catch (error) {
				return errorReply(
					envelope,
					"drive_bank_record_failure_failed",
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		default:
			return errorReply(
				envelope,
				"not_implemented",
				`Unknown drive bank command: ${envelope.command}`,
			);
	}
}
