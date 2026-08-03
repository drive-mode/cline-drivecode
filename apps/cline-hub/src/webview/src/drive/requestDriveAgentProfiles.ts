/**
 * Webview bridge for the durable per-agent appearance map (DRV-AGENT-PROFILE).
 *
 * Both lanes resolve with the whole map, because both are answered by the same
 * hub read: a save that returned only the row it wrote would leave a second
 * browser stale until its next reload.
 */

import { type AgentProfile, AgentProfileSchema } from "@cline/shared";
import {
	type HostMessage,
	isOptionalString,
	subscribeToHostMessages,
} from "../lib/host-message-gateway";
import { postToHost } from "../vscode";

const PROFILES_TIMEOUT_MS = 4_000;

export type DriveAgentProfileDraft = Omit<AgentProfile, "id">;

type ProfilesReplyMessage = HostMessage & {
	type: "drive_agent_profiles" | "drive_agent_profiles_error";
	requestId?: string;
	profiles?: unknown;
	text?: string;
};

const PROFILES_REPLY_TYPES = [
	"drive_agent_profiles",
	"drive_agent_profiles_error",
] as const;

function isProfilesReplyMessage(
	message: HostMessage,
): message is ProfilesReplyMessage {
	return (
		(message.type === "drive_agent_profiles" ||
			message.type === "drive_agent_profiles_error") &&
		isOptionalString(message.requestId) &&
		isOptionalString(message.text)
	);
}

/**
 * Parse the wire payload back into profiles.
 *
 * The hub already sanitized; re-parsing here is not distrust of the hub but of
 * the shape, which crosses a `postMessage` boundary typed as `unknown`. A row
 * that fails is dropped rather than defaulted — an agent with no stored
 * appearance is not the same as an agent whose appearance failed to parse, and
 * only the first should fall through to the stable hash.
 */
export function parseAgentProfilesPayload(value: unknown): AgentProfile[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const profiles: AgentProfile[] = [];
	for (const entry of value) {
		const parsed = AgentProfileSchema.safeParse(entry);
		if (parsed.success) {
			profiles.push(parsed.data);
		}
	}
	return profiles;
}

function awaitProfilesReply(
	requestId: string,
	timeoutMs: number,
	label: string,
	send: () => void,
): Promise<AgentProfile[]> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error(`${label} timed out`));
		}, timeoutMs);

		const unsubscribe = subscribeToHostMessages({
			types: PROFILES_REPLY_TYPES,
			guard: isProfilesReplyMessage,
			onMessage: (message) => {
				if (message.requestId !== requestId) {
					return;
				}
				clearTimeout(timer);
				unsubscribe();
				if (message.type === "drive_agent_profiles_error") {
					reject(new Error(message.text?.trim() || `${label} failed`));
					return;
				}
				resolve(parseAgentProfilesPayload(message.profiles));
			},
		});
		send();
	});
}

function mintRequestId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Read every durably-styled agent for this workspace. */
export function requestDriveAgentProfiles(
	workspaceRoot: string,
	options?: { timeoutMs?: number },
): Promise<AgentProfile[]> {
	const root = workspaceRoot.trim();
	if (!root) {
		return Promise.reject(new Error("workspaceRoot is required"));
	}
	const requestId = mintRequestId("drive-profiles");
	return awaitProfilesReply(
		requestId,
		options?.timeoutMs ?? PROFILES_TIMEOUT_MS,
		"drive_agent_profiles_get",
		() => {
			postToHost({
				type: "drive_agent_profiles_get",
				requestId,
				workspaceRoot: root,
			});
		},
	);
}

/** Durably write one agent's appearance; resolves with the refreshed map. */
export function requestDriveAgentProfilePut(
	workspaceRoot: string,
	profile: DriveAgentProfileDraft,
	options?: { timeoutMs?: number },
): Promise<AgentProfile[]> {
	const root = workspaceRoot.trim();
	if (!root) {
		return Promise.reject(new Error("workspaceRoot is required"));
	}
	const requestId = mintRequestId("drive-profile-put");
	return awaitProfilesReply(
		requestId,
		options?.timeoutMs ?? PROFILES_TIMEOUT_MS,
		"drive_agent_profile_put",
		() => {
			postToHost({
				type: "drive_agent_profile_put",
				requestId,
				workspaceRoot: root,
				profile,
			});
		},
	);
}
