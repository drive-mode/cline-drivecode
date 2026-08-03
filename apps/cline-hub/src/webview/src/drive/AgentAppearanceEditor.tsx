/**
 * Name and body ink pickers for one agent (DRV-AGENT-PROFILE).
 *
 * Two controls, not one — the whole ask is that an agent's name and its prose
 * can be coloured independently.
 *
 * Keyed by profile id and `AgentRef` rather than by a seated `Participant`, so
 * the same editor serves the in-call sheet and the standalone profile page,
 * which has no room and therefore no participant. A ref is what makes a write
 * durable: `agent.appearance` is keyed by `agentProfileId(ref)`, so a seat that
 * recorded none has nowhere to store the choice. That is said plainly rather
 * than papered over with a save that only ever reached localStorage.
 */

import type { AgentRef, InkRef } from "@cline/shared";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
	buildAgentProfileDraft,
	inkFromPaletteChoice,
	inkPaletteIndex,
} from "./agentAppearance";
import { resolveChannelInk, useDriveInkTheme } from "./agentInk";
import { requestDriveAgentProfilePut } from "./requestDriveAgentProfiles";
import type { DriveAgentInk } from "./types";

type SaveState =
	| { status: "idle" }
	| { status: "saving" }
	| { status: "saved" }
	| { status: "error"; message: string };

const PALETTE_INDICES = [0, 1, 2, 3, 4, 5, 6, 7] as const;

function InkSelect({
	id,
	label,
	value,
	preview,
	onChange,
}: {
	id: string;
	label: string;
	value: number | null;
	preview: string;
	onChange: (raw: string) => void;
}) {
	return (
		<div className="space-y-1.5">
			<Label
				className="text-[10px] uppercase tracking-wide text-muted-foreground"
				htmlFor={id}
			>
				{label}
			</Label>
			<div className="flex items-center gap-2">
				<select
					className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring"
					data-ink-select={id}
					id={id}
					onChange={(event) => onChange(event.target.value)}
					value={value === null ? "" : String(value)}
				>
					<option value="">Default</option>
					{PALETTE_INDICES.map((index) => (
						<option key={index} value={String(index)}>
							Palette {index}
						</option>
					))}
				</select>
				<span
					aria-hidden
					className="shrink-0 text-sm font-semibold"
					data-ink-preview={id}
					style={{ color: preview }}
				>
					Aa
				</span>
			</div>
		</div>
	);
}

export function AgentAppearanceEditor({
	profileId,
	agentRef,
	displayName,
	ink,
	workspaceRoot,
	onInkChange,
	onDurableProfiles,
}: {
	profileId: string;
	/** Null when this seat recorded no ref — appearance stays browser-local. */
	agentRef: AgentRef | null;
	displayName: string;
	ink: DriveAgentInk | undefined;
	workspaceRoot?: string;
	onInkChange: (next: DriveAgentInk) => void;
	/** Refreshed durable map after a successful save. */
	onDurableProfiles?: (
		profiles: readonly { id: string; nameInk: InkRef; bodyInk: InkRef }[],
	) => void;
}) {
	const theme = useDriveInkTheme();
	const [save, setSave] = useState<SaveState>({ status: "idle" });

	const root = workspaceRoot?.trim() ?? "";
	const durable = Boolean(agentRef && root);

	/**
	 * Paint first, then persist.
	 *
	 * The local change applies unconditionally so the preview never lags the
	 * select, and the durable write reconciles against what the hub actually
	 * stored — including the channel the user did not touch, which the facet
	 * requires and the resolver's own default supplies.
	 */
	const commit = (next: DriveAgentInk) => {
		onInkChange(next);
		if (!agentRef || !root) {
			return;
		}
		setSave({ status: "saving" });
		void requestDriveAgentProfilePut(
			root,
			buildAgentProfileDraft({
				ref: agentRef,
				profileId,
				displayName,
				ink: next,
			}),
		)
			.then((profiles) => {
				setSave({ status: "saved" });
				onDurableProfiles?.(profiles);
			})
			.catch((error: unknown) => {
				setSave({
					status: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			});
	};

	return (
		<div className="space-y-2" data-testid="agent-appearance-editor">
			<InkSelect
				id={`agent-name-ink-${profileId}`}
				label="Name ink"
				onChange={(raw) =>
					commit({ ...ink, nameInk: inkFromPaletteChoice(raw) ?? undefined })
				}
				preview={resolveChannelInk({
					ink: ink?.nameInk ?? null,
					channel: "name",
					profileId,
					theme,
				})}
				value={inkPaletteIndex(ink?.nameInk)}
			/>
			<InkSelect
				id={`agent-body-ink-${profileId}`}
				label="Body ink"
				onChange={(raw) =>
					commit({ ...ink, bodyInk: inkFromPaletteChoice(raw) ?? undefined })
				}
				preview={resolveChannelInk({
					ink: ink?.bodyInk ?? null,
					channel: "body",
					profileId,
					theme,
				})}
				value={inkPaletteIndex(ink?.bodyInk)}
			/>
			<p className="text-[11px] text-muted-foreground">
				{durable
					? "Resolved against the active theme and clamped for contrast. Saved to this workspace's agent.appearance facet, so it survives a reload."
					: agentRef
						? "Set a workspace root to save this appearance durably — it is browser-local until then."
						: "This seat carries no agent ref, so its appearance cannot be pinned durably — it is browser-local."}
			</p>
			{save.status === "saving" ? (
				<p className="text-[11px] text-muted-foreground">Saving…</p>
			) : null}
			{save.status === "saved" ? (
				<p
					className="text-[11px] text-muted-foreground"
					data-testid="agent-appearance-saved"
				>
					Saved.
				</p>
			) : null}
			{save.status === "error" ? (
				<p className="text-[11px] text-destructive">{save.message}</p>
			) : null}
		</div>
	);
}
