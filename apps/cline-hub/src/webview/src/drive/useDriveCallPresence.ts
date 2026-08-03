/**
 * Route-independent, read-only view of the Drive call (DRV-PIP prerequisite).
 *
 * `useDriveSession` has one call site — inside `Chat` — so leaving the call
 * route unmounts it and destroys every consumer of `driveSession`. Mounting
 * this hook in the app shell keeps call presence readable from any view.
 *
 * It is a second READER, never a second writer (ADR-0006): it seeds from the
 * driveUi state `useDriveSession` persists, folds the broadcasts the hub sends
 * every peer, and issues no ops beyond a single idempotent `call_get_room`
 * when it rehydrates an active call it has no snapshot for. No gap fill, no
 * optimistic updates — the hub stays authoritative and both readers converge.
 */

import { useEffect, useRef, useState } from "react";
import { subscribeToHostMessages } from "../lib/host-message-gateway";
import { getVsCodeApi, postToHost } from "../vscode";
import {
	DRIVE_CALL_PRESENCE_MESSAGE_TYPES,
	type DriveCallPresence,
	foldDriveCallPresence,
	IDLE_DRIVE_CALL_PRESENCE,
	type PersistedDrivePresenceSeed,
	seedDriveCallPresence,
} from "./driveCallPresence";
import {
	isDriveSessionHostMessage,
	resolveDriveTargetRoomId,
} from "./driveSessionPolicy";

function readSeedPresence(): DriveCallPresence {
	try {
		const state = getVsCodeApi()?.getState() as
			| { driveUi?: Partial<PersistedDrivePresenceSeed> }
			| undefined;
		return seedDriveCallPresence(state?.driveUi);
	} catch {
		return IDLE_DRIVE_CALL_PRESENCE;
	}
}

export function useDriveCallPresence(): DriveCallPresence {
	const [presence, setPresence] = useState<DriveCallPresence>(readSeedPresence);
	/**
	 * The seed, held only until the one allowed read is spent. Clearing it in
	 * the effect — rather than tracking a boolean — makes "at most one
	 * `call_get_room`" true even under StrictMode's mount/unmount/mount.
	 */
	const unspentSeedRef = useRef<DriveCallPresence | null>(presence);

	useEffect(
		() =>
			subscribeToHostMessages({
				types: DRIVE_CALL_PRESENCE_MESSAGE_TYPES,
				guard: isDriveSessionHostMessage,
				onMessage: (message) => {
					setPresence((current) => foldDriveCallPresence(current, message));
				},
			}),
		[],
	);

	useEffect(() => {
		// One read on mount, and only when persisted state claims a live call this
		// reader has no snapshot for. `call_get_room` is idempotent and carries no
		// afterSeq cursor: gap fill belongs to the writer, not to this reader.
		const seeded = unspentSeedRef.current;
		unspentSeedRef.current = null;
		if (!seeded?.active) {
			return;
		}
		postToHost({
			type: "call_get_room",
			roomId: resolveDriveTargetRoomId({ currentRoomId: seeded.roomId }),
		});
	}, []);

	return presence;
}
