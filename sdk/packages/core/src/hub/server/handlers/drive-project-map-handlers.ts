import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { readProjectMapSnapshot } from "../../project-map/load-project-map";
import { errorReply, okReply } from "./context";

export async function handleDriveProjectMapCommand(
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const workspaceRoot = envelope.payload?.workspaceRoot;
	if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
		return errorReply(
			envelope,
			"invalid_payload",
			"drive_project_map_get requires workspaceRoot",
		);
	}
	const snapshot = await readProjectMapSnapshot(workspaceRoot.trim());
	return okReply(envelope, {
		snapshot: snapshot as unknown as Record<string, unknown>,
	});
}
