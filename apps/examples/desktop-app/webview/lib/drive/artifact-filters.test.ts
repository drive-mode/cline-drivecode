import type { DriveArtifactDirectoryEntry } from "@cline/drive";
import { describe, expect, it } from "vitest";
import {
	ARTIFACT_KIND_FACET_BY_KIND,
	ARTIFACT_KIND_LABELS,
	ARTIFACT_STATUSES,
	artifactDirectoryEntryFromUnknown,
	artifactDirectoryFromReply,
	artifactFacetSets,
	artifactStatusLabel,
	EMPTY_ARTIFACT_FILTERS,
	filterArtifacts,
	hasActiveArtifactFilters,
	isShowArtifactKind,
	isWorkspaceUnboundError,
	sanitizeProduceArgs,
	sortArtifacts,
} from "./artifact-filters";

function entry(
	overrides: Partial<DriveArtifactDirectoryEntry> & { showItemId: string },
): DriveArtifactDirectoryEntry {
	return {
		roomId: "router-fix",
		artifactKind: "diagram.architecture",
		mediaClass: "still",
		title: overrides.showItemId,
		ownerParticipantId: "drive:partner",
		produce: { tool: "render_mermaid", args: {} },
		tags: [],
		status: "shown",
		createdAt: "2026-09-01T10:00:00.000Z",
		updatedAt: "2026-09-01T10:00:00.000Z",
		...overrides,
	};
}

const corpus: DriveArtifactDirectoryEntry[] = [
	entry({
		showItemId: "retry-path",
		title: "Retry path · pending flag",
		tags: ["router", "race"],
		status: "showing",
		createdAt: "2026-09-01T09:50:00.000Z",
		updatedAt: "2026-09-01T10:05:00.000Z",
	}),
	entry({
		showItemId: "plan",
		title: "Router fix plan",
		artifactKind: "doc.plan",
		mediaClass: "document",
		produce: { tool: "render_markdown", args: { markdown: "1. Guard" } },
		tags: ["plan"],
		status: "ready",
		createdAt: "2026-09-01T09:55:00.000Z",
		updatedAt: "2026-09-01T09:55:00.000Z",
	}),
	entry({
		showItemId: "review",
		title: "Review · retry once",
		artifactKind: "doc.review",
		mediaClass: "document",
		ownerParticipantId: "agent:riley",
		tags: ["review", "tests"],
		status: "planned",
		createdAt: "2026-09-01T09:58:00.000Z",
		updatedAt: "2026-09-01T09:58:00.000Z",
	}),
	entry({
		showItemId: "sequence",
		title: "Timeout → retry sequence",
		artifactKind: "diagram.sequence",
		tags: ["router", "sequence"],
		status: "shown",
		createdAt: "2026-09-01T09:40:00.000Z",
		updatedAt: "2026-09-01T09:45:00.000Z",
	}),
	entry({
		showItemId: "share",
		roomId: "docs-refresh",
		title: "README checklist",
		artifactKind: "share.structured",
		mediaClass: "structured",
		ownerParticipantId: "agent:sam",
		produce: { tool: "share_structured", args: { items: ["a"] } },
		tags: ["docs"],
		status: "cancelled",
		createdAt: "2026-08-31T09:00:00.000Z",
		updatedAt: "2026-08-31T09:00:00.000Z",
	}),
];

describe("artifact taxonomy", () => {
	it("files every kind under one facet with a label", () => {
		for (const [kind, facet] of Object.entries(ARTIFACT_KIND_FACET_BY_KIND)) {
			expect(isShowArtifactKind(kind)).toBe(true);
			expect(typeof facet).toBe("string");
			expect(
				ARTIFACT_KIND_LABELS[kind as keyof typeof ARTIFACT_KIND_LABELS].length,
			).toBeGreaterThan(0);
		}
		expect(isShowArtifactKind("diagram.made_up")).toBe(false);
		expect(ARTIFACT_STATUSES.map((status) => status.id)).toEqual([
			"showing",
			"ready",
			"planned",
			"shown",
			"cancelled",
		]);
		expect(artifactStatusLabel("showing")).toBe("On stage");
	});
});

describe("artifact filters", () => {
	it("reports whether any filter narrows the view", () => {
		expect(hasActiveArtifactFilters(EMPTY_ARTIFACT_FILTERS)).toBe(false);
		expect(
			hasActiveArtifactFilters({ ...EMPTY_ARTIFACT_FILTERS, query: "  " }),
		).toBe(false);
		expect(
			hasActiveArtifactFilters({ ...EMPTY_ARTIFACT_FILTERS, status: "ready" }),
		).toBe(true);
	});

	it("applies query, kind facet, tag and status together, newest first", () => {
		expect(
			filterArtifacts(corpus, EMPTY_ARTIFACT_FILTERS).map((e) => e.showItemId),
		).toEqual(["retry-path", "review", "plan", "sequence", "share"]);
		expect(
			filterArtifacts(corpus, {
				...EMPTY_ARTIFACT_FILTERS,
				kindFacet: "diagrams",
			}).map((e) => e.showItemId),
		).toEqual(["retry-path", "sequence"]);
		expect(
			filterArtifacts(corpus, {
				...EMPTY_ARTIFACT_FILTERS,
				kindFacet: "diagrams",
				tag: "sequence",
			}).map((e) => e.showItemId),
		).toEqual(["sequence"]);
		expect(
			filterArtifacts(corpus, {
				...EMPTY_ARTIFACT_FILTERS,
				status: "planned",
			}).map((e) => e.showItemId),
		).toEqual(["review"]);
		expect(
			filterArtifacts(corpus, {
				...EMPTY_ARTIFACT_FILTERS,
				query: "sequence diagram",
			}).map((e) => e.showItemId),
		).toEqual(["sequence"]);
		expect(
			filterArtifacts(corpus, {
				...EMPTY_ARTIFACT_FILTERS,
				query: "riley",
			}).map((e) => e.showItemId),
		).toEqual(["review"]);
	});

	it("never matches the produce recipe", () => {
		expect(
			filterArtifacts(corpus, { ...EMPTY_ARTIFACT_FILTERS, query: "Guard" }),
		).toEqual([]);
	});
});

describe("artifact sorting", () => {
	it("orders by each key deterministically", () => {
		expect(sortArtifacts(corpus, "created").map((e) => e.showItemId)).toEqual([
			"review",
			"plan",
			"retry-path",
			"sequence",
			"share",
		]);
		expect(sortArtifacts(corpus, "title").map((e) => e.showItemId)).toEqual([
			"share",
			"retry-path",
			"review",
			"plan",
			"sequence",
		]);
		expect(sortArtifacts(corpus, "kind").map((e) => e.showItemId)).toEqual([
			"retry-path",
			"plan",
			"review",
			"sequence",
			"share",
		]);
		expect(sortArtifacts(corpus, "status").map((e) => e.showItemId)).toEqual([
			"retry-path",
			"plan",
			"review",
			"sequence",
			"share",
		]);
	});
});

describe("artifact facets", () => {
	it("counts each axis over the set the other axes narrowed", () => {
		const facets = artifactFacetSets(corpus, EMPTY_ARTIFACT_FILTERS);
		expect(facets.kinds).toEqual([
			{ id: "plans", label: "Plans", count: 1 },
			{ id: "diagrams", label: "Diagrams", count: 2 },
			{ id: "reviews", label: "Reviews", count: 1 },
			{ id: "shares", label: "Shares", count: 1 },
		]);
		expect(facets.tags.map((tag) => `${tag.tag}:${tag.count}`)).toEqual([
			"docs:1",
			"plan:1",
			"race:1",
			"review:1",
			"router:2",
			"sequence:1",
			"tests:1",
		]);
		expect(facets.statuses.map((s) => `${s.id}:${s.count}`)).toEqual([
			"showing:1",
			"ready:1",
			"planned:1",
			"shown:1",
			"cancelled:1",
		]);

		const narrowed = artifactFacetSets(corpus, {
			...EMPTY_ARTIFACT_FILTERS,
			kindFacet: "diagrams",
		});
		// Kind counts ignore the kind filter itself so other chips stay reachable.
		expect(narrowed.kinds.map((facet) => facet.id)).toEqual([
			"plans",
			"diagrams",
			"reviews",
			"shares",
		]);
		expect(narrowed.tags.map((tag) => tag.tag)).toEqual([
			"race",
			"router",
			"sequence",
		]);
		expect(narrowed.statuses.map((s) => s.id)).toEqual(["showing", "shown"]);
	});
});

describe("artifact wire guard", () => {
	const raw = {
		showItemId: "show-1",
		roomId: "router-fix",
		artifactKind: "diagram.sequence",
		mediaClass: "still",
		title: "Sequence",
		ownerParticipantId: "drive:partner",
		produce: {
			tool: "render_mermaid",
			templateId: "seq.flow",
			args: { mermaidSource: "sequenceDiagram", svg: "<svg/>", uri: "data:" },
		},
		tags: ["a", "", 3],
		status: "shown",
		createdAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
		thumbnail: "should be dropped",
	};

	it("keeps source args and drops bytes-shaped keys and unknown fields", () => {
		const parsed = artifactDirectoryEntryFromUnknown(raw);
		expect(parsed).not.toBeNull();
		expect(parsed?.produce).toEqual({
			tool: "render_mermaid",
			templateId: "seq.flow",
			args: { mermaidSource: "sequenceDiagram" },
		});
		expect(parsed?.tags).toEqual(["a"]);
		expect(Object.keys(parsed ?? {})).not.toContain("thumbnail");
		expect(sanitizeProduceArgs({ image: "x", markdown: "ok" })).toEqual({
			markdown: "ok",
		});
		expect(sanitizeProduceArgs(null)).toEqual({});
	});

	it("rejects entries a newer hub might send with kinds it cannot file", () => {
		expect(
			artifactDirectoryEntryFromUnknown({ ...raw, artifactKind: "hologram" }),
		).toBeNull();
		expect(
			artifactDirectoryEntryFromUnknown({ ...raw, status: "archived" }),
		).toBeNull();
		expect(artifactDirectoryEntryFromUnknown({ ...raw, title: "" })).toBeNull();
		expect(
			artifactDirectoryEntryFromUnknown({ ...raw, produce: { args: {} } }),
		).toBeNull();
		expect(artifactDirectoryEntryFromUnknown("nope")).toBeNull();
	});

	it("reads a reply leniently", () => {
		expect(
			artifactDirectoryFromReply({ artifacts: [raw, null, 1] }),
		).toHaveLength(1);
		expect(artifactDirectoryFromReply({})).toEqual([]);
		expect(artifactDirectoryFromReply(undefined)).toEqual([]);
	});

	it("recognises the unbound-workspace error by code", () => {
		expect(
			isWorkspaceUnboundError(
				new Error("workspace_not_bound: No Drive room for /repo yet."),
			),
		).toBe(true);
		expect(isWorkspaceUnboundError("room_not_found: nope")).toBe(false);
		expect(isWorkspaceUnboundError(new Error("boom"))).toBe(false);
	});
});
