import type { DriveRoomDirectoryEntry } from "@cline/drive";

/**
 * Port for the Rooms page. Live hub or demo adapter — the view must not read
 * CLINE_DEMO_* or query params itself (same rule as the Status Hub sources;
 * the composition root decides which adapter it gets).
 *
 * The workspace root is passed per call rather than captured at construction.
 * The hub learns it asynchronously, so a source that closed over it would
 * either bind whatever was known at mount — listing against no durable log and
 * never retrying — or need a new identity whenever it changed, which makes the
 * page reload on every hub broadcast. Passing it in keeps the source stable and
 * lets the view re-list on the value.
 *
 * Only `stopRoom` writes, and it writes by asking the hub to end the call —
 * the hub stays the single writer of room state (ADR-0000 D2).
 */
export interface DriveRoomsSource {
	listRooms(workspaceRoot?: string): Promise<DriveRoomDirectoryEntry[]>;
	/** End the live call. Keeps the room, its config and its history. */
	stopRoom(roomId: string, workspaceRoot?: string): Promise<void>;
}
