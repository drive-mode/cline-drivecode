import type { DriveArtifactDirectoryEntry } from "@cline/drive";
import {
	type HostMessage,
	isOptionalString,
	subscribeToHostMessages,
} from "../lib/host-message-gateway";
import { postToHost } from "../vscode";
import { artifactDirectoryEntryFromUnknown } from "./artifactEntry";
import {
	DriveArtifactsListError,
	type DriveArtifactsSource,
} from "./drive-artifacts-source";

const TIMEOUT_MS = 5_000;

const ARTIFACTS_REPLY_TYPES = [
	"drive_artifacts",
	"drive_artifacts_error",
] as const;

type ArtifactsReply = HostMessage & {
	type: "drive_artifacts" | "drive_artifacts_error";
	requestId?: string;
	artifacts?: unknown[];
	text?: string;
	code?: string;
};

function isArtifactsReply(message: HostMessage): message is ArtifactsReply {
	return (
		(message.type === "drive_artifacts" ||
			message.type === "drive_artifacts_error") &&
		isOptionalString(message.requestId) &&
		(message.artifacts === undefined || Array.isArray(message.artifacts)) &&
		isOptionalString(message.text) &&
		isOptionalString(message.code)
	);
}

/**
 * Live hub adapter: reads the durable artifact corpus via
 * `drive.artifacts.list`. Read-only — artifacts are recorded by the hub as the
 * director presents, so the page never writes one.
 *
 * The corpus spans rooms by design, which is the whole point of giving
 * artifacts their own log family: a diagram produced in a room that has since
 * stopped is still listed here.
 */
export class HubDriveArtifactsSource implements DriveArtifactsSource {
	listArtifacts(workspaceRoot: string): Promise<DriveArtifactDirectoryEntry[]> {
		const requestId = `drive-artifacts-${Date.now()}-${Math.random().toString(36).slice(2)}`;

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				unsubscribe();
				reject(
					new DriveArtifactsListError(
						"drive.artifacts.list timed out",
						"timeout",
					),
				);
			}, TIMEOUT_MS);

			const unsubscribe = subscribeToHostMessages({
				types: ARTIFACTS_REPLY_TYPES,
				guard: isArtifactsReply,
				onMessage: (message) => {
					if (message.requestId !== requestId) {
						return;
					}
					clearTimeout(timer);
					unsubscribe();
					if (message.type === "drive_artifacts_error") {
						reject(
							new DriveArtifactsListError(
								message.text?.trim() || "drive.artifacts.list failed",
								message.code,
							),
						);
						return;
					}
					const entries: DriveArtifactDirectoryEntry[] = [];
					for (const raw of message.artifacts ?? []) {
						const entry = artifactDirectoryEntryFromUnknown(raw);
						if (entry) {
							entries.push(entry);
						}
					}
					resolve(entries);
				},
			});

			postToHost({
				type: "drive_artifacts_list",
				requestId,
				workspaceRoot,
			});
		});
	}
}
