import { describe, expect, it } from "vitest";
import { resolvePresentedArtifact } from "./artifactBody";

/**
 * Human vs agent Spotlight branch rules (mirrors Spotlight.tsx props).
 */
function spotlightBranch(input: {
	stageSharer: "you" | "agent";
	hubPin: { kind: string; label: string; ref?: string } | null;
}): {
	humanPin: typeof input.hubPin;
	humanSharing: boolean;
	suppressAgentCards: boolean;
} {
	const humanSharing = input.stageSharer === "you";
	const humanPin = humanSharing ? input.hubPin : null;
	return {
		humanPin,
		humanSharing,
		suppressAgentCards: Boolean(humanPin) && humanSharing,
	};
}

/**
 * What counts as staged on the screen (mirrors Spotlight.tsx). A caption alone
 * is narration, not an artifact — staging on it would make the presenter bar
 * claim an artifact is up while the screen shows the plain workspace.
 */
function staged(artifact: { title?: string; caption?: string; uri?: string }) {
	return Boolean(artifact.uri || artifact.title);
}

/** Subtitle text for the frame (mirrors Chat.tsx's `narration` prop). */
function narration(
	presentedShow: { caption?: string } | null,
	joinNote: string | null,
) {
	return presentedShow?.caption ?? joinNote;
}

describe("Spotlight human/agent branch", () => {
	it("shows hub pin only when you share; no optimistic invent", () => {
		expect(
			spotlightBranch({
				stageSharer: "you",
				hubPin: null,
			}),
		).toEqual({
			humanPin: null,
			humanSharing: true,
			suppressAgentCards: false,
		});

		expect(
			spotlightBranch({
				stageSharer: "you",
				hubPin: {
					kind: "selection",
					label: "block",
					ref: "const x = 1",
				},
			}).humanPin?.ref,
		).toBe("const x = 1");
	});

	it("hides pin and does not suppress cards when agent shares", () => {
		const branch = spotlightBranch({
			stageSharer: "agent",
			hubPin: { kind: "file", label: "a.ts" },
		});
		expect(branch.humanPin).toBeNull();
		expect(branch.suppressAgentCards).toBe(false);
	});
});

describe("Spotlight narration vs staged artifact", () => {
	it("does not stage a caption-only show", () => {
		expect(staged({ caption: "Reading the failing test now." })).toBe(false);
		expect(staged({ title: "Data flow" })).toBe(true);
		expect(staged({ uri: "data:image/png;base64,AAA" })).toBe(true);
	});

	it("stages a beat-only show once its backlog item completes it", () => {
		// A `drive_script_beat` presents a show with a caption and nothing else,
		// so on its own it must not stage. Once the same show id resolves against
		// the backlog the frame gets the item's title, and the gate flips —
		// which is why the client-side renderers need no widening here.
		const beat = { showItemId: "s1", caption: "Here is the layout." };
		expect(staged(beat)).toBe(false);
		expect(
			staged(
				resolvePresentedArtifact(beat, [
					{
						id: "s1",
						title: "Architecture overview",
						produce: { tool: "render_mermaid" },
					},
				]) ?? {},
			),
		).toBe(true);
	});

	it("subtitles a script beat that lands before anything is staged", () => {
		// `drive_script_beat` with no prior show yields a caption-only show; the
		// screen stays idle, so the subtitle is the only place the line can show.
		const beatOnly = { caption: "Reading the failing test now." };
		expect(staged(beatOnly)).toBe(false);
		expect(narration(beatOnly, "On the call. I am Riley.")).toBe(
			"Reading the failing test now.",
		);
	});

	it("falls back to the join note only while no show is presented", () => {
		expect(narration(null, "On the call. I am Riley.")).toBe(
			"On the call. I am Riley.",
		);
		expect(narration(null, null)).toBeNull();
	});
});
