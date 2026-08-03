/**
 * Hub DriveWorkExecutor — binds wave tasks to chat-fork spawn/promote.
 * Keeps DriveHostPort free of runTask (DRV-PARALLEL-WAVES / ADR-0014).
 */

import type { DriveWorkExecutor, DriveWorkOutcome } from "@cline/drive";
import type { HubCommandEnvelope, SeedWorkspace } from "@cline/shared";
import type { HubTransportContext } from "./context";
import { handleDriveForkCommand } from "./drive-fork-handlers";
import { resolveDoItemFromWaveTask } from "./drive-wave-map";

export type CreateHubWaveExecutorInput = {
	ctx: HubTransportContext;
	roomId: string;
	parentSessionId: string;
	assigneeParticipantId: string;
	parentBriefing?: string;
	workspace?: SeedWorkspace;
	allowedPathPrefixes?: string[];
	/** When true, skip runTurn and promote immediately after spawn (tests). */
	syncComplete?: boolean;
};

function claimEnvelope(
	requestId: string,
	payload: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		command: "drive.fork.claim",
		requestId,
		payload,
	};
}

function promoteEnvelope(
	requestId: string,
	payload: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		command: "drive.fork.promote",
		requestId,
		payload,
	};
}

function cancelEnvelope(
	requestId: string,
	payload: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		command: "drive.fork.cancel",
		requestId,
		payload,
	};
}

export function createHubWaveExecutor(
	input: CreateHubWaveExecutorInput,
): DriveWorkExecutor {
	return {
		async runTask({ task, signal }): Promise<DriveWorkOutcome> {
			if (signal?.aborted) {
				return { ok: false, error: "aborted" };
			}

			const doItem = resolveDoItemFromWaveTask(task);
			const assignee =
				doItem.assigneeParticipantId ?? input.assigneeParticipantId;

			const claim = await handleDriveForkCommand(
				input.ctx,
				claimEnvelope(`wave-claim-${task.id}`, {
					roomId: input.roomId,
					parentSessionId: input.parentSessionId,
					assigneeParticipantId: assignee,
					parentBriefing: input.parentBriefing ?? "",
					doItem,
					workspace: input.workspace ?? { mode: "shared_readonly" },
					allowedPathPrefixes: input.allowedPathPrefixes ?? [],
					reason: "wave_item",
				}),
			);

			if (!claim.ok) {
				return {
					ok: false,
					error: claim.error?.message ?? "wave claim failed",
				};
			}

			const fork = claim.payload?.fork as
				| { workerSessionId?: string }
				| undefined;
			const workerSessionId = fork?.workerSessionId;
			if (!workerSessionId) {
				return { ok: false, error: "wave claim missing workerSessionId" };
			}

			if (!input.syncComplete) {
				try {
					await input.ctx.sessionHost.runTurn?.({
						sessionId: workerSessionId,
						prompt: `(wave) ${doItem.goal}`,
						delivery: "queue",
					});
				} catch (error) {
					const message =
						error instanceof Error ? error.message : "worker turn failed";
					await handleDriveForkCommand(
						input.ctx,
						promoteEnvelope(`wave-fail-${task.id}`, {
							roomId: input.roomId,
							promote: {
								workerSessionId,
								doItemId: doItem.id,
								status: "failed",
								summary: message,
								decisions: [],
								showItemIds: [],
								eventRefs: [],
								auditHandle: workerSessionId,
								retainForAudit: false,
							},
						}),
					);
					return { ok: false, error: message };
				}
			}

			if (signal?.aborted) {
				await handleDriveForkCommand(
					input.ctx,
					cancelEnvelope(`wave-cancel-${task.id}`, {
						roomId: input.roomId,
						workerSessionId,
						summary: "Wave task aborted",
					}),
				);
				return { ok: false, error: "aborted" };
			}

			const promote = await handleDriveForkCommand(
				input.ctx,
				promoteEnvelope(`wave-promote-${task.id}`, {
					roomId: input.roomId,
					promote: {
						workerSessionId,
						doItemId: doItem.id,
						status: "done",
						summary: `Wave task ${task.id} completed`,
						decisions: [],
						showItemIds: [],
						eventRefs: [],
						auditHandle: workerSessionId,
						retainForAudit: false,
					},
				}),
			);

			if (!promote.ok) {
				return {
					ok: false,
					error: promote.error?.message ?? "wave promote failed",
				};
			}

			return {
				ok: true,
				result: {
					workerSessionId,
					doItemId: doItem.id,
					kind: task.kind,
				},
			};
		},
	};
}
