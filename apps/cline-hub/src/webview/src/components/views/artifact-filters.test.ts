import type { DriveArtifactDirectoryEntry } from "@cline/drive";
import { ShowArtifactKindSchema } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	ARTIFACT_KIND_FACET_BY_KIND,
	ARTIFACT_KIND_FACETS,
	type ArtifactFilters,
	artifactFacetSets,
	artifactKindFacetCounts,
	artifactTagFacetCounts,
	EMPTY_ARTIFACT_FILTERS,
	filterArtifacts,
	hasActiveArtifactFilters,
	isShowArtifactKind,
	matchesArtifactKindFacet,
	matchesArtifactQuery,
	matchesArtifactTag,
} from "./artifact-filters";

function entry(
	overrides: Partial<DriveArtifactDirectoryEntry> = {},
): DriveArtifactDirectoryEntry {
	return {
		showItemId: "show_1",
		roomId: "demo-polish",
		artifactKind: "doc.plan",
		mediaClass: "document",
		title: "Fix plan · demo-polish",
		ownerParticipantId: "cline",
		produce: { tool: "produceMermaid", args: {} },
		tags: [],
		status: "shown",
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-01T00:00:00.000Z",
		...overrides,
	};
}

function filters(overrides: Partial<ArtifactFilters> = {}): ArtifactFilters {
	return { ...EMPTY_ARTIFACT_FILTERS, ...overrides };
}

describe("kind facet taxonomy", () => {
	it("files every ShowArtifactKind the schema admits", () => {
		for (const kind of ShowArtifactKindSchema.options) {
			expect(ARTIFACT_KIND_FACET_BY_KIND[kind]).toBeDefined();
		}
	});

	it("offers a chip for every facet a kind can land in", () => {
		const chipIds = new Set(ARTIFACT_KIND_FACETS.map((facet) => facet.id));
		for (const facet of Object.values(ARTIFACT_KIND_FACET_BY_KIND)) {
			expect(chipIds.has(facet)).toBe(true);
		}
	});

	it("maps the vocabulary people actually use", () => {
		expect(ARTIFACT_KIND_FACET_BY_KIND["doc.plan"]).toBe("plans");
		// Architecture is a diagram, not a facet of its own.
		expect(ARTIFACT_KIND_FACET_BY_KIND["diagram.architecture"]).toBe(
			"diagrams",
		);
		expect(ARTIFACT_KIND_FACET_BY_KIND["diagram.sequence"]).toBe("diagrams");
		// Animations span two families, which no single kind can express.
		expect(ARTIFACT_KIND_FACET_BY_KIND["walkthrough.animation"]).toBe(
			"animations",
		);
		expect(ARTIFACT_KIND_FACET_BY_KIND["capture.demo_clip"]).toBe("animations");
	});

	it("rejects a kind it cannot file", () => {
		expect(isShowArtifactKind("doc.plan")).toBe(true);
		expect(isShowArtifactKind("doc.novel")).toBe(false);
		expect(isShowArtifactKind(undefined)).toBe(false);
		// Object.hasOwn, not `in`: a prototype key is not a kind.
		expect(isShowArtifactKind("toString")).toBe(false);
	});
});

describe("hasActiveArtifactFilters", () => {
	it("is false for the empty filters", () => {
		expect(hasActiveArtifactFilters(EMPTY_ARTIFACT_FILTERS)).toBe(false);
	});

	it("ignores whitespace-only queries", () => {
		expect(hasActiveArtifactFilters(filters({ query: "   " }))).toBe(false);
	});

	it("is true once any axis narrows", () => {
		expect(hasActiveArtifactFilters(filters({ query: "plan" }))).toBe(true);
		expect(hasActiveArtifactFilters(filters({ kindFacet: "plans" }))).toBe(
			true,
		);
		expect(hasActiveArtifactFilters(filters({ tag: "scripts" }))).toBe(true);
	});
});

describe("matchesArtifactQuery", () => {
	it("does not narrow on an empty query", () => {
		expect(matchesArtifactQuery(entry(), "")).toBe(true);
		expect(matchesArtifactQuery(entry(), "  ")).toBe(true);
	});

	it("matches title, kind, media class, presenter, room and tags", () => {
		const item = entry({
			title: "cline-drive · system architecture",
			artifactKind: "diagram.architecture",
			mediaClass: "still",
			ownerParticipantId: "atlas",
			roomId: "arch-review",
			tags: ["scripts"],
		});
		expect(matchesArtifactQuery(item, "SYSTEM")).toBe(true);
		expect(matchesArtifactQuery(item, "diagram.arch")).toBe(true);
		expect(matchesArtifactQuery(item, "still")).toBe(true);
		expect(matchesArtifactQuery(item, "atlas")).toBe(true);
		expect(matchesArtifactQuery(item, "arch-review")).toBe(true);
		expect(matchesArtifactQuery(item, "scripts")).toBe(true);
		expect(matchesArtifactQuery(item, "nothing here")).toBe(false);
	});

	it("never reads the produce recipe", () => {
		const item = entry({
			title: "Fix plan",
			produce: { tool: "produceMermaid", args: { secretly: "flowchart TD" } },
		});
		expect(matchesArtifactQuery(item, "flowchart")).toBe(false);
	});
});

describe("facet predicates", () => {
	it("does not narrow when no facet is selected", () => {
		expect(matchesArtifactKindFacet(entry(), null)).toBe(true);
		expect(matchesArtifactTag(entry(), null)).toBe(true);
	});

	it("admits every kind in the selected group", () => {
		expect(
			matchesArtifactKindFacet(
				entry({ artifactKind: "diagram.data_flow" }),
				"diagrams",
			),
		).toBe(true);
		expect(
			matchesArtifactKindFacet(
				entry({ artifactKind: "diagram.network_security" }),
				"diagrams",
			),
		).toBe(true);
		expect(
			matchesArtifactKindFacet(entry({ artifactKind: "doc.plan" }), "diagrams"),
		).toBe(false);
	});

	it("matches a tag exactly", () => {
		const item = entry({ tags: ["scripts", "onboarding"] });
		expect(matchesArtifactTag(item, "scripts")).toBe(true);
		expect(matchesArtifactTag(item, "script")).toBe(false);
	});
});

describe("filterArtifacts", () => {
	const corpus = [
		entry({
			showItemId: "a",
			artifactKind: "doc.plan",
			title: "Fix plan",
			updatedAt: "2026-08-01T00:00:00.000Z",
		}),
		entry({
			showItemId: "b",
			artifactKind: "diagram.architecture",
			title: "System architecture",
			tags: ["scripts"],
			updatedAt: "2026-08-03T00:00:00.000Z",
		}),
		entry({
			showItemId: "c",
			artifactKind: "capture.demo_clip",
			title: "Playback clip",
			tags: ["scripts", "demo"],
			updatedAt: "2026-08-02T00:00:00.000Z",
		}),
	];

	it("returns everything, newest first, with no filters", () => {
		expect(
			filterArtifacts(corpus, EMPTY_ARTIFACT_FILTERS).map((e) => e.showItemId),
		).toEqual(["b", "c", "a"]);
	});

	it("narrows on a facet whose kinds are present", () => {
		const narrowed = filterArtifacts(
			corpus,
			filters({ kindFacet: "diagrams" }),
		);
		expect(narrowed.map((e) => e.showItemId)).toEqual(["b"]);
		expect(narrowed.length).toBeLessThan(corpus.length);
	});

	it("returns nothing for a facet no artifact lands in", () => {
		expect(filterArtifacts(corpus, filters({ kindFacet: "reviews" }))).toEqual(
			[],
		);
	});

	it("groups animations across two kind families", () => {
		const animations = filterArtifacts(
			[
				...corpus,
				entry({ showItemId: "d", artifactKind: "walkthrough.animation" }),
			],
			filters({ kindFacet: "animations" }),
		);
		expect(animations.map((e) => e.showItemId).sort()).toEqual(["c", "d"]);
	});

	it("intersects the axes rather than unioning them", () => {
		expect(
			filterArtifacts(
				corpus,
				filters({ kindFacet: "diagrams", tag: "scripts" }),
			).map((e) => e.showItemId),
		).toEqual(["b"]);
		expect(
			filterArtifacts(corpus, filters({ kindFacet: "plans", tag: "scripts" })),
		).toEqual([]);
	});

	it("applies the query alongside the facets", () => {
		expect(
			filterArtifacts(corpus, filters({ query: "playback" })).map(
				(e) => e.showItemId,
			),
		).toEqual(["c"]);
	});

	it("leaves the input untouched", () => {
		const input = [...corpus];
		filterArtifacts(input, EMPTY_ARTIFACT_FILTERS);
		expect(input.map((e) => e.showItemId)).toEqual(["a", "b", "c"]);
	});

	it("sinks entries with no timestamp rather than floating them", () => {
		const undated = entry({ showItemId: "z", updatedAt: "" });
		expect(
			filterArtifacts([undated, ...corpus], EMPTY_ARTIFACT_FILTERS).map(
				(e) => e.showItemId,
			),
		).toEqual(["b", "c", "a", "z"]);
	});
});

describe("facet counts", () => {
	const corpus = [
		entry({ showItemId: "a", artifactKind: "doc.plan", tags: ["scripts"] }),
		entry({ showItemId: "b", artifactKind: "diagram.architecture" }),
		entry({
			showItemId: "c",
			artifactKind: "diagram.sequence",
			tags: ["demo"],
		}),
	];

	it("counts kinds by group and hides facets with no hits", () => {
		const counts = artifactKindFacetCounts(corpus);
		expect(counts).toEqual([
			{ id: "plans", label: "Plans", count: 1 },
			{ id: "diagrams", label: "Diagrams", count: 2 },
		]);
	});

	it("keeps kind chips in the declared order", () => {
		const ids = artifactKindFacetCounts(corpus).map((facet) => facet.id);
		const declared = ARTIFACT_KIND_FACETS.map((facet) => facet.id).filter(
			(id) => ids.includes(id),
		);
		expect(ids).toEqual(declared);
	});

	it("counts tags, sorted, with no zero-hit entries", () => {
		expect(artifactTagFacetCounts(corpus)).toEqual([
			{ tag: "demo", count: 1 },
			{ tag: "scripts", count: 1 },
		]);
	});

	it("counts a tag once per artifact carrying it", () => {
		expect(
			artifactTagFacetCounts([
				entry({ showItemId: "a", tags: ["scripts"] }),
				entry({ showItemId: "b", tags: ["scripts", "demo"] }),
			]),
		).toEqual([
			{ tag: "demo", count: 1 },
			{ tag: "scripts", count: 2 },
		]);
	});

	it("returns no facets at all for an empty set", () => {
		expect(artifactKindFacetCounts([])).toEqual([]);
		expect(artifactTagFacetCounts([])).toEqual([]);
	});
});

/**
 * The wiring, not the counters: which set feeds which row. Swap the two and
 * every count is still plausible and none is right, so it is asserted directly.
 */
describe("artifactFacetSets", () => {
	const corpus = [
		entry({ showItemId: "a", artifactKind: "doc.plan", tags: ["scripts"] }),
		entry({ showItemId: "b", artifactKind: "doc.plan", tags: ["handoff"] }),
		entry({
			showItemId: "c",
			artifactKind: "diagram.architecture",
			tags: ["scripts"],
		}),
		entry({ showItemId: "d", artifactKind: "diagram.sequence", tags: [] }),
	];

	it("counts both rows over the whole corpus when nothing narrows", () => {
		const { kinds, tags } = artifactFacetSets(corpus, EMPTY_ARTIFACT_FILTERS);
		expect(kinds).toEqual([
			{ id: "plans", label: "Plans", count: 2 },
			{ id: "diagrams", label: "Diagrams", count: 2 },
		]);
		expect(tags).toEqual([
			{ tag: "handoff", count: 1 },
			{ tag: "scripts", count: 2 },
		]);
	});

	it("counts kinds within the selected tag, not the whole corpus", () => {
		const { kinds } = artifactFacetSets(corpus, filters({ tag: "scripts" }));
		expect(kinds).toEqual([
			{ id: "plans", label: "Plans", count: 1 },
			{ id: "diagrams", label: "Diagrams", count: 1 },
		]);
	});

	it("counts tags within the selected kind, not the whole corpus", () => {
		const { tags } = artifactFacetSets(corpus, filters({ kindFacet: "plans" }));
		expect(tags).toEqual([
			{ tag: "handoff", count: 1 },
			{ tag: "scripts", count: 1 },
		]);
	});

	it("does not let a row narrow itself — its own chips stay reachable", () => {
		// With Plans selected, Diagrams must still be offered, or selecting a
		// kind would make every other kind unreachable.
		const { kinds } = artifactFacetSets(
			corpus,
			filters({ kindFacet: "plans" }),
		);
		expect(kinds.map((facet) => facet.id)).toEqual(["plans", "diagrams"]);
		const { tags } = artifactFacetSets(corpus, filters({ tag: "scripts" }));
		expect(tags.map((facet) => facet.tag)).toEqual(["handoff", "scripts"]);
	});

	it("narrows both rows by the query", () => {
		const { kinds, tags } = artifactFacetSets(
			corpus,
			filters({ query: "handoff" }),
		);
		expect(kinds).toEqual([{ id: "plans", label: "Plans", count: 1 }]);
		expect(tags).toEqual([{ tag: "handoff", count: 1 }]);
	});

	it("offers no chips at all when the query matches nothing", () => {
		expect(artifactFacetSets(corpus, filters({ query: "zzz" }))).toEqual({
			kinds: [],
			tags: [],
		});
	});

	it("agrees with the list it describes", () => {
		for (const active of [
			EMPTY_ARTIFACT_FILTERS,
			filters({ tag: "scripts" }),
			filters({ kindFacet: "plans" }),
			filters({ query: "handoff" }),
		]) {
			const { kinds } = artifactFacetSets(corpus, active);
			for (const facet of kinds) {
				const listed = filterArtifacts(corpus, {
					...active,
					kindFacet: facet.id,
				});
				expect(listed.length).toBe(facet.count);
			}
			const { tags } = artifactFacetSets(corpus, active);
			for (const facet of tags) {
				const listed = filterArtifacts(corpus, { ...active, tag: facet.tag });
				expect(listed.length).toBe(facet.count);
			}
		}
	});
});
