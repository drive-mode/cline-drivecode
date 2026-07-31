/**
 * “Who should take this?” picker for stuck-task recruit (DRV-RECRUIT-STALL).
 * Structured need + ranked reasons only — no utterances.
 */

import type { RankedRecruit, RecruitNeed } from "@cline/drive";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type RecruitStallPickerProps = {
	need: RecruitNeed;
	ranked: readonly RankedRecruit[];
	disabled?: boolean;
	className?: string;
	onSeat: (entry: RankedRecruit) => void;
	onDismiss: () => void;
};

export function RecruitStallPicker({
	need,
	ranked,
	disabled,
	className,
	onSeat,
	onDismiss,
}: RecruitStallPickerProps) {
	return (
		<section
			aria-label="Recruit on stall"
			className={cn(
				"space-y-2 rounded-md border border-violet-500/40 bg-violet-500/5 p-3",
				className,
			)}
			data-slot="recruit-stall-picker"
		>
			<div className="text-xs font-medium text-violet-900 dark:text-violet-100">
				Who should take this?
			</div>
			<p className="text-[10px] text-muted-foreground">
				Need for <span className="font-mono">{need.taskId}</span>
				{need.title ? (
					<>
						{" "}
						· <span className="font-medium">{need.title}</span>
					</>
				) : null}
			</p>
			{need.capabilities.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{need.capabilities.slice(0, 8).map((cap) => (
						<span
							className="rounded border border-violet-500/30 bg-background/50 px-1.5 py-0.5 font-mono text-[10px]"
							data-recruit-capability={cap}
							key={cap}
						>
							{cap}
						</span>
					))}
				</div>
			) : null}
			{ranked.length === 0 ? (
				<p className="text-[11px] text-muted-foreground">
					No candidates ranked — seat manually from the roster.
				</p>
			) : (
				<ul className="space-y-1.5">
					{ranked.map((entry) => (
						<li
							className="flex flex-wrap items-center gap-2 rounded border bg-background/60 px-2 py-1.5"
							data-recruit-slug={entry.slug}
							key={entry.slug}
						>
							<div className="min-w-0 flex-1">
								<div className="truncate text-xs font-medium">
									{entry.displayName}
									<span className="ml-1 font-mono text-[10px] text-muted-foreground">
										{entry.slug}
									</span>
								</div>
								<div className="truncate text-[10px] text-muted-foreground">
									score {entry.score}
									{entry.reasons.length > 0
										? ` · ${entry.reasons.slice(0, 3).join(", ")}`
										: ""}
								</div>
							</div>
							<Button
								className="h-7 text-xs"
								data-recruit-cta="seat"
								disabled={disabled}
								onClick={() => onSeat(entry)}
								size="sm"
								type="button"
								variant="outline"
							>
								Seat
							</Button>
						</li>
					))}
				</ul>
			)}
			<Button
				className="h-7 text-xs"
				data-recruit-cta="dismiss"
				disabled={disabled}
				onClick={onDismiss}
				size="sm"
				type="button"
				variant="ghost"
			>
				Dismiss
			</Button>
		</section>
	);
}
