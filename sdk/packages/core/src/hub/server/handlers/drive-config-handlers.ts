/**
 * Hub drive_config_get / drive_config_put / drive_config_upsert_profile.
 *
 * The two lanes here write different files on purpose. Voice + provider facets
 * live in `facets.v1.json` (whole-object put); per-agent appearance lives in
 * the catalog envelope `catalog-facets.v1.json` as an `agent.appearance` map.
 * Keeping them apart is what makes a TTS change unable to erase an agent's
 * colours — see `upsertAgentProfile`.
 */

import type {
	AgentAppearance,
	AgentRef,
	HubCommandEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";
import {
	agentProfileId,
	parseAgentAppearance,
	parseAgentRef,
	parseDriveFacetValues,
	type ResolvedLlmEgress,
} from "@cline/shared";
import {
	listAgentProfiles,
	upsertAgentProfile,
} from "../../drive-config/driveCatalogFacetStore";
import {
	loadOrSeedDriveFacets,
	setDriveFacets,
} from "../../drive-config/driveFacetsStore";
import { errorReply, type HubTransportContext, okReply } from "./context";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function defaultLlm(): ResolvedLlmEgress {
	return { kind: "cloud", providerId: "anthropic" };
}

export function handleDriveConfigCommand(
	ctx: HubTransportContext,
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
		case "drive_config_get": {
			const facets = loadOrSeedDriveFacets({ configParent });
			// Read back through the facet store's map lane, so the durable
			// appearance written by drive_config_upsert_profile has a caller.
			return okReply(envelope, {
				facets,
				profiles: listAgentProfiles(configParent),
			});
		}
		case "drive_config_put": {
			let facets: ReturnType<typeof parseDriveFacetValues>;
			try {
				facets = parseDriveFacetValues(envelope.payload?.facets);
			} catch (error) {
				return errorReply(
					envelope,
					"invalid_payload",
					error instanceof Error ? error.message : String(error),
				);
			}
			const llm =
				(envelope.payload?.llm as ResolvedLlmEgress | undefined) ??
				defaultLlm();
			const result = setDriveFacets({ configParent, facets, llm });
			if (!result.ok) {
				return errorReply(envelope, "facet_rejected", result.message);
			}
			ctx.publish(
				ctx.buildEvent("drive.config.changed", {
					snapshot: result.snapshot as unknown as Record<string, unknown>,
				}),
			);
			return okReply(envelope, {
				facets: result.facets,
				snapshot: result.snapshot,
			});
		}
		case "drive_config_upsert_profile": {
			const raw = envelope.payload?.profile;
			if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
				return errorReply(
					envelope,
					"invalid_payload",
					"profile object is required",
				);
			}
			const { id, ref: rawRef, ...rest } = raw as Record<string, unknown>;

			let ref: AgentRef;
			let appearance: AgentAppearance;
			try {
				ref = parseAgentRef(rawRef);
				appearance = parseAgentAppearance(rest);
			} catch (error) {
				return errorReply(
					envelope,
					"invalid_payload",
					error instanceof Error ? error.message : String(error),
				);
			}

			// The id is derived from the ref, so a supplied one is only accepted
			// when it agrees — honouring a conflicting id would file the
			// appearance under a key no reader ever looks up. Checked before the
			// write, not after, so a rejected call leaves disk untouched.
			const derivedId = agentProfileId(ref);
			if (typeof id === "string" && id !== derivedId) {
				return errorReply(
					envelope,
					"invalid_payload",
					`profile.id "${id}" does not match the id derived from ref ("${derivedId}")`,
				);
			}

			const result = upsertAgentProfile({
				workspaceRoot: configParent,
				ref,
				appearance,
			});
			if (!result.ok) {
				return errorReply(envelope, result.code, result.message);
			}
			ctx.publish(
				ctx.buildEvent("drive.profile.changed", {
					profile: result.profile as unknown as Record<string, unknown>,
				}),
			);
			return okReply(envelope, { profile: result.profile });
		}
		default:
			return errorReply(
				envelope,
				"not_implemented",
				`Unknown drive config command: ${envelope.command}`,
			);
	}
}
