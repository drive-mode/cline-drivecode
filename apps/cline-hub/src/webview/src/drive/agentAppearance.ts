/**
 * Which agents can have a *durable* appearance, and what gets written for them.
 *
 * Pure on purpose: the hub vitest project is node-env and never collects
 * `.tsx`, so every decision a component would otherwise bury in JSX lives here
 * where a test can reach it.
 */

import { defaultInkRef } from "@cline/drive";
import {
	type AgentRef,
	agentProfileId,
	type InkRef,
	type Participant,
} from "@cline/shared";
import type { DriveAgentProfileDraft } from "./requestDriveAgentProfiles";
import type { DriveAgentInk } from "./types";

/**
 * The durable key an agent's appearance can be saved under, or null.
 *
 * Null is the common case for a legacy seat: `agent.appearance` is keyed by
 * `agentProfileId(ref)` and the inverse parse is strict, so a participant with
 * no `ref` has no durable identity to write against. Its colour still resolves
 * — through the stable hash on the participant id — it just cannot be pinned.
 * Seating with a real `ref` is what turns that from local to durable.
 */
export function durableAppearanceTarget(
	participant: Participant,
): { ref: AgentRef; profileId: string } | null {
	if (participant.kind !== "agent" || !participant.ref) {
		return null;
	}
	return {
		ref: participant.ref,
		profileId: agentProfileId(participant.ref),
	};
}

/**
 * Fill a whole durable profile from whatever the two channels currently hold.
 *
 * The durable schema requires both inks, while the UI lets a user set one and
 * leave the other alone. The gap is filled with the resolver's own default for
 * the untouched channel — the same value that channel was already painting —
 * so saving a name colour cannot silently restyle the body.
 */
export function buildAgentProfileDraft(input: {
	ref: AgentRef;
	profileId: string;
	displayName?: string;
	ink?: DriveAgentInk;
}): DriveAgentProfileDraft {
	const { ref, profileId, displayName, ink } = input;
	const trimmedName = displayName?.trim();
	return {
		ref,
		...(trimmedName ? { displayName: trimmedName } : {}),
		nameInk: ink?.nameInk ?? defaultInkRef("name", profileId),
		bodyInk: ink?.bodyInk ?? defaultInkRef("body", profileId),
	};
}

/** Palette index of an ink, or null when it is a token or unset. */
export function inkPaletteIndex(ink: InkRef | null | undefined): number | null {
	return ink?.kind === "palette" ? ink.index : null;
}

/**
 * The ink a palette `<select>` value maps to.
 *
 * `""` clears back to the channel default rather than writing index 0 — those
 * are different states, and conflating them would make "Default" unreachable
 * once anything had been chosen.
 */
export function inkFromPaletteChoice(raw: string): InkRef | null {
	if (raw === "") {
		return null;
	}
	const index = Number.parseInt(raw, 10);
	if (!Number.isInteger(index) || index < 0 || index > 7) {
		return null;
	}
	return { kind: "palette", index: index as 0 };
}
