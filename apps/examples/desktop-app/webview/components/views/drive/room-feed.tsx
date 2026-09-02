"use client";

/**
 * The room feed drawer — every typed room event, chronological, with
 * filters (All / Talk / Room), a per-participant focus, a capped list, and
 * auto-scroll that steps aside the moment you scroll up ("Jump to latest").
 *
 * `useRoomFeed` projects the hub event stream into display lines (see
 * `lib/drive/room-feed.ts`) and merges them with the conversation lane the
 * room fold keeps. Nothing here is authoritative; the hub is.
 */

import type { Participant } from "@cline/shared";
import {
	Aperture,
	ArrowDown,
	AtSign,
	Crown,
	Hand,
	Info,
	LogOut,
	MessageSquare,
	Mic,
	MicOff,
	PhoneOff,
	Presentation,
	Sparkles,
	UserRound,
	Wrench,
	X,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import type { ParticipantInk } from "@/lib/drive/agent-ink";
import type { DriveDataSource } from "@/lib/drive/drive-source";
import {
	appendRoomFeedItem,
	filterRoomFeed,
	mergeRoomFeed,
	participantNames,
	ROOM_FEED_FILTERS,
	type RoomFeedFilter,
	type RoomFeedItem,
	type RoomFeedKind,
	roomFeedItemFromHubEvent,
	roomFeedSyncItem,
} from "@/lib/drive/room-feed";
import type { DriveRoomState } from "@/lib/drive/room-state";
import { formatClock } from "@/lib/drive/stage-cards";
import { cn } from "@/lib/utils";
import { ParticipantAvatar } from "./roster";

/**
 * Subscribe to the source and keep the display-only room lines; merge them
 * with the fold's conversation lane. Resets when the room changes.
 */
export function useRoomFeed(
	source: DriveDataSource,
	room: DriveRoomState,
	participants: readonly Participant[],
): RoomFeedItem[] {
	const [roomItems, setRoomItems] = useState<RoomFeedItem[]>([]);
	const names = useMemo(() => participantNames(participants), [participants]);
	const namesRef = useRef(names);
	namesRef.current = names;
	const seededForRef = useRef<string | null>(null);

	// A different room or source is a different transcript.
	const transcriptKey = `${source.kind}:${room.roomId ?? ""}`;
	const transcriptRef = useRef(transcriptKey);
	useEffect(() => {
		transcriptRef.current = transcriptKey;
		setRoomItems([]);
		seededForRef.current = null;
	}, [transcriptKey]);

	useEffect(
		() =>
			source.subscribe((event) => {
				const item = roomFeedItemFromHubEvent(event, namesRef.current);
				if (item) {
					setRoomItems((previous) => appendRoomFeedItem(previous, item));
				}
			}),
		[source],
	);

	const snapshot = room.snapshot;
	useEffect(() => {
		if (!snapshot || seededForRef.current === snapshot.roomId) {
			return;
		}
		seededForRef.current = snapshot.roomId;
		const item = roomFeedSyncItem({
			roomId: snapshot.roomId,
			seq: room.seq,
			participantCount: snapshot.participants.length,
			at: room.lastEventAt ?? new Date().toISOString(),
		});
		setRoomItems((previous) => appendRoomFeedItem(previous, item));
	}, [snapshot, room.seq, room.lastEventAt]);

	return useMemo(
		() => mergeRoomFeed(room.conversation, roomItems),
		[room.conversation, roomItems],
	);
}

const KIND_ICON: Record<RoomFeedKind, typeof Info> = {
	message: MessageSquare,
	narration: MessageSquare,
	beat: Sparkles,
	system: Info,
	join: UserRound,
	leave: LogOut,
	mode: Wrench,
	address: AtSign,
	stage: Aperture,
	title: Crown,
	hand: Hand,
	mute: MicOff,
	end: PhoneOff,
	work: Wrench,
	show: Presentation,
};

function FeedRow({
	item,
	participant,
	ink,
	onOpenParticipant,
}: {
	item: RoomFeedItem;
	participant: Participant | null;
	ink: ParticipantInk | null;
	onOpenParticipant: (participantId: string) => void;
}) {
	const talk = item.group === "talk";
	const Icon = KIND_ICON[item.kind];
	if (talk && participant) {
		return (
			<li className="flex gap-2 px-3 py-1.5">
				<button
					aria-label={`Open ${participant.displayName}`}
					className="mt-0.5 shrink-0 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
					onClick={() => onOpenParticipant(participant.id)}
					type="button"
				>
					<ParticipantAvatar ink={ink} participant={participant} size="sm" />
				</button>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="flex items-baseline gap-1.5">
						<span
							className="truncate text-xs font-semibold text-foreground"
							style={ink ? { color: ink.css } : undefined}
						>
							{participant.displayName}
						</span>
						{item.kind === "beat" ? (
							<span className="text-[10px] text-muted-foreground">
								narrated
							</span>
						) : null}
						<time
							className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
							dateTime={item.at}
						>
							{formatClock(item.at)}
						</time>
					</div>
					<p className="cline-chat-selectable text-[13px] leading-snug text-foreground">
						{item.text}
					</p>
				</div>
			</li>
		);
	}
	return (
		<li className="flex items-start gap-2 px-3 py-1">
			<Icon
				aria-hidden="true"
				className={cn(
					"mt-0.5 size-3.5 shrink-0",
					item.kind === "end"
						? "text-error-text"
						: item.kind === "title" || item.kind === "stage"
							? "text-warning-text"
							: "text-muted-foreground",
				)}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex items-baseline gap-1.5">
					<span className="min-w-0 flex-1 text-xs text-muted-foreground">
						{item.text}
					</span>
					<time
						className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70"
						dateTime={item.at}
					>
						{formatClock(item.at)}
					</time>
				</div>
				{item.detail ? (
					<p className="cline-chat-selectable mt-0.5 truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
						{item.detail}
					</p>
				) : null}
			</div>
		</li>
	);
}

export type RoomFeedProps = {
	items: readonly RoomFeedItem[];
	participants: readonly Participant[];
	inkById: Record<string, ParticipantInk>;
	filter: RoomFeedFilter;
	onFilterChange: (filter: RoomFeedFilter) => void;
	focusParticipantId: string | null;
	onClearFocus: () => void;
	whileAwayNote: string | null;
	onDismissWhileAway: () => void;
	callLive: boolean;
	onOpenParticipant: (participantId: string) => void;
	className?: string;
	/** Extra chrome under the header (e.g. the ended-call handoff). */
	children?: ReactNode;
};

export function RoomFeed({
	items,
	participants,
	inkById,
	filter,
	onFilterChange,
	focusParticipantId,
	onClearFocus,
	whileAwayNote,
	onDismissWhileAway,
	callLive,
	onOpenParticipant,
	className,
	children,
}: RoomFeedProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [pinnedToLatest, setPinnedToLatest] = useState(true);
	const [unseen, setUnseen] = useState(0);
	const byId = useMemo(() => {
		const map: Record<string, Participant> = {};
		for (const participant of participants) {
			map[participant.id] = participant;
		}
		return map;
	}, [participants]);
	const visible = useMemo(
		() => filterRoomFeed(items, { filter, participantId: focusParticipantId }),
		[filter, focusParticipantId, items],
	);
	const focused = focusParticipantId ? byId[focusParticipantId] : undefined;
	const lastId = visible[visible.length - 1]?.id ?? null;

	const scrollToLatest = useCallback(() => {
		const node = scrollRef.current;
		if (node) {
			node.scrollTop = node.scrollHeight;
		}
		setPinnedToLatest(true);
		setUnseen(0);
	}, []);

	// Auto-scroll only while pinned; otherwise count what arrived.
	// biome-ignore lint/correctness/useExhaustiveDependencies: lastId is the trigger — a new tail line — not a value read here.
	useEffect(() => {
		if (pinnedToLatest) {
			const node = scrollRef.current;
			if (node) {
				node.scrollTop = node.scrollHeight;
			}
		} else {
			setUnseen((count) => count + 1);
		}
	}, [lastId, pinnedToLatest]);

	const onScroll = useCallback(() => {
		const node = scrollRef.current;
		if (!node) {
			return;
		}
		const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
		const atBottom = distance < 24;
		setPinnedToLatest(atBottom);
		if (atBottom) {
			setUnseen(0);
		}
	}, []);

	return (
		<section
			aria-label="Room feed"
			className={cn("relative flex min-h-0 flex-1 flex-col", className)}
		>
			<header className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 pt-2 pb-2">
				<div className="flex items-center gap-2">
					<h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
						Room feed
					</h2>
					<span className="text-[11px] text-muted-foreground">
						{visible.length}
						{visible.length !== items.length ? ` of ${items.length}` : ""}
					</span>
					<fieldset
						aria-label="Feed filter"
						className="m-0 ml-auto flex min-w-0 items-center gap-0.5 rounded-md border border-border p-0.5"
					>
						{ROOM_FEED_FILTERS.map((entry) => (
							<button
								aria-pressed={filter === entry.id}
								className={cn(
									"rounded px-1.5 py-0.5 text-[11px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
									filter === entry.id
										? "bg-primary/15 text-foreground"
										: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
								)}
								key={entry.id}
								onClick={() => onFilterChange(entry.id)}
								type="button"
							>
								{entry.label}
							</button>
						))}
					</fieldset>
				</div>
				{focused ? (
					<div className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] text-foreground">
						<ParticipantAvatar
							ink={inkById[focused.id] ?? null}
							participant={focused}
							size="sm"
						/>
						<span className="min-w-0 flex-1 truncate">
							Focused on {focused.displayName}
						</span>
						<Button
							aria-label="Clear participant focus"
							className="size-5"
							onClick={onClearFocus}
							size="icon"
							type="button"
							variant="ghost"
						>
							<X aria-hidden="true" className="size-3" />
						</Button>
					</div>
				) : null}
				{children}
			</header>

			{whileAwayNote ? (
				<div
					className="mx-3 mt-2 flex shrink-0 items-start gap-2 rounded-md border border-info-border bg-info-surface px-2.5 py-2 text-xs text-foreground"
					role="note"
				>
					<Info
						aria-hidden="true"
						className="mt-0.5 size-3.5 shrink-0 text-info-text"
					/>
					<div className="min-w-0 flex-1">
						<p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-info-text">
							While you were away
						</p>
						<p className="mt-0.5 leading-snug">{whileAwayNote}</p>
					</div>
					<Button
						aria-label="Dismiss the while-you-were-away note"
						className="size-5 shrink-0"
						onClick={onDismissWhileAway}
						size="icon"
						type="button"
						variant="ghost"
					>
						<X aria-hidden="true" className="size-3" />
					</Button>
				</div>
			) : null}

			<div
				className="drive-scroll min-h-0 flex-1 overflow-y-auto py-1"
				onScroll={onScroll}
				ref={scrollRef}
			>
				{visible.length === 0 ? (
					<p className="px-3 py-6 text-center text-xs text-muted-foreground">
						{items.length === 0
							? callLive
								? "Quiet so far. Narration, work and room changes land here as the hub reports them."
								: "Nothing yet. Join the call and the room's events will stream in."
							: "Nothing matches this filter."}
					</p>
				) : (
					<ol className="flex flex-col">
						{visible.map((item) => {
							const participant = item.participantId
								? (byId[item.participantId] ?? null)
								: null;
							return (
								<FeedRow
									ink={participant ? (inkById[participant.id] ?? null) : null}
									item={item}
									key={item.id}
									onOpenParticipant={onOpenParticipant}
									participant={participant}
								/>
							);
						})}
					</ol>
				)}
			</div>

			{!pinnedToLatest ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
					<Button
						aria-label="Jump to latest"
						className="pointer-events-auto h-7 gap-1.5 rounded-full px-3 text-xs shadow-md"
						onClick={scrollToLatest}
						size="sm"
						type="button"
						variant="secondary"
					>
						<ArrowDown aria-hidden="true" className="size-3.5" />
						Jump to latest{unseen > 0 ? ` · ${unseen}` : ""}
					</Button>
				</div>
			) : null}
		</section>
	);
}

export { Mic as FeedMicIcon };
