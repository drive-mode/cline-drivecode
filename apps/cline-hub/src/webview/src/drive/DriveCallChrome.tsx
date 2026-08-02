import type { StageCard } from "@cline/shared";
import {
	ApertureIcon,
	EarIcon,
	HandIcon,
	HeadphoneOffIcon,
	HeadphonesIcon,
	Loader2Icon,
	MicIcon,
	MicOffIcon,
	PhoneIcon,
	PhoneOffIcon,
	RotateCcwIcon,
	Settings2Icon,
	UsersIcon,
	VolumeXIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
	interruptChromeCopy,
	resolveInterruptPhase,
} from "./agencyChrome";
import { isDriveHumanId } from "./participantIds";
import type { DriveSubMode, DriveUiState } from "./types";
import type { DriveConnectionPhase } from "./useDriveSession";

const SUB_MODES: DriveSubMode[] = ["plan", "agent", "ask", "debug"];

export function DriveHeaderControls({
	connectionPhase,
	drive,
	disabled,
	onJoinDrive,
	onLeaveDrive,
	onEndDrive,
	onToggleSpotlight,
}: {
	connectionPhase: DriveConnectionPhase;
	drive: DriveUiState;
	disabled?: boolean;
	onJoinDrive: () => void;
	onLeaveDrive: () => void;
	/** End closes the session with Tier-0 handoff (distinct from Leave). */
	onEndDrive?: () => void;
	onToggleSpotlight: () => void;
}) {
	const joining = connectionPhase === "joining";
	const onCall = connectionPhase === "on";
	const statusText =
		connectionPhase === "joining"
			? "Joining Drive call."
			: connectionPhase === "on"
				? "Drive call connected."
				: connectionPhase === "error"
					? "Drive call connection failed."
					: "Drive call disconnected.";

	return (
		<div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
			<span
				aria-atomic="true"
				aria-live="polite"
				className="sr-only"
				role="status"
			>
				{statusText}
			</span>
			{onCall && drive.active ? (
				<>
					<Badge
						className="max-w-full gap-1.5 border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
						title={`Drive · ${drive.partnerName}`}
						variant="outline"
					>
						{/* Call-live indicator. It used to key off mic state, which
						    stops pulsing entirely now that the mic defaults to muted —
						    and mic state already has its own button on the strip. */}
						<span
							aria-hidden
							className="inline-block size-2 animate-pulse rounded-full bg-amber-500"
						/>
						<span className="max-w-40 truncate">
							Drive · {drive.partnerName}
						</span>
					</Badge>
					<Button
						aria-pressed={drive.stageLayout}
						disabled={disabled}
						onClick={onToggleSpotlight}
						size="sm"
						type="button"
						variant={drive.stageLayout ? "default" : "outline"}
					>
						{drive.stageLayout ? "Hide Spotlight" : "Show Spotlight"}
					</Button>
				</>
			) : null}
			{onCall && onEndDrive ? (
				<Button
					aria-label="End Drive call"
					disabled={disabled}
					onClick={onEndDrive}
					size="sm"
					title="End call with handoff summary (closes the room)"
					type="button"
					variant="outline"
				>
					End call
				</Button>
			) : null}
			<Button
				aria-label={joining ? "Cancel joining Drive call" : undefined}
				disabled={disabled}
				onClick={onCall || joining ? onLeaveDrive : onJoinDrive}
				size="sm"
				title={
					onCall
						? "Leave call (work continues; rejoin to catch up)"
						: undefined
				}
				type="button"
				variant={onCall ? "default" : "outline"}
			>
				{onCall ? (
					<>
						<PhoneOffIcon className="size-3.5" />
						Leave call
					</>
				) : joining ? (
					<>
						<Loader2Icon className="size-3.5 animate-spin" />
						Joining…
					</>
				) : (
					<>
						<PhoneIcon className="size-3.5" />
						Join call
					</>
				)}
			</Button>
		</div>
	);
}

/**
 * One 30px icon-only call control — the canvas `.strip-btn`.
 *
 * Icon-only chrome is only a win when it stays labelled, so the label is a
 * required prop and feeds both the tooltip and `aria-label`.
 */
function StripButton({
	children,
	disabled,
	label,
	onClick,
	pressed,
	tone = "neutral",
}: {
	children: ReactNode;
	disabled?: boolean;
	/** Accessible name — also the tooltip copy. */
	label: string;
	onClick: () => void;
	/** Omit for controls that are not toggles (settings, leave). */
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
							"size-[30px] shrink-0 [&_svg]:size-[15px]",
							tone === "live" &&
								"border-amber-500/55 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:border-amber-400/55 dark:bg-amber-400/10 dark:text-amber-300",
							tone === "danger" &&
								"border-destructive/45 bg-destructive/10 text-destructive hover:bg-destructive/20",
						)}
						disabled={disabled}
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

/**
 * The strip's single piece of text status. The canvas cycles modes on click;
 * a menu is used here so every mode stays one action away, as it was when the
 * strip carried four mode buttons.
 */
function DriveModePill({
	disabled,
	onSubModeChange,
	subMode,
}: {
	disabled?: boolean;
	onSubModeChange: (mode: DriveSubMode) => void;
	subMode: DriveSubMode;
}) {
	const label = `Working mode: ${subMode}`;
	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger
					render={
						<DropdownMenuTrigger
							render={
								<Button
									aria-label={label}
									// The outline variant repaints aria-expanded like a popover
									// trigger; the pill keeps its amber skin while open.
									className="h-[30px] shrink-0 rounded-full border-amber-500/45 bg-amber-500/15 px-3 text-xs font-semibold capitalize text-amber-700 aria-expanded:bg-amber-500/25 aria-expanded:text-amber-700 dark:border-amber-400/45 dark:bg-amber-400/15 dark:text-amber-300 dark:aria-expanded:text-amber-300"
									disabled={disabled}
									size="sm"
									type="button"
									variant="outline"
								/>
							}
						/>
					}
				>
					{subMode}
				</TooltipTrigger>
				<TooltipContent>{label}</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start" className="min-w-32">
				<DropdownMenuRadioGroup
					onValueChange={(value) => onSubModeChange(value as DriveSubMode)}
					value={subMode}
				>
					{SUB_MODES.map((mode) => (
						<DropdownMenuRadioItem
							className="capitalize"
							key={mode}
							value={mode}
						>
							{mode}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function DriveCallStrip({
	drive,
	disabled,
	workerCount = 0,
	workersOpen = false,
	turnInFlight = false,
	onMuteToggle,
	onDeafenToggle,
	onHandToggle,
	onSubModeChange,
	onClearOverride,
	onLeaveDrive,
	onOpenSettings,
	onToggleSpotlight,
	onTogglePartnerMute,
	onTogglePartnerDeafen,
	onToggleWorkers,
}: {
	drive: DriveUiState;
	disabled?: boolean;
	workerCount?: number;
	workersOpen?: boolean;
	/** True while an agent turn is running — raise-hand → finishing chrome. */
	turnInFlight?: boolean;
	onMuteToggle: () => void;
	/** Self output mute — stops this browser speaking agent audio. */
	onDeafenToggle?: () => void;
	onHandToggle: () => void;
	onSubModeChange: (mode: DriveSubMode) => void;
	onClearOverride?: () => void;
	/** Hang up: leaves the call, work continues. Never the Tier-0 End. */
	onLeaveDrive?: () => void;
	onOpenSettings?: () => void;
	onToggleSpotlight?: () => void;
	onTogglePartnerMute?: () => void;
	onTogglePartnerDeafen?: () => void;
	onToggleWorkers?: () => void;
}) {
	if (!drive.active) {
		return null;
	}

	const spotlightLabel = isDriveHumanId(drive.spotlightParticipantId)
		? "you"
		: drive.partnerName;
	const nextSpotlightLabel = isDriveHumanId(drive.spotlightParticipantId)
		? drive.partnerName
		: "you";
	const interruptPhase = resolveInterruptPhase({
		handRaised: drive.handRaised,
		turnInFlight,
	});
	const interruptCopy = interruptChromeCopy(interruptPhase);
	// Icon states carry the status the old text run spelled out; assistive tech
	// gets the same facts back from a live region. One span per fact (and no
	// aria-atomic) so a single toggle announces itself, not the whole strip.
	const statusFacts: Array<{ id: string; text: string }> = [
		{ id: "mic", text: drive.muted ? "You are muted" : "Your mic is live" },
		{
			id: "deafen",
			text: drive.deafened ? "You are deafened" : "",
		},
		{ id: "spotlight", text: `Spotlight on ${spotlightLabel}` },
		{
			id: "partner-audio",
			text: [
				drive.partnerMuted ? "muted" : null,
				drive.partnerDeafened ? "deafened" : null,
			]
				.filter((part): part is string => part != null)
				.map((part) => `${drive.partnerName} is ${part}`)
				.join(", "),
		},
		{
			id: "mode",
			text: drive.postureOverride
				? `Working mode ${drive.subMode}, posture override`
				: `Working mode ${drive.subMode}`,
		},
		{ id: "hand", text: drive.handRaised ? "Your hand is raised" : "" },
	];

	return (
		<div className="flex items-center gap-2 overflow-x-auto border-b border-amber-500/30 bg-amber-500/5 px-4 py-[7px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
			<span className="sr-only" role="status">
				{statusFacts.map((fact) => (
					// Trailing stop so adjacent facts do not run together aloud.
					<span key={fact.id}>{fact.text ? `${fact.text}. ` : ""}</span>
				))}
			</span>
			<StripButton
				disabled={disabled}
				label={drive.muted ? "Unmute" : "Mute"}
				onClick={onMuteToggle}
				pressed={drive.muted}
				tone={drive.muted ? "danger" : "neutral"}
			>
				{drive.muted ? <MicOffIcon /> : <MicIcon />}
			</StripButton>
			{/* Output mute, paired with the mic the way every call app pairs them.
			    Mic governs what the room hears; this governs what you hear. */}
			<StripButton
				disabled={disabled}
				label={
					drive.deafened
						? "Undeafen (hear the partner again)"
						: "Deafen (stop partner audio here)"
				}
				onClick={() => onDeafenToggle?.()}
				pressed={drive.deafened}
				tone={drive.deafened ? "danger" : "neutral"}
			>
				{drive.deafened ? <HeadphoneOffIcon /> : <HeadphonesIcon />}
			</StripButton>
			<StripButton
				disabled={disabled}
				label={drive.handRaised ? "Lower hand" : "Raise hand"}
				onClick={onHandToggle}
				pressed={drive.handRaised}
				tone={drive.handRaised ? "live" : "neutral"}
			>
				<HandIcon />
			</StripButton>
			<StripButton
				disabled={disabled}
				label={`Move Spotlight to ${nextSpotlightLabel}`}
				onClick={() => onToggleSpotlight?.()}
			>
				<ApertureIcon />
			</StripButton>
			<StripButton
				disabled={disabled}
				label={
					drive.partnerMuted
						? `Unmute ${drive.partnerName}`
						: `Mute ${drive.partnerName} (cannot speak)`
				}
				onClick={() => onTogglePartnerMute?.()}
				pressed={drive.partnerMuted}
				tone={drive.partnerMuted ? "live" : "neutral"}
			>
				<VolumeXIcon />
			</StripButton>
			<StripButton
				disabled={disabled}
				label={
					drive.partnerDeafened
						? `Undeafen ${drive.partnerName}`
						: `Deafen ${drive.partnerName} (cannot hear)`
				}
				onClick={() => onTogglePartnerDeafen?.()}
				pressed={drive.partnerDeafened}
				tone={drive.partnerDeafened ? "live" : "neutral"}
			>
				{/* Their hearing, not yours — the headphones glyph now belongs to
				    the self-deafen control two buttons back. */}
				<EarIcon />
			</StripButton>
			<DriveModePill
				disabled={disabled}
				onSubModeChange={onSubModeChange}
				subMode={drive.subMode}
			/>
			{drive.postureOverride ? (
				<StripButton
					disabled={disabled}
					label={`Clear ${drive.postureOverride} override (back to bank posture)`}
					onClick={() => onClearOverride?.()}
					tone="live"
				>
					<RotateCcwIcon />
				</StripButton>
			) : null}
			{onToggleWorkers ? (
				<StripButton
					disabled={disabled}
					label={
						workerCount > 0 ? `Worker audit (${workerCount})` : "Worker audit"
					}
					onClick={() => onToggleWorkers()}
					pressed={workersOpen}
					tone={workersOpen ? "live" : "neutral"}
				>
					<span className="relative flex items-center justify-center">
						<UsersIcon />
						{workerCount > 0 ? (
							<span
								aria-hidden
								className="absolute -top-2 -right-2 rounded-full bg-amber-500 px-1 text-[9px] leading-[13px] font-semibold text-amber-950"
							>
								{workerCount > 9 ? "9+" : workerCount}
							</span>
						) : null}
					</span>
				</StripButton>
			) : null}
			<StripButton
				disabled={disabled}
				label="Call settings"
				onClick={() => onOpenSettings?.()}
			>
				<Settings2Icon />
			</StripButton>
			{onLeaveDrive ? (
				<StripButton
					disabled={disabled}
					label="Leave call (work continues; rejoin to catch up)"
					onClick={() => onLeaveDrive()}
					tone="danger"
				>
					<PhoneIcon className="rotate-[135deg]" />
				</StripButton>
			) : null}
			{/* Status, not a control: it yields the fixed room the buttons need. */}
			{interruptCopy ? (
				<span
					aria-live="polite"
					className="shrink-0 rounded-full border border-amber-600/40 bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-900 dark:text-amber-100"
					data-slot="agency-interrupt"
					role="status"
				>
					{interruptCopy}
				</span>
			) : null}
			<span className="ml-auto hidden shrink-0 pl-2 text-xs text-muted-foreground sm:inline">
				with{" "}
				<b className="font-medium text-amber-700 dark:text-amber-300">
					{drive.partnerName}
				</b>
			</span>
		</div>
	);
}

export function DriveStagePanel({
	sharingLabel,
	nowLabel,
	nextLabel,
	children,
}: {
	sharingLabel: string;
	nowLabel: string;
	nextLabel: string;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col border-l bg-muted/20">
			<div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
				<span className="text-emerald-600 dark:text-emerald-400">● sharing</span>
				<span className="truncate">{sharingLabel}</span>
			</div>
			<div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
			<div className="grid grid-cols-2 gap-2 border-t p-3">
				<div className="rounded-md border bg-background p-2">
					<div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
						now
					</div>
					<div className="text-xs">{nowLabel}</div>
				</div>
				<div className="rounded-md border bg-background p-2">
					<div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
						next
					</div>
					<div className="text-xs">{nextLabel}</div>
				</div>
			</div>
		</div>
	);
}

export function DriveStageCards({ cards }: { cards: readonly StageCard[] }) {
	return (
		<div className="space-y-2">
			<p className="text-xs text-muted-foreground">
				Latest Spotlight updates from the shared event stream.
			</p>
			{cards.map((card) => (
				<div
					className="rounded-md border bg-background p-2"
					key={card.id}
				>
					<div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
						<span className="rounded border px-1.5 py-0.5">{card.category}</span>
						<span className="truncate font-medium normal-case text-foreground">
							{card.title}
						</span>
					</div>
					{card.summary ? (
						<pre className="mt-1 overflow-auto font-mono text-[11px] text-muted-foreground">
							{card.summary}
						</pre>
					) : null}
				</div>
			))}
		</div>
	);
}
