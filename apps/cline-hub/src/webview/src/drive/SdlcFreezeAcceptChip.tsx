/**
 * Gated SDLC freeze accept chip (req-sdlc-bankable / W-44).
 * Shows the stage freeze checklist and Accept → bank boundary.
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
			className="space-y-2 border-b border-violet-500/25 bg-violet-500/5 px-4 py-2"
			data-slot="sdlc-freeze-accept-chip"
		>
			<div className="flex flex-wrap items-start gap-2">
				<div className="min-w-0 flex-1 space-y-0.5">
					<div className="text-[10px] font-medium uppercase tracking-wide text-violet-800 dark:text-violet-200">
						Phase-entry freeze → bank
					</div>
					<div className="truncate text-xs" title={summary}>
						{summary}
					</div>
					<p className="text-[10px] text-muted-foreground">
						Accept creates DriveTasks + active plan so S2 can credit this guided
						session.
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
			</div>
			<ol
				className="list-decimal space-y-1 pl-5 text-[11px] text-muted-foreground"
				data-slot="sdlc-freeze-checklist"
			>
				{plan.tasks.map((task) => (
					<li key={task.id}>
						<span className="font-medium text-foreground">{task.title}</span>
						{task.body.trim() ? (
							<span className="ml-1 truncate">— {task.body.trim()}</span>
						) : null}
					</li>
				))}
			</ol>
		</section>
	);
}
