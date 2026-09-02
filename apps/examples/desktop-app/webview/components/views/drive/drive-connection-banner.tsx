"use client";

/**
 * Connection state for the Drive view, as one persistent live region.
 *
 * The element is always mounted so assistive tech keeps a single status
 * region; it collapses visually when there is nothing to say.
 */

import { Loader2, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDriveHub } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";

export function DriveConnectionBanner({
	demoForced,
	onLeaveDemo,
}: {
	/** The composition root chose the demo; there is no "leave" affordance. */
	demoForced: boolean;
	onLeaveDemo: () => void;
}) {
	const { phase, hub, lastError, clearError, retry } = useDriveHub();

	let content: React.ReactNode = null;
	let tone: "neutral" | "warning" | "demo" = "neutral";

	if (phase === "connecting") {
		content = (
			<>
				<Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
				<span>Connecting to Cline Hub…</span>
			</>
		);
	} else if (phase === "live" && hub.reconnecting) {
		tone = "warning";
		content = (
			<>
				<Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
				<span>Reconnecting to your fleet…</span>
			</>
		);
	} else if (phase === "unreachable") {
		tone = "warning";
		content = (
			<>
				<span className="font-medium">Cline Hub is unreachable.</span>
				{hub.error ? (
					<span className="truncate text-muted-foreground">{hub.error}</span>
				) : null}
				<Button
					className="ml-auto h-7"
					onClick={() => void retry()}
					size="xs"
					type="button"
					variant="outline"
				>
					<RefreshCw aria-hidden="true" className="size-3" />
					Retry
				</Button>
			</>
		);
	} else if (phase === "demo") {
		tone = "demo";
		content = (
			<>
				<Badge
					className="px-1.5 py-0 text-[10px] uppercase tracking-wide"
					variant="secondary"
				>
					Demo
				</Badge>
				<span>
					Demo world — a labeled fixture. Nothing here touches a real hub.
				</span>
				{demoForced ? null : (
					<Button
						className="ml-auto h-7"
						onClick={onLeaveDemo}
						size="xs"
						type="button"
						variant="outline"
					>
						Leave demo
					</Button>
				)}
			</>
		);
	}

	return (
		<div className="shrink-0">
			<div
				aria-live="polite"
				className={cn(
					"flex min-h-8 items-center gap-2 border-b px-4 text-xs",
					tone === "neutral" && "border-border bg-card text-muted-foreground",
					tone === "warning" &&
						"border-border bg-secondary text-secondary-foreground",
					tone === "demo" && "border-border bg-sidebar text-sidebar-foreground",
					content === null && "sr-only",
				)}
				role="status"
			>
				{content}
			</div>
			{lastError ? (
				<div
					className="flex min-h-8 items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 text-xs text-foreground"
					role="alert"
				>
					{lastError.code ? (
						<span className="rounded-sm bg-destructive/20 px-1 font-mono text-[10px] text-destructive">
							{lastError.code}
						</span>
					) : null}
					<span className="truncate">{lastError.text}</span>
					<Button
						aria-label="Dismiss error"
						className="ml-auto size-6"
						onClick={clearError}
						size="icon"
						type="button"
						variant="ghost"
					>
						<X aria-hidden="true" className="size-3" />
					</Button>
				</div>
			) : null}
		</div>
	);
}
