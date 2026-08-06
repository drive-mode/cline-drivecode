import { describe, expect, it } from "vitest";
import { formatAddressSetLabel } from "./addressLabel";

describe("formatAddressSetLabel", () => {
	it("labels everyone and agents", () => {
		expect(formatAddressSetLabel({ mode: "everyone" })).toBe("Everyone");
		expect(
			formatAddressSetLabel(
				{ mode: "agents", agentIds: ["a1"] },
				[
					{
						id: "a1",
						kind: "agent",
						displayName: "Coder",
						role: "partner",
						status: "idle",
						seatSources: [],
					},
				],
			),
		).toBe("Coder");
		expect(
			formatAddressSetLabel({ mode: "pack", packId: "core" }),
		).toBe("Pack · core");
	});
});
