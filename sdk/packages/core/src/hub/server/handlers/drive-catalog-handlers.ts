/**
 * Hub drive_catalog_get / drive_catalog_put (typed facet catalog IO).
 * Separate from voice drive_config_* / driveFacetsStore.
 */

import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import {
	catalogSnapshotView,
	putCatalogDurableValues,
} from "../../drive-config/driveCatalogFacetStore";
import { errorReply, type HubTransportContext, okReply } from "./context";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function handleDriveCatalogCommand(
	_ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const workspaceRoot =
		readString(envelope.payload, "workspaceRoot") ??
		readString(envelope.payload, "configParent");
	if (!workspaceRoot) {
		return errorReply(
			envelope,
			"invalid_payload",
			"workspaceRoot or configParent is required",
		);
	}

	switch (envelope.command) {
		case "drive_catalog_get": {
			const view = catalogSnapshotView(workspaceRoot);
			return okReply(envelope, {
				durable: view.durable,
				live: view.live,
				defs: view.defs,
			});
		}
		case "drive_catalog_put": {
			const values = envelope.payload?.values;
			if (
				values === null ||
				typeof values !== "object" ||
				Array.isArray(values)
			) {
				return errorReply(
					envelope,
					"invalid_payload",
					"values object is required",
				);
			}
			const result = putCatalogDurableValues({
				workspaceRoot,
				values: values as Record<string, unknown>,
			});
			if (!result.ok) {
				return errorReply(envelope, result.code, result.message);
			}
			return okReply(envelope, { durable: result.snapshot });
		}
		default:
			return errorReply(
				envelope,
				"not_implemented",
				`Unknown drive catalog command: ${envelope.command}`,
			);
	}
}
