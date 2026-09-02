"use client";

/**
 * `DriveHubProvider` / `useDriveHub()` — one provider per Drive view.
 *
 * The provider subscribes to the source's hub events once, folds them into
 * `DriveRoomState`, asks `drive_hub_status` on mount and on transport
 * reconnect, retries an unreachable hub with backoff, and re-requests
 * `call_get_room` whenever the fold reports `needsResync`. Actions are thin
 * wrappers over the port: the hub stays the only writer.
 */

import type { DriveRoomDirectoryEntry } from "@cline/drive";
import type {
	AddressSet,
	DriveSubMode,
	StageSharer,
	StatusSummary,
} from "@cline/shared";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { desktopClient } from "@/lib/desktop-client";
import type { DesktopTransportState } from "@/lib/desktop-transport";
import {
	type DriveCallOp,
	type DriveCallReply,
	type DriveCommandErrorInfo,
	type DriveCommandPayload,
	parseDriveCommandError,
} from "./drive-client";
import {
	DRIVE_DEFAULT_ROOM_ID,
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
	isDriveHumanId,
} from "./drive-ids";
import type { DriveDataSource } from "./drive-source";
import {
	applyCallReply,
	applyDriveHubEvent,
	type DriveRoomState,
	markResyncRequested,
	resetDriveRoomState,
	selectCallLive,
} from "./room-state";

export type DrivePhase = "connecting" | "live" | "unreachable" | "demo";

export type DriveHubInfo = {
	url: string | null;
	error: string | null;
	workspaceRoot: string | null;
	/** The hub was live and the transport dropped; a retry is scheduled. */
	reconnecting: boolean;
	lastCheckedAt: string | null;
};

export type DriveStagePin = {
	kind: "selection" | "file" | "terminal";
	label: string;
	ref?: string;
};

export type DrivePresenterActions = {
	grant(agentId: string, durationMs?: number): Promise<boolean>;
	transfer(agentId: string, durationMs?: number): Promise<boolean>;
	revoke(): Promise<boolean>;
};

export type DriveHubContextValue = {
	phase: DrivePhase;
	hub: DriveHubInfo;
	source: DriveDataSource;
	room: DriveRoomState;
	roomId: string;
	callLive: boolean;
	humanParticipantId: string;
	rooms: DriveRoomDirectoryEntry[];
	roomsError: string | null;
	roomsLoading: boolean;
	statusSummary: StatusSummary | null;
	refreshRoom(): Promise<void>;
	refreshRooms(): Promise<void>;
	refreshSummary(): Promise<void>;
	/** Re-run the hub status check now (also resets the backoff). */
	retry(): Promise<void>;
	join(roomId?: string): Promise<boolean>;
	leave(): Promise<boolean>;
	end(): Promise<boolean>;
	setMode(subMode: DriveSubMode, driveActive?: boolean): Promise<boolean>;
	setAddress(addressSet: AddressSet): Promise<boolean>;
	setStage(
		sharer: StageSharer | null,
		pin?: DriveStagePin | null,
	): Promise<boolean>;
	raiseHand(raised: boolean): Promise<boolean>;
	mute(muted: boolean, participantId?: string): Promise<boolean>;
	presenter: DrivePresenterActions;
	lastError: DriveCommandErrorInfo | null;
	clearError(): void;
};

const DriveHubContext = createContext<DriveHubContextValue | null>(null);

const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;
const SUMMARY_DEBOUNCE_MS = 400;

const EMPTY_HUB_INFO: DriveHubInfo = {
	url: null,
	error: null,
	workspaceRoot: null,
	reconnecting: false,
	lastCheckedAt: null,
};

function isStatusSummary(value: unknown): value is StatusSummary {
	return (
		value !== null &&
		typeof value === "object" &&
		typeof (value as { total?: unknown }).total === "number" &&
		typeof (value as { byState?: unknown }).byState === "object"
	);
}

function isRoomDirectoryEntryArray(
	value: unknown,
): value is DriveRoomDirectoryEntry[] {
	return (
		Array.isArray(value) &&
		value.every(
			(entry) =>
				entry !== null &&
				typeof entry === "object" &&
				typeof (entry as { roomId?: unknown }).roomId === "string",
		)
	);
}

function humanIdFromReply(reply: DriveCallReply): string | null {
	const human = reply.snapshot.participants.find(
		(participant) => participant.kind === "human",
	);
	return human?.id ?? null;
}

export function DriveHubProvider({
	source,
	roomId: roomIdProp,
	children,
}: {
	source: DriveDataSource;
	roomId?: string | null;
	children: ReactNode;
}) {
	const roomId = roomIdProp?.trim() || DRIVE_DEFAULT_ROOM_ID;
	const [phase, setPhase] = useState<DrivePhase>("connecting");
	const [hub, setHub] = useState<DriveHubInfo>(EMPTY_HUB_INFO);
	const [room, setRoom] = useState<DriveRoomState>(() =>
		resetDriveRoomState(roomId),
	);
	const [rooms, setRooms] = useState<DriveRoomDirectoryEntry[]>([]);
	const [roomsError, setRoomsError] = useState<string | null>(null);
	const [roomsLoading, setRoomsLoading] = useState(false);
	const [statusSummary, setStatusSummary] = useState<StatusSummary | null>(
		null,
	);
	const [lastError, setLastError] = useState<DriveCommandErrorInfo | null>(
		null,
	);
	const [rememberedHumanId, setRememberedHumanId] = useState<string | null>(
		null,
	);

	const roomIdRef = useRef(roomId);
	roomIdRef.current = roomId;
	const phaseRef = useRef<DrivePhase>("connecting");
	phaseRef.current = phase;
	const workspaceRootRef = useRef<string | null>(null);
	const retryAttemptRef = useRef(0);
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const summaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const disposedRef = useRef(false);
	const checkingRef = useRef<Promise<void> | null>(null);
	// Bumped for every source; an in-flight hub check from the previous source
	// must not apply its result (phase, hub info) to the new one.
	const sourceGenerationRef = useRef(0);

	const clearRetry = useCallback(() => {
		if (retryTimerRef.current) {
			clearTimeout(retryTimerRef.current);
			retryTimerRef.current = null;
		}
	}, []);

	const failWith = useCallback((error: unknown) => {
		setLastError(parseDriveCommandError(error));
	}, []);

	const runCall = useCallback(
		async (
			op: DriveCallOp,
			payload: DriveCommandPayload = {},
			targetRoomId: string = roomIdRef.current,
		): Promise<DriveCallReply | null> => {
			try {
				const reply = await source.call(op, targetRoomId, payload);
				if (disposedRef.current) {
					return reply;
				}
				setRoom((previous) => applyCallReply(previous, reply));
				const humanId = humanIdFromReply(reply);
				if (humanId) {
					setRememberedHumanId(humanId);
				}
				return reply;
			} catch (error) {
				if (!disposedRef.current) {
					failWith(error);
				}
				return null;
			}
		},
		[failWith, source],
	);

	const refreshRoom = useCallback(async () => {
		try {
			const reply = await source.call("call_get_room", roomIdRef.current);
			if (disposedRef.current) {
				return;
			}
			setRoom((previous) => applyCallReply(previous, reply));
			const humanId = humanIdFromReply(reply);
			if (humanId) {
				setRememberedHumanId(humanId);
			}
		} catch {
			// A room that does not exist yet is not an error worth a banner;
			// the next join creates it.
		}
	}, [source]);

	const refreshRooms = useCallback(async () => {
		setRoomsLoading(true);
		try {
			const reply = await source.listRooms(
				workspaceRootRef.current ?? undefined,
			);
			if (disposedRef.current) {
				return;
			}
			setRooms(isRoomDirectoryEntryArray(reply?.rooms) ? reply.rooms : []);
			setRoomsError(null);
		} catch (error) {
			if (!disposedRef.current) {
				setRoomsError(parseDriveCommandError(error).text);
			}
		} finally {
			if (!disposedRef.current) {
				setRoomsLoading(false);
			}
		}
	}, [source]);

	const refreshSummary = useCallback(async () => {
		try {
			const reply = await source.status<{ summary?: unknown }>("summary");
			if (disposedRef.current) {
				return;
			}
			setStatusSummary(isStatusSummary(reply?.summary) ? reply.summary : null);
		} catch {
			// Status Hub may not be provisioned; the section reports that itself.
		}
	}, [source]);

	const scheduleRetry = useCallback(
		(check: () => Promise<void>) => {
			clearRetry();
			const attempt = retryAttemptRef.current;
			const delayMs = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
			retryAttemptRef.current = attempt + 1;
			retryTimerRef.current = setTimeout(() => {
				retryTimerRef.current = null;
				void check();
			}, delayMs);
		},
		[clearRetry],
	);

	const checkHub = useCallback(async (): Promise<void> => {
		if (checkingRef.current) {
			return checkingRef.current;
		}
		const generation = sourceGenerationRef.current;
		const stale = () =>
			disposedRef.current || generation !== sourceGenerationRef.current;
		const run = (async () => {
			const checkedAt = new Date().toISOString();
			try {
				const status = await source.hubStatus();
				if (stale()) {
					return;
				}
				workspaceRootRef.current = status.workspaceRoot?.trim() || null;
				if (status.connected) {
					retryAttemptRef.current = 0;
					clearRetry();
					setHub({
						url: status.url,
						error: null,
						workspaceRoot: workspaceRootRef.current,
						reconnecting: false,
						lastCheckedAt: checkedAt,
					});
					setPhase(source.kind === "demo" ? "demo" : "live");
					await Promise.all([refreshRoom(), refreshRooms(), refreshSummary()]);
					return;
				}
				setHub({
					url: status.url,
					error: status.error ?? "Cline Hub is not connected.",
					workspaceRoot: workspaceRootRef.current,
					reconnecting: phaseRef.current === "live",
					lastCheckedAt: checkedAt,
				});
				setPhase("unreachable");
				scheduleRetry(checkHub);
			} catch (error) {
				if (stale()) {
					return;
				}
				setHub((previous) => ({
					...previous,
					error: parseDriveCommandError(error).text,
					reconnecting: phaseRef.current === "live",
					lastCheckedAt: checkedAt,
				}));
				setPhase("unreachable");
				scheduleRetry(checkHub);
			}
		})().finally(() => {
			checkingRef.current = null;
		});
		checkingRef.current = run;
		return run;
	}, [
		clearRetry,
		refreshRoom,
		refreshRooms,
		refreshSummary,
		scheduleRetry,
		source,
	]);

	// One subscription per source; folds every broadcast into room state.
	useEffect(() => {
		disposedRef.current = false;
		retryAttemptRef.current = 0;
		sourceGenerationRef.current += 1;
		checkingRef.current = null;
		workspaceRootRef.current = null;
		setRememberedHumanId(null);
		setPhase("connecting");
		setHub(EMPTY_HUB_INFO);
		setRoom(resetDriveRoomState(roomIdRef.current));
		setRooms([]);
		setRoomsError(null);
		setStatusSummary(null);
		setLastError(null);
		const unsubscribe = source.subscribe((event) => {
			if (disposedRef.current) {
				return;
			}
			if (event.event === "status.updated") {
				if (summaryTimerRef.current) {
					clearTimeout(summaryTimerRef.current);
				}
				summaryTimerRef.current = setTimeout(() => {
					summaryTimerRef.current = null;
					void refreshSummary();
				}, SUMMARY_DEBOUNCE_MS);
				return;
			}
			setRoom((previous) => applyDriveHubEvent(previous, event));
		});
		void checkHub();
		return () => {
			disposedRef.current = true;
			unsubscribe();
			clearRetry();
			if (summaryTimerRef.current) {
				clearTimeout(summaryTimerRef.current);
				summaryTimerRef.current = null;
			}
		};
	}, [checkHub, clearRetry, refreshSummary, source]);

	// The hub lives behind the desktop transport: re-check on reconnect.
	useEffect(() => {
		if (source.kind !== "hub") {
			return;
		}
		let previous: DesktopTransportState | null = null;
		return desktopClient.subscribeTransportState((state) => {
			const wasConnected = previous === "connected";
			previous = state;
			if (state === "connected" && !wasConnected && previous !== null) {
				retryAttemptRef.current = 0;
				void checkHub();
				return;
			}
			if (
				(state === "reconnecting" || state === "unavailable") &&
				phaseRef.current === "live"
			) {
				setHub((current) => ({
					...current,
					reconnecting: true,
					error: desktopClient.getTransportError() ?? current.error,
				}));
			}
		});
	}, [checkHub, source]);

	// Switching rooms rebinds the fold; the next call reply fills it.
	useEffect(() => {
		setRoom((previous) =>
			previous.roomId === roomId ? previous : resetDriveRoomState(roomId),
		);
		if (phaseRef.current === "live" || phaseRef.current === "demo") {
			void refreshRoom();
		}
	}, [refreshRoom, roomId]);

	// The fold fell behind: ask the hub for the whole room again.
	useEffect(() => {
		if (!room.needsResync) {
			return;
		}
		setRoom(markResyncRequested);
		void refreshRoom();
	}, [refreshRoom, room.needsResync]);

	const humanParticipantId = useMemo(() => {
		const seated = room.snapshot?.participants.find(
			(participant) => participant.kind === "human",
		);
		return seated?.id ?? rememberedHumanId ?? DRIVE_PARTICIPANT_HUMAN;
	}, [rememberedHumanId, room.snapshot]);

	const retry = useCallback(async () => {
		retryAttemptRef.current = 0;
		clearRetry();
		setLastError(null);
		await checkHub();
	}, [checkHub, clearRetry]);

	const join = useCallback(
		async (targetRoomId?: string) => {
			const target = targetRoomId?.trim() || roomIdRef.current;
			const humanId = isDriveHumanId(humanParticipantId)
				? humanParticipantId
				: DRIVE_PARTICIPANT_HUMAN;
			const reply = await runCall(
				"call_join",
				{
					human: { id: humanId, displayName: "You", role: "host" },
					agent: {
						id: DRIVE_PARTICIPANT_PARTNER,
						displayName: "Cline",
						role: "partner",
					},
					activateDrive: true,
					...(workspaceRootRef.current
						? { workspaceRoot: workspaceRootRef.current }
						: {}),
				},
				target,
			);
			if (reply) {
				void refreshRooms();
			}
			return reply !== null;
		},
		[humanParticipantId, refreshRooms, runCall],
	);

	const leave = useCallback(async () => {
		const reply = await runCall("call_leave", {
			participantId: humanParticipantId,
		});
		if (reply) {
			void refreshRooms();
		}
		return reply !== null;
	}, [humanParticipantId, refreshRooms, runCall]);

	const end = useCallback(async () => {
		const reply = await runCall("call_end", {
			actorId: humanParticipantId,
			...(workspaceRootRef.current
				? { workspaceRoot: workspaceRootRef.current }
				: {}),
		});
		if (reply) {
			void refreshRooms();
		}
		return reply !== null;
	}, [humanParticipantId, refreshRooms, runCall]);

	const setMode = useCallback(
		async (subMode: DriveSubMode, driveActive?: boolean) =>
			(await runCall("call_set_mode", {
				subMode,
				...(driveActive !== undefined ? { driveActive } : {}),
			})) !== null,
		[runCall],
	);

	const setAddress = useCallback(
		async (addressSet: AddressSet) =>
			(await runCall("call_set_address", { addressSet })) !== null,
		[runCall],
	);

	const setStage = useCallback(
		async (sharer: StageSharer | null, pin?: DriveStagePin | null) =>
			(await runCall("call_set_stage", {
				sharer,
				...(pin !== undefined ? { pin } : {}),
			})) !== null,
		[runCall],
	);

	const raiseHand = useCallback(
		async (raised: boolean) =>
			(await runCall("call_raise_hand", {
				participantId: humanParticipantId,
				raised,
			})) !== null,
		[humanParticipantId, runCall],
	);

	const mute = useCallback(
		async (muted: boolean, participantId?: string) =>
			(await runCall("call_mute", {
				participantId: participantId ?? humanParticipantId,
				muted,
			})) !== null,
		[humanParticipantId, runCall],
	);

	const runPresenter = useCallback(
		async (
			command:
				| "drive.presenter.grant"
				| "drive.presenter.transfer"
				| "drive.presenter.revoke",
			payload: DriveCommandPayload,
		) => {
			try {
				const reply = await source.command<{
					snapshot?: unknown;
					seq?: number;
				}>(command, { roomId: roomIdRef.current, ...payload });
				if (disposedRef.current) {
					return true;
				}
				if (reply?.snapshot) {
					setRoom((previous) =>
						applyCallReply(previous, {
							roomId: roomIdRef.current,
							snapshot: reply.snapshot as DriveCallReply["snapshot"],
							...(typeof reply.seq === "number" ? { seq: reply.seq } : {}),
						}),
					);
				}
				return true;
			} catch (error) {
				if (!disposedRef.current) {
					failWith(error);
				}
				return false;
			}
		},
		[failWith, source],
	);

	const presenter = useMemo<DrivePresenterActions>(
		() => ({
			grant: (agentId, durationMs) =>
				runPresenter("drive.presenter.grant", {
					agentId,
					...(durationMs ? { durationMs } : {}),
				}),
			transfer: (agentId, durationMs) =>
				runPresenter("drive.presenter.transfer", {
					agentId,
					...(durationMs ? { durationMs } : {}),
				}),
			revoke: () => runPresenter("drive.presenter.revoke", {}),
		}),
		[runPresenter],
	);

	const clearError = useCallback(() => setLastError(null), []);

	const value = useMemo<DriveHubContextValue>(
		() => ({
			phase,
			hub,
			source,
			room,
			roomId,
			callLive: selectCallLive(room),
			humanParticipantId,
			rooms,
			roomsError,
			roomsLoading,
			statusSummary,
			refreshRoom,
			refreshRooms,
			refreshSummary,
			retry,
			join,
			leave,
			end,
			setMode,
			setAddress,
			setStage,
			raiseHand,
			mute,
			presenter,
			lastError,
			clearError,
		}),
		[
			clearError,
			end,
			hub,
			humanParticipantId,
			join,
			lastError,
			leave,
			mute,
			phase,
			presenter,
			raiseHand,
			refreshRoom,
			refreshRooms,
			refreshSummary,
			retry,
			room,
			roomId,
			rooms,
			roomsError,
			roomsLoading,
			setAddress,
			setMode,
			setStage,
			source,
			statusSummary,
		],
	);

	return (
		<DriveHubContext.Provider value={value}>
			{children}
		</DriveHubContext.Provider>
	);
}

/** Null outside a `DriveHubProvider` — for chrome that is always mounted. */
export function useOptionalDriveHub(): DriveHubContextValue | null {
	return useContext(DriveHubContext);
}

export function useDriveHub(): DriveHubContextValue {
	const value = useContext(DriveHubContext);
	if (!value) {
		throw new Error("useDriveHub must be used inside a DriveHubProvider");
	}
	return value;
}
