import type { Participant } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { resolveSpeakerByline } from "./speakerBylineLogic";

const human: Participant = {
	id: "drive:human",
	kind: "human",
	displayName: "Harrison",
	role: "host",
	status: "idle",
};

const partner: Participant = {
	id: "drive:partner",
	kind: "agent",
	displayName: "Partner",
	role: "partner",
	status: "idle",
	seatSources: [],
};

const specialist: Participant = {
	id: "agent:reviewer",
	kind: "agent",
	displayName: "Reviewer",
	role: "specialist",
	status: "idle",
	seatSources: [],
};

const roster = [human, partner, specialist];

describe("resolveSpeakerByline", () => {
	/**
	 * The load-bearing case. A null result is the contract that keeps
	 * `MessageByline` from rendering any element at all — no placeholder,
	 * no empty node. Everything below guards that null.
	 */
	it("returns null when the message carries no speakerId", () => {
		expect(resolveSpeakerByline(undefined, roster)).toBeNull();
	});

	it("returns null for a blank or whitespace speakerId", () => {
		expect(resolveSpeakerByline("", roster)).toBeNull();
		expect(resolveSpeakerByline("   ", roster)).toBeNull();
	});

	it("does not fall back to the partner when attribution is missing", () => {
		// One runtime makes "Partner" a good guess and still a lie.
		expect(resolveSpeakerByline(undefined, [human, partner])).toBeNull();
	});

	it("returns null when there is no roster to resolve against", () => {
		expect(resolveSpeakerByline("drive:partner", undefined)).toBeNull();
		expect(resolveSpeakerByline("drive:partner", [])).toBeNull();
	});

	it("returns null when the speaker is no longer seated", () => {
		// The raw id is not a name; printing `agent:reviewer` is not attribution.
		expect(resolveSpeakerByline("agent:reviewer", [human, partner])).toBeNull();
	});

	it("names the addressed participant when the id resolves", () => {
		expect(resolveSpeakerByline("drive:partner", roster)).toBe("Partner");
		expect(resolveSpeakerByline("agent:reviewer", roster)).toBe("Reviewer");
	});

	it("tolerates surrounding whitespace on the id", () => {
		expect(resolveSpeakerByline("  drive:partner  ", roster)).toBe("Partner");
	});
});
