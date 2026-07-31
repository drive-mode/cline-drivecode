/**
 * Drive tab / settings-adjacent unfinished-plan row (DRV-PLAN-REENTRY).
 * Glanceable title + open count + last-session chips; Resume joins the room.
 */

import type { PlanReentryRowModel } from "@cline/drive";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PlanReentryRowProps = {
	row: PlanReentryRowModel;
	disabled?: boolean;
	/** Join / focus the same hub room as Chat Join. */
	onResume: () => void;
	className?: string;
};

export function PlanReentryRow({
	row,
	disabled,
	onResume,
	className,
}: PlanReentryRowProps) {
	return (
		<div
			aria-label="Unfinished plan"
			className={cn(
				"flex flex-wrap items-center gap-2 border-b border-sky-500/25 bg-sky-500/5 px-4 py-2",
				className,
			)}
			data-slot="plan-reentry-row"
			role="region"
		>
			<div className="min-w-0 flex-1 space-y-0.5">
				<div className="text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
					Unfinished plan
				</div>
				<div className="truncate text-xs font-medium" title={row.planTitle}>
					{row.planTitle}
				</div>
				<div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
					<span data-slot="plan-reentry-open-count">
						{row.openTaskCount} open
					</span>
					{row.chips.map((chip) => (
						<span
							className="rounded border border-sky-500/30 bg-background/60 px-1.5 py-0.5 font-mono"
							data-plan-reentry-chip={chip.id}
							key={chip.id}
						>
							{chip.id}: {chip.label}
						</span>
					))}
				</div>
			</div>
			<Button
				className="h-7 shrink-0 text-xs"
				data-plan-reentry-cta="resume"
				disabled={disabled}
				onClick={onResume}
				size="sm"
				type="button"
				variant="outline"
			>
				Resume
			</Button>
		</div>
	);
}
