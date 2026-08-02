/**
 * Rooms — every Drive session, resumable.
 *
 * One card per room in the durable log (ADR-0013 lane 1). Stopping a room
 * closes the call and assembles a handoff; it does not delete anything, so
 * the card stays here with its configuration and stage history and Start
 * picks it back up. That is the whole point of the surface: stop ≠ lose.
 *
 * The directory is read-only. Stop routes to `call_end` and Start to the
 * normal join flow, so the hub remains the single writer of room state.
 */

import type { DriveRoomDirectoryEntry, DriveRoomStatus } from "@cline/drive";
import { DoorOpenIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DriveRoomsSource } from "../../rooms/drive-rooms-source";
import {
	endedRoomEntry,
	type RoomCardModel,
	roomCardModel,
} from "../../rooms/roomCardModel";
import { PageEmptyState, PageFrame, PageHeader } from "./page-layout";

/** Live borrows the Status Hub's "running" ink; stopped rooms stay quiet. */
const STATUS_STYLES: Record<DriveRoomStatus, string> = {
	live: "border-primary/40 text-primary",
	paused: "border-amber-500/50 text-amber-600 dark:text-amber-400",
	ended: "border-border text-muted-foreground",
};

const DOT_STYLES: Record<DriveRoomStatus, string> = {
	live: "bg-primary",
	paused: "bg-amber-500",
	ended: "bg-muted-foreground/50",
};

function RoomCard({
	card,
	onOpen,
	onStop,
	stopping,
}: {
	card: RoomCardModel;
	onOpen: (roomId: string) => void;
	onStop: (roomId: string) => void;
	stopping: boolean;
}) {
	return (
		<li
			className={cn(
				"flex min-w-0 items-center gap-3 rounded-lg border bg-card px-4 py-3",
				card.status === "live" && "border-primary/40",
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"size-2.5 shrink-0 rounded-full",
					DOT_STYLES[card.status],
				)}
			/>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate text-sm font-semibold text-foreground">
						{card.roomId}
					</span>
					<Badge
						className={cn("shrink-0 text-[10px]", STATUS_STYLES[card.status])}
						variant="outline"
					>
						{card.statusLabel}
					</Badge>
				</div>
				<div className="mt-1 truncate text-xs text-muted-foreground">
					{card.meta}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<Button
					onClick={() => onOpen(card.roomId)}
					size="sm"
					type="button"
					variant={card.primaryAction === "start" ? "default" : "outline"}
				>
					{card.primaryAction === "start" ? "Start" : "Open"}
				</Button>
				{card.canStop ? (
					<Button
						className="text-destructive hover:text-destructive"
						disabled={stopping}
						onClick={() => onStop(card.roomId)}
						size="sm"
						type="button"
						variant="outline"
					>
						Stop
					</Button>
				) : null}
			</div>
		</li>
	);
}

export function RoomsView({
	onOpenRoom,
	roomsSource,
	workspaceRoot,
}: {
	/** Join or rejoin the room — the same flow the Drive page uses. */
	onOpenRoom: (roomId: string) => void;
	roomsSource: DriveRoomsSource;
	/**
	 * Where the durable room log lives. The hub reports it asynchronously, so
	 * this is often undefined on the first render — listing again when it
	 * arrives is what stops the page sitting on an empty, unbound directory.
	 */
	workspaceRoot?: string;
}) {
	const [entries, setEntries] = useState<DriveRoomDirectoryEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [stoppingRoomId, setStoppingRoomId] = useState<string | null>(null);
	/** Workspace the rooms on screen were listed for. */
	const loadedRootRef = useRef<string | undefined>(undefined);
	/**
	 * Newest list request. A list issued for one workspace can still be in
	 * flight when the workspace changes, and its late reply would otherwise
	 * paint the previous project's rooms over the current one — the same
	 * cross-workspace bleed the directory fix removed, arriving as a race.
	 * Only the newest request may write.
	 */
	const requestSeqRef = useRef(0);

	const refresh = useCallback(async () => {
		const seq = ++requestSeqRef.current;
		const requestedRoot = workspaceRoot;
		setLoading(true);
		// Rooms belong to the workspace they were listed for. Drop them the
		// moment the workspace changes, so a slow or failing list can never
		// leave another project's rooms on screen.
		if (loadedRootRef.current !== requestedRoot) {
			setEntries([]);
		}
		try {
			const listed = await roomsSource.listRooms(requestedRoot);
			if (seq !== requestSeqRef.current) {
				return;
			}
			loadedRootRef.current = requestedRoot;
			setEntries(listed);
			setError(null);
		} catch (cause) {
			if (seq !== requestSeqRef.current) {
				return;
			}
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			// A superseded request must not clear the newer one's spinner.
			if (seq === requestSeqRef.current) {
				setLoading(false);
			}
		}
	}, [roomsSource, workspaceRoot]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const stopRoom = useCallback(
		async (roomId: string) => {
			setStoppingRoomId(roomId);
			try {
				await roomsSource.stopRoom(roomId, workspaceRoot);
				setStoppingRoomId(null);
				// The hub has confirmed this room ended. Land that before
				// re-listing: a stop that succeeds and a refresh that fails are
				// separate facts, and the card must not go on offering Stop for a
				// room we know is closed.
				setEntries((current) =>
					current.map((entry) =>
						entry.roomId === roomId ? endedRoomEntry(entry) : entry,
					),
				);
				// refresh() clears the error banner on success.
				await refresh();
			} catch (cause) {
				setStoppingRoomId(null);
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		},
		[refresh, roomsSource, workspaceRoot],
	);

	const cards = useMemo(
		() => entries.map((entry) => roomCardModel(entry)),
		[entries],
	);
	const liveCount = cards.filter((card) => card.status === "live").length;

	return (
		<PageFrame>
			<PageHeader
				description="Every Drive session you have run, resumable. Stopping a room ends the call and saves a handoff — its configuration and history stay put, so Start picks up where you left off."
				icon={DoorOpenIcon}
				meta={
					cards.length > 0 ? (
						<Badge className="text-[10px]" variant="outline">
							{liveCount} live / {cards.length}
						</Badge>
					) : null
				}
				title="Rooms"
				actions={
					<Button
						disabled={loading}
						onClick={() => {
							void refresh();
						}}
						size="sm"
						type="button"
						variant="outline"
					>
						<RefreshCwIcon
							className={cn("size-3.5", loading && "animate-spin")}
						/>
						Refresh
					</Button>
				}
			/>

			{error ? (
				<PageEmptyState className="mb-4 border-destructive/40 text-destructive">
					Could not load rooms: {error}
				</PageEmptyState>
			) : null}

			{cards.length === 0 && !loading && !error ? (
				<PageEmptyState>
					No rooms yet. Start a Drive call and it will show up here — and stay
					here after you stop it.
				</PageEmptyState>
			) : (
				// 24rem keeps name + status + meta + both buttons on one row; below
				// that the grid drops to a single column rather than truncating.
				<ul className="grid list-none gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(24rem,1fr))]">
					{cards.map((card) => (
						<RoomCard
							card={card}
							key={card.roomId}
							onOpen={onOpenRoom}
							onStop={(roomId) => {
								void stopRoom(roomId);
							}}
							stopping={stoppingRoomId === card.roomId}
						/>
					))}
				</ul>
			)}
		</PageFrame>
	);
}
