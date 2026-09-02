"use client";

/**
 * The Director's queue, made visible: one chip per show under the frame,
 * plus the NOW / NEXT cursor. Every state carries a cue that survives without
 * hue — dashed rule (planned), solid rule (ready), filled with a live dot
 * (showing), struck through (shown) — so the queue reads for colour-blind
 * viewers too. Read-only: the hub decides what shows next.
 */

import type {
	ShowRailCursor,
	ShowRailEntry,
	ShowRailStatus,
} from "@/lib/drive/show-rail";
import { cn } from "@/lib/utils";

const CHIP_STYLE: Record<ShowRailStatus, string> = {
	planned: "border-dashed border-border text-muted-foreground",
	ready: "border-border text-foreground",
	showing:
		"border-warning-border bg-warning-surface font-medium text-warning-text",
	shown: "border-border text-muted-foreground line-through opacity-60",
};

export function ShowRail({
	entries,
	cursor,
	dimmed,
	className,
}: {
	entries: readonly ShowRailEntry[];
	cursor: ShowRailCursor;
	/** A human pin holds the screen, so the Director's queue is on hold. */
	dimmed: boolean;
	className?: string;
}) {
	if (entries.length === 0) {
		return null;
	}
	return (
		<section
			aria-label="Show backlog"
			className={cn(
				"flex shrink-0 flex-col gap-1.5 motion-safe:transition-opacity",
				dimmed && "opacity-50 saturate-50",
				className,
			)}
		>
			<div className="flex min-w-0 items-center gap-2">
				<span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
					Show backlog
				</span>
				<ol className="drive-scroll flex min-w-0 items-center gap-1.5 overflow-x-auto py-0.5">
					{entries.map((entry) => (
						<li
							className={cn(
								"flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] leading-4",
								CHIP_STYLE[entry.status],
							)}
							key={entry.id}
							title={entry.title}
						>
							{entry.status === "showing" ? (
								<span
									aria-hidden="true"
									className="drive-live-dot size-[5px] shrink-0 rounded-full bg-current"
								/>
							) : null}
							{entry.label}
							<span className="sr-only">, {entry.status}</span>
						</li>
					))}
				</ol>
			</div>
			<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
				<span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-warning-text">
					now
				</span>
				<span className="min-w-0 truncate text-muted-foreground">
					{cursor.now?.title ?? "—"}
				</span>
				<span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
					next
				</span>
				<span className="min-w-0 truncate text-muted-foreground">
					{cursor.next?.title ?? "—"}
				</span>
			</div>
		</section>
	);
}
