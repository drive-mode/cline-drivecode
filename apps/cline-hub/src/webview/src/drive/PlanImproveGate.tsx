/**
 * Gated plan-improve queue card (DRV-PLAN-IMPROVE / Slice 3).
 * Post-session / after End — distinct from in-call StuckRecoveryFork.
 * Accept | reject | mute; nothing durable until Accept.
 */

import type { PlanningProposal } from "@cline/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PlanImproveGateProps = {
	proposal: PlanningProposal;
	disabled?: boolean;
	className?: string;
	onAccept: () => void;
	onReject: () => void;
	onMute: () => void;
};

export function PlanImproveGate({
	proposal,
	disabled,
	className,
	onAccept,
	onReject,
	onMute,
}: PlanImproveGateProps) {
	const targetLabel =
		proposal.target.type === "planning_skill"
			? `skill:${proposal.target.skillId}`
			: `template:${proposal.target.templateId}`;

	return (
		<section
			aria-label="Plan improve proposal"
			className={cn(
				"space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3",
				className,
			)}
			data-proposal-kind="planning"
			data-slot="plan-improve-gate"
		>
			<div className="text-xs font-medium text-amber-900 dark:text-amber-200">
				Planning improve
				<span className="font-normal text-muted-foreground">
					{" "}
					· gated · {proposal.label}
				</span>
			</div>
			<p className="text-[10px] text-muted-foreground">
				Reasons <span className="font-mono">{proposal.reasons.join("+")}</span>
				{" · "}
				target <span className="font-mono">{targetLabel}</span>
				{proposal.callSessionId ? (
					<>
						{" · "}
						session <span className="font-mono">{proposal.callSessionId}</span>
					</>
				) : null}
			</p>
			<p className="text-[10px] text-muted-foreground">
				Evidence: {proposal.evidence.eventIds.length} events ·{" "}
				{proposal.evidence.taskIds.length} tasks ·{" "}
				{proposal.evidence.skillIds.length} skills — no utterances. Accept
				writes under .drive/plan-improve/ only.
			</p>
			<div className="flex flex-wrap gap-1.5">
				<Button
					className="h-7 text-xs"
					data-plan-improve="accept"
					disabled={disabled}
					onClick={onAccept}
					size="sm"
					type="button"
					variant="default"
				>
					Accept
				</Button>
				<Button
					className="h-7 text-xs"
					data-plan-improve="reject"
					disabled={disabled}
					onClick={onReject}
					size="sm"
					type="button"
					variant="outline"
				>
					Reject
				</Button>
				<Button
					className="h-7 text-xs"
					data-plan-improve="mute"
					disabled={disabled}
					onClick={onMute}
					size="sm"
					type="button"
					variant="ghost"
				>
					Mute
				</Button>
			</div>
		</section>
	);
}
