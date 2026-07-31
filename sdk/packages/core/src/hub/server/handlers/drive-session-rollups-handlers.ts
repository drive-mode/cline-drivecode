/**
 * Hub command: local SessionRollup dump (Slice 2 debug / Status port).
 * No PostHog / phone-home — reads workspace Drive JSONL only.
 */

import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import {
	formatSessionRollupsDump,
	readSessionRollups,
} from "../../collaboration/sessionRollupReader";
import { errorReply, type HubTransportContext, okReply } from "./context";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveInt(
	payload: Record<string, unknown> | undefined,
	key: string,
): number | undefined {
	const value = payload?.[key];
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.floor(value);
	}
	if (typeof value === "string" && value.trim()) {
		const n = Number.parseInt(value.trim(), 10);
		if (Number.isFinite(n) && n > 0) {
			return n;
		}
	}
	return undefined;
}

export async function handleDriveSessionRollupsCommand(
	_ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	if (envelope.command !== "drive_session_rollups") {
		return errorReply(
			envelope,
			"not_implemented",
			`Unknown command: ${envelope.command}`,
		);
	}

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

	const callSessionId = readString(envelope.payload, "callSessionId");
	const limit = readPositiveInt(envelope.payload, "limit") ?? 10;
	const rollups = readSessionRollups(workspaceRoot, {
		callSessionId,
		limit,
	});
	const dump = formatSessionRollupsDump(rollups);
	return okReply(envelope, { rollups, dump, limit });
}
