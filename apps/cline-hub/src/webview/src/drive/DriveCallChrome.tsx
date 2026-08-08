import type { StageCard, StagePin } from "@cline/shared";
import {
	ApertureIcon,
	CaptionsIcon,
	CaptionsOffIcon,
	EarIcon,
	HandIcon,
	HeadphoneOffIcon,
	HeadphonesIcon,
	ListTodoIcon,
	Loader2Icon,
	MicIcon,
	MicOffIcon,
	PanelBottomIcon,
	PhoneIcon,
	PinIcon,
	RotateCcwIcon,
	SlidersHorizontalIcon,
	UsersIcon,
	VolumeXIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
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
	debugRetentionStripCopy,
	interruptChromeCopy,
	resolveInterruptPhase,
} from "./agencyChrome";
import { isDriveHumanId } from "./participantIds";
import { buildHumanPinDefaults, type HumanPinKind } from "./pinDefaults";
import type { DriveSubMode, DriveUiState } from "./types";
import type { DriveConnectionPhase } from "./useDriveSession";
import { driveOutputSilenced } from "./voice/driveEarcons";
import {
	outputVolumeFromPercent,
	outputVolumePercent,
} from "./voice/driveHardwarePrefs";

const SUB_MODES: DriveSubMode[] = ["plan", "agent", "ask", "debug"];

export function DriveHeaderControls({
	connectionPhase,
	drive,
	disabled,
	onJoinDrive,
	onLeaveDrive,
	onEndDrive,
	onToggleStageLayout,
}: {
	connectionPhase: DriveConnectionPhase;
	drive: DriveUiState;
	disabled?: boolean;
	onJoinDrive: () => void;
	/** Cancels a join in flight. Leaving an established call is strip-only. */
	onLeaveDrive: () => void;
	/** End closes the session with Tier-0 handoff (distinct from Leave). */
	onEndDrive?: () => void;
	/** Flips the Spotlight/feed split layout — not who is sharing. */
	onToggleStageLayout: () => void;
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
						onClick={onToggleStageLayout}
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
			{/* No Leave here: the strip already carries it, and two Leave buttons
			    on one screen is the duplication this header used to create. End
			    stays because it is a Tier-0 close with no strip equivalent. */}
			{onCall ? null : (
				<Button
					aria-label={joining ? "Cancel joining Drive call" : undefined}
					disabled={disabled}
					onClick={joining ? onLeaveDrive : onJoinDrive}
					size="sm"
					type="button"
					variant="outline"
				>
					{joining ? (
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
			)}
		</div>
	);
}

/**
 * One icon-only call control — the canvas `.strip-btn`.
 *
 * Desktop stays at the canvas 30px density. At ≤720px (phone / narrow hub
 * rail) bump to 44px so the strip meets the touch target floor without a
 * second component tree (ux-quality phase 2).
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
							"size-[30px] shrink-0 touch-manipulation max-[720px]:size-11 [&_svg]:size-[15px] max-[720px]:[&_svg]:size-[18px]",
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
 * Output volume, sitting beside deafen because it governs the same thing:
 * what this browser plays. The canvas's compact 64px slider.
 *
 * It is a view of `driveVoice.hardware.outputVolume` — the same pref the
 * settings panel edits and the same one `speak()` and `driveEarconVolume()`
 * read. Nothing is stored here.
 *
 * Hidden below `sm`. Measured at 520px with every optional control present,
 * the twelve buttons and the mode pill span 469px of a 488px content box —
 * 19px of slack, against the 72px this slider and its gap want. It yields
 * rather than pushing Leave past the edge of a strip whose scrollbar is
 * hidden; volume stays one click away in the settings panel, whose button
 * never leaves the strip.
 */
function StripVolume({
	disabled,
	dimmed,
	onChange,
	volume,
}: {
	disabled?: boolean;
	/** Output is silenced anyway — shown, still adjustable, visibly inert. */
	dimmed: boolean;
	onChange: (volume: number) => void;
	volume: number;
}) {
	const percent = outputVolumePercent(volume);
	const valueText = `${percent}%`;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<input
						// The name stays put and the value rides `aria-valuetext`;
						// baking the percent into the label would rename the control
						// on every arrow key and say the number twice.
						aria-label="Partner volume"
						aria-valuetext={valueText}
						className={cn(
							"hidden h-[30px] w-16 shrink-0 cursor-pointer rounded-full accent-amber-600 outline-none sm:block dark:accent-amber-400",
							// The strip's buttons get their focus ring from the Button
							// variant; a bare input has to ask for the same one.
							"focus-visible:ring-3 focus-visible:ring-ring/50",
							dimmed && "opacity-45",
						)}
						disabled={disabled}
						max={100}
						min={0}
						onChange={(event) =>
							onChange(outputVolumeFromPercent(Number(event.target.value)))
						}
						step={1}
						type="range"
						value={percent}
					/>
				}
			/>
			<TooltipContent>{`Partner volume: ${valueText}`}</TooltipContent>
		</Tooltip>
	);
}

/**
 * Share pin on the strip — the one call control the roster sheet had and the
 * strip did not, two clicks deep behind a participant row. It hands the caller
 * a {@link StagePin} that goes out through the same `buildSetStageMessage` the
 * sheet's chooser uses (`stageSharePin.ts`), never a second payload.
 *
 * Defaults are read here, at render, exactly as the sheet reads them, so the
 * `selection` pin still sees the live browser selection.
 */
function StripSharePin({
	disabled,
	drive,
	onSharePin,
}: {
	disabled?: boolean;
	drive: DriveUiState;
	onSharePin: (pin: StagePin) => void;
}) {
	const defaults = buildHumanPinDefaults(drive.stageCards);
	const label =
		"Share pin (take Spotlight with a selection, file, or terminal)";
	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger
					render={
						<DropdownMenuTrigger
							render={
								<Button
									aria-label={label}
									className="size-[30px] shrink-0 touch-manipulation max-[720px]:size-11 [&_svg]:size-[15px] max-[720px]:[&_svg]:size-[18px]"
									data-testid="drive-strip-share-pin"
									disabled={disabled}
									size="icon-sm"
									type="button"
									variant="outline"
								/>
							}
						/>
					}
				>
					<PinIcon />
				</TooltipTrigger>
				<TooltipContent>{label}</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start" className="min-w-44">
				{(Object.keys(defaults) as HumanPinKind[]).map((kind) => (
					<DropdownMenuItem
						data-testid={`drive-strip-share-pin-${kind}`}
						key={kind}
						onClick={() => onSharePin(defaults[kind])}
					>
						<span className="capitalize">Pin {kind}</span>
						<span className="ml-auto max-w-[10rem] truncate text-[10px] text-muted-foreground">
							{defaults[kind].label}
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
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
									className="h-[30px] shrink-0 touch-manipulation rounded-full border-amber-500/45 bg-amber-500/15 px-3 text-xs font-semibold capitalize text-amber-700 aria-expanded:bg-amber-500/25 aria-expanded:text-amber-700 max-[720px]:h-11 dark:border-amber-400/45 dark:bg-amber-400/15 dark:text-amber-300 dark:aria-expanded:text-amber-300"
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
	captionsOpen,
	drive,
	disabled,
	outputVolume,
	workerCount = 0,
	workersOpen = false,
	turnInFlight = false,
	powerOpen = false,
	planOpen = false,
	spendLabel,
	onMuteToggle,
	onDeafenToggle,
	onHandToggle,
	onOutputVolumeChange,
	onToggleCaptions,
	onSubModeChange,
	onClearOverride,
	onLeaveDrive,
	onOpenSettings,
	onMoveSpotlight,
	onSharePin,
	onTogglePartnerMute,
	onTogglePartnerDeafen,
	onToggleWorkers,
	onTogglePower,
	onTogglePlan,
}: {
	/** CC panel open — the strip button is its only control. */
	captionsOpen: boolean;
	drive: DriveUiState;
	disabled?: boolean;
	/** `driveVoice.hardware.outputVolume` in [0, 1] — never a local copy. */
	outputVolume: number;
	workerCount?: number;
	workersOpen?: boolean;
	/** True while an agent turn is running — raise-hand → finishing chrome. */
	turnInFlight?: boolean;
	/** Power cockpit sheet open (PU0). */
	powerOpen?: boolean;
	/** Plan / task-bank sheet open (ADR-0029 D4 — off stage siblings). */
	planOpen?: boolean;
	/** Honest spend pill when measured (PU4); omit when unknown. */
	spendLabel?: string;
	onMuteToggle: () => void;
	/** Self output mute — stops this browser speaking agent audio. */
	onDeafenToggle?: () => void;
	onHandToggle: () => void;
	onOutputVolumeChange: (volume: number) => void;
	onToggleCaptions: () => void;
	onSubModeChange: (mode: DriveSubMode) => void;
	onClearOverride?: () => void;
	/** Hang up: leaves the call, work continues. Never the Tier-0 End. */
	onLeaveDrive?: () => void;
	onOpenSettings?: () => void;
	/** Changes who is sharing — not the split layout the header toggles. */
	onMoveSpotlight?: () => void;
	/** Take Spotlight with a pin. Same op as the roster sheet's Share pin. */
	onSharePin?: (pin: StagePin) => void;
	onTogglePartnerMute?: () => void;
	onTogglePartnerDeafen?: () => void;
	onToggleWorkers?: () => void;
	onTogglePower?: () => void;
	onTogglePlan?: () => void;
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
	const debugRetentionCopy = debugRetentionStripCopy(
		Boolean(
			(drive as DriveUiState & { debugRetention?: boolean }).debugRetention,
		),
	);
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
			id: "debug-retention",
			text: debugRetentionCopy ?? "",
		},
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
		<div className="flex items-center gap-2 overflow-x-auto border-b border-amber-500/30 bg-amber-500/5 px-4 py-[7px] max-[720px]:gap-2.5 max-[720px]:px-3 max-[720px]:py-2 max-[720px]:pb-[max(0.5rem,env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
			<StripVolume
				dimmed={driveOutputSilenced({
					selfSilenced: drive.deafened,
					partnerMuted: drive.partnerMuted,
				})}
				disabled={disabled}
				onChange={onOutputVolumeChange}
				volume={outputVolume}
			/>
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
				onClick={() => onMoveSpotlight?.()}
			>
				<ApertureIcon />
			</StripButton>
			{onSharePin ? (
				<StripSharePin
					disabled={disabled}
					drive={drive}
					onSharePin={onSharePin}
				/>
			) : null}
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
			{/* Canvas position: the last icon before the mode pill. */}
			<StripButton
				disabled={disabled}
				label={
					captionsOpen
						? "Hide live captions"
						: "Show live captions (nothing is saved)"
				}
				onClick={onToggleCaptions}
				pressed={captionsOpen}
				tone={captionsOpen ? "live" : "neutral"}
			>
				{captionsOpen ? <CaptionsIcon /> : <CaptionsOffIcon />}
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
			{onTogglePlan ? (
				<StripButton
					disabled={disabled}
					label={planOpen ? "Close plan" : "Open plan"}
					onClick={() => onTogglePlan()}
					pressed={planOpen}
					tone={planOpen ? "live" : "neutral"}
				>
					<ListTodoIcon />
				</StripButton>
			) : null}
			{onTogglePower ? (
				<StripButton
					disabled={disabled}
					label={powerOpen ? "Close power cockpit" : "Open power cockpit"}
					onClick={() => onTogglePower()}
					pressed={powerOpen}
					tone={powerOpen ? "live" : "neutral"}
				>
					<PanelBottomIcon />
				</StripButton>
			) : null}
			{/* Sliders, not a gear: the composer's gear opens the provider/model
			    panel, and two identical gears on one screen read as one control
			    rendered twice. Different panel, different glyph. */}
			<StripButton
				disabled={disabled}
				label="Call settings"
				onClick={() => onOpenSettings?.()}
			>
				<SlidersHorizontalIcon />
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
			{spendLabel ? (
				<span
					aria-label={`Session spend ${spendLabel}`}
					className="shrink-0 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-foreground"
					data-slot="call-spend-pill"
				>
					{spendLabel}
				</span>
			) : null}
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
