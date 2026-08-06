/** Address set label for persistent chip (PU6). */

import type { AddressSet, Participant } from "@cline/shared";

export function formatAddressSetLabel(
	addressSet: AddressSet,
	participants: readonly Participant[] = [],
): string {
	if (addressSet.mode === "everyone") {
		return "Everyone";
	}
	if (addressSet.mode === "pack") {
		return `Pack · ${addressSet.packId}`;
	}
	const names = addressSet.agentIds.map((id) => {
		const seated = participants.find((p) => p.id === id);
		return seated?.displayName ?? id;
	});
	if (names.length === 1) {
		return names[0] ?? "Agent";
	}
	return names.slice(0, 2).join(" + ") + (names.length > 2 ? "…" : "");
}
