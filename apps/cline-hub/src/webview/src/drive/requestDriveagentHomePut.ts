/** Webview bridge for hub `drive_agent_home_put` (DRV-DRIVEAGENT-HOME). */

import type { DriveagentHomePatch } from "@cline/drive";
import {
	type HostMessage,
	isOptionalString,
	subscribeToHostMessages,
} from "../lib/host-message-gateway";
import { postToHost } from "../vscode";
import {
	type DriveagentHomeProjection,
	isCompiledSection,
	isHomeSection,
} from "./requestDriveagentHome";

const SAVE_TIMEOUT_MS = 5_000;

export type DriveagentHomeTier = "workspace" | "user";

export type DriveagentHomeSaveResult = DriveagentHomeProjection & {
	/** `user` means the write applies to every workspace on the machine. */
	tier: DriveagentHomeTier;
};

type SaveReplyMessage = HostMessage & {
	type: "drive_agent_home_saved" | "drive_agent_home_error";
	requestId?: string;
	home?: unknown;
	compiled?: unknown;
	tier?: unknown;
	text?: string;
};

const SAVE_REPLY_TYPES = [
	"drive_agent_home_saved",
	"drive_agent_home_error",
] as const;

function isSaveReplyMessage(message: HostMessage): message is SaveReplyMessage {
	return (
		(message.type === "drive_agent_home_saved" ||
			message.type === "drive_agent_home_error") &&
		isOptionalString(message.requestId) &&
		isOptionalString(message.text)
	);
}

/**
 * Save a Driveagent home patch and resolve with the re-sanitized home.
 *
 * `patch` carries only the fields the read path showed. Omitting a field means
 * "leave it alone" — the hub merges against the file on disk, so the prompt
 * this projection never contained is preserved rather than cleared.
 */
export function requestDriveagentHomePut(
	workspaceRoot: string,
	slug: string,
	patch: DriveagentHomePatch,
	options?: { timeoutMs?: number },
): Promise<DriveagentHomeSaveResult> {
	const timeoutMs = options?.timeoutMs ?? SAVE_TIMEOUT_MS;
	const root = workspaceRoot.trim();
	const homeSlug = slug.trim();
	if (!root) {
		return Promise.reject(new Error("workspaceRoot is required"));
	}
	if (!homeSlug) {
		return Promise.reject(new Error("slug is required"));
	}

	const requestId = `drive-home-put-${Date.now()}-${Math.random().toString(36).slice(2)}`;

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error("drive_agent_home_put timed out"));
		}, timeoutMs);

		const unsubscribe = subscribeToHostMessages({
			types: SAVE_REPLY_TYPES,
			guard: isSaveReplyMessage,
			onMessage: (message) => {
				if (message.requestId !== requestId) {
					return;
				}
				clearTimeout(timer);
				unsubscribe();
				if (message.type === "drive_agent_home_error") {
					reject(
						new Error(message.text?.trim() || "drive_agent_home_put failed"),
					);
					return;
				}
				if (
					!isHomeSection(message.home) ||
					!isCompiledSection(message.compiled)
				) {
					reject(
						new Error(
							"drive_agent_home_saved missing or malformed home/compiled",
						),
					);
					return;
				}
				resolve({
					slug: message.home.slug,
					agent: message.home.agent,
					permissions: message.home.permissions,
					compiled: message.compiled,
					tier: message.tier === "user" ? "user" : "workspace",
				});
			},
		});
		postToHost({
			type: "drive_agent_home_put",
			requestId,
			workspaceRoot: root,
			slug: homeSlug,
			patch,
		});
	});
}
