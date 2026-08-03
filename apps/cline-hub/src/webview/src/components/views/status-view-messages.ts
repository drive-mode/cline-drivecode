/**
 * Host-message shape guards for the Status Hub view, kept out of the
 * component so they can be tested under the node environment the webview
 * suite runs in. Guards cover the fields the view's logic consumes; fields
 * that are only rendered as React text stay unchecked because they are inert.
 */

import type {
	StatusSummary,
	StatusTagCount,
	StatusUpdate,
} from "@cline/shared";
import {
	type HostMessage,
	isOptionalString,
	isRecord,
} from "../../lib/host-message-gateway";

export const STATUS_VIEW_MESSAGE_TYPES = [
	"status_page",
	"status_summary_result",
	"status_tasks_snapshot_result",
	"team_progress",
	"status_error",
	"status_updated",
] as const;

export type StatusViewHostMessage = HostMessage &
	(
		| {
				type: "status_page";
				requestId: string;
				updates: StatusUpdate[];
				nextCursor?: number | null;
				hasMore?: boolean;
				/**
				 * Unnarrowed on purpose. The guard admits the frame regardless of
				 * these, so the view has to run them through `statusTagCountsOf`
				 * and a finite check before rendering either as a number.
				 */
				total?: unknown;
				tagFacets?: unknown;
		  }
		| {
				type: "status_summary_result";
				requestId?: string;
				summary: StatusSummary;
		  }
		| { type: "status_tasks_snapshot_result" }
		| { type: "team_progress" }
		| { type: "status_error"; requestId: string; text: string }
		| { type: "status_updated"; update: StatusUpdate }
	);

export function isStatusSummaryPayload(value: unknown): value is StatusSummary {
	if (!isRecord(value) || typeof value.total !== "number") {
		return false;
	}
	if (
		!isRecord(value.byState) ||
		!Object.values(value.byState).every((count) => typeof count === "number")
	) {
		return false;
	}
	if (
		!Array.isArray(value.byAgent) ||
		!value.byAgent.every(
			(agent) => isRecord(agent) && typeof agent.agentId === "string",
		)
	) {
		return false;
	}
	return (
		value.lastUpdatedAt === null ||
		value.lastUpdatedAt === undefined ||
		typeof value.lastUpdatedAt === "string"
	);
}

/**
 * Facet counts are rendered as numbers the user acts on — a chip count is a
 * promise about what clicking it returns — so a malformed entry has to be
 * dropped rather than coerced into a chip labelled `undefined`.
 */
export function isStatusTagCountPayload(
	value: unknown,
): value is StatusTagCount {
	return (
		isRecord(value) &&
		typeof value.tag === "string" &&
		value.tag !== "" &&
		typeof value.count === "number" &&
		Number.isFinite(value.count)
	);
}

/**
 * The usable facet entries of a page, junk discarded.
 *
 * Filtered rather than validated as a precondition on the whole frame: the
 * chips are decoration next to the rows, so one bad entry must cost its own
 * chip and nothing else. Rejecting the frame would drop a perfectly good page
 * of updates and — because the view clears `loading` only on a frame it
 * accepts — leave the list empty with the spinner stuck on.
 */
export function statusTagCountsOf(
	value: unknown,
): StatusTagCount[] | undefined {
	return Array.isArray(value)
		? value.filter(isStatusTagCountPayload)
		: undefined;
}

/** Shallow: checks the fields dedupe, filters, and board sections key on. */
export function isStatusUpdatePayload(value: unknown): value is StatusUpdate {
	return (
		isRecord(value) &&
		typeof value.updateId === "string" &&
		typeof value.subject === "string" &&
		typeof value.state === "string" &&
		isOptionalString(value.agentId)
	);
}

export function isStatusViewHostMessage(
	message: HostMessage,
): message is StatusViewHostMessage {
	switch (message.type) {
		case "status_page":
			// `total` and `tagFacets` are deliberately not checked here: the view
			// narrows them at the point of use, so a bad count costs its own chip
			// instead of sinking a whole page of rows.
			return (
				typeof message.requestId === "string" &&
				Array.isArray(message.updates) &&
				message.updates.every(isStatusUpdatePayload) &&
				(message.nextCursor === undefined ||
					message.nextCursor === null ||
					typeof message.nextCursor === "number") &&
				(message.hasMore === undefined || typeof message.hasMore === "boolean")
			);
		case "status_summary_result":
			return (
				isOptionalString(message.requestId) &&
				isStatusSummaryPayload(message.summary)
			);
		case "status_tasks_snapshot_result":
		case "team_progress":
			return true;
		case "status_error":
			return (
				typeof message.requestId === "string" &&
				typeof message.text === "string"
			);
		case "status_updated":
			return isStatusUpdatePayload(message.update);
		default:
			return false;
	}
}
