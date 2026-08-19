/**
 * Analytics · Drive sessions accomplishment lens (DRV-ANALYTICS).
 * Lists recent call sessions with S2/S3/E1/E2/P1/P2 chips; drill to room/bank by
 * callSessionId. Distinct from agent Board / Changelog / Dependency map.
 */

import type { StatusSessionRow } from "@cline/drive";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageEmptyState } from "../components/views/page-layout";

export type StatusSessionsPanelProps = {
	rows: StatusSessionRow[];
	loading: boolean;
	error: string | null;
	selectedCallSessionId: string | null;
	onSelect: (row: StatusSessionRow) => void;
	/** Open Drive / join room for bank + plan correlation. */
	onOpenRoom?: (row: StatusSessionRow) => void;
	/**
	 * Opt-in shipped digest export (DRV-SHIPPED-DIGEST). Default off —
	 * only runs when the user clicks Export.
	 */
	onExportShippedDigest?: () => void | Promise<void>;
	exportBusy?: boolean;
};

function formatDuration(ms: number | null): string {
	if (ms == null || !Number.isFinite(ms) || ms < 0) {
		return "—";
	}
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const rem = seconds % 60;
	return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
}

export function StatusSessionsPanel({
	rows,
	loading,
	error,
	selectedCallSessionId,
	onSelect,
	onOpenRoom,
	onExportShippedDigest,
	exportBusy,
}: StatusSessionsPanelProps) {
	const selected =
		rows.find((row) => row.callSessionId === selectedCallSessionId) ?? null;

	if (error) {
		return (
			<div
				className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
				role="alert"
			>
				{error}
			</div>
		);
	}

	if (!loading && rows.length === 0) {
		return (
			<div className="rounded-lg border bg-card">
				<PageEmptyState>
					No Drive sessions in local room + bank logs yet. Complete tasks in a
					call to see accomplishment chips here.
				</PageEmptyState>
			</div>
		);
	}

	return (
		<div className="space-y-4" data-slot="status-sessions-panel">
			<p className="text-xs text-muted-foreground">
				Drive session accomplishment (local SessionRollups) — Analytics, not the
				agent Board or Changelog. Chips include S2 tasks done, S3 clean-drain,
				E1 continue, E2 intent refresh, P1 churn, P2 sticky fail.
			</p>

			{onExportShippedDigest ? (
				<div className="flex flex-wrap items-center gap-2">
					<Button
						className="h-7 text-xs"
						data-testid="status-export-shipped-digest"
						disabled={exportBusy || loading || rows.length === 0}
						onClick={() => {
							void onExportShippedDigest();
						}}
						size="sm"
						type="button"
						variant="outline"
					>
						{exportBusy ? "Exporting…" : "Export shipped digest"}
					</Button>
					<span className="text-[10px] text-muted-foreground">
						Opt-in local Markdown only — no cloud telemetry.
					</span>
				</div>
			) : null}

			<div className="rounded-lg border bg-card">
				<ul>
					{rows.map((row) => {
						const active = row.callSessionId === selectedCallSessionId;
						return (
							<li key={row.callSessionId}>
								<button
									aria-pressed={active}
									className={cn(
										"flex w-full flex-wrap items-center gap-2 border-b px-4 py-3 text-left last:border-b-0",
										active ? "bg-accent" : "hover:bg-muted/40",
									)}
									data-status-session-row={row.callSessionId}
									onClick={() => onSelect(row)}
									type="button"
								>
									<div className="min-w-0 flex-1 space-y-1">
										<div className="truncate font-mono text-xs font-medium">
											{row.callSessionId}
										</div>
										<div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
											<span>room={row.roomId ?? "—"}</span>
											<span>·</span>
											<span>{formatDuration(row.durationMs)}</span>
											{row.failureStickyCount > 0 ? (
												<span className="text-amber-700 dark:text-amber-300">
													P2 sticky={row.failureStickyCount}
												</span>
											) : null}
										</div>
									</div>
									<div className="flex flex-wrap gap-1">
										{row.chips.length === 0 ? (
											<span className="text-[10px] text-muted-foreground">
												no chips
											</span>
										) : (
											row.chips.map((chip) => (
												<span
													className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-800 dark:text-emerald-200"
													data-status-session-chip={chip.id}
													key={chip.id}
												>
													{chip.id}: {chip.label}
												</span>
											))
										)}
									</div>
								</button>
							</li>
						);
					})}
				</ul>
			</div>

			{loading ? (
				<p className="text-xs text-muted-foreground">Loading sessions…</p>
			) : null}

			{selected ? (
				<section
					aria-label="Session drill-down"
					className="space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-4 py-3"
					data-slot="status-session-drill"
				>
					<div className="text-[10px] font-medium uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
						Bank / room correlation
					</div>
					<dl className="grid gap-1 text-xs">
						<div className="flex gap-2">
							<dt className="text-muted-foreground">callSessionId</dt>
							<dd className="font-mono">{selected.callSessionId}</dd>
						</div>
						<div className="flex gap-2">
							<dt className="text-muted-foreground">roomId</dt>
							<dd className="font-mono">{selected.roomId ?? "—"}</dd>
						</div>
						<div className="flex gap-2">
							<dt className="text-muted-foreground">completed tasks</dt>
							<dd className="font-mono">
								{selected.completedTaskIds.length > 0
									? selected.completedTaskIds.join(", ")
									: "—"}
							</dd>
						</div>
					</dl>
					{onOpenRoom && selected.roomId ? (
						<Button
							className="h-7 text-xs"
							data-status-session-cta="open-room"
							onClick={() => onOpenRoom(selected)}
							size="sm"
							type="button"
							variant="outline"
						>
							Open room / Drive
						</Button>
					) : null}
				</section>
			) : null}
		</div>
	);
}
