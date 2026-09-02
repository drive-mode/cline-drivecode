"use client";

/**
 * The Spotlight — the shared surface everyone on the call watches.
 *
 * Renders the hub's stage projection: who is sharing (with agent ink and the
 * Presenter badge), the presented Director artifact or the human's pin on a
 * fixed-dark screen, the live narration caption, the show-backlog rail, and
 * the agent work deck. It never streams pixels; every frame is built from
 * typed events. Ported from the hub's `drive/Spotlight.tsx` onto the desktop
 * kit, with the layout contract from the brief: the screen is the primary
 * surface and keeps a 320px floor (a pixel literal on purpose — the app root font size is user-set, so a rem floor would drift) so it stays ≥ 320px tall at 1280×640.
 *
 * Accessibility: the whole surface is one labelled region with a polite live
 * status line, so a screen reader hears "Cline is presenting doc.plan —
 * <narration>" once per change rather than every card.
 */

import type { Participant, ShowBacklogItem, StagePin } from "@cline/shared";
import {
	Layers,
	PanelRightClose,
	PanelRightOpen,
	Pin,
	SquareTerminal,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ParticipantInk } from "@/lib/drive/agent-ink";
import type { DriveStageLayout } from "@/lib/drive/drive-prefs";
import type {
	DrivePresentedShow,
	DriveSpotlightSelection,
} from "@/lib/drive/room-state";
import { projectShowRail, selectShowRailCursor } from "@/lib/drive/show-rail";
import { orderStageCards } from "@/lib/drive/stage-cards";
import type { DrivePhase } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";
import { PresentedArtifact } from "./presented-artifact";
import { ParticipantAvatar } from "./roster";
import { ShowRail } from "./show-rail";
import { StageCardView } from "./stage-card";

export type SpotlightProps = {
	selection: DriveSpotlightSelection;
	participants: readonly Participant[];
	/** Themed inks for the byline and deck. */
	inkById: Record<string, ParticipantInk>;
	/** Inks resolved against the fixed-dark screen well. */
	screenInkById: Record<string, ParticipantInk>;
	humanId: string;
	presentedShow: DrivePresentedShow | null;
	showBacklog: readonly ShowBacklogItem[];
	activeShowId: string | null;
	/** Latest narration line; null reserves the slot empty. */
	narration: string | null;
	/** Changes when a new beat lands, so the caption re-animates. */
	narrationKey: string;
	captionsOn: boolean;
	phase: DrivePhase;
	callLive: boolean;
	nowMs: number;
	stageLayout: DriveStageLayout;
	onToggleStageLayout: () => void;
	feedCollapsed: boolean;
	onToggleFeed: () => void;
	/** The Presenter badge + menu, rendered in the byline. */
	presenterControls: ReactNode;
	onOpenParticipant: (participantId: string) => void;
	className?: string;
};

function HumanPinContent({ pin }: { pin: StagePin }) {
	const body = pin.ref?.trim() || pin.label;
	const eyebrow =
		pin.kind === "selection"
			? "selection"
			: pin.kind === "file"
				? "file"
				: "terminal";
	return (
		<div className="flex max-h-full min-h-0 w-full max-w-[44rem] flex-col overflow-hidden rounded-lg border border-(--drive-share)/55 bg-card">
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
				{pin.kind === "terminal" ? (
					<SquareTerminal
						aria-hidden="true"
						className="size-3.5 shrink-0 text-(--drive-share)"
					/>
				) : (
					<Pin
						aria-hidden="true"
						className="size-3.5 shrink-0 text-(--drive-share)"
					/>
				)}
				<span className="shrink-0 rounded border border-(--drive-share)/45 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-(--drive-share)">
					{eyebrow}
				</span>
				<span
					className={cn(
						"truncate text-[13px] font-medium text-foreground",
						pin.kind !== "selection" && "font-mono text-xs",
					)}
				>
					{pin.label}
				</span>
			</div>
			<pre className="cline-chat-selectable drive-scroll max-h-72 min-h-0 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-[1.55] text-foreground">
				{body}
			</pre>
		</div>
	);
}

function ScreenIdle({
	sharer,
	ink,
	hint,
}: {
	sharer: Participant | null;
	ink: ParticipantInk | null;
	hint: string;
}) {
	const label = sharer?.displayName ?? "Nobody";
	const verb = sharer?.kind === "human" ? "are" : "is";
	return (
		<div className="flex max-w-sm flex-col items-center gap-2 text-center">
			{sharer ? (
				<ParticipantAvatar ink={ink} participant={sharer} size="lg" />
			) : (
				<span
					aria-hidden="true"
					className="grid size-12 place-items-center rounded-full border border-dashed border-border text-muted-foreground"
				>
					<Layers className="size-5" />
				</span>
			)}
			<p className="text-[13px] font-semibold text-foreground">
				{sharer ? `${label} ${verb} sharing` : "The Spotlight is empty"}
			</p>
			<p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
				{sharer ? "workspace" : "no sharer"}
			</p>
			<p className="text-[11px] text-muted-foreground">{hint}</p>
		</div>
	);
}

export function Spotlight({
	selection,
	participants,
	inkById,
	screenInkById,
	humanId,
	presentedShow,
	showBacklog,
	activeShowId,
	narration,
	narrationKey,
	captionsOn,
	phase,
	callLive,
	nowMs,
	stageLayout,
	onToggleStageLayout,
	feedCollapsed,
	onToggleFeed,
	presenterControls,
	onOpenParticipant,
	className,
}: SpotlightProps) {
	const sharer = selection.sharerParticipant;
	const humanShares = selection.sharer?.kind === "human";
	const humanPin = humanShares ? selection.pin : null;
	const staged = Boolean(presentedShow?.uri || presentedShow?.title);
	const presentedItem = presentedShow
		? (showBacklog.find((item) => item.id === presentedShow.showItemId) ?? null)
		: null;
	const ownerId =
		presentedShow?.ownerParticipantId ?? presentedItem?.ownerParticipantId;
	const owner = ownerId
		? (participants.find((participant) => participant.id === ownerId) ?? null)
		: null;
	const railEntries = projectShowRail(showBacklog, activeShowId);
	const railCursor = selectShowRailCursor(railEntries);
	const cards = orderStageCards(selection.cards);
	const deckVisible = stageLayout === "split";
	const sharerName =
		sharer?.displayName ??
		(selection.sharer ? selection.sharer.participantId : "Nobody");
	const sharerInk = sharer ? (inkById[sharer.id] ?? null) : null;
	const sharerScreenInk = sharer ? (screenInkById[sharer.id] ?? null) : null;
	const isYou = sharer?.id === humanId;
	const presentingVerb = isYou ? "are" : "is";
	const artifactKind = humanPin
		? "structured share"
		: staged
			? (presentedShow?.artifactKind ?? "artifact")
			: "workspace";
	const stickyMode = !humanPin && staged ? presentedShow?.sticky : undefined;
	const caption = captionsOn ? narration : null;
	const statusLine = `${sharerName} ${presentingVerb} presenting ${artifactKind}${
		narration ? `. ${narration}` : ""
	}`;
	const feedToggleLabel = feedCollapsed
		? "Show roster and feed"
		: "Hide roster and feed";
	const emptyHint = callLive
		? "Nothing is staged yet. Work lands here as typed events — edits, commands, tests — the moment an agent reports it."
		: "Join the call to seat yourself; the room's typed work will appear here.";

	return (
		<section
			aria-label="Spotlight"
			className={cn(
				"drive-scroll flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-auto p-3",
				className,
			)}
		>
			<p
				aria-atomic="true"
				aria-live="polite"
				className="sr-only"
				role="status"
			>
				{statusLine}
			</p>

			{/* Byline: who holds the Spotlight, what is on it, and the room's badges. */}
			<header className="flex min-h-7 shrink-0 items-center gap-2">
				{sharer ? (
					<button
						aria-label={`Open ${sharer.displayName}`}
						className="flex min-w-0 items-center gap-2 rounded-md py-0.5 pr-1.5 pl-0.5 text-left outline-none hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/50"
						onClick={() => onOpenParticipant(sharer.id)}
						type="button"
					>
						<ParticipantAvatar
							ink={sharerInk}
							participant={sharer}
							size="sm"
							speaking={sharer.status === "speaking"}
						/>
						<span className="flex min-w-0 items-baseline gap-1.5 text-sm">
							<span
								className="truncate font-semibold text-foreground"
								style={sharerInk ? { color: sharerInk.css } : undefined}
							>
								{isYou ? "You" : sharer.displayName}
							</span>
							<span className="shrink-0 text-muted-foreground">
								{presentingVerb} presenting
							</span>
							<span className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-warning-text">
								{artifactKind}
							</span>
						</span>
					</button>
				) : (
					<span className="text-sm text-muted-foreground">
						Nobody is presenting
					</span>
				)}
				{stickyMode ? (
					<span className="hidden shrink-0 rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground @min-[40rem]:inline">
						sticky · {stickyMode}
					</span>
				) : null}
				<span className="ml-auto flex shrink-0 items-center gap-1.5">
					{presenterControls}
					<Badge className="h-6 text-[10px]" variant="outline">
						{phase === "demo"
							? "Demo call"
							: humanPin
								? "Human share"
								: callLive
									? "Live room"
									: "Watching"}
					</Badge>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								aria-label={
									deckVisible ? "Hide the work deck" : "Show the work deck"
								}
								aria-pressed={deckVisible}
								className="size-6"
								onClick={onToggleStageLayout}
								size="icon"
								type="button"
								variant="ghost"
							>
								<Layers aria-hidden="true" className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							{deckVisible ? "Hide the work deck" : "Show the work deck"}
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								aria-expanded={!feedCollapsed}
								aria-label={feedToggleLabel}
								className="size-6"
								onClick={onToggleFeed}
								size="icon"
								type="button"
								variant="ghost"
							>
								{feedCollapsed ? (
									<PanelRightOpen aria-hidden="true" className="size-3.5" />
								) : (
									<PanelRightClose aria-hidden="true" className="size-3.5" />
								)}
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">{feedToggleLabel}</TooltipContent>
					</Tooltip>
				</span>
			</header>

			{/* The screen: fixed-dark in both themes, the only flex-1 item here. */}
			<div
				className={cn(
					"dark drive-screen @container relative flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-lg border",
					humanPin ? "border-(--drive-share)/60" : "border-white/15",
				)}
				data-spotlight-screen={
					humanPin ? "human" : staged ? "artifact" : "idle"
				}
			>
				<div className="flex shrink-0 items-center gap-2 border-b border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5">
					<span
						aria-hidden="true"
						className={cn(
							"size-[7px] shrink-0 rounded-full",
							humanPin
								? "drive-live-dot bg-(--drive-share) text-(--drive-share)"
								: callLive
									? "drive-live-dot bg-success-solid text-success-solid"
									: "bg-(--drive-screen-text-dim)",
						)}
					/>
					<p className="flex min-w-0 flex-1 items-center gap-x-1.5 whitespace-nowrap text-[11px] font-medium text-(--drive-screen-text-muted)">
						<span
							className="max-w-40 shrink-0 truncate font-semibold text-white"
							style={
								sharerScreenInk ? { color: sharerScreenInk.color } : undefined
							}
						>
							{isYou ? "You" : sharerName}
						</span>
						<span className="shrink-0">{presentingVerb} presenting ·</span>
						<span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.07em] text-(--drive-share)">
							{artifactKind}
						</span>
					</p>
					{presentedItem?.mediaClass ? (
						<span className="hidden shrink-0 rounded-full border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-(--drive-screen-text-muted) @min-[28rem]:inline">
							{presentedItem.mediaClass}
						</span>
					) : null}
				</div>
				<div
					className="drive-screen-body grid min-h-0 flex-1 place-items-center overflow-hidden p-4"
					key={
						humanPin
							? `pin:${humanPin.kind}:${humanPin.label}`
							: (presentedShow?.showItemId ?? "idle")
					}
				>
					<div className="drive-frame-in flex max-h-full min-h-0 w-full items-center justify-center">
						{humanPin ? (
							<HumanPinContent pin={humanPin} />
						) : staged && presentedShow ? (
							<PresentedArtifact
								item={presentedItem}
								ownerName={owner?.displayName}
								show={presentedShow}
							/>
						) : (
							<ScreenIdle
								hint={
									cards.length === 0
										? emptyHint
										: "Presenting from the workspace — the deck below is the work."
								}
								ink={sharerScreenInk}
								sharer={sharer}
							/>
						)}
					</div>
				</div>
				<p
					aria-hidden={!captionsOn}
					className="flex h-12 shrink-0 items-center justify-center border-t border-white/[0.08] px-4 text-center text-xs italic leading-tight text-(--drive-share)/95"
				>
					{caption ? (
						<span className="drive-beat-in line-clamp-2" key={narrationKey}>
							{caption}
						</span>
					) : captionsOn ? (
						<span className="text-(--drive-screen-text-dim)">
							{callLive ? "Narration appears here as agents speak." : ""}
						</span>
					) : (
						<span className="text-(--drive-screen-text-dim)">Captions off</span>
					)}
				</p>
			</div>

			<ShowRail
				cursor={railCursor}
				dimmed={Boolean(humanPin)}
				entries={railEntries}
			/>

			{deckVisible && cards.length > 0 ? (
				<section
					aria-label="Agent work deck"
					className={cn(
						"shrink-0 motion-safe:transition-opacity",
						humanPin && "opacity-50",
					)}
				>
					<div className="mb-1.5 flex items-center gap-2">
						<span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
							Work deck
						</span>
						<span className="text-[10px] text-muted-foreground">
							{humanPin
								? "paused while you hold the Spotlight"
								: `${cards.length} ${cards.length === 1 ? "card" : "cards"} · newest first`}
						</span>
					</div>
					<div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
						{cards.map((card) => (
							<StageCardView
								animate
								card={card}
								key={`${card.id}:${card.updatedAt}`}
								nowMs={nowMs}
							/>
						))}
					</div>
				</section>
			) : null}
		</section>
	);
}
