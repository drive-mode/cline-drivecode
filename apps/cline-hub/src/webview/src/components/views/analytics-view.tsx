/**
 * Analytics — retrospective Drive session observability (DRV-ANALYTICS).
 *
 * Local SessionRollups with accomplishment chips and opt-in shipped digest.
 * Distinct from Status Hub Board / Changelog / Dependency map (live ops).
 */

import type { StatusSessionRow } from "@cline/drive";
import { buildShippedDigest, formatShippedDigestMarkdown } from "@cline/drive";
import { ChartNoAxesColumnIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadTextFile } from "../../status/downloadTextFile";
import { StatusSessionsPanel } from "../../status/StatusSessionsPanel";
import type { StatusSessionRollupSource } from "../../status/status-session-rollup-source";
import { PageFrame, PageHeader } from "./page-layout";

export function AnalyticsView(props: {
	sessionSource: StatusSessionRollupSource;
	onOpenSessionRoom?: (row: StatusSessionRow) => void;
}) {
	const { sessionSource, onOpenSessionRoom } = props;
	const [sessionRows, setSessionRows] = useState<StatusSessionRow[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selectedCallSessionId, setSelectedCallSessionId] = useState<
		string | null
	>(null);
	const [exportBusy, setExportBusy] = useState(false);
	const sessionsRequestRef = useRef<string | null>(null);

	const requestSessions = useCallback(() => {
		const requestId = `analytics-sessions-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		sessionsRequestRef.current = requestId;
		setLoading(true);
		setError(null);
		void sessionSource
			.loadSessions({ limit: 20 })
			.then((rows) => {
				if (sessionsRequestRef.current !== requestId) return;
				setSessionRows(rows);
				setLoading(false);
			})
			.catch((err) => {
				if (sessionsRequestRef.current !== requestId) return;
				setError(err instanceof Error ? err.message : String(err));
				setSessionRows([]);
				setLoading(false);
			});
	}, [sessionSource]);

	useEffect(() => {
		requestSessions();
	}, [requestSessions]);

	const exportShippedDigest = useCallback(async () => {
		setExportBusy(true);
		try {
			const rows =
				sessionRows.length > 0
					? sessionRows
					: await sessionSource.loadSessions({ limit: 20 });
			const digest = buildShippedDigest({ rollups: rows });
			const markdown = formatShippedDigestMarkdown(digest);
			const stamp = digest.generatedAt.slice(0, 19).replace(/[:T]/g, "-");
			downloadTextFile(`drive-shipped-digest-${stamp}.md`, markdown);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setExportBusy(false);
		}
	}, [sessionRows, sessionSource]);

	return (
		<PageFrame>
			<PageHeader
				description="Did Drive sessions get work done? Local rollups and shipped digests — not live agent ops."
				icon={ChartNoAxesColumnIcon}
				title="Analytics"
				actions={
					<Button
						disabled={loading}
						onClick={requestSessions}
						size="sm"
						type="button"
						variant="outline"
					>
						<RefreshCwIcon
							className={cn("size-3.5", loading && "animate-spin")}
						/>
						Refresh
					</Button>
				}
			/>

			<StatusSessionsPanel
				error={error}
				exportBusy={exportBusy}
				loading={loading}
				onExportShippedDigest={exportShippedDigest}
				onOpenRoom={onOpenSessionRoom}
				onSelect={(row) => setSelectedCallSessionId(row.callSessionId)}
				rows={sessionRows}
				selectedCallSessionId={selectedCallSessionId}
			/>
		</PageFrame>
	);
}
