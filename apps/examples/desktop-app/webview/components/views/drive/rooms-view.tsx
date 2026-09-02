"use client";

/**
 * Rooms — every Drive session this workspace has opened, resumable.
 *
 * One card per room in the durable log (ADR-0013 lane 1). Stopping a room
 * closes the call and assembles a handoff; it does not delete anything, so
 * the card stays with its configuration and stage history and Start picks
 * it back up. That is the whole point of the surface: stop ≠ lose.
 *
 * The directory is read-only. Stop routes to `call_end` and Open / Start to
 * the normal join flow, so the hub remains the single writer of room state.
 */

import type { DriveRoomStatus } from "@cline/drive";
import {
	ArrowUpDown,
	Bot,
	DoorOpen,
	LayoutGrid,
	Loader2,
	PhoneCall,
	RefreshCw,
	Rows3,
	Search,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	PageEmptyState,
	PageFrame,
	PageHeader,
} from "@/components/views/page-layout";
import { parseDriveCommandError } from "@/lib/drive/drive-client";
import { useDrivePrefs } from "@/lib/drive/drive-prefs";
import type { DriveSection } from "@/lib/drive/drive-section";
import {
	applyEndedOverrides,
	countRoomsByStatus,
	isRoomsFilter,
	isRoomsSort,
	queryRoomEntries,
	ROOMS_FILTER_LABELS,
	ROOMS_FILTERS,
	ROOMS_SORT_LABELS,
	ROOMS_SORTS,
	type RoomCardModel,
	type RoomsFilter,
	type RoomsLayout,
	type RoomsSort,
	roomCardModel,
} from "@/lib/drive/room-card-model";
import { useDriveHub } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";

export type RoomsViewProps = {
	onNavigateSection: (section: DriveSection) => void;
};

/** Live borrows the Status Hub's "running" ink; stopped rooms stay quiet. */
const STATUS_BADGE_STYLES: Record<DriveRoomStatus, string> = {
	live: "border-primary/40 text-primary",
	paused: "border-amber-500/50 text-amber-600 dark:text-amber-400",
	ended: "border-border text-muted-foreground",
};

const STATUS_DOT_STYLES: Record<DriveRoomStatus, string> = {
	live: "bg-primary",
	paused: "bg-amber-500",
	ended: "bg-muted-foreground/50",
};

const PARTICIPANT_CHIP_CAP = 4;
const CLOCK_TICK_MS = 30_000;

/** Shared by the list header and every list row so the columns line up. */
const LIST_GRID =
	"grid grid-cols-[minmax(14rem,1.4fr)_minmax(10rem,1fr)_6rem_6rem_6rem_7rem_10rem] gap-x-4 max-[1100px]:grid-cols-[minmax(12rem,1fr)_minmax(8rem,1fr)_10rem]";

function ParticipantChips({ names }: { names: readonly string[] }) {
	if (names.length === 0) {
		return <span className="text-xs text-muted-foreground">No one seated</span>;
	}
	const shown = names.slice(0, PARTICIPANT_CHIP_CAP);
	const rest = names.length - shown.length;
	return (
		<ul
			aria-label={`Seated: ${names.join(", ")}`}
			className="flex flex-wrap gap-1"
		>
			{shown.map((name) => (
				<li
					className="flex h-6 items-center gap-1 rounded-md border bg-background px-1.5 text-xs text-foreground"
					key={name}
				>
					<Bot
						aria-hidden="true"
						className={cn("size-3", name === "You" ? "hidden" : "text-primary")}
					/>
					{name}
				</li>
			))}
			{rest > 0 ? (
				<li className="flex h-6 items-center rounded-md border bg-background px-1.5 text-xs text-muted-foreground">
					+{rest}
				</li>
			) : null}
		</ul>
	);
}

function Stat({ label, value }: { label: string; value: string | number }) {
	return (
		<div className="min-w-0">
			<dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
				{label}
			</dt>
			<dd className="truncate text-sm text-foreground tabular-nums">{value}</dd>
		</div>
	);
}

function RoomCard({
	card,
	layout,
	opening,
	stopping,
	reduceMotion,
	onOpen,
	onStop,
}: {
	card: RoomCardModel;
	layout: RoomsLayout;
	opening: boolean;
	stopping: boolean;
	reduceMotion: boolean;
	onOpen: (roomId: string) => void;
	onStop: (roomId: string) => void;
}) {
	const busy = opening || stopping;
	const live = card.status === "live";
	const spin = !reduceMotion && "motion-safe:animate-spin";
	const actions = (
		<div className="flex shrink-0 items-center gap-2 justify-self-end">
			<Button
				aria-label={`${card.primaryLabel} room ${card.roomId}`}
				disabled={busy}
				onClick={() => onOpen(card.roomId)}
				size="sm"
				type="button"
				variant={card.primaryAction === "start" ? "default" : "outline"}
			>
				{opening ? (
					<Loader2 aria-hidden="true" className={cn("size-3.5", spin)} />
				) : (
					<PhoneCall aria-hidden="true" className="size-3.5" />
				)}
				{opening ? "Opening…" : card.primaryLabel}
			</Button>
			{card.canStop ? (
				<Button
					aria-label={`Stop room ${card.roomId}`}
					className="text-destructive hover:text-destructive"
					disabled={busy}
					onClick={() => onStop(card.roomId)}
					size="sm"
					type="button"
					variant="outline"
				>
					{stopping ? (
						<Loader2 aria-hidden="true" className={cn("size-3.5", spin)} />
					) : null}
					{stopping ? "Stopping…" : "Stop"}
				</Button>
			) : null}
		</div>
	);
	const title = (
		<div className="flex min-w-0 items-center gap-2">
			<span
				aria-hidden="true"
				className={cn(
					"size-2.5 shrink-0 rounded-full",
					STATUS_DOT_STYLES[card.status],
					live && !reduceMotion && "motion-safe:animate-pulse",
				)}
			/>
			<span className="truncate text-sm font-semibold text-foreground">
				{card.roomId}
			</span>
			<Badge
				className={cn("shrink-0 text-[10px]", STATUS_BADGE_STYLES[card.status])}
				variant="outline"
			>
				{card.statusLabel}
			</Badge>
			{card.isCurrent ? (
				<Badge className="shrink-0 text-[10px]" variant="secondary">
					Current
				</Badge>
			) : null}
		</div>
	);

	if (layout === "list") {
		return (
			<li
				className={cn(
					LIST_GRID,
					"min-h-16 items-center border-t px-4 py-2.5 text-sm transition-colors hover:bg-surface-hover-lighter",
					card.isCurrent && "bg-surface-hover",
				)}
				data-status={card.status}
			>
				<div className="min-w-0">
					{title}
					<p className="mt-0.5 truncate text-xs text-muted-foreground">
						{card.meta}
					</p>
				</div>
				<div className="min-w-0">
					<ParticipantChips names={card.participantNames} />
				</div>
				<span className="truncate text-muted-foreground max-[1100px]:hidden">
					{card.subModeLabel}
				</span>
				<span className="truncate text-muted-foreground tabular-nums max-[1100px]:hidden">
					{card.cardCount} {card.cardCount === 1 ? "card" : "cards"}
				</span>
				<span className="truncate text-muted-foreground tabular-nums max-[1100px]:hidden">
					{card.eventCount} {card.eventCount === 1 ? "event" : "events"}
				</span>
				<span
					className="truncate text-muted-foreground max-[1100px]:hidden"
					title={card.updatedAt}
				>
					{card.updatedLabel}
				</span>
				{actions}
			</li>
		);
	}

	return (
		<li
			className={cn(
				"flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4",
				live && "border-primary/40",
				card.isCurrent && "ring-1 ring-primary/30",
			)}
			data-status={card.status}
		>
			<div className="min-w-0">
				{title}
				<p className="mt-1 truncate text-xs text-muted-foreground">
					{card.meta}
				</p>
			</div>
			<div className="min-w-0">
				<div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
					Seated
				</div>
				<ParticipantChips names={card.participantNames} />
			</div>
			<dl className="grid grid-cols-4 gap-x-3 gap-y-2">
				<Stat label="Mode" value={card.subModeLabel} />
				<Stat label="Address" value={card.addressLabel} />
				<Stat label="Cards" value={card.cardCount} />
				<Stat label="Events" value={card.eventCount} />
			</dl>
			<div className="mt-auto flex items-center justify-between gap-3 border-t pt-3">
				<span
					className="truncate text-xs text-muted-foreground"
					title={card.updatedAt}
				>
					Updated {card.updatedLabel || "—"}
				</span>
				{actions}
			</div>
		</li>
	);
}

function RoomCardSkeleton({ layout }: { layout: RoomsLayout }) {
	if (layout === "list") {
		return (
			<li className="flex h-16 items-center gap-4 border-t px-4">
				<Skeleton className="h-4 w-48" />
				<Skeleton className="h-6 w-32" />
				<Skeleton className="ml-auto h-8 w-20" />
			</li>
		);
	}
	return (
		<li className="flex flex-col gap-4 rounded-xl border bg-card p-4">
			<Skeleton className="h-4 w-40" />
			<Skeleton className="h-3 w-56" />
			<Skeleton className="h-6 w-48" />
			<div className="grid grid-cols-4 gap-3">
				<Skeleton className="h-8" />
				<Skeleton className="h-8" />
				<Skeleton className="h-8" />
				<Skeleton className="h-8" />
			</div>
			<div className="flex justify-end gap-2 border-t pt-3">
				<Skeleton className="h-8 w-20" />
				<Skeleton className="h-8 w-16" />
			</div>
		</li>
	);
}

export function RoomsView({ onNavigateSection }: RoomsViewProps) {
	const {
		phase,
		hub,
		source,
		roomId: currentRoomId,
		humanParticipantId,
		rooms,
		roomsError,
		roomsLoading,
		refreshRooms,
		join,
		end,
	} = useDriveHub();
	const [prefs] = useDrivePrefs();
	const reduceMotion = prefs.reduceMotion;

	const [filter, setFilter] = useState<RoomsFilter>("all");
	const [sort, setSort] = useState<RoomsSort>("status");
	const [search, setSearch] = useState("");
	const [layout, setLayout] = useState<RoomsLayout>("grid");
	const [openingRoomId, setOpeningRoomId] = useState<string | null>(null);
	const [stopCandidate, setStopCandidate] = useState<RoomCardModel | null>(
		null,
	);
	const [stoppingRoomId, setStoppingRoomId] = useState<string | null>(null);
	const [endedOverrides, setEndedOverrides] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [actionError, setActionError] = useState<string | null>(null);
	const [now, setNow] = useState(() => Date.now());

	const hubAnswers = phase === "live" || phase === "demo";

	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
		return () => window.clearInterval(timer);
	}, []);

	// Arriving on the page re-lists so the directory is not the connect-time
	// snapshot; the provider already keeps it fresh after every join / end.
	useEffect(() => {
		if (hubAnswers) {
			void refreshRooms();
		}
	}, [hubAnswers, refreshRooms]);

	// A confirmed stop is overlaid until the hub's own list agrees.
	useEffect(() => {
		setEndedOverrides((previous) => {
			if (previous.size === 0) {
				return previous;
			}
			const next = new Set(
				[...previous].filter(
					(id) =>
						rooms.find((entry) => entry.roomId === id)?.status !== "ended",
				),
			);
			return next.size === previous.size ? previous : next;
		});
	}, [rooms]);

	const entries = useMemo(
		() => applyEndedOverrides(rooms, endedOverrides),
		[endedOverrides, rooms],
	);
	const counts = useMemo(() => countRoomsByStatus(entries), [entries]);
	const cards = useMemo(
		() =>
			queryRoomEntries(entries, { filter, sort, search }).map((entry) =>
				roomCardModel(entry, { now, currentRoomId }),
			),
		[currentRoomId, entries, filter, now, search, sort],
	);
	const filtered = filter !== "all" || search.trim().length > 0;

	const openRoom = useCallback(
		async (roomId: string) => {
			setActionError(null);
			setOpeningRoomId(roomId);
			try {
				const ok = await join(roomId);
				if (ok) {
					onNavigateSection("call");
				}
			} finally {
				setOpeningRoomId(null);
			}
		},
		[join, onNavigateSection],
	);

	const stopRoom = useCallback(
		async (roomId: string) => {
			setActionError(null);
			setStoppingRoomId(roomId);
			let ok = false;
			try {
				if (roomId === currentRoomId) {
					// The bound room: go through the provider so the fold sees `ended`.
					ok = await end();
				} else {
					await source.call("call_end", roomId, {
						actorId: humanParticipantId,
						...(hub.workspaceRoot ? { workspaceRoot: hub.workspaceRoot } : {}),
					});
					ok = true;
				}
			} catch (error) {
				setActionError(parseDriveCommandError(error).text);
			} finally {
				setStoppingRoomId(null);
			}
			if (!ok) {
				return;
			}
			// The hub confirmed this room ended. Land that before re-listing: a
			// stop that succeeds and a refresh that fails are separate facts, and
			// the card must not go on offering Stop for a room we know is closed.
			setEndedOverrides((previous) => new Set([...previous, roomId]));
			await refreshRooms();
		},
		[
			currentRoomId,
			end,
			hub.workspaceRoot,
			humanParticipantId,
			refreshRooms,
			source,
		],
	);

	const confirmStop = async () => {
		if (!stopCandidate) {
			return;
		}
		const target = stopCandidate.roomId;
		setStopCandidate(null);
		await stopRoom(target);
	};

	const error = roomsError ?? actionError;
	const showSkeleton = roomsLoading && entries.length === 0 && !error;
	const showEmpty = entries.length === 0 && !roomsLoading && !error;

	const cardList = (
		<ul
			className={cn(
				"list-none",
				layout === "grid" &&
					"grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(22rem,1fr))]",
			)}
		>
			{showSkeleton
				? ["a", "b", "c"].map((key) => (
						<RoomCardSkeleton key={key} layout={layout} />
					))
				: cards.map((card) => (
						<RoomCard
							card={card}
							key={card.roomId}
							layout={layout}
							onOpen={(roomId) => void openRoom(roomId)}
							onStop={(roomId) =>
								setStopCandidate(
									cards.find((entry) => entry.roomId === roomId) ?? null,
								)
							}
							opening={openingRoomId === card.roomId}
							reduceMotion={reduceMotion}
							stopping={stoppingRoomId === card.roomId}
						/>
					))}
		</ul>
	);

	return (
		<PageFrame>
			<PageHeader
				actions={
					<Button
						disabled={roomsLoading || !hubAnswers}
						onClick={() => void refreshRooms()}
						size="sm"
						type="button"
						variant="outline"
					>
						<RefreshCw
							aria-hidden="true"
							className={cn(
								"size-3.5",
								roomsLoading && !reduceMotion && "motion-safe:animate-spin",
							)}
						/>
						Refresh
					</Button>
				}
				description="Every Drive session this workspace has opened, resumable. Stopping a room ends the call and saves a handoff — its configuration and stage history stay put, so Start picks up where you left off."
				icon={DoorOpen}
				meta={
					entries.length > 0 ? (
						<Badge className="text-[10px]" variant="outline">
							{counts.live} live / {counts.all}
						</Badge>
					) : null
				}
				title="Rooms"
			/>

			<div className="mb-4 flex flex-wrap items-center gap-2">
				<div className="relative min-w-44 max-w-72 flex-1">
					<Search
						aria-hidden="true"
						className="-translate-y-1/2 pointer-events-none absolute left-2.5 top-1/2 size-4 text-muted-foreground"
					/>
					<Input
						aria-label="Search rooms"
						className="h-8 pl-8 pr-8"
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search rooms"
						value={search}
					/>
					{search ? (
						<button
							aria-label="Clear search"
							className="-translate-y-1/2 absolute right-1.5 top-1/2 grid size-5 place-items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onClick={() => setSearch("")}
							type="button"
						>
							<X aria-hidden="true" className="size-3.5" />
						</button>
					) : null}
				</div>
				<ToggleGroup
					aria-label="Filter rooms by status"
					className="h-8 gap-0.5 rounded-md border bg-background p-0.5"
					onValueChange={(value) => {
						if (isRoomsFilter(value)) {
							setFilter(value);
						}
					}}
					size="sm"
					type="single"
					value={filter}
				>
					{ROOMS_FILTERS.map((option) => (
						<ToggleGroupItem
							aria-label={`${ROOMS_FILTER_LABELS[option]} rooms (${counts[option]})`}
							className="h-7 gap-1.5 rounded-sm px-2.5 text-xs first:rounded-sm last:rounded-sm"
							key={option}
							value={option}
						>
							{ROOMS_FILTER_LABELS[option]}
							<span className="text-muted-foreground tabular-nums">
								{counts[option]}
							</span>
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				<div className="ml-auto flex items-center gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								aria-label={`Sort rooms: ${ROOMS_SORT_LABELS[sort]}`}
								className="h-8"
								size="sm"
								type="button"
								variant="outline"
							>
								<ArrowUpDown aria-hidden="true" className="size-3.5" />
								{ROOMS_SORT_LABELS[sort]}
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" sideOffset={6}>
							<DropdownMenuLabel>Sort rooms</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuRadioGroup
								onValueChange={(value) => {
									if (isRoomsSort(value)) {
										setSort(value);
									}
								}}
								value={sort}
							>
								{ROOMS_SORTS.map((option) => (
									<DropdownMenuRadioItem key={option} value={option}>
										{ROOMS_SORT_LABELS[option]}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
					<ToggleGroup
						aria-label="Directory layout"
						className="h-8 gap-0.5 rounded-md border bg-background p-0.5 [&>button]:h-7 [&>button]:rounded-sm"
						onValueChange={(value) => {
							if (value === "grid" || value === "list") {
								setLayout(value);
							}
						}}
						size="sm"
						type="single"
						value={layout}
					>
						<ToggleGroupItem aria-label="Grid layout" title="Grid" value="grid">
							<LayoutGrid aria-hidden="true" className="size-4" />
						</ToggleGroupItem>
						<ToggleGroupItem aria-label="List layout" title="List" value="list">
							<Rows3 aria-hidden="true" className="size-4" />
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
			</div>

			{error ? (
				<PageEmptyState className="mb-4 flex items-center justify-between gap-3 border-destructive/40 text-destructive">
					<span className="min-w-0 truncate">
						{roomsError ? "Could not load rooms: " : "Room action failed: "}
						{error}
					</span>
					<Button
						className="h-7 shrink-0 px-2 text-xs"
						onClick={() => {
							setActionError(null);
							void refreshRooms();
						}}
						size="sm"
						type="button"
						variant="outline"
					>
						<RefreshCw aria-hidden="true" className="size-3" />
						Try again
					</Button>
				</PageEmptyState>
			) : null}

			{showEmpty ? (
				<Empty className="border border-dashed border-border bg-card">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<DoorOpen aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>No rooms yet</EmptyTitle>
						<EmptyDescription>
							Start a Drive call and it shows up here — and stays here after you
							stop it, with its configuration and stage history intact.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button onClick={() => onNavigateSection("lobby")} type="button">
							<PhoneCall aria-hidden="true" className="size-4" />
							Go to the Lobby
						</Button>
					</EmptyContent>
				</Empty>
			) : !showSkeleton && cards.length === 0 && filtered ? (
				<PageEmptyState className="flex items-center justify-between gap-3">
					<span>No rooms match the current filters.</span>
					<Button
						onClick={() => {
							setFilter("all");
							setSearch("");
						}}
						size="xs"
						type="button"
						variant="outline"
					>
						Clear filters
					</Button>
				</PageEmptyState>
			) : layout === "list" ? (
				<div className="overflow-hidden rounded-lg border bg-card">
					<div
						className={cn(
							LIST_GRID,
							"bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground",
						)}
					>
						<span>Room</span>
						<span>Seated</span>
						<span className="max-[1100px]:hidden">Mode</span>
						<span className="max-[1100px]:hidden">Cards</span>
						<span className="max-[1100px]:hidden">Events</span>
						<span className="max-[1100px]:hidden">Updated</span>
						<span className="sr-only">Actions</span>
					</div>
					{cardList}
				</div>
			) : (
				cardList
			)}

			<AlertDialog
				onOpenChange={(open) => {
					if (!open) {
						setStopCandidate(null);
					}
				}}
				open={stopCandidate !== null}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Stop {stopCandidate?.roomId ?? "this room"}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Stopping ends the call for everyone seated
							{stopCandidate && stopCandidate.participantNames.length > 0
								? ` (${stopCandidate.participantNames.join(", ")})`
								: ""}{" "}
							and saves a handoff. The room's configuration and stage history
							stay here, so Start picks it back up later.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-white hover:bg-destructive/90"
							onClick={(event) => {
								event.preventDefault();
								void confirmStop();
							}}
						>
							Stop room
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageFrame>
	);
}
