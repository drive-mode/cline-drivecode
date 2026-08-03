/**
 * Add → Recruit picker (DRV-RECRUIT).
 * Need text + ranked agents; Seat calls parent callback (hub call_seat).
 */

import {
	type RankedRecruit,
	type RecruitCandidate,
} from "@cline/drive";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { rankRecruitFromFreeText } from "./recruitAddNeed";

export type RecruitAddPickerProps = {
	candidates: readonly RecruitCandidate[];
	disabled?: boolean;
	className?: string;
	limit?: number;
	onSeat: (entry: RankedRecruit) => void;
	onDismiss: () => void;
};

export function RecruitAddPicker({
	candidates,
	disabled,
	className,
	limit = 5,
	onSeat,
	onDismiss,
}: RecruitAddPickerProps) {
	const [needText, setNeedText] = useState("");
	const { ranked } = useMemo(
		() =>
			rankRecruitFromFreeText(needText, candidates, {
				limit,
			}),
		[needText, candidates, limit],
	);

	return (
		<section
			aria-label="Add recruit"
			className={cn(
				"space-y-2 rounded-md border border-violet-500/40 bg-violet-500/5 p-3",
				className,
			)}
			data-slot="recruit-add-picker"
		>
			<div className="text-xs font-medium text-violet-900 dark:text-violet-100">
				Recruit
			</div>
			<p className="text-[10px] text-muted-foreground">
				Describe the need — ranked agents use labels only (no utterances).
			</p>
			<Input
				aria-label="Recruit need"
				className="h-8 text-xs"
				data-recruit-need-input=""
				disabled={disabled}
				onChange={(event) => setNeedText(event.target.value)}
				placeholder="e.g. security review auth"
				value={needText}
			/>
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
