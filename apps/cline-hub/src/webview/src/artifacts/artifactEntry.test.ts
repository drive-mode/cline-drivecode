import {
	MediaArtifactStatusSchema,
	MediaClassSchema,
	ShowArtifactKindSchema,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { artifactDirectoryEntryFromUnknown } from "./artifactEntry";

function wire(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		showItemId: "show_1",
		roomId: "demo-polish",
		artifactKind: "diagram.architecture",
		mediaClass: "still",
		title: "cline-drive · system architecture",
		ownerParticipantId: "cline",
		produce: { tool: "produceMermaid", templateId: "arch", args: { src: "x" } },
		tags: ["scripts"],
		status: "shown",
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-02T00:00:00.000Z",
		...overrides,
	};
}

/**
 * A guard that silently rejects a taxonomy member is worse than one that
 * crashes: every artifact of the new kind, class or status just disappears from
 * the page. The membership sets are total `Record`s so the compiler catches a
 * schema that grew — these run the same check against the schemas themselves,
 * so drift fails the suite as well.
 */
describe("taxonomy coverage", () => {
	it.each(ShowArtifactKindSchema.options)("accepts kind %s", (artifactKind) => {
		expect(
			artifactDirectoryEntryFromUnknown(wire({ artifactKind })),
		).not.toBeNull();
	});

	it.each(MediaClassSchema.options)("accepts media class %s", (mediaClass) => {
		expect(
			artifactDirectoryEntryFromUnknown(wire({ mediaClass })),
		).not.toBeNull();
	});

	it.each(MediaArtifactStatusSchema.options)("accepts status %s", (status) => {
		expect(artifactDirectoryEntryFromUnknown(wire({ status }))).not.toBeNull();
	});
});

describe("artifactDirectoryEntryFromUnknown", () => {
	it("accepts a well-formed entry", () => {
		expect(artifactDirectoryEntryFromUnknown(wire())).toEqual({
			showItemId: "show_1",
			roomId: "demo-polish",
			artifactKind: "diagram.architecture",
			mediaClass: "still",
			title: "cline-drive · system architecture",
			ownerParticipantId: "cline",
			produce: { tool: "produceMermaid", templateId: "arch", args: {} },
			tags: ["scripts"],
			status: "shown",
			createdAt: "2026-08-01T00:00:00.000Z",
			updatedAt: "2026-08-02T00:00:00.000Z",
		});
	});

	it("rejects anything that is not an object", () => {
		expect(artifactDirectoryEntryFromUnknown(null)).toBeNull();
		expect(artifactDirectoryEntryFromUnknown("show_1")).toBeNull();
		expect(artifactDirectoryEntryFromUnknown(undefined)).toBeNull();
	});

	it("rejects a missing or blank identity", () => {
		expect(
			artifactDirectoryEntryFromUnknown(wire({ showItemId: "" })),
		).toBeNull();
		expect(
			artifactDirectoryEntryFromUnknown(wire({ roomId: "  " })),
		).toBeNull();
		expect(
			artifactDirectoryEntryFromUnknown(wire({ title: undefined })),
		).toBeNull();
		expect(
			artifactDirectoryEntryFromUnknown(wire({ ownerParticipantId: 7 })),
		).toBeNull();
	});

	it("rejects a taxonomy value this webview cannot file", () => {
		expect(
			artifactDirectoryEntryFromUnknown(wire({ artifactKind: "doc.novel" })),
		).toBeNull();
		expect(
			artifactDirectoryEntryFromUnknown(wire({ mediaClass: "hologram" })),
		).toBeNull();
		expect(
			artifactDirectoryEntryFromUnknown(wire({ status: "archived" })),
		).toBeNull();
	});

	it("rejects a produce recipe with no tool", () => {
		expect(artifactDirectoryEntryFromUnknown(wire({ produce: {} }))).toBeNull();
		expect(
			artifactDirectoryEntryFromUnknown(wire({ produce: undefined })),
		).toBeNull();
	});

	it("drops produce args — the page never reads them and must not hold them", () => {
		const entry = artifactDirectoryEntryFromUnknown(
			wire({
				produce: {
					tool: "produceMermaid",
					args: { uri: "data:image/svg+xml;base64,PHN2Zz4=" },
				},
			}),
		);
		expect(entry?.produce.args).toEqual({});
	});

	it("drops unknown fields rather than passing them through", () => {
		const entry = artifactDirectoryEntryFromUnknown(
			wire({ uri: "data:image/png;base64,iVBOR", caption: "the flash" }),
		);
		expect(entry).not.toBeNull();
		expect(Object.keys(entry ?? {})).not.toContain("uri");
		expect(Object.keys(entry ?? {})).not.toContain("caption");
	});

	it("omits templateId when the recipe has none", () => {
		const entry = artifactDirectoryEntryFromUnknown(
			wire({ produce: { tool: "produceMermaid", args: {} } }),
		);
		expect(entry?.produce).toEqual({ tool: "produceMermaid", args: {} });
	});

	it("defaults tags to an empty list and drops non-string members", () => {
		expect(
			artifactDirectoryEntryFromUnknown(wire({ tags: undefined }))?.tags,
		).toEqual([]);
		expect(
			artifactDirectoryEntryFromUnknown(
				wire({ tags: ["scripts", 3, "", null] }),
			)?.tags,
		).toEqual(["scripts"]);
	});

	it("tolerates missing timestamps", () => {
		const entry = artifactDirectoryEntryFromUnknown(
			wire({ createdAt: undefined, updatedAt: 12 }),
		);
		expect(entry?.createdAt).toBe("");
		expect(entry?.updatedAt).toBe("");
	});
});
