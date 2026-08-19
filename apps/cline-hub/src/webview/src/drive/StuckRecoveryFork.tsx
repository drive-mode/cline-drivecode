/**
 * Spotlight recovery fork card (DRV-STUCK-RECOVERY).
 * Gated options — Accept mutates via parent; Dismiss writes nothing.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RECOVERY_OPTIONS, type RecoveryOptionKind } from "./stuckRecovery";

export type StuckRecoveryForkProps = {
	taskId: string;
	/** Structured failure note from the bank — not an utterance. */
	failureNote: string;
	nowTitle?: string | null;
	disabled?: boolean;
	className?: string;
	/** Manual lastFailure vs auto stall classifier (W4.1). */
	source?: "manual" | "auto_stall";
	onAccept: (option: RecoveryOptionKind) => void;
	onDismiss: () => void;
};

export function StuckRecoveryFork({
	taskId,
	failureNote,
	nowTitle,
	disabled,
	className,
	source = "manual",
	onAccept,
	onDismiss,
}: StuckRecoveryForkProps) {
	return (
		<section
			aria-label="Stuck recovery"
			className={cn(
				"space-y-2 rounded-md border border-rose-500/40 bg-rose-500/5 p-3",
				className,
			)}
			data-recovery-source={source}
			data-slot="stuck-recovery-fork"
		>
			<div className="text-xs font-medium text-rose-800 dark:text-rose-200">
				{source === "auto_stall" ? "Session stall" : "Now is stuck"}
				{nowTitle?.trim() ? (
					<span className="font-normal text-muted-foreground">
						{" "}
						· {nowTitle.trim()}
					</span>
				) : null}
			</div>
			<p
				className="truncate font-mono text-[11px] text-rose-700 dark:text-rose-300"
				data-slot="stuck-recovery-failure"
				title={failureNote}
			>
				{failureNote}
			</p>
			<p className="text-[10px] text-muted-foreground">
				Task <span className="font-mono">{taskId}</span> — choose a recovery
				path (gated; nothing writes until you accept).
			</p>
			<div className="flex flex-wrap gap-1.5">
				{RECOVERY_OPTIONS.map((entry) => (
					<Button
						className="h-7 text-xs"
						disabled={disabled}
						key={entry.option}
						onClick={() => onAccept(entry.option)}
						size="sm"
						title={entry.hint}
						type="button"
						variant="outline"
						data-recovery-option={entry.option}
					>
						{entry.label}
					</Button>
				))}
				<Button
					className="h-7 text-xs"
					disabled={disabled}
					onClick={onDismiss}
					size="sm"
					type="button"
					variant="ghost"
					data-recovery-option="dismiss"
				>
					Dismiss
				</Button>
			</div>
		</section>
	);
}
