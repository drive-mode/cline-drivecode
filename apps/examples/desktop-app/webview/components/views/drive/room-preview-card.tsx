"use client";

/**
 * The Lobby's room preview: what the hub says about the bound room, and the
 * one primary action that follows from it (Start / Join / Continue / Retry).
 *
 * Presentation only. The projection is `lib/drive/room-preview.ts`; the
 * actions go back to the Lobby, which routes them through the port.
 */

import {
	Bot,
	DoorOpen,
	Hand,
	Loader2,
	MicOff,
	MonitorPlay,
	PhoneCall,
	RefreshCw,
	User,
} from "lucide-react";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CommandBadge } from "@/components/views/page-layout";
import { roomRelativeTime } from "@/lib/drive/room-card-model";
import type {
	RoomPreview,
	RoomPreviewActionKind,
	RoomPreviewParticipant,
} from "@/lib/drive/room-preview";
import { cn } from "@/lib/utils";

export type RoomPreviewCardProps = {
	preview: RoomPreview;
	/** A join is in flight; the primary action waits for it. */
	busy: boolean;
	reduceMotion: boolean;
	/** Wall-clock for relative times; the Lobby ticks it. */
	now: number;
	onAction: (kind: RoomPreviewActionKind) => void;
	/** Offered next to Retry when the hub cannot be checked. */
	onExploreDemo?: () => void;
	onOpenRooms: () => void;
};

function ActionIcon({ kind }: { kind: RoomPreviewActionKind }) {
	if (kind === "retry") {
		return <RefreshCw aria-hidden="true" className="size-4" />;
	}
	return <PhoneCall aria-hidden="true" className="size-4" />;
}

function ParticipantChip({
	participant,
}: {
	participant: RoomPreviewParticipant;
}) {
	const Icon = participant.kind === "human" ? User : Bot;
	const marks: string[] = [];
	if (participant.sharing) {
		marks.push("sharing the Spotlight");
	}
	if (participant.presenting) {
		marks.push("Presenter");
	}
	if (participant.muted) {
		marks.push("muted");
	}
	if (participant.handRaised) {
		marks.push("hand raised");
	}
	const label = `${participant.displayName}${participant.isYou ? " (you)" : ""} · ${participant.statusLabel}${marks.length ? ` · ${marks.join(", ")}` : ""}`;
	return (
		<li
			className={cn(
				"flex h-7 max-w-full items-center gap-1.5 rounded-md border bg-background px-2 text-xs",
				participant.sharing && "border-primary/40",
			)}
			title={label}
		>
			<Icon
				aria-hidden="true"
				className={cn(
					"size-3.5 shrink-0",
					participant.kind === "agent"
						? "text-primary"
						: "text-muted-foreground",
				)}
			/>
			<span className="truncate font-medium text-foreground">
				{participant.displayName}
			</span>
			{participant.isYou ? (
				<span className="text-muted-foreground">you</span>
			) : null}
			<span className="text-muted-foreground">{participant.statusLabel}</span>
			{participant.sharing ? (
				<MonitorPlay aria-hidden="true" className="size-3 text-primary" />
			) : null}
			{participant.presenting ? (
				<Badge
					className="h-4 border-primary/40 px-1 text-[10px] text-primary"
					variant="outline"
				>
					Presenter
				</Badge>
			) : null}
			{participant.muted ? (
				<MicOff aria-hidden="true" className="size-3 text-muted-foreground" />
			) : null}
			{participant.handRaised ? (
				<Hand aria-hidden="true" className="size-3 text-primary" />
			) : null}
			<span className="sr-only">{label}</span>
		</li>
	);
}

function DetailTile({
	label,
	children,
	className,
}: {
	label: string;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"min-w-0 rounded-lg border bg-background/60 px-3 py-2.5",
				className,
			)}
		>
			<div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			<div className="mt-2 min-h-7">{children}</div>
		</div>
	);
}

function DetailSkeleton() {
	return (
		<div
			aria-hidden="true"
			className="grid grid-cols-3 gap-3 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]"
		>
			{["roster", "spotlight", "mode", "wire"].map((key) => (
				<div
					className={cn(
						"rounded-lg border bg-background/60 px-3 py-2.5",
						key === "roster" && "col-span-3 xl:col-span-1",
					)}
					key={key}
				>
					<Skeleton className="h-3 w-16" />
					<Skeleton className="mt-3 h-5 w-3/4" />
				</div>
			))}
		</div>
	);
}

export function RoomPreviewCard({
	preview,
	busy,
	reduceMotion,
	now,
	onAction,
	onExploreDemo,
	onOpenRooms,
}: RoomPreviewCardProps) {
	const headingId = useId();
	const seated = preview.state === "seated";
	const unreachable = preview.state === "unreachable";
	const checking = preview.state === "checking";
	const actionDisabled = !preview.action.enabled || busy;

	return (
		<section
			aria-labelledby={headingId}
			className={cn(
				"mb-6 rounded-xl border bg-card",
				seated && "border-primary/40",
				unreachable && "border-destructive/40",
			)}
			data-slot="drive-room-preview"
			data-state={preview.state}
		>
			<div className="flex flex-wrap items-start justify-between gap-4 p-5">
				<div className="flex min-w-0 flex-1 items-start gap-3">
					<div
						className={cn(
							"flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary",
							unreachable && "bg-destructive/10 text-destructive",
						)}
					>
						<PhoneCall aria-hidden="true" className="size-4.5" />
					</div>
					<div className="min-w-0">
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<h2
								className="truncate text-base font-semibold text-foreground"
								id={headingId}
							>
								{preview.title}
							</h2>
							<Badge
								className={cn(
									seated && "border-primary/40 text-primary",
									unreachable && "border-destructive/40 text-destructive",
								)}
								variant={seated || unreachable ? "outline" : "secondary"}
							>
								{seated ? (
									<span
										aria-hidden="true"
										className={cn(
											"size-1.5 rounded-full bg-primary",
											!reduceMotion && "motion-safe:animate-pulse",
										)}
									/>
								) : null}
								{checking ? (
									<Loader2
										aria-hidden="true"
										className={cn(
											"size-3",
											!reduceMotion && "motion-safe:animate-spin",
										)}
									/>
								) : null}
								{preview.badge}
							</Badge>
							{preview.title !== preview.roomId ? (
								<CommandBadge>{preview.roomId}</CommandBadge>
							) : null}
						</div>
						<p
							aria-atomic="true"
							aria-live="polite"
							className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground"
							role="status"
						>
							{preview.description}
						</p>
					</div>
				</div>
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					{unreachable && onExploreDemo ? (
						<Button onClick={onExploreDemo} type="button" variant="outline">
							Explore the demo world
						</Button>
					) : null}
					<Button
						aria-busy={busy || undefined}
						className="min-w-36"
						disabled={actionDisabled}
						onClick={() => onAction(preview.action.kind)}
						type="button"
					>
						{busy ? (
							<Loader2
								aria-hidden="true"
								className={cn(
									"size-4",
									!reduceMotion && "motion-safe:animate-spin",
								)}
							/>
						) : (
							<ActionIcon kind={preview.action.kind} />
						)}
						{busy ? "Joining…" : preview.action.label}
					</Button>
				</div>
			</div>

			<div className="border-t px-5 py-4">
				{preview.hasSnapshot ? (
					<div className="grid grid-cols-3 gap-3 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
						<DetailTile className="col-span-3 xl:col-span-1" label="Roster">
							{preview.roster.length > 0 ? (
								<ul className="flex flex-wrap gap-1.5">
									{preview.roster.map((participant) => (
										<ParticipantChip
											key={participant.id}
											participant={participant}
										/>
									))}
								</ul>
							) : (
								<span className="text-sm text-muted-foreground">
									No one seated
								</span>
							)}
						</DetailTile>
						<DetailTile label="Spotlight">
							<div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
								<MonitorPlay
									aria-hidden="true"
									className="size-3.5 shrink-0 text-primary"
								/>
								<span className="truncate">
									{preview.sharer?.displayName ?? "No one sharing"}
								</span>
							</div>
							<div className="mt-0.5 truncate text-xs text-muted-foreground">
								{preview.cardCount} {preview.cardCount === 1 ? "card" : "cards"}
								{preview.cardCount > 0 ? " on the stage" : ""}
							</div>
							<div
								className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground"
								title={
									preview.presenter
										? `Presenter: ${preview.presenter.displayName}, ${preview.presenter.remainingLabel}`
										: "No Presenter granted"
								}
							>
								{preview.presenter ? (
									<>
										<Badge
											className="h-4 border-primary/40 px-1 text-[10px] text-primary"
											variant="outline"
										>
											Presenter
										</Badge>
										<span className="truncate">
											{preview.presenter.displayName}
											{preview.presenter.remainingLabel
												? ` · ${preview.presenter.remainingLabel}`
												: ""}
										</span>
									</>
								) : (
									"No Presenter granted"
								)}
							</div>
						</DetailTile>
						<DetailTile label="Working state">
							<div className="text-sm font-medium text-foreground">
								{preview.subModeLabel}
							</div>
							<div
								className="mt-0.5 truncate text-xs text-muted-foreground"
								title={`Addressing ${preview.addressLabel}`}
							>
								Addressing {preview.addressLabel}
							</div>
						</DetailTile>
						<DetailTile label="Wire">
							<div className="font-mono text-sm text-foreground tabular-nums">
								seq {preview.seq}
							</div>
							<div
								className="mt-0.5 truncate text-xs text-muted-foreground"
								title={preview.lastEventAt ?? undefined}
							>
								{preview.lastEventAt
									? `Updated ${roomRelativeTime(preview.lastEventAt, now)}`
									: "No events yet"}
							</div>
						</DetailTile>
					</div>
				) : checking ? (
					<DetailSkeleton />
				) : (
					<div className="flex min-h-7 flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
						<p className="max-w-3xl leading-6">
							{unreachable
								? "Drive runs against the Cline Hub daemon this app started. Nothing on this page is real until it answers."
								: "Starting a call seats you and Cline in the room and turns Drive on. Your agents' work lands on the Spotlight as typed events — there is no screen capture to set up."}
						</p>
						<Button
							className="shrink-0"
							onClick={onOpenRooms}
							size="sm"
							type="button"
							variant="ghost"
						>
							<DoorOpen aria-hidden="true" className="size-3.5" />
							See every room
						</Button>
					</div>
				)}
			</div>
		</section>
	);
}
