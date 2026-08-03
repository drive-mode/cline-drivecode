/**
 * CLI Drive room join/leave (Phase 4 parity). Local chrome still toggles
 * immediately; hub call_join is best-effort when a discovered hub is up.
 * Isolation must be available before teamOpt (fail closed here: single partner).
 */

import {
	ensureDetachedHubServer,
	NodeHubClient,
	readHubDiscovery,
	resolveSharedHubOwnerContext,
} from "@cline/core/hub";

export const CLI_DRIVE_DEFAULT_ROOM_ID = "default";
export const CLI_DRIVE_HUMAN_ID = "cli-human";
export const CLI_DRIVE_PARTNER_ID = "cli-partner";

export type CliDriveJoinResult =
	| { ok: true; roomId: string; via: "hub" | "local" }
	| { ok: false; error: string; via: "hub" | "local" };

/**
 * Whether multi-agent seating is allowed. teamOpt requires isolation.
 * CLI Phase 4 fails closed: teamOpt without isolation → false.
 */
export function canSeatAdditionalAgent(input: {
	teamOpt: boolean;
	isolationAvailable: boolean;
}): boolean {
	if (!input.teamOpt) {
		return false;
	}
	return input.isolationAvailable;
}

export async function joinCliDriveRoom(input?: {
	cwd?: string;
	roomId?: string;
	partnerName?: string;
	sessionId?: string;
}): Promise<CliDriveJoinResult> {
	const roomId = input?.roomId?.trim() || CLI_DRIVE_DEFAULT_ROOM_ID;
	const cwd = input?.cwd ?? process.cwd();
	try {
		const owner = resolveSharedHubOwnerContext(cwd);
		const discovery = await readHubDiscovery(owner.discoveryPath);
		let address = discovery?.url;
		if (!address) {
			const ensured = await ensureDetachedHubServer(cwd, {});
			address = ensured.url;
		}
		if (!address) {
			return {
				ok: false,
				error: "No hub address available for call_join.",
				via: "hub",
			};
		}
		const client = new NodeHubClient({
			url: address,
			clientType: "cli-drive",
			displayName: "Cline CLI Drive",
		});
		await client.connect();
		try {
			await client.command("call_join", {
				roomId,
				human: {
					id: CLI_DRIVE_HUMAN_ID,
					displayName: "You",
					role: "host",
				},
				agent: {
					id: CLI_DRIVE_PARTNER_ID,
					displayName: input?.partnerName?.trim() || "Cline",
					role: "partner",
				},
				sessionId: input?.sessionId,
				activateDrive: true,
			});
			return { ok: true, roomId, via: "hub" };
		} finally {
			await client.dispose();
		}
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
			via: "hub",
		};
	}
}

export async function leaveCliDriveRoom(input?: {
	cwd?: string;
	roomId?: string;
}): Promise<CliDriveJoinResult> {
	const roomId = input?.roomId?.trim() || CLI_DRIVE_DEFAULT_ROOM_ID;
	const cwd = input?.cwd ?? process.cwd();
	try {
		const owner = resolveSharedHubOwnerContext(cwd);
		const discovery = await readHubDiscovery(owner.discoveryPath);
		if (!discovery?.url) {
			return { ok: true, roomId, via: "local" };
		}
		const client = new NodeHubClient({
			url: discovery.url,
			clientType: "cli-drive",
			displayName: "Cline CLI Drive",
		});
		await client.connect();
		try {
			await client.command("call_leave", {
				roomId,
				participantId: CLI_DRIVE_HUMAN_ID,
			});
			return { ok: true, roomId, via: "hub" };
		} finally {
			await client.dispose();
		}
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
			via: "hub",
		};
	}
}
