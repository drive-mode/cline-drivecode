"use client";

/**
 * The call strip — every call control in one row, each one an op the hub
 * owns (DRV-CALL-STRIP / ADR-0006: no second writer). Room name and live
 * dot, elapsed time, the working-mode segmented control, the address chip,
 * mute / raise hand, Move Spotlight, share pin, the feed fold, the keyboard
 * legend, and Leave / End. Ported from the hub's `drive/DriveCallChrome.tsx`
 * onto the desktop kit.
 */

import type {
	AddressSet,
	DriveSubMode,
	Participant,
	StagePin,
} from "@cline/shared";
import {
	Aperture,
	AtSign,
	Hand,
	Keyboard,
	LoaderCircle,
	LogOut,
	Mic,
	MicOff,
	Package,
	PanelRightClose,
	PanelRightOpen,
	PhoneOff,
	Pin,
	Radio,
	User,
	Users,
	UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	type AddressChoice,
	buildAddressChoices,
	formatAddressSetLabel,
	formatElapsed,
	HUMAN_PIN_KIND_LABEL,
	HUMAN_PIN_KINDS,
	type HumanPinKind,
	sameAddressSet,
} from "@/lib/drive/stage-cards";
import type { DrivePhase } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";

export const DRIVE_SUB_MODES: readonly {
	id: DriveSubMode;
	label: string;
	hint: string;
}[] = [
	{ id: "plan", label: "Plan", hint: "Agents propose before they act" },
	{ id: "act", label: "Act", hint: "Agents do the work" },
	{ id: "ask", label: "Ask", hint: "Answer questions, change nothing" },
	{ id: "debug", label: "Debug", hint: "Reproduce, isolate, explain" },
];

export type CallShortcut = { keys: string[]; label: string };

export const CALL_SHORTCUTS: readonly CallShortcut[] = [
	{ keys: ["M"], label: "Mute / unmute" },
	{ keys: ["H"], label: "Raise / lower hand" },
	{ keys: ["S"], label: "Move Spotlight" },
	{ keys: ["["], label: "Fold roster and feed" },
	{ keys: ["]"], label: "Unfold roster and feed" },
	{ keys: ["?"], label: "This legend" },
];

export type CallStripProps = {
	roomId: string;
	phase: DrivePhase;
	callLive: boolean;
	ended: boolean;
	elapsedMs: number | null;
	seq: number;
	subMode: DriveSubMode;
	addressSet: AddressSet;
	participants: readonly Participant[];
	muted: boolean;
	handRaised: boolean;
	/** Who the Spotlight would move to; null disables the control. */
	nextSharerLabel: string | null;
	pinDefaults: Record<HumanPinKind, StagePin>;
	feedCollapsed: boolean;
	/** Ops in flight, by name — disables that control and shows a spinner. */
	busy: ReadonlySet<string>;
	legendOpen: boolean;
	onLegendOpenChange: (open: boolean) => void;
	onSetMode: (mode: DriveSubMode) => void;
	onSetAddress: (addressSet: AddressSet) => void;
	onToggleMute: () => void;
	onToggleHand: () => void;
	onMoveSpotlight: () => void;
	onSharePin: (pin: StagePin) => void;
	onToggleFeed: () => void;
	onLeave: () => void;
	onEnd: () => void;
	onJoin: () => void;
	className?: string;
};

function StripButton({
	label,
	onClick,
	pressed,
	tone = "neutral",
	disabled,
	busy,
	shortcut,
	children,
}: {
	label: string;
	onClick: () => void;
	pressed?: boolean;
	tone?: "neutral" | "live" | "danger";
	disabled?: boolean;
	busy?: boolean;
	shortcut?: string;
	children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					aria-label={label}
					aria-pressed={pressed}
					className={cn(
						"size-8 rounded-md border",
						tone === "neutral" && "border-transparent",
						tone === "live" &&
							"border-warning-border bg-warning-surface text-warning-text hover:bg-warning-surface",
						tone === "danger" &&
							"border-error-border bg-error-surface text-error-text hover:bg-error-surface",
					)}
					disabled={disabled || busy}
					onClick={onClick}
					size="icon"
					type="button"
					variant="ghost"
				>
					{busy ? (
						<LoaderCircle
							aria-hidden="true"
							className="size-4 motion-safe:animate-spin"
						/>
					) : (
						children
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				<span className="inline-flex items-center gap-2">
					{label}
					{shortcut ? <Kbd>{shortcut}</Kbd> : null}
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

const ADDRESS_ICON: Record<AddressChoice["kind"], typeof Users> = {
	everyone: Users,
	one: User,
	many: UsersRound,
	pack: Package,
};

function AddressChip({
	addressSet,
	participants,
	disabled,
	busy,
	onSetAddress,
}: {
	addressSet: AddressSet;
	participants: readonly Participant[];
	disabled: boolean;
	busy: boolean;
	onSetAddress: (addressSet: AddressSet) => void;
}) {
	const choices = buildAddressChoices(participants);
	const current =
		choices.find((choice) => sameAddressSet(choice.addressSet, addressSet)) ??
		null;
	const label = formatAddressSetLabel(addressSet, participants);
	const scoped = addressSet.mode !== "everyone";
	const Icon = ADDRESS_ICON[current?.kind ?? (scoped ? "many" : "everyone")];
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={`Send to ${label}. Change who you are addressing.`}
					className={cn(
						"h-8 max-w-48 gap-1.5 rounded-md border px-2 text-xs",
						scoped
							? "border-primary/40 bg-primary/10 text-foreground"
							: "border-border text-muted-foreground",
					)}
					disabled={disabled || busy}
					size="sm"
					type="button"
					variant="ghost"
				>
					{busy ? (
						<LoaderCircle
							aria-hidden="true"
							className="size-3.5 motion-safe:animate-spin"
						/>
					) : (
						<AtSign aria-hidden="true" className="size-3.5" />
					)}
					<span className="truncate">{label}</span>
					<Icon aria-hidden="true" className="size-3 text-muted-foreground" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-60">
				<DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
					Who your next message is scoped to.
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuRadioGroup
					onValueChange={(id) => {
						const choice = choices.find((entry) => entry.id === id);
						if (choice) {
							onSetAddress(choice.addressSet);
						}
					}}
					value={current?.id ?? ""}
				>
					{choices.map((choice) => {
						const ChoiceIcon = ADDRESS_ICON[choice.kind];
						return (
							<DropdownMenuRadioItem key={choice.id} value={choice.id}>
								<ChoiceIcon
									aria-hidden="true"
									className="mr-1 size-3.5 text-muted-foreground"
								/>
								{choice.label}
							</DropdownMenuRadioItem>
						);
					})}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function SharePinMenu({
	defaults,
	disabled,
	busy,
	onSharePin,
}: {
	defaults: Record<HumanPinKind, StagePin>;
	disabled: boolean;
	busy: boolean;
	onSharePin: (pin: StagePin) => void;
}) {
	const label =
		"Share a pin (take the Spotlight with a selection, file or terminal)";
	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							aria-label={label}
							className="size-8 rounded-md border border-transparent"
							disabled={disabled || busy}
							size="icon"
							type="button"
							variant="ghost"
						>
							{busy ? (
								<LoaderCircle
									aria-hidden="true"
									className="size-4 motion-safe:animate-spin"
								/>
							) : (
								<Pin aria-hidden="true" className="size-4" />
							)}
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">Share a pin</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start" className="w-64">
				<DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
					Take the Spotlight with a structured share. No pixels leave the app.
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{HUMAN_PIN_KINDS.map((kind) => (
					<DropdownMenuItem
						className="flex-col items-start gap-0"
						key={kind}
						onSelect={() => onSharePin(defaults[kind])}
					>
						<span className="text-sm">
							Pin {HUMAN_PIN_KIND_LABEL[kind].toLowerCase()}
						</span>
						<span className="max-w-full truncate text-[11px] text-muted-foreground">
							{defaults[kind].label}
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ShortcutLegend({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Popover onOpenChange={onOpenChange} open={open}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							aria-label="Keyboard shortcuts"
							className="size-8 rounded-md border border-transparent"
							size="icon"
							type="button"
							variant="ghost"
						>
							<Keyboard aria-hidden="true" className="size-4" />
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					<span className="inline-flex items-center gap-2">
						Keyboard shortcuts <Kbd>?</Kbd>
					</span>
				</TooltipContent>
			</Tooltip>
			<PopoverContent align="end" className="w-64 p-3">
				<p className="mb-2 text-xs font-semibold text-foreground">
					Call shortcuts
				</p>
				<dl className="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
					{CALL_SHORTCUTS.map((shortcut) => (
						<div className="contents" key={shortcut.label}>
							<dt className="flex gap-1">
								{shortcut.keys.map((key) => (
									<Kbd key={key}>{key}</Kbd>
								))}
							</dt>
							<dd className="text-muted-foreground">{shortcut.label}</dd>
						</div>
					))}
				</dl>
				<p className="mt-2 text-[10px] text-muted-foreground">
					Shortcuts are ignored while typing in a field.
				</p>
			</PopoverContent>
		</Popover>
	);
}

export function CallStrip({
	roomId,
	phase,
	callLive,
	ended,
	elapsedMs,
	seq,
	subMode,
	addressSet,
	participants,
	muted,
	handRaised,
	nextSharerLabel,
	pinDefaults,
	feedCollapsed,
	busy,
	legendOpen,
	onLegendOpenChange,
	onSetMode,
	onSetAddress,
	onToggleMute,
	onToggleHand,
	onMoveSpotlight,
	onSharePin,
	onToggleFeed,
	onLeave,
	onEnd,
	onJoin,
	className,
}: CallStripProps) {
	const controlsDisabled = !callLive;
	const feedLabel = feedCollapsed
		? "Unfold roster and feed"
		: "Fold roster and feed";
	const statusFacts = [
		callLive ? "Call is live" : ended ? "Call ended" : "Not on the call",
		muted ? "You are muted" : "Your mic is live",
		handRaised ? "Your hand is raised" : "",
		`Working mode ${subMode}`,
		`Addressing ${formatAddressSetLabel(addressSet, participants)}`,
	].filter(Boolean);

	return (
		<div
			className={cn(
				"flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
				className,
			)}
			data-slot="drive-call-strip"
		>
			<span className="sr-only" role="status">
				{statusFacts.map((fact) => (
					<span key={fact}>{fact}. </span>
				))}
			</span>

			{/* Room identity + live state. */}
			<div className="flex min-w-0 shrink-0 items-center gap-2 pr-2">
				<span
					aria-hidden="true"
					className={cn(
						"size-2 shrink-0 rounded-full",
						callLive
							? "drive-live-dot bg-success-solid text-success-solid"
							: ended
								? "bg-error-solid"
								: "bg-muted-foreground/50",
					)}
				/>
				<Radio
					aria-hidden="true"
					className="size-3.5 shrink-0 text-muted-foreground"
				/>
				<span className="max-w-40 truncate text-sm font-semibold text-foreground">
					{roomId}
				</span>
				<span className="font-mono text-[11px] tabular-nums text-muted-foreground">
					{elapsedMs === null ? "—:——" : formatElapsed(elapsedMs)}
				</span>
				<span className="hidden font-mono text-[10px] text-muted-foreground @min-[70rem]:inline">
					seq {seq}
				</span>
			</div>

			<span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />

			{/* Working mode. */}
			<ToggleGroup
				aria-label="Working mode"
				className="shrink-0"
				disabled={controlsDisabled || busy.has("mode")}
				onValueChange={(value) => {
					const next = DRIVE_SUB_MODES.find((mode) => mode.id === value);
					if (next && next.id !== subMode) {
						onSetMode(next.id);
					}
				}}
				size="sm"
				type="single"
				value={subMode}
				variant="outline"
			>
				{DRIVE_SUB_MODES.map((mode) => (
					<Tooltip key={mode.id}>
						<TooltipTrigger asChild>
							<ToggleGroupItem
								aria-label={`${mode.label} mode — ${mode.hint}`}
								className="h-8 px-2.5 text-xs data-[state=on]:bg-primary/15 data-[state=on]:text-foreground"
								value={mode.id}
							>
								{mode.label}
							</ToggleGroupItem>
						</TooltipTrigger>
						<TooltipContent side="bottom">{mode.hint}</TooltipContent>
					</Tooltip>
				))}
			</ToggleGroup>

			<AddressChip
				addressSet={addressSet}
				busy={busy.has("address")}
				disabled={controlsDisabled}
				onSetAddress={onSetAddress}
				participants={participants}
			/>

			<span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />

			<StripButton
				busy={busy.has("mute")}
				disabled={controlsDisabled}
				label={muted ? "Unmute" : "Mute"}
				onClick={onToggleMute}
				pressed={muted}
				shortcut="M"
				tone={muted ? "danger" : "neutral"}
			>
				{muted ? (
					<MicOff aria-hidden="true" className="size-4" />
				) : (
					<Mic aria-hidden="true" className="size-4" />
				)}
			</StripButton>
			<StripButton
				busy={busy.has("hand")}
				disabled={controlsDisabled}
				label={handRaised ? "Lower hand" : "Raise hand"}
				onClick={onToggleHand}
				pressed={handRaised}
				shortcut="H"
				tone={handRaised ? "live" : "neutral"}
			>
				<Hand aria-hidden="true" className="size-4" />
			</StripButton>
			<StripButton
				busy={busy.has("stage")}
				disabled={controlsDisabled || nextSharerLabel === null}
				label={
					nextSharerLabel
						? `Move Spotlight to ${nextSharerLabel}`
						: "Move Spotlight (nobody to move it to)"
				}
				onClick={onMoveSpotlight}
				shortcut="S"
			>
				<Aperture aria-hidden="true" className="size-4" />
			</StripButton>
			<SharePinMenu
				busy={busy.has("stage")}
				defaults={pinDefaults}
				disabled={controlsDisabled}
				onSharePin={onSharePin}
			/>

			<span className="ml-auto" />

			<StripButton
				label={feedLabel}
				onClick={onToggleFeed}
				pressed={!feedCollapsed}
				shortcut={feedCollapsed ? "]" : "["}
			>
				{feedCollapsed ? (
					<PanelRightOpen aria-hidden="true" className="size-4" />
				) : (
					<PanelRightClose aria-hidden="true" className="size-4" />
				)}
			</StripButton>
			<ShortcutLegend onOpenChange={onLegendOpenChange} open={legendOpen} />

			<span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />

			{callLive ? (
				<>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								aria-label="Leave call — the room keeps running; rejoin anytime"
								className="h-8 gap-1.5 px-2.5 text-xs"
								disabled={busy.has("leave")}
								onClick={onLeave}
								size="sm"
								type="button"
								variant="outline"
							>
								{busy.has("leave") ? (
									<LoaderCircle
										aria-hidden="true"
										className="size-3.5 motion-safe:animate-spin"
									/>
								) : (
									<LogOut aria-hidden="true" className="size-3.5" />
								)}
								Leave
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							Leave — work continues; rejoin to catch up
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								aria-label="End call for everyone — closes the room with a handoff summary"
								className="h-8 gap-1.5 px-2.5 text-xs"
								disabled={busy.has("end")}
								onClick={onEnd}
								size="sm"
								type="button"
								variant="destructive"
							>
								{busy.has("end") ? (
									<LoaderCircle
										aria-hidden="true"
										className="size-3.5 motion-safe:animate-spin"
									/>
								) : (
									<PhoneOff aria-hidden="true" className="size-3.5" />
								)}
								End
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							End for everyone — the room closes with a handoff
						</TooltipContent>
					</Tooltip>
				</>
			) : (
				<Button
					aria-label={ended ? "Rejoin the call" : "Join the call"}
					className="h-8 gap-1.5 px-3 text-xs"
					disabled={busy.has("join") || phase === "connecting"}
					onClick={onJoin}
					size="sm"
					type="button"
				>
					{busy.has("join") ? (
						<LoaderCircle
							aria-hidden="true"
							className="size-3.5 motion-safe:animate-spin"
						/>
					) : (
						<Radio aria-hidden="true" className="size-3.5" />
					)}
					{ended ? "Rejoin" : "Join call"}
				</Button>
			)}
		</div>
	);
}
