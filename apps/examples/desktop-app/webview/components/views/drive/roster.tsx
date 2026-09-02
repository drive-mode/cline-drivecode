"use client";

/**
 * The call roster (DRV-ROSTER) — who is on the call, what they are doing,
 * and the badges the hub asserts about them (mute, raised hand, sharing,
 * Presenter). Every fact here is read from the room snapshot; nothing is
 * kept locally. Ported from the hub's `drive/Roster.tsx` + `AgentAvatar.tsx`
 * onto the desktop kit.
 *
 * Agents wear the Cline mark (the builtin pair partner) or an initial, tinted
 * with their resolved name ink; humans keep the room's chrome colours.
 */

import type { Participant } from "@cline/shared";
import {
	Crown,
	Hand,
	MicOff,
	Package,
	ScreenShare,
	Sparkles,
} from "lucide-react";
import type { CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ParticipantInk } from "@/lib/drive/agent-ink";
import {
	isClineParticipant,
	participantInitials,
	participantStatusLabel,
} from "@/lib/drive/stage-cards";
import { cn } from "@/lib/utils";

export type RosterEntry = {
	participant: Participant;
	ink: ParticipantInk | null;
	muted: boolean;
	handRaised: boolean;
	/** Holds the stage right now. */
	sharing: boolean;
	/** Holds the active Presenter grant. */
	presenter: boolean;
	isYou: boolean;
};

/**
 * The Cline bot-head mark as an inline icon, ported 1:1 from the hub webview
 * (`apps/cline-hub/src/webview/src/components/icons/cline-mark.tsx`): an
 * explicit `currentColor` fill so it takes the agent's ink like text does.
 * Worn only by the builtin pair partner — never by any other agent.
 */
export function ClineMarkIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="currentColor"
			height="24"
			viewBox="0 0 466.73 487.04"
			width="24"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M463.6,275.08l-29.26-58.75v-33.83c0-56.08-45.01-101.5-100.53-101.5h-50.01c3.62-7.43,5.61-15.79,5.61-24.61,0-31.17-25.08-56.39-56.07-56.39s-56.07,25.22-56.07,56.39c0,8.82,1.99,17.17,5.61,24.61h-50.01c-55.51,0-100.52,45.42-100.52,101.5v33.83l-29.87,58.59c-3.01,5.9-3.01,12.92,0,18.81l29.87,57.93v33.83c0,56.08,45.01,101.5,100.52,101.5h200.95c55.51,0,100.53-45.42,100.53-101.5v-33.83l29.21-58.13c2.9-5.79,2.9-12.61.05-18.46ZM202.75,322.96c0,25.48-20.54,46.14-45.88,46.14s-45.88-20.66-45.88-46.14v-82.02c0-25.48,20.54-46.14,45.88-46.14s45.88,20.66,45.88,46.14v82.02ZM350.58,322.96c0,25.48-20.54,46.14-45.88,46.14s-45.88-20.66-45.88-46.14v-82.02c0-25.48,20.54-46.14,45.88-46.14s45.88,20.66,45.88,46.14v82.02Z" />
		</svg>
	);
}

const AVATAR_SIZE = {
	sm: { box: "size-6 text-[10px]", mark: "size-3.5" },
	md: { box: "size-8 text-[12px]", mark: "size-4" },
	lg: { box: "size-12 text-base", mark: "size-6" },
} as const;

export type ParticipantAvatarSize = keyof typeof AVATAR_SIZE;

/**
 * A participant's avatar, tinted with the participant's resolved name ink so
 * the avatar, the roster name and the feed byline are the same colour without
 * any of them picking one.
 */
export function ParticipantAvatar({
	participant,
	ink,
	size = "md",
	className,
	speaking = false,
}: {
	participant: Participant;
	/** Resolved, contrast-clamped ink. Null keeps the human hue. */
	ink: ParticipantInk | null;
	size?: ParticipantAvatarSize;
	className?: string;
	speaking?: boolean;
}) {
	const sizes = AVATAR_SIZE[size];
	const isAgent = participant.kind === "agent";
	const wearsMark = isAgent && isClineParticipant(participant);
	const style: CSSProperties | undefined =
		isAgent && ink ? { color: ink.css } : undefined;
	return (
		<span
			aria-hidden="true"
			className={cn(
				"grid shrink-0 place-items-center rounded-full border font-mono font-semibold leading-none",
				sizes.box,
				isAgent && ink
					? "border-current/40 bg-current/15"
					: isAgent
						? "border-border bg-secondary text-secondary-foreground"
						: "border-primary/40 bg-primary/15 text-primary",
				speaking && "drive-speaking",
				className,
			)}
			data-agent-avatar={wearsMark ? "cline-mark" : "initial"}
			data-participant-id={participant.id}
			style={style}
		>
			{wearsMark ? (
				<ClineMarkIcon className={sizes.mark} />
			) : (
				participantInitials(participant)
			)}
		</span>
	);
}

const STATUS_DOT: Record<Participant["status"], string> = {
	idle: "bg-muted-foreground/50",
	working: "bg-info-solid",
	speaking: "bg-success-solid",
	away: "bg-transparent border border-muted-foreground/60",
};

export function ParticipantStatusDot({
	status,
	className,
}: {
	status: Participant["status"];
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-block size-1.5 shrink-0 rounded-full",
				STATUS_DOT[status],
				className,
			)}
		/>
	);
}

function rosterAriaLabel(entry: RosterEntry): string {
	const { participant } = entry;
	const parts = [
		participant.displayName,
		participant.kind === "human"
			? participant.role
			: `${participant.role} agent`,
		participantStatusLabel(participant.status),
	];
	if (entry.isYou) {
		parts.push("you");
	}
	if (entry.presenter) {
		parts.push("Presenter");
	}
	if (entry.sharing) {
		parts.push("on the Spotlight");
	}
	if (entry.muted) {
		parts.push("muted");
	}
	if (entry.handRaised) {
		parts.push("hand raised");
	}
	return parts.join(", ");
}

function seatSourceHint(participant: Participant): string | null {
	if (participant.kind !== "agent" || participant.seatSources.length === 0) {
		return null;
	}
	const pack = participant.seatSources.find((source) => source.kind === "pack");
	if (pack && pack.kind === "pack") {
		return pack.packId;
	}
	const spawn = participant.seatSources.find(
		(source) => source.kind === "spawn",
	);
	if (spawn && spawn.kind === "spawn") {
		return `spawned by ${spawn.parentId}`;
	}
	return null;
}

function RosterRow({
	entry,
	selected,
	onSelect,
}: {
	entry: RosterEntry;
	selected: boolean;
	onSelect: (participantId: string) => void;
}) {
	const { participant, ink } = entry;
	const speaking = participant.status === "speaking";
	const packHint = seatSourceHint(participant);
	return (
		<li>
			<button
				aria-label={rosterAriaLabel(entry)}
				aria-pressed={selected}
				className={cn(
					"group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors",
					"hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/50",
					selected && "bg-surface-hover",
				)}
				onClick={() => onSelect(participant.id)}
				type="button"
			>
				<ParticipantAvatar
					ink={ink}
					participant={participant}
					speaking={speaking}
				/>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="flex min-w-0 items-center gap-1.5">
						<span
							className="truncate text-sm font-medium text-foreground"
							style={ink ? { color: ink.css } : undefined}
						>
							{participant.displayName}
						</span>
						{entry.isYou ? (
							<span className="shrink-0 text-[10px] text-muted-foreground">
								you
							</span>
						) : null}
						{entry.presenter ? (
							<Crown
								aria-hidden="true"
								className="size-3 shrink-0 text-warning-text"
							/>
						) : null}
					</span>
					<span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
						<ParticipantStatusDot status={participant.status} />
						<span className="truncate">
							{participant.role} · {participantStatusLabel(participant.status)}
							{packHint ? ` · ${packHint}` : ""}
						</span>
					</span>
				</span>
				<span className="flex shrink-0 items-center gap-1">
					{entry.sharing ? (
						<Badge
							aria-label="On the Spotlight"
							className="h-5 gap-1 px-1.5 text-[10px]"
							variant="secondary"
						>
							<ScreenShare className="size-3" />
							Spotlight
						</Badge>
					) : null}
					{entry.muted ? (
						<Badge
							aria-label="Muted"
							className="h-5 px-1 text-[10px]"
							variant="destructive"
						>
							<MicOff className="size-3" />
						</Badge>
					) : null}
					{entry.handRaised ? (
						<Badge
							aria-label="Hand raised"
							className="h-5 px-1 text-[10px]"
							variant="outline"
						>
							<Hand className="size-3" />
						</Badge>
					) : null}
				</span>
			</button>
		</li>
	);
}

export function Roster({
	entries,
	selectedId,
	onSelect,
	className,
}: {
	entries: readonly RosterEntry[];
	selectedId: string | null;
	onSelect: (participantId: string) => void;
	className?: string;
}) {
	const agents = entries.filter((entry) => entry.participant.kind === "agent");
	return (
		<section
			aria-label="Call roster"
			className={cn("flex min-h-0 flex-col", className)}
		>
			<header className="flex items-center justify-between px-3 pt-3 pb-1">
				<h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
					On call
				</h2>
				<span className="text-[11px] text-muted-foreground">
					{entries.length} seated · {agents.length}{" "}
					{agents.length === 1 ? "agent" : "agents"}
				</span>
			</header>
			{entries.length === 0 ? (
				<p className="px-3 pb-3 text-xs text-muted-foreground">
					Nobody is seated yet. Join the call to seat yourself and your partner.
				</p>
			) : (
				<ul className="flex flex-col gap-0.5 px-1 pb-2">
					{entries.map((entry) => (
						<RosterRow
							entry={entry}
							key={entry.participant.id}
							onSelect={onSelect}
							selected={selectedId === entry.participant.id}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

/** The folded drawer's rail: avatars only, each a button to the sheet. */
export function RosterRail({
	entries,
	selectedId,
	onSelect,
	className,
}: {
	entries: readonly RosterEntry[];
	selectedId: string | null;
	onSelect: (participantId: string) => void;
	className?: string;
}) {
	return (
		<ul
			aria-label="Call roster"
			className={cn("flex flex-col items-center gap-1.5", className)}
		>
			{entries.map((entry) => (
				<li className="relative" key={entry.participant.id}>
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								aria-label={rosterAriaLabel(entry)}
								aria-pressed={selectedId === entry.participant.id}
								className={cn(
									"grid place-items-center rounded-full p-0.5 outline-none transition-colors hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/50",
									selectedId === entry.participant.id && "bg-surface-hover",
								)}
								onClick={() => onSelect(entry.participant.id)}
								type="button"
							>
								<ParticipantAvatar
									ink={entry.ink}
									participant={entry.participant}
									size="md"
									speaking={entry.participant.status === "speaking"}
								/>
							</button>
						</TooltipTrigger>
						<TooltipContent side="left">
							{rosterAriaLabel(entry)}
						</TooltipContent>
					</Tooltip>
					{entry.sharing ? (
						<Sparkles
							aria-hidden="true"
							className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-background p-px text-warning-text"
						/>
					) : entry.muted ? (
						<MicOff
							aria-hidden="true"
							className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-background p-px text-error-text"
						/>
					) : entry.handRaised ? (
						<Hand
							aria-hidden="true"
							className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-background p-px text-foreground"
						/>
					) : null}
				</li>
			))}
		</ul>
	);
}

export { Package as RosterPackIcon };
