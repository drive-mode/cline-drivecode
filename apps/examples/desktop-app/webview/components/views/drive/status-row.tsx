"use client";

/**
 * One Status Hub entry.
 *
 * A row answers four questions without being opened: what happened, what work
 * it belongs to, who did it, and when. The headline alone does not — "Processed
 * batch 66 of 70" is meaningless without its subject, agent and provenance —
 * so every row carries a provenance line under the headline.
 */

import type { StatusPriority, StatusState, StatusUpdate } from "@cline/shared";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
	isStaleRunning,
	progressPercent,
	relativeTime,
	sourceLabel,
	workspaceLabel,
} from "@/lib/drive/status-filters";
import { cn } from "@/lib/utils";

/** Outline badge treatment per state, from the semantic tokens. */
export const STATE_STYLES: Record<StatusState, string> = {
	running: "border-primary/40 text-primary",
	blocked: "border-warning-border text-warning-text",
	queued: "border-border text-muted-foreground",
	done: "border-success-border text-success-text",
	failed: "border-destructive/50 text-destructive",
	cancelled: "border-border text-muted-foreground line-through",
};

/** Solid dot per state, for tiles and legends. */
export const STATE_DOT: Record<StatusState, string> = {
	running: "bg-primary",
	blocked: "bg-warning-solid",
	queued: "bg-muted-foreground",
	done: "bg-success-solid",
	failed: "bg-destructive",
	cancelled: "bg-border",
};

const PRIORITY_STYLES: Partial<Record<StatusPriority, string>> = {
	critical: "border-destructive/60 text-destructive",
	high: "border-warning-border text-warning-text",
};

function absoluteTime(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * One tag on a row. Clickable only when the surrounding view has a tag filter
 * to drive — otherwise it stays a plain badge rather than a dead button.
 */
function TagBadge({
	active,
	onClick,
	tag,
}: {
	active: boolean;
	onClick?: (tag: string) => void;
	tag: string;
}) {
	const badge = (
		<Badge
			className={cn(
				"h-5 px-1.5 text-[10px] font-normal",
				active && "border-primary text-primary",
			)}
			variant="outline"
		>
			{tag}
		</Badge>
	);
	if (!onClick) {
		return badge;
	}
	return (
		<button
			aria-pressed={active}
			className="rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/50"
			onClick={() => onClick(tag)}
			title={active ? `Stop filtering by ${tag}` : `Filter by ${tag}`}
			type="button"
		>
			{badge}
		</button>
	);
}

export type StatusRowProps = {
	update: StatusUpdate;
	/** Changelog mode reads better as `queued → running` than a bare state. */
	showTransition?: boolean;
	/** Tags currently filtering the view, so this row can show which are on. */
	activeTags?: readonly string[];
	/** Toggle a tag filter from the row; omitted where there is no filter. */
	onTagClick?: (tag: string) => void;
	/** Wall clock for relative times; injectable for deterministic rendering. */
	nowMs?: number;
};

export function StatusRow({
	update,
	showTransition = false,
	activeTags,
	onTagClick,
	nowMs,
}: StatusRowProps) {
	const [expanded, setExpanded] = useState(false);
	const who = update.agentName ?? update.agentId;
	const stale = isStaleRunning(update, nowMs);
	const source = sourceLabel(update.source);
	const workspace = workspaceLabel(update.workspaceRoot);
	const percent = progressPercent(update);
	const priorityStyle = PRIORITY_STYLES[update.priority];
	const detailId = `status-detail-${update.updateId}`;

	return (
		<li className="border-b border-border last:border-b-0">
			<div className="flex items-start gap-3 px-4 py-3">
				<div className="mt-0.5 flex shrink-0 items-center gap-1">
					{showTransition && update.previousState ? (
						<>
							<Badge
								className={cn(
									"h-5 px-1.5 text-[10px] opacity-60",
									STATE_STYLES[update.previousState],
								)}
								variant="outline"
							>
								{update.previousState}
							</Badge>
							<span
								aria-hidden="true"
								className="text-xs text-muted-foreground"
							>
								→
							</span>
							<span className="sr-only">then</span>
						</>
					) : null}
					<Badge
						className={cn("h-5 px-1.5 text-[10px]", STATE_STYLES[update.state])}
						variant="outline"
					>
						{update.state}
					</Badge>
				</div>

				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
						<span className="text-sm font-medium text-foreground">
							{update.headline}
						</span>
						{priorityStyle ? (
							<Badge
								className={cn("h-5 px-1.5 text-[10px]", priorityStyle)}
								variant="outline"
							>
								{update.priority}
							</Badge>
						) : null}
						{stale ? (
							<Badge
								className="h-5 border-warning-border px-1.5 text-[10px] text-warning-text"
								title="Still running, but no update in over 30 minutes"
								variant="outline"
							>
								stale
							</Badge>
						) : null}
					</div>

					{/* Provenance: what work, who, how it got here, when. */}
					<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
						<span className="truncate font-mono text-foreground/70">
							{update.subject}
						</span>
						{update.historyCount != null && update.historyCount > 1 ? (
							<span title="Total updates recorded for this subject">
								· {update.historyCount} updates
							</span>
						) : null}
						<span aria-hidden="true">·</span>
						<span className="text-foreground/70">{who ?? "unattributed"}</span>
						<span>· via {source}</span>
						{workspace ? <span>· {workspace}</span> : null}
						{update.sessionId ? (
							<span
								className="truncate font-mono"
								title={`Session ${update.sessionId}`}
							>
								· session{" "}
								{update.sessionId.length > 14
									? `${update.sessionId.slice(0, 12)}…`
									: update.sessionId}
							</span>
						) : null}
						<span title={absoluteTime(update.createdAt)}>
							· {relativeTime(update.createdAt, nowMs)}
						</span>
						{percent !== null ? <span>· {percent}%</span> : null}
						{update.tags.map((tag) => (
							<TagBadge
								active={activeTags?.includes(tag) === true}
								key={tag}
								onClick={onTagClick}
								tag={tag}
							/>
						))}
					</div>

					{percent !== null ? (
						<div
							aria-label={`${percent}% complete`}
							aria-valuemax={100}
							aria-valuemin={0}
							aria-valuenow={percent}
							className="mt-2 h-1 w-full max-w-xs overflow-hidden rounded-full bg-primary/15"
							role="progressbar"
						>
							<div
								className="h-full rounded-full bg-primary transition-[width]"
								style={{ width: `${percent}%` }}
							/>
						</div>
					) : null}

					{update.detail ? (
						<>
							<button
								aria-controls={detailId}
								aria-expanded={expanded}
								className="mt-1.5 inline-flex items-center gap-1 rounded-sm text-xs text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
								onClick={() => setExpanded((open) => !open)}
								type="button"
							>
								{expanded ? (
									<ChevronDown aria-hidden="true" className="size-3" />
								) : (
									<ChevronRight aria-hidden="true" className="size-3" />
								)}
								{expanded ? "Hide detail" : "Show detail"}
							</button>
							{expanded ? (
								<pre
									className="cline-chat-selectable mt-2 whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] leading-5 text-muted-foreground"
									id={detailId}
								>
									{update.detail}
								</pre>
							) : null}
						</>
					) : null}
				</div>
			</div>
		</li>
	);
}
