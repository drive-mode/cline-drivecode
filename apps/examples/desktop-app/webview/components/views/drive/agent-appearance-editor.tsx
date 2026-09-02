"use client";

/**
 * Name and body ink pickers for one agent (DRV-AGENT-PROFILE).
 *
 * Two channels, chosen independently: an agent can carry a loud name and
 * quiet prose, or the reverse. Every swatch and every preview colour is
 * resolved by `@cline/drive`'s clamp for the active host theme, so what the
 * picker paints is exactly what the roster and the Spotlight will paint.
 *
 * Presentational on purpose. The optimistic write and its rollback live in
 * `agent-profile.tsx`; this component only reports a new local ink and shows
 * the save state it is handed.
 */

import type { DriveInkChannel } from "@cline/drive";
import type { AgentRef, InkRef } from "@cline/shared";
import { Check, Loader2, Wand2 } from "lucide-react";
import { type KeyboardEvent, useId, useRef } from "react";
import { DriveMarkIcon } from "@/components/icons/drive-mark";
import {
	agentInitial,
	DRIVE_SCREEN_INK_THEME,
	type DriveAgentInk,
	type DriveInkSwatch,
	describeResolvedInk,
	inkPaletteIndex,
	paletteSwatches,
	resolveAgentInk,
	useDriveInkTheme,
} from "@/lib/drive/agent-appearance";
import { cn } from "@/lib/utils";

export type AppearanceSaveState =
	| { status: "idle" }
	| { status: "saving" }
	| { status: "saved" }
	| { status: "error"; message: string };

const CHANNEL_COPY: Record<DriveInkChannel, { label: string; hint: string }> = {
	name: {
		label: "Name ink",
		hint: "Roster rows, bylines, the Spotlight chip.",
	},
	body: {
		label: "Body ink",
		hint: "Narration and messages in the feed.",
	},
};

function InkPicker({
	channel,
	profileId,
	value,
	disabled,
	onChange,
}: {
	channel: DriveInkChannel;
	profileId: string;
	value: InkRef | undefined;
	disabled: boolean;
	onChange: (next: InkRef | undefined) => void;
}) {
	const theme = useDriveInkTheme();
	const labelId = useId();
	const hintId = useId();
	const groupRef = useRef<HTMLFieldSetElement>(null);
	const swatches = paletteSwatches({ channel, profileId, theme });
	const selectedIndex = inkPaletteIndex(value);
	const defaultResolved = resolveAgentInk({
		ink: null,
		channel,
		profileId,
		theme,
	});
	// Position 0 is "Default"; positions 1..8 are the palette.
	const options: {
		key: string;
		label: string;
		color: string;
		ink: InkRef | undefined;
		swatch: DriveInkSwatch | null;
	}[] = [
		{
			key: "default",
			label: "Default (stable hash)",
			color: defaultResolved.color,
			ink: undefined,
			swatch: null,
		},
		...swatches.map((swatch) => ({
			key: String(swatch.index),
			label: swatch.isAccent ? `${swatch.label} (Cline accent)` : swatch.label,
			color: swatch.color,
			ink: { kind: "palette", index: swatch.index } as InkRef,
			swatch,
		})),
	];
	const checkedPosition = selectedIndex === null ? 0 : selectedIndex + 1;

	const onKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
		if (disabled) {
			return;
		}
		let next: number | null = null;
		if (event.key === "ArrowRight" || event.key === "ArrowDown") {
			next = (checkedPosition + 1) % options.length;
		} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
			next = (checkedPosition - 1 + options.length) % options.length;
		} else if (event.key === "Home") {
			next = 0;
		} else if (event.key === "End") {
			next = options.length - 1;
		}
		if (next === null) {
			return;
		}
		event.preventDefault();
		onChange(options[next]?.ink);
		const buttons =
			groupRef.current?.querySelectorAll<HTMLButtonElement>("button");
		buttons?.[next]?.focus();
	};

	const resolved = resolveAgentInk({
		ink: value ?? null,
		channel,
		profileId,
		theme,
	});
	const copy = CHANNEL_COPY[channel];

	return (
		<div className="space-y-2">
			<div className="flex items-baseline justify-between gap-3">
				<span className="text-sm font-medium text-foreground" id={labelId}>
					{copy.label}
				</span>
				<span className="text-xs text-muted-foreground" id={hintId}>
					{copy.hint}
				</span>
			</div>
			<fieldset
				aria-describedby={hintId}
				aria-labelledby={labelId}
				className="flex flex-wrap items-center gap-2"
				onKeyDown={onKeyDown}
				ref={groupRef}
			>
				{options.map((option, position) => {
					const checked = position === checkedPosition;
					return (
						<button
							aria-label={option.label}
							aria-pressed={checked}
							className={cn(
								"relative grid size-8 place-items-center rounded-full border border-border transition-[box-shadow,transform] outline-none",
								"focus-visible:ring-[3px] focus-visible:ring-ring/50",
								checked
									? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
									: "hover:scale-105",
								disabled && "cursor-not-allowed opacity-60",
							)}
							disabled={disabled}
							key={option.key}
							onClick={() => onChange(option.ink)}
							style={{ backgroundColor: option.color }}
							tabIndex={checked ? 0 : -1}
							title={option.label}
							type="button"
						>
							{position === 0 ? (
								<Wand2
									aria-hidden="true"
									className="size-3.5 text-background mix-blend-difference"
								/>
							) : checked ? (
								<Check
									aria-hidden="true"
									className="size-4 text-background mix-blend-difference"
								/>
							) : null}
						</button>
					);
				})}
			</fieldset>
			<p className="text-xs text-muted-foreground">
				{selectedIndex === null
					? `Default · ${describeResolvedInk(resolved)}`
					: `${options[checkedPosition]?.label ?? ""} · ${describeResolvedInk(resolved)}`}
			</p>
		</div>
	);
}

function PreviewWell({
	title,
	profileId,
	displayName,
	ink,
	isCline,
	theme,
	className,
}: {
	title: string;
	profileId: string;
	displayName: string;
	ink: DriveAgentInk;
	isCline: boolean;
	theme: ReturnType<typeof useDriveInkTheme>;
	className?: string;
}) {
	const nameColor = resolveAgentInk({
		ink: ink.nameInk ?? null,
		channel: "name",
		profileId,
		theme,
	}).color;
	const bodyColor = resolveAgentInk({
		ink: ink.bodyInk ?? null,
		channel: "body",
		profileId,
		theme,
	}).color;
	return (
		<div
			className={cn(
				"rounded-lg border border-border bg-background p-4 text-foreground",
				className,
			)}
		>
			<div className="mb-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
				{title}
			</div>
			<div className="flex items-start gap-3">
				<span
					aria-hidden="true"
					className="grid size-9 shrink-0 place-items-center rounded-full border border-current/40 bg-current/15 font-mono text-sm font-bold"
					style={{ color: nameColor }}
				>
					{isCline ? (
						<DriveMarkIcon className="size-5" />
					) : (
						agentInitial(displayName)
					)}
				</span>
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span
							className="truncate text-sm font-semibold"
							style={{ color: nameColor }}
						>
							{displayName}
						</span>
						<span className="rounded-sm border border-border px-1 font-mono text-[10px] text-muted-foreground">
							presenter
						</span>
					</div>
					<p className="mt-1 text-sm leading-6" style={{ color: bodyColor }}>
						The retry path now backs off twice before it gives up — I kept the
						first attempt synchronous so the happy path stays fast.
					</p>
				</div>
			</div>
		</div>
	);
}

export function AgentAppearanceEditor({
	profileId,
	agentRef,
	displayName,
	ink,
	isCline,
	durable,
	saveState,
	onChange,
}: {
	profileId: string;
	/** Null when this seat recorded no ref — appearance stays browser-local. */
	agentRef: AgentRef | null;
	displayName: string;
	ink: DriveAgentInk;
	isCline: boolean;
	/** True when a save reaches the hub (a ref exists and the hub is reachable). */
	durable: boolean;
	saveState: AppearanceSaveState;
	onChange: (next: DriveAgentInk) => void;
}) {
	const theme = useDriveInkTheme();
	const saving = saveState.status === "saving";

	return (
		<div
			className="grid gap-6 max-[1100px]:grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]"
			data-testid="agent-appearance-editor"
		>
			<div className="space-y-5">
				<InkPicker
					channel="name"
					disabled={saving}
					onChange={(next) => onChange({ ...ink, nameInk: next })}
					profileId={profileId}
					value={ink.nameInk}
				/>
				<InkPicker
					channel="body"
					disabled={saving}
					onChange={(next) => onChange({ ...ink, bodyInk: next })}
					profileId={profileId}
					value={ink.bodyInk}
				/>
				<div
					aria-live="polite"
					className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground"
					role="status"
				>
					{saveState.status === "saving" ? (
						<>
							<Loader2 aria-hidden="true" className="size-3 animate-spin" />
							Saving…
						</>
					) : saveState.status === "saved" ? (
						<>
							<Check aria-hidden="true" className="size-3 text-success-text" />
							Saved to this workspace's agent.appearance facet.
						</>
					) : saveState.status === "error" ? (
						<span className="text-destructive">
							Could not save — reverted. {saveState.message}
						</span>
					) : durable ? (
						"Picking a swatch saves it for every window on this workspace."
					) : agentRef ? (
						"The hub is not reachable, so this choice stays in this window until it reconnects."
					) : (
						"This seat carries no agent ref, so its appearance cannot be pinned durably — it is local to this window."
					)}
				</div>
			</div>
			<div className="space-y-3">
				<PreviewWell
					displayName={displayName}
					ink={ink}
					isCline={isCline}
					profileId={profileId}
					theme={theme}
					title="In the room"
				/>
				<PreviewWell
					className="dark"
					displayName={displayName}
					ink={ink}
					isCline={isCline}
					profileId={profileId}
					theme={DRIVE_SCREEN_INK_THEME}
					title="On the Spotlight"
				/>
			</div>
		</div>
	);
}
