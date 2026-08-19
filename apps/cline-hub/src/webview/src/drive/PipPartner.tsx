/**
 * PiP Partner — the companion call surface (ADR-0006, DRV-PIP).
 *
 * The call strip lives inside `Chat`, which only mounts on the Drive call
 * route, so leaving that route used to take every call control with it. This
 * widget is what the user keeps: partner, narration, and the four ops the
 * wireframe's variant C shows — mute, raise hand, leave, expand.
 *
 * Three constraints shape the whole file:
 *
 * 1. **Not a second writer.** Every op goes through `driveCallOps`, the one
 *    place those frames are built, and `driveCallOps.test.ts` globs the whole
 *    webview to keep it that way. Nothing here inlines a `call_*` payload.
 * 2. **Not a second source of truth.** There is no local `muted` or
 *    `handRaised` state: both render straight off `DriveCallPresence`, which
 *    folds the hub's broadcasts. A local optimistic flip here would let the
 *    companion disagree with the strip, which is the exact failure DRV-PIP
 *    ("state matches the call strip") forbids.
 * 3. **Not a second IA.** No roster, no stage, no address UI. Expand routes to
 *    the room the user is already in; it writes nothing.
 *
 * Hide ≠ leave. Minimising collapses to a restore pill and persists per room
 * through `lib/drive-pip-hidden`; the call keeps running and Leave stays the
 * only way out. Visibility is `shouldShowPip` (E5). Strip position is
 * session-scoped drag (PIP-06) via `lib/drive-pip-position`.
 */

import {
	ChevronDownIcon,
	HandIcon,
	MicIcon,
	MicOffIcon,
	PhoneIcon,
	ScanIcon,
} from "lucide-react";
import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	readDrivePipHidden,
	writeDrivePipHidden,
} from "@/lib/drive-pip-hidden";
import {
	clampPipPosition,
	type DrivePipPosition,
	defaultPipPosition,
	readDrivePipPosition,
	writeDrivePipPosition,
} from "@/lib/drive-pip-position";
import { cn } from "@/lib/utils";
import { postToHost } from "../vscode";
import {
	buildLeaveFrame,
	buildMuteFrame,
	buildRaiseHandFrame,
} from "./driveCallOps";
import type { DriveCallPresence } from "./driveCallPresence";
import { shouldShowPip } from "./shouldShowPip";
import { DRIVE_DEFAULT_ROOM_ID, DRIVE_PARTICIPANT_HUMAN } from "./types";

function PipButton({
	children,
	label,
	onClick,
	pressed,
	tone = "neutral",
}: {
	children: ReactNode;
	/** Accessible name — also the tooltip copy. */
	label: string;
	onClick: () => void;
	/** Omit for controls that are not toggles (leave, expand). */
	pressed?: boolean;
	tone?: "neutral" | "live" | "danger";
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-label={label}
						aria-pressed={pressed}
						className={cn(
							"h-7 flex-1 [&_svg]:size-[13px]",
							tone === "live" &&
								"border-amber-500/55 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:border-amber-400/55 dark:bg-amber-400/10 dark:text-amber-300",
							tone === "danger" &&
								"border-destructive/45 text-destructive hover:bg-destructive/10",
						)}
						onClick={onClick}
						size="icon-sm"
						type="button"
						variant="outline"
					/>
				}
			>
				{children}
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

function viewportSize(): { width: number; height: number } {
	if (typeof window === "undefined") {
		return { width: 1280, height: 720 };
	}
	return { width: window.innerWidth, height: window.innerHeight };
}

function usePipPosition(roomId: string): {
	position: DrivePipPosition;
	setPosition: (next: DrivePipPosition) => void;
	bindCardRef: (el: HTMLElement | null) => void;
} {
	const cardEl = useRef<HTMLElement | null>(null);
	const [position, setPositionState] = useState<DrivePipPosition>(() => {
		const stored = readDrivePipPosition(roomId);
		const size = { width: 240, height: 140 };
		return clampPipPosition(
			stored ?? defaultPipPosition(viewportSize(), size),
			viewportSize(),
			size,
		);
	});

	const measure = useCallback(
		() => ({
			width: cardEl.current?.offsetWidth ?? 240,
			height: cardEl.current?.offsetHeight ?? 140,
		}),
		[],
	);

	const setPosition = (next: DrivePipPosition) => {
		const clamped = clampPipPosition(next, viewportSize(), measure());
		setPositionState(clamped);
		writeDrivePipPosition(roomId, clamped);
	};

	useEffect(() => {
		const onResize = () => {
			setPositionState((prev) =>
				clampPipPosition(prev, viewportSize(), measure()),
			);
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [measure]);

	return {
		position,
		setPosition,
		bindCardRef: (el) => {
			cardEl.current = el;
		},
	};
}

function PipCard({
	onExpand,
	presence,
	roomId,
}: {
	onExpand: (roomId: string) => void;
	presence: DriveCallPresence;
	/** Storage + expand key; `presence.roomId` before the hub seats us. */
	roomId: string;
}) {
	// Keyed by room in `PipPartner`, so the initialiser re-runs per call and no
	// effect is needed to follow the room.
	const [hidden, setHidden] = useState(() => readDrivePipHidden(roomId));
	const { position, setPosition, bindCardRef } = usePipPosition(roomId);
	const dragRef = useRef<{
		pointerId: number;
		originX: number;
		originY: number;
		startLeft: number;
		startTop: number;
	} | null>(null);

	const setHiddenPersisted = (next: boolean) => {
		setHidden(next);
		writeDrivePipHidden(roomId, next);
	};

	const partnerName = presence.partnerName?.trim() || "Drive call";
	const style = {
		left: position.left,
		top: position.top,
	} as const;

	const onDragPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
		if (event.button !== 0) {
			return;
		}
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = {
			pointerId: event.pointerId,
			originX: event.clientX,
			originY: event.clientY,
			startLeft: position.left,
			startTop: position.top,
		};
	};

	const onDragPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}
		setPosition({
			left: drag.startLeft + (event.clientX - drag.originX),
			top: drag.startTop + (event.clientY - drag.originY),
		});
	};

	const onDragPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
		if (dragRef.current?.pointerId === event.pointerId) {
			dragRef.current = null;
		}
	};

	// z-40, not z-50: dialogs, sheets and this widget's own tooltips sit at
	// z-50, and the companion must never cover a modal.
	if (
		!shouldShowPip({
			active: true,
			onCallRoute: false,
			optedOut: hidden,
		})
	) {
		return (
			<div
				className="fixed z-40"
				data-drive-pip="minimised"
				ref={bindCardRef}
				style={style}
			>
				<Button
					aria-label={`Show the ${partnerName} call companion`}
					className="h-8 gap-2 rounded-full border-amber-500/45 bg-background/95 px-3 shadow-lg backdrop-blur dark:border-amber-400/45"
					onClick={() => setHiddenPersisted(false)}
					onPointerDown={onDragPointerDown}
					onPointerMove={onDragPointerMove}
					onPointerUp={onDragPointerUp}
					size="sm"
					type="button"
					variant="outline"
				>
					<span
						aria-hidden="true"
						className="size-1.5 rounded-full bg-amber-500 dark:bg-amber-400"
					/>
					<span className="max-w-32 truncate text-xs">{partnerName}</span>
				</Button>
			</div>
		);
	}

	return (
		<aside
			aria-label={`${partnerName} call companion`}
			className="fixed z-40 w-60 rounded-lg border border-amber-500/40 bg-background/95 p-3 shadow-lg backdrop-blur dark:border-amber-400/40"
			// Presence facts as data, so a runtime smoke can read what the widget
			// is actually showing rather than inferring it from icon glyphs.
			data-drive-pip="open"
			data-hand-raised={String(presence.handRaised)}
			data-muted={String(presence.muted)}
			data-room-id={presence.roomId ?? ""}
			ref={bindCardRef}
			style={style}
		>
			<div
				className="flex cursor-grab items-center gap-2 active:cursor-grabbing"
				onPointerDown={onDragPointerDown}
				onPointerMove={onDragPointerMove}
				onPointerUp={onDragPointerUp}
			>
				<span
					aria-hidden="true"
					className="size-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400"
				/>
				<span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
					{partnerName}
				</span>
				<Button
					aria-label="Minimise the call companion (stays in the call)"
					className="size-6 shrink-0 text-muted-foreground [&_svg]:size-[13px]"
					onClick={() => setHiddenPersisted(true)}
					onPointerDown={(event) => event.stopPropagation()}
					size="icon-sm"
					type="button"
					variant="ghost"
				>
					<ChevronDownIcon />
				</Button>
			</div>
			{/* Clamped, not just min-height: narration is hub text of unbounded
				length and this card is fixed-position, so an unclamped line would
				grow it up the viewport. */}
			<p
				aria-live="polite"
				className="mt-1.5 line-clamp-2 min-h-8 text-[11.5px] leading-4 text-muted-foreground"
			>
				{presence.narration ?? "Still in call"}
			</p>
			<div className="mt-2 flex gap-1">
				<PipButton
					label={presence.muted ? "Unmute" : "Mute"}
					onClick={() => {
						// `presence.roomId` passes through unchanged — buildMuteFrame
						// owns the seated / pre-join branch, and normalising it here
						// would re-derive the decision it exists to make.
						postToHost(
							buildMuteFrame({
								roomId: presence.roomId,
								participantId: DRIVE_PARTICIPANT_HUMAN,
								muted: !presence.muted,
							}),
						);
					}}
					pressed={presence.muted}
					tone={presence.muted ? "danger" : "neutral"}
				>
					{presence.muted ? <MicOffIcon /> : <MicIcon />}
				</PipButton>
				<PipButton
					label={presence.handRaised ? "Lower hand" : "Raise hand"}
					onClick={() => {
						// null before a room exists — a hand raised at nobody is local
						// state the strip does not post either.
						const frame = buildRaiseHandFrame({
							roomId: presence.roomId,
							participantId: DRIVE_PARTICIPANT_HUMAN,
							raised: !presence.handRaised,
						});
						if (frame) {
							postToHost(frame);
						}
					}}
					pressed={presence.handRaised}
					tone={presence.handRaised ? "live" : "neutral"}
				>
					<HandIcon />
				</PipButton>
				<PipButton
					label="Leave call"
					onClick={() => {
						postToHost(
							buildLeaveFrame({
								roomId: presence.roomId,
								participantId: DRIVE_PARTICIPANT_HUMAN,
							}),
						);
					}}
					tone="danger"
				>
					<PhoneIcon className="rotate-[135deg]" />
				</PipButton>
				<PipButton label="Expand to the room" onClick={() => onExpand(roomId)}>
					<ScanIcon />
				</PipButton>
			</div>
		</aside>
	);
}

export function PipPartner({
	onCallRoute,
	onExpand,
	presence,
}: {
	/**
	 * The Drive call route already renders the strip and the roster, so the
	 * companion stands down there. Full rule: {@link shouldShowPip}.
	 */
	onCallRoute: boolean;
	onExpand: (roomId: string) => void;
	presence: DriveCallPresence;
}) {
	// Mount gate ignores opt-out so the restore pill can still appear.
	if (
		!shouldShowPip({
			active: presence.active,
			onCallRoute,
			optedOut: false,
		})
	) {
		return null;
	}
	const roomId = presence.roomId ?? DRIVE_DEFAULT_ROOM_ID;
	// Keyed so the minimise preference is read fresh for each room rather than
	// carried across calls.
	return (
		<PipCard
			key={roomId}
			onExpand={onExpand}
			presence={presence}
			roomId={roomId}
		/>
	);
}
