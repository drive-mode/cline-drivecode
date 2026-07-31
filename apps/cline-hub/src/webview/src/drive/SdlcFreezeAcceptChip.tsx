/**
 * Gated SDLC freeze accept chip (req-sdlc-bankable / W-44).
 * Stage freeze card UI is incomplete — this is the Plan-posture accept boundary
 * for proposals already on `pendingSdlcFreeze`.
 */

import type { SdlcFreezeProposal } from "@cline/drive";
import { buildSdlcFreezeAcceptPlan } from "@cline/drive";
import { Button } from "@/components/ui/button";

export type SdlcFreezeAcceptChipProps = {
	proposal: SdlcFreezeProposal;
	disabled?: boolean;
	onAccept: () => void;
	onDismiss: () => void;
};

export function SdlcFreezeAcceptChip({
	proposal,
	disabled,
	onAccept,
	onDismiss,
}: SdlcFreezeAcceptChipProps) {
	const plan = buildSdlcFreezeAcceptPlan(proposal);
	const summary =
		proposal.kind === "escape"
			? `Escape: ${plan.tasks[0]?.title ?? "build"}`
			: `Freeze: ${plan.planTitle} (${plan.tasks.length} task${plan.tasks.length === 1 ? "" : "s"})`;

	return (
		<section
			aria-label="Accept SDLC freeze into bank"
			className="flex flex-wrap items-center gap-2 border-b border-violet-500/25 bg-violet-500/5 px-4 py-2"
			data-slot="sdlc-freeze-accept-chip"
		>
			<div className="min-w-0 flex-1 space-y-0.5">
				<div className="text-[10px] font-medium uppercase tracking-wide text-violet-800 dark:text-violet-200">
					Phase-entry freeze → bank
				</div>
				<div className="truncate text-xs" title={summary}>
					{summary}
				</div>
				<p className="text-[10px] text-muted-foreground">
					Accept creates DriveTasks + active plan so S2 can credit this
					guided session. Stage freeze cards still stubbed.
				</p>
			</div>
			<div className="flex shrink-0 gap-1.5">
				<Button
					className="h-7 text-xs"
					data-sdlc-freeze-cta="accept"
					disabled={disabled}
					onClick={onAccept}
					size="sm"
					type="button"
				>
					Accept into bank
				</Button>
				<Button
					className="h-7 text-xs"
					data-sdlc-freeze-cta="dismiss"
					disabled={disabled}
					onClick={onDismiss}
					size="sm"
					type="button"
					variant="ghost"
				>
					Dismiss
				</Button>
			</div>
		</section>
	);
}
