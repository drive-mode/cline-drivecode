import type { BankSnapshot } from "@cline/shared";
import { cn } from "@/lib/utils";
import { hasNowLastFailure } from "../drive/agencyChrome";
import { shouldShowNowNext } from "./nowNextLogic";

export type NowNextProps = {
	snapshot: BankSnapshot;
	onSelectNow?: (taskId: string) => void;
	onSelectNext?: (taskId: string) => void;
	/** One-shot felt-agency consequence (DRV-FELT-AGENCY). */
	agencyBanner?: string | null;
	className?: string;
};

export { shouldShowNowNext } from "./nowNextLogic";

export function NowNext({
	snapshot,
	onSelectNow,
	onSelectNext,
	agencyBanner,
	className,
}: NowNextProps) {
	if (!shouldShowNowNext(snapshot)) {
		return null;
	}

	const recovery = hasNowLastFailure(snapshot);

	return (
		<div
			className={cn(
				"border-b border-amber-500/20 bg-amber-500/5",
				recovery && "border-rose-500/30 bg-rose-500/5",
				className,
			)}
			data-recovery={recovery ? "true" : undefined}
			data-slot="now-next"
		>
			{agencyBanner ? (
				<div
					aria-live="polite"
					className="border-b border-amber-500/20 px-4 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-100"
					data-slot="agency-consequence"
					role="status"
				>
					{agencyBanner}
				</div>
			) : null}
			{recovery ? (
				<div
					className="px-4 pt-2 text-[10px] font-medium uppercase tracking-wide text-rose-700 dark:text-rose-300"
					data-slot="now-next-recovery"
				>
					Needs a fix-up
				</div>
			) : null}
			<div className="flex flex-wrap items-stretch gap-2 px-4 py-2">
				<button
					className={cn(
						"min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-left hover:bg-muted/60",
						recovery && "border-rose-500/40",
					)}
					onClick={() => {
						if (snapshot.nowTaskId) {
							onSelectNow?.(snapshot.nowTaskId);
						}
					}}
					type="button"
				>
					<div
						className={cn(
							"text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300",
							recovery && "text-rose-700 dark:text-rose-300",
						)}
					>
						now
					</div>
					<div className="truncate text-xs font-medium">
						{snapshot.nowTitle ?? snapshot.nowTaskId}
					</div>
					{recovery && snapshot.nowLastFailure ? (
						<div className="mt-0.5 truncate text-[10px] text-rose-700/90 dark:text-rose-300/90">
							{snapshot.nowLastFailure}
						</div>
					) : null}
				</button>
				<button
					className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-left hover:bg-muted/60 disabled:opacity-50"
					disabled={!snapshot.nextTaskId}
					onClick={() => {
						if (snapshot.nextTaskId) {
							onSelectNext?.(snapshot.nextTaskId);
						}
					}}
					type="button"
				>
					<div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
						next
					</div>
					<div className="truncate text-xs">
						{snapshot.nextTitle ?? snapshot.nextTaskId ?? "—"}
					</div>
				</button>
			</div>
		</div>
	);
}
