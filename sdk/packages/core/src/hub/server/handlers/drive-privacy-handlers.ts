/**
 * Hub drive_privacy_put — live (hub-memory, never-persisted) DRV-PRIVACY
 * retention facets (see collaboration/retentionCaps.ts). `privacy.debugRetention`
 * is session-scoped: it never survives a hub restart and never writes to disk.
 */

import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import {
	getLiveRetentionFacets,
	setLiveRetentionFacets,
} from "../../collaboration/retentionCaps";
import { errorReply, type HubTransportContext, okReply } from "./context";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalBoolean(
	payload: Record<string, unknown> | undefined,
	key: string,
): boolean | undefined {
	const value = payload?.[key];
	return typeof value === "boolean" ? value : undefined;
}

/**
 * Both retention facets are record counts, so a fractional value is not a
 * small cap — it is not a cap. Accepting `0.5` here is what let it reach
 * `Math.floor` downstream and resolve to `0`, which means "empty the log".
 * Rejecting non-integers at the wire keeps the destructive value from being
 * expressible at all; `resolveRecordCap` is the second line, not the first.
 *
 * An unusable value is dropped rather than erroring, matching how every other
 * field here treats the wrong type. The caller is not left guessing: the
 * `ok` reply echoes the facets that were actually applied.
 */
function readOptionalPositiveInteger(
	payload: Record<string, unknown> | undefined,
	key: string,
): number | undefined {
	const value = payload?.[key];
	return typeof value === "number" && Number.isInteger(value) && value >= 1
		? value
		: undefined;
}

export function handleDrivePrivacyCommand(
	_ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const configParent =
		readString(envelope.payload, "configParent") ??
		readString(envelope.payload, "workspaceRoot");
	if (!configParent) {
		return errorReply(
			envelope,
			"invalid_payload",
			"configParent or workspaceRoot is required",
		);
	}

	switch (envelope.command) {
		case "drive_privacy_put": {
			const debugRetention = readOptionalBoolean(
				envelope.payload,
				"debugRetention",
			);
			const retentionRoomMax = readOptionalPositiveInteger(
				envelope.payload,
				"retentionRoomMax",
			);
			const retentionBankMax = readOptionalPositiveInteger(
				envelope.payload,
				"retentionBankMax",
			);
			// Merge onto the existing live facets for this workspace — a
			// caller setting only `debugRetention` must not silently drop a
			// previously set `retentionRoomMax`/`retentionBankMax` (and vice
			// versa).
			const next = {
				...getLiveRetentionFacets(configParent),
				...(debugRetention !== undefined ? { debugRetention } : {}),
				...(retentionRoomMax !== undefined ? { retentionRoomMax } : {}),
				...(retentionBankMax !== undefined ? { retentionBankMax } : {}),
			};
			setLiveRetentionFacets(configParent, next);
			return okReply(envelope, { facets: next });
		}
		default:
			return errorReply(
				envelope,
				"not_implemented",
				`Unknown drive privacy command: ${envelope.command}`,
			);
	}
}
