import { describe, expect, it } from "vitest";
import {
	DRIVE_ROOM_HUB_UNREACHABLE_MESSAGE,
	isDriveTransportErrorMessage,
} from "./driveRoomPreview";

// Covers the "no hub reachable" fix for the Drive home view: without a
// listener for the transport's own `{ type: "error" }` message, the room
// preview card stayed on "Checking…" forever whenever the hub never
// answered `call_get_room` (see drive-view.tsx's bounded-wait effect, which
// falls back to this same copy on timeout).

describe("isDriveTransportErrorMessage", () => {
	it("recognizes the webview transport's own connectivity-failure text", () => {
		expect(
			isDriveTransportErrorMessage({
				type: "error",
				text: "Failed to connect to the Cline Hub server.",
			}),
		).toBe(true);
		expect(
			isDriveTransportErrorMessage({
				type: "error",
				text: "Received an invalid message from the Cline Hub server.",
			}),
		).toBe(true);
	});

	it("does not mistake a hub-answered call_error for a transport error", () => {
		expect(
			isDriveTransportErrorMessage({
				type: "call_error",
				command: "call_get_room",
				text: "boom",
			}),
		).toBe(false);
	});

	it("does not mistake other host messages for a transport error", () => {
		expect(isDriveTransportErrorMessage({ type: "status" })).toBe(false);
		expect(isDriveTransportErrorMessage({ type: "room_snapshot" })).toBe(false);
		expect(isDriveTransportErrorMessage({ type: "room_not_found" })).toBe(
			false,
		);
	});

	it("does not mistake an unrelated `error` message from another feature for a transport failure", () => {
		// `{ type: "error" }` is a shared channel other server features reuse
		// for their own failures (see e.g. drive-mute-gate.ts, sessions.ts,
		// drive-commands.ts) — none of these mean the hub itself is down.
		expect(
			isDriveTransportErrorMessage({
				type: "error",
				text: "Mic is muted. Unmute on the call strip before sending spoken input.",
			}),
		).toBe(false);
		expect(
			isDriveTransportErrorMessage({
				type: "error",
				text: "No active session to restore.",
			}),
		).toBe(false);
		expect(
			isDriveTransportErrorMessage({
				type: "error",
				text: "Hub UI client is not connected.",
			}),
		).toBe(false);
		expect(isDriveTransportErrorMessage({ type: "error" })).toBe(false);
	});
});

describe("DRIVE_ROOM_HUB_UNREACHABLE_MESSAGE", () => {
	it("matches the house copy useDriveSession.ts uses for the same condition", () => {
		// "Hub is down." is the string useDriveSession.ts uses when an active
		// call's hub disconnects (hub_disconnected / version_skew) — reusing it
		// here keeps both surfaces speaking about one underlying condition.
		expect(DRIVE_ROOM_HUB_UNREACHABLE_MESSAGE).toMatch(/^Hub is down\./);
		expect(DRIVE_ROOM_HUB_UNREACHABLE_MESSAGE).not.toMatch(/sorry|oops/i);
	});

	it("says what it means for the room preview, not 'Join again' (nothing joined yet)", () => {
		expect(DRIVE_ROOM_HUB_UNREACHABLE_MESSAGE).toContain(
			"Could not check the Pairing room",
		);
		expect(DRIVE_ROOM_HUB_UNREACHABLE_MESSAGE).not.toMatch(/join again/i);
	});
});
