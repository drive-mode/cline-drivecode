import type { StageCard } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { buildHumanPinDefaults } from "./pinDefaults";
import { buildSetStageMessage } from "./stageSharePin";

describe("buildHumanPinDefaults for Share pin", () => {
	it("prefers edit and command cards for file/terminal pins", () => {
		const cards: StageCard[] = [
			{
				id: "c1",
				category: "edit",
				title: "router.ts",
				summary: "src/router.ts",
				workEventId: "w1",
				updatedAt: "2026-07-29T00:00:00.000Z",
			},
			{
				id: "c2",
				category: "command",
				title: "bun test",
				summary: "ok",
				workEventId: "w2",
				updatedAt: "2026-07-29T00:00:01.000Z",
			},
		];
		const defaults = buildHumanPinDefaults(cards);
		expect(defaults.file.label).toBe("router.ts");
		expect(defaults.terminal.label).toBe("bun test");
		expect(defaults.selection.kind).toBe("selection");
	});
});

describe("Share pin stage payload shape", () => {
	it("builds call_set_stage human+pin and agent return payloads", () => {
		const humanPin = buildHumanPinDefaults([]).file;
		const takeStage = buildSetStageMessage({
			roomId: "default",
			sharer: { kind: "human", participantId: "drive:human" },
			pin: humanPin,
		});
		expect(takeStage.type).toBe("call_set_stage");
		expect(takeStage.sharer?.kind).toBe("human");
		expect(takeStage.pin?.kind).toBe("file");

		const returnSpotlight = buildSetStageMessage({
			roomId: "default",
			sharer: { kind: "agent", participantId: "drive:partner" },
			pin: null,
		});
		expect(returnSpotlight.pin).toBeNull();
		expect(returnSpotlight.sharer?.kind).toBe("agent");
	});

	it("falls back to the default room and distinguishes omitted from cleared pins", () => {
		expect(buildSetStageMessage({ roomId: null, sharer: null }).roomId).toBe(
			"default",
		);
		expect(buildSetStageMessage({ roomId: "  ", sharer: null }).roomId).toBe(
			"default",
		);
		// Omitted leaves the pin alone; null clears it. The strip's Share pin and
		// the roster sheet's must agree on that distinction.
		expect(buildSetStageMessage({ roomId: "r1", sharer: null }).pin).toBe(
			undefined,
		);
		expect(
			buildSetStageMessage({ roomId: "r1", sharer: null, pin: null }).pin,
		).toBeNull();
	});
});
