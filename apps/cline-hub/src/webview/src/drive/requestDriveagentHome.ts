/** Webview bridge for hub `drive_agent_home_get` (DRV-DRIVEAGENT-HOME). */

import {
	type HostMessage,
	isOptionalString,
	isOptionalStringArray,
	isRecord,
	isStringArray,
	subscribeToHostMessages,
} from "../lib/host-message-gateway";
import { postToHost } from "../vscode";

const HOME_TIMEOUT_MS = 3_000;

export type DriveagentHomeProjection = {
	slug: string;
	agent: {
		name: string;
		description: string;
		tools?: string[];
		skills?: string[];
		editable?: boolean;
	};
	permissions: {
		presetIntent: "readonly" | "standard" | "full";
		approvalHooks: string[];
		notes?: string;
	};
	compiled: {
		name: string;
		slug: string;
		description: string;
		tools?: string[];
		skills?: string[];
	};
};

type HomeReplyMessage = HostMessage & {
	type: "drive_agent_home" | "drive_agent_home_error";
	requestId?: string;
	home?: unknown;
	compiled?: unknown;
	text?: string;
};

const HOME_REPLY_TYPES = [
	"drive_agent_home",
	"drive_agent_home_error",
] as const;

function isHomeReplyMessage(message: HostMessage): message is HomeReplyMessage {
	return (
		(message.type === "drive_agent_home" ||
			message.type === "drive_agent_home_error") &&
		isOptionalString(message.requestId) &&
		isOptionalString(message.text)
	);
}

function isHomeAgent(
	value: unknown,
): value is DriveagentHomeProjection["agent"] {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		typeof value.description === "string" &&
		isOptionalStringArray(value.tools) &&
		isOptionalStringArray(value.skills) &&
		(value.editable === undefined || typeof value.editable === "boolean")
	);
}

function isHomePermissions(
	value: unknown,
): value is DriveagentHomeProjection["permissions"] {
	return (
		isRecord(value) &&
		(value.presetIntent === "readonly" ||
			value.presetIntent === "standard" ||
			value.presetIntent === "full") &&
		isStringArray(value.approvalHooks) &&
		isOptionalString(value.notes)
	);
}

function isHomeSection(value: unknown): value is {
	slug: string;
	agent: DriveagentHomeProjection["agent"];
	permissions: DriveagentHomeProjection["permissions"];
} {
	return (
		isRecord(value) &&
		typeof value.slug === "string" &&
		isHomeAgent(value.agent) &&
		isHomePermissions(value.permissions)
	);
}

function isCompiledSection(
	value: unknown,
): value is DriveagentHomeProjection["compiled"] {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		typeof value.slug === "string" &&
		typeof value.description === "string" &&
		isOptionalStringArray(value.tools) &&
		isOptionalStringArray(value.skills)
	);
}

/**
 * Request hub `drive_agent_home_get` and resolve with a prompt-stripped home.
 * Rejects on error reply or timeout (~3s).
 */
export function requestDriveagentHome(
	workspaceRoot: string,
	slug: string,
	options?: { timeoutMs?: number },
): Promise<DriveagentHomeProjection> {
	const timeoutMs = options?.timeoutMs ?? HOME_TIMEOUT_MS;
	const root = workspaceRoot.trim();
	const homeSlug = slug.trim();
	if (!root) {
		return Promise.reject(new Error("workspaceRoot is required"));
	}
	if (!homeSlug) {
		return Promise.reject(new Error("slug is required"));
	}

	const requestId = `drive-home-${Date.now()}-${Math.random().toString(36).slice(2)}`;

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error("drive_agent_home_get timed out"));
		}, timeoutMs);

		const unsubscribe = subscribeToHostMessages({
			types: HOME_REPLY_TYPES,
			guard: isHomeReplyMessage,
			onMessage: (message) => {
				if (message.requestId !== requestId) {
					return;
				}
				clearTimeout(timer);
				unsubscribe();
				if (message.type === "drive_agent_home_error") {
					reject(
						new Error(message.text?.trim() || "drive_agent_home_get failed"),
					);
					return;
				}
				if (
					!isHomeSection(message.home) ||
					!isCompiledSection(message.compiled)
				) {
					reject(
						new Error("drive_agent_home missing or malformed home/compiled"),
					);
					return;
				}
				resolve({
					slug: message.home.slug,
					agent: message.home.agent,
					permissions: message.home.permissions,
					compiled: message.compiled,
				});
			},
		});
		postToHost({
			type: "drive_agent_home_get",
			requestId,
			workspaceRoot: root,
			slug: homeSlug,
		});
	});
}
