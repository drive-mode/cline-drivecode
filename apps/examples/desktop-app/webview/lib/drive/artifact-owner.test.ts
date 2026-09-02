import { driveInkTheme } from "@cline/drive";
import type { AgentProfile, Participant } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	artifactOwnerInitials,
	artifactOwnerInk,
	artifactOwnerLabel,
	artifactOwnerProfileId,
	isHumanOwner,
} from "./artifact-owner";

const participants: Participant[] = [
	{
		id: "drive:human",
		kind: "human",
		displayName: "Harrison",
		role: "host",
		status: "idle",
	},
	{
		id: "agent:riley",
		kind: "agent",
		displayName: "Riley",
		role: "specialist",
		status: "working",
		ref: { kind: "driveagent", slug: "riley" },
		seatSources: [],
	},
	{
		id: "agent:legacy",
		kind: "agent",
		displayName: "Legacy",
		role: "specialist",
		status: "idle",
		seatSources: [],
	},
];

const theme = driveInkTheme("dark");

describe("artifact owner", () => {
	it("labels seated owners by display name and unseated ones by id", () => {
		expect(artifactOwnerLabel("agent:riley", participants)).toBe("Riley");
		expect(artifactOwnerLabel("drive:human", participants)).toBe("Harrison");
		expect(artifactOwnerLabel("agent:sam")).toBe("Sam");
		expect(artifactOwnerLabel("drive:partner")).toBe("Cline");
		expect(artifactOwnerLabel("drive:human")).toBe("You");
		expect(artifactOwnerLabel("pack/code_reviewer")).toBe("Code reviewer");
		expect(artifactOwnerLabel("::")).toBe("::");
	});

	it("tells humans from agents, seated or not", () => {
		expect(isHumanOwner("drive:human", participants)).toBe(true);
		expect(isHumanOwner("agent:riley", participants)).toBe(false);
		expect(isHumanOwner("drive:human")).toBe(true);
		expect(isHumanOwner("human:alice")).toBe(true);
		expect(isHumanOwner("agent:sam")).toBe(false);
	});

	it("keys appearance by the agent ref when the seat recorded one", () => {
		expect(artifactOwnerProfileId("agent:riley", participants)).toBe(
			"driveagent.riley",
		);
		expect(artifactOwnerProfileId("agent:legacy", participants)).toBe(
			"agent:legacy",
		);
		expect(artifactOwnerProfileId("agent:sam")).toBe("agent:sam");
	});

	it("resolves ink through the kernel, honouring stored profiles", () => {
		const profiles: AgentProfile[] = [
			{
				id: "driveagent.riley",
				ref: { kind: "driveagent", slug: "riley" },
				nameInk: { kind: "palette", index: 2 },
				bodyInk: { kind: "token", token: "muted" },
			},
		];
		const stored = artifactOwnerInk({
			ownerId: "agent:riley",
			participants,
			profiles,
			theme,
		});
		const unstored = artifactOwnerInk({
			ownerId: "agent:riley",
			participants,
			theme,
		});
		expect(stored).toMatch(/^oklch\(/);
		expect(unstored).toMatch(/^oklch\(/);
		expect(artifactOwnerInk({ ownerId: "drive:human", theme })).toBeUndefined();
		// Two unconfigured agents still differ.
		expect(artifactOwnerInk({ ownerId: "agent:sam", theme })).not.toBe(
			artifactOwnerInk({ ownerId: "agent:riley", theme }),
		);
	});

	it("builds avatar initials", () => {
		expect(artifactOwnerInitials("Riley")).toBe("RI");
		expect(artifactOwnerInitials("Code reviewer")).toBe("CR");
		expect(artifactOwnerInitials("  ")).toBe("?");
	});
});
