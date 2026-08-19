/**
 * Hub command: drive.wave.run — first live DriveWaveRunner binding.
 */

import { DriveWaveRunner, failFastReview } from "@cline/drive";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { getDriveRoomStore } from "../../collaboration";
import { errorReply, type HubTransportContext, okReply } from "./context";
import { createHubWaveExecutor } from "./drive-wave-executor";
import { doBacklogToWaveInputs } from "./drive-wave-map";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(
	payload: Record<string, unknown> | undefined,
	key: string,
): boolean | undefined {
	const value = payload?.[key];
	return typeof value === "boolean" ? value : undefined;
}

export async function handleDriveWaveCommand(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	switch (envelope.command) {
		case "drive.wave.run":
			return await handleWaveRun(ctx, envelope);
		default:
			return errorReply(
				envelope,
				"not_implemented",
				"Unknown drive wave command",
			);
	}
}

async function handleWaveRun(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const parentSessionId = readString(envelope.payload, "parentSessionId");
	const assigneeParticipantId = readString(
		envelope.payload,
		"assigneeParticipantId",
	);
	const parentBriefing = readString(envelope.payload, "parentBriefing") ?? "";
	const syncComplete = readBoolean(envelope.payload, "syncComplete") === true;
	const initialConcurrency =
		typeof envelope.payload?.concurrency === "number"
			? envelope.payload.concurrency
			: 2;

	if (!parentSessionId || !assigneeParticipantId) {
		return errorReply(
			envelope,
			"invalid_payload",
			"parentSessionId and assigneeParticipantId are required",
		);
	}

	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);

	const fromPayload = Array.isArray(envelope.payload?.work)
		? (envelope.payload?.work as unknown[])
		: null;

	let workInputs = doBacklogToWaveInputs(room.director.doBacklog);
	if (fromPayload && fromPayload.length > 0) {
		workInputs = fromPayload
			.filter(
				(entry): entry is Record<string, unknown> =>
					!!entry && typeof entry === "object",
			)
			.map((entry) => ({
				id: typeof entry.id === "string" ? entry.id : undefined,
				kind: typeof entry.kind === "string" ? entry.kind : "do_item",
				payload:
					entry.payload && typeof entry.payload === "object"
						? (entry.payload as Record<string, unknown>)
						: entry,
				dependsOn: Array.isArray(entry.dependsOn)
					? entry.dependsOn.filter((d): d is string => typeof d === "string")
					: undefined,
				priority:
					typeof entry.priority === "number" ? entry.priority : undefined,
			}));
	}

	if (workInputs.length === 0) {
		return errorReply(
			envelope,
			"empty_wave",
			"No queued Do items (or work[]) to run",
		);
	}

	ctx.publish(
		ctx.buildEvent("drive.wave.started", {
			roomId,
			workCount: workInputs.length,
		}),
	);

	const host = createHubWaveExecutor({
		ctx,
		roomId,
		parentSessionId,
		assigneeParticipantId,
		parentBriefing,
		syncComplete,
	});

	const runner = new DriveWaveRunner({
		host,
		gates: [failFastReview()],
		concurrency: {
			initial: initialConcurrency,
			max: Math.max(initialConcurrency, 4),
		},
	});

	const result = await runner.run(workInputs);
	const nextRoom = store.getOrCreateLive(roomId);

	ctx.publish(
		ctx.buildEvent("drive.wave.completed", {
			roomId,
			status: result.status,
			waveRunId: result.waveRunId,
			wave: result.wave,
			success: result.success,
		}),
	);

	return okReply(envelope, {
		room: nextRoom,
		result: {
			status: result.status,
			waveRunId: result.waveRunId,
			wave: result.wave,
			success: result.success,
			failed: result.failed,
			message: result.message,
			errors: result.errors,
			tasks: result.tasks.map((t) => ({
				id: t.id,
				kind: t.kind,
				status: t.status,
				dependsOn: t.dependsOn,
				error: t.error,
				result: t.result,
			})),
		},
	});
}
