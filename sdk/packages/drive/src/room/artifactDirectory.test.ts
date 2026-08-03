import type { DriveEvent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	artifactDirectoryTags,
	type DriveArtifactDirectoryEntry,
	filterArtifactDirectory,
	projectArtifactDirectory,
	sortArtifactDirectory,
} from "./artifactDirectory";

const ROOM = "demo-polish";

/** Keys the four hub producers populate; none may reach the corpus. */
const MEDIA_BYTE_KEYS = [
	"uri",
	"dataUri",
	"svg",
	"image",
	"bytes",
	"thumbnail",
];

function ts(minute: number): string {
	return `2026-07-31T16:${String(minute).padStart(2, "0")}:00.000Z`;
}

function artifact(
	overrides: Partial<Extract<DriveEvent, { type: "media.artifact" }>> & {
		id: string;
		showItemId: string;
	},
): DriveEvent {
	return {
		schemaVersion: 1,
		roomId: ROOM,
		at: ts(10),
		type: "media.artifact",
		track: "media",
		artifactKind: "diagram.architecture",
		mediaClass: "still",
		title: "Cline drive topology",
		caption: "Hub daemon is the single writer",
		ownerParticipantId: "drive:partner",
		produce: {
			tool: "render_mermaid",
			args: { mermaidSource: "flowchart LR\n  A --> B" },
		},
		status: "shown",
		...overrides,
	};
}

describe("projectArtifactDirectory", () => {
	it("projects a record into a bytes-free corpus entry", () => {
		const entries = projectArtifactDirectory({
			events: [
				artifact({
					id: "e1",
					showItemId: "show-abc123",
					tags: ["architecture", "hub"],
				}),
			],
		});

		expect(entries).toEqual([
			{
				showItemId: "show-abc123",
				roomId: ROOM,
				artifactKind: "diagram.architecture",
				mediaClass: "still",
				title: "Cline drive topology",
				ownerParticipantId: "drive:partner",
				produce: {
					tool: "render_mermaid",
					args: { mermaidSource: "flowchart LR\n  A --> B" },
				},
				tags: ["architecture", "hub"],
				status: "shown",
				createdAt: ts(10),
				updatedAt: ts(10),
			},
		]);
	});

	it("drops the caption rather than carrying prose into UI state", () => {
		const [entry] = projectArtifactDirectory({
			events: [artifact({ id: "e1", showItemId: "show-1" })],
		});
		expect(entry).not.toHaveProperty("caption");
		expect(JSON.stringify(entry)).not.toContain("single writer");
	});

	it("carries no artifact bytes into the corpus", () => {
		const serialized = JSON.stringify(
			projectArtifactDirectory({
				events: [artifact({ id: "e1", showItemId: "show-1" })],
			}),
		);
		for (const key of MEDIA_BYTE_KEYS) {
			expect(serialized).not.toContain(`"${key}"`);
		}
		expect(serialized).not.toContain("data:image");
	});

	it("defaults tags to an empty list when the record omits them", () => {
		const [entry] = projectArtifactDirectory({
			events: [artifact({ id: "e1", showItemId: "show-1" })],
		});
		expect(entry?.tags).toEqual([]);
	});

	it("lets the show lifecycle advance one entry in place", () => {
		const entries = projectArtifactDirectory({
			events: [
				artifact({ id: "e1", showItemId: "show-1", status: "planned" }),
				artifact({ id: "e2", showItemId: "show-2", title: "Plan card" }),
				artifact({
					id: "e3",
					showItemId: "show-1",
					status: "shown",
					title: "Topology v2",
					tags: ["architecture"],
					at: ts(40),
				}),
			],
		});

		expect(entries.map((e) => e.showItemId)).toEqual(["show-1", "show-2"]);
		expect(entries[0]?.status).toBe("shown");
		expect(entries[0]?.title).toBe("Topology v2");
		expect(entries[0]?.tags).toEqual(["architecture"]);
		// First production time survives; the newest record moves updatedAt.
		expect(entries[0]?.createdAt).toBe(ts(10));
		expect(entries[0]?.updatedAt).toBe(ts(40));
	});

	/**
	 * Regression: producers key showItemId on a content hash, so the same
	 * diagram shown in two rooms arrives with one id. Keying the corpus on
	 * showItemId alone let the second room overwrite the first room's record.
	 */
	it("keeps a content-shared showItemId separate per room", () => {
		const entries = projectArtifactDirectory({
			events: [
				artifact({ id: "e1", showItemId: "show-1", title: "Room one" }),
				artifact({
					id: "e2",
					showItemId: "show-1",
					roomId: "other-room",
					title: "Room two",
				}),
			],
		});

		expect(entries.map((e) => [e.roomId, e.title])).toEqual([
			[ROOM, "Room one"],
			["other-room", "Room two"],
		]);
	});

	it("ignores records from the other four tracks", () => {
		const entries = projectArtifactDirectory({
			events: [
				{
					schemaVersion: 1,
					id: "w1",
					roomId: ROOM,
					at: ts(5),
					type: "work.edit",
					track: "work",
					path: "src/app.ts",
				},
				artifact({ id: "e1", showItemId: "show-1" }),
				{
					schemaVersion: 1,
					id: "c1",
					roomId: ROOM,
					at: ts(20),
					type: "conversation.message",
					track: "conversation",
					text: "ship it",
				},
			],
		});
		expect(entries.map((e) => e.showItemId)).toEqual(["show-1"]);
	});

	it("survives an empty log", () => {
		expect(projectArtifactDirectory({ events: [] })).toEqual([]);
	});
});

describe("sortArtifactDirectory", () => {
	it("orders most recently touched first", () => {
		const entries = projectArtifactDirectory({
			events: [
				artifact({ id: "e1", showItemId: "old", at: ts(10) }),
				artifact({ id: "e2", showItemId: "newest", at: ts(50) }),
				artifact({ id: "e3", showItemId: "middle", at: ts(30) }),
			],
		});

		expect(sortArtifactDirectory(entries).map((e) => e.showItemId)).toEqual([
			"newest",
			"middle",
			"old",
		]);
		// Sorting does not disturb the projection it was handed.
		expect(entries.map((e) => e.showItemId)).toEqual([
			"old",
			"newest",
			"middle",
		]);
	});

	it("breaks a timestamp tie on room then id", () => {
		const entries = projectArtifactDirectory({
			events: [
				artifact({ id: "e1", showItemId: "show-b" }),
				artifact({ id: "e2", showItemId: "show-a" }),
				artifact({ id: "e3", showItemId: "show-a", roomId: "another-room" }),
			],
		});
		expect(sortArtifactDirectory(entries).map((e) => keyLabel(e))).toEqual([
			"another-room/show-a",
			`${ROOM}/show-a`,
			`${ROOM}/show-b`,
		]);
	});
});

function keyLabel(entry: DriveArtifactDirectoryEntry): string {
	return `${entry.roomId}/${entry.showItemId}`;
}

describe("filterArtifactDirectory", () => {
	const entries = projectArtifactDirectory({
		events: [
			artifact({
				id: "e1",
				showItemId: "arch",
				artifactKind: "diagram.architecture",
				tags: ["architecture", "hub"],
			}),
			artifact({
				id: "e2",
				showItemId: "plan",
				artifactKind: "doc.plan",
				mediaClass: "document",
				tags: ["hub"],
			}),
			artifact({
				id: "e3",
				showItemId: "untagged",
				artifactKind: "diagram.architecture",
			}),
		],
	});

	it("narrows by kind", () => {
		expect(
			filterArtifactDirectory(entries, {
				kind: "diagram.architecture",
			}).map((e) => e.showItemId),
		).toEqual(["arch", "untagged"]);
		expect(
			filterArtifactDirectory(entries, { kind: "capture.demo_clip" }),
		).toEqual([]);
	});

	it("narrows by tag", () => {
		expect(
			filterArtifactDirectory(entries, { tag: "hub" }).map((e) => e.showItemId),
		).toEqual(["arch", "plan"]);
		expect(filterArtifactDirectory(entries, { tag: "missing" })).toEqual([]);
	});

	it("requires both facets when both are given", () => {
		expect(
			filterArtifactDirectory(entries, {
				kind: "diagram.architecture",
				tag: "hub",
			}).map((e) => e.showItemId),
		).toEqual(["arch"]);
		expect(
			filterArtifactDirectory(entries, {
				kind: "doc.plan",
				tag: "architecture",
			}),
		).toEqual([]);
	});

	it("does not narrow when no facet is given", () => {
		expect(filterArtifactDirectory(entries, {})).toHaveLength(3);
	});
});

describe("artifactDirectoryTags", () => {
	it("lists the distinct tags in the corpus, sorted", () => {
		const entries = projectArtifactDirectory({
			events: [
				artifact({ id: "e1", showItemId: "a", tags: ["hub", "architecture"] }),
				artifact({ id: "e2", showItemId: "b", tags: ["hub"] }),
				artifact({ id: "e3", showItemId: "c" }),
			],
		});
		expect(artifactDirectoryTags(entries)).toEqual(["architecture", "hub"]);
		expect(artifactDirectoryTags([])).toEqual([]);
	});
});
