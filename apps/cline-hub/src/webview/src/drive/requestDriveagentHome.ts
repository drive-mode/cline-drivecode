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
import type {
	DriveagentHomeListing,
	DriveagentHomeProjection,
} from "./driveagentHomeTypes";

export type {
	DriveagentHomeListing,
	DriveagentHomeProjection,
} from "./driveagentHomeTypes";

const HOME_TIMEOUT_MS = 3_000;

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

export function isHomeSection(value: unknown): value is {
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

export function isCompiledSection(
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

type HomeListReplyMessage = HostMessage & {
	type: "drive_agent_homes" | "drive_agent_home_error";
	requestId?: string;
	homes?: unknown;
	text?: string;
};

const HOME_LIST_REPLY_TYPES = [
	"drive_agent_homes",
	"drive_agent_home_error",
] as const;

function isHomeListReplyMessage(
	message: HostMessage,
): message is HomeListReplyMessage {
	return (
		(message.type === "drive_agent_homes" ||
			message.type === "drive_agent_home_error") &&
		isOptionalString(message.requestId) &&
		isOptionalString(message.text)
	);
}

/**
 * Parse a home listing.
 *
 * A row is kept on its slug alone: a home whose YAML stopped compiling still
 * exists on disk, and dropping it would make the directory quietly disagree
 * with the filesystem it is a view of.
 */
export function parseHomeListingPayload(
	value: unknown,
): DriveagentHomeListing[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const rows: DriveagentHomeListing[] = [];
	for (const entry of value) {
		if (!isRecord(entry) || typeof entry.slug !== "string" || !entry.slug) {
			continue;
		}
		rows.push({
			slug: entry.slug,
			tier: entry.tier === "user" ? "user" : "workspace",
			...(typeof entry.displayName === "string"
				? { displayName: entry.displayName }
				: {}),
			...(typeof entry.description === "string"
				? { description: entry.description }
				: {}),
			...(isStringArray(entry.skills) ? { skills: entry.skills } : {}),
			...(typeof entry.editable === "boolean"
				? { editable: entry.editable }
				: {}),
		});
	}
	return rows;
}

/** Request hub `drive_agent_home_list` for the agents directory. */
export function requestDriveagentHomeList(
	workspaceRoot: string,
	options?: { timeoutMs?: number },
): Promise<DriveagentHomeListing[]> {
	const timeoutMs = options?.timeoutMs ?? HOME_TIMEOUT_MS;
	const root = workspaceRoot.trim();
	if (!root) {
		return Promise.reject(new Error("workspaceRoot is required"));
	}

	const requestId = `drive-home-list-${Date.now()}-${Math.random().toString(36).slice(2)}`;

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error("drive_agent_home_list timed out"));
		}, timeoutMs);

		const unsubscribe = subscribeToHostMessages({
			types: HOME_LIST_REPLY_TYPES,
			guard: isHomeListReplyMessage,
			onMessage: (message) => {
				if (message.requestId !== requestId) {
					return;
				}
				clearTimeout(timer);
				unsubscribe();
				if (message.type === "drive_agent_home_error") {
					reject(
						new Error(message.text?.trim() || "drive_agent_home_list failed"),
					);
					return;
				}
				resolve(parseHomeListingPayload(message.homes));
			},
		});
		postToHost({
			type: "drive_agent_home_list",
			requestId,
			workspaceRoot: root,
		});
	});
}
