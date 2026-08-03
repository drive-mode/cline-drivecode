import type {
	HubCommandName,
	StatusTagCount,
	StatusUpdate,
} from "@cline/shared";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

/**
 * Bridges the browser Status Hub view to hub `status.*` commands.
 *
 * Paging is always server-side: the browser sends a cursor and a limit and
 * gets one page back, so a long changelog never has to be materialized in the
 * dashboard process or the tab.
 */

function asStatusUpdates(value: unknown): StatusUpdate[] {
	return Array.isArray(value) ? (value as StatusUpdate[]) : [];
}

/**
 * Drops anything malformed rather than letting a junk chip render a count.
 *
 * Deliberately the same test the view's own guard applies to these entries: if
 * this pass were looser, an entry it forwarded and the view rejected would sink
 * the whole `status_page` frame rather than one chip.
 */
function asStatusTagCounts(value: readonly unknown[]): StatusTagCount[] {
	return value.filter((entry): entry is StatusTagCount => {
		if (typeof entry !== "object" || entry === null) return false;
		const { tag, count } = entry as StatusTagCount;
		return typeof tag === "string" && tag !== "" && Number.isFinite(count);
	});
}

export async function handleStatusCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: {
		type:
			| "status_query"
			| "status_board"
			| "status_current"
			| "status_subjects"
			| "status_tasks_snapshot"
			| "status_summary";
		requestId: string;
		[key: string]: unknown;
	},
): Promise<void> {
	if (!ctx.uiClient) {
		ctx.send(peer, {
			type: "status_error",
			requestId: frame.requestId,
			text: "Hub is not connected.",
			code: "hub_disconnected",
		});
		return;
	}

	const command = frame.type.replace("status_", "status.") as HubCommandName;
	const { type: _type, requestId, ...payload } = frame;

	try {
		const reply = await ctx.uiClient.command(
			command,
			payload as Record<string, unknown>,
		);
		if (!reply.ok) {
			ctx.send(peer, {
				type: "status_error",
				requestId,
				text: reply.error?.message ?? "Status command failed.",
				code: reply.error?.code,
			});
			return;
		}

		if (frame.type === "status_summary") {
			ctx.send(peer, {
				type: "status_summary_result",
				requestId,
				summary: reply.payload?.summary as never,
			});
			return;
		}

		if (frame.type === "status_subjects") {
			ctx.send(peer, {
				type: "status_subjects_result",
				requestId,
				subjects: Array.isArray(reply.payload?.subjects)
					? (reply.payload.subjects as string[])
					: [],
			});
			return;
		}

		if (frame.type === "status_tasks_snapshot") {
			ctx.send(peer, {
				type: "status_tasks_snapshot_result",
				requestId,
				teams: reply.payload?.teams ?? [],
			});
			return;
		}

		ctx.send(peer, {
			type: "status_page",
			requestId,
			updates: asStatusUpdates(reply.payload?.updates),
			nextCursor:
				typeof reply.payload?.nextCursor === "number"
					? reply.payload.nextCursor
					: null,
			hasMore: reply.payload?.hasMore === true,
			ftsAvailable: reply.payload?.ftsAvailable === true,
			// Forwarded only when the hub actually sent them — a query that did
			// not ask for facets gets none. Omitting beats defaulting to 0: the
			// view draws chip counts and a result count from these, and a
			// fabricated zero would read as "nothing matches".
			...(Number.isFinite(reply.payload?.total)
				? { total: reply.payload?.total as number }
				: {}),
			...(Array.isArray(reply.payload?.tagFacets)
				? { tagFacets: asStatusTagCounts(reply.payload.tagFacets) }
				: {}),
		});
	} catch (error) {
		ctx.send(peer, {
			type: "status_error",
			requestId,
			text: error instanceof Error ? error.message : String(error),
			code: "status_command_failed",
		});
	}
}
