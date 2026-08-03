/**
 * Artifact family log (DRV-ARTIFACTS, ADR-0013 lane 1).
 */

import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ShowBacklogItem } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	migrateArtifactCorpus,
	readArtifactCorpus,
	readArtifactEvents,
	readArtifactLogSince,
	recordShowBacklogArtifacts,
	resetArtifactLogRetentionCacheForTests,
	restoreShowBacklogFromArtifacts,
} from "./artifactEventLog";

/** A real producer output: base64 SVG in `uri`, recipe in `produce.args`. */
function showItem(overrides: Partial<ShowBacklogItem> = {}): ShowBacklogItem {
	return {
		id: "show_abc123",
		ownerParticipantId: "agent:arch",
		title: "Auth flow",
		intent: "explain the login path",
		artifactKind: "diagram.sequence",
		mediaClass: "still",
		uri: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
		caption: "Login hits the token service first",
		produce: {
			tool: "render_mermaid",
			templateId: "seq_overview",
			args: { mermaidSource: "sequenceDiagram\n  A->>B: hi" },
		},
		priority: 10,
		status: "ready",
		scoreReasons: [],
		...overrides,
	};
}

function eventsJsonl(dir: string): string {
	return readFileSync(
		join(dir, ".cline", "drive", "artifacts", "events.jsonl"),
		"utf8",
	);
}

describe("artifactEventLog", () => {
	const dirs: string[] = [];

	function scratch(): string {
		const dir = mkdtempSync(join(tmpdir(), "drive-artifact-log-"));
		dirs.push(dir);
		return dir;
	}

	beforeEach(() => {
		resetArtifactLogRetentionCacheForTests();
	});

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		resetArtifactLogRetentionCacheForTests();
	});

	it("records an enqueued artifact under the artifact family", () => {
		const dir = scratch();
		const appended = recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r1",
			before: [],
			after: [showItem()],
		});

		expect(appended).toHaveLength(1);
		expect(appended[0]?.family).toBe("artifact");
		expect(appended[0]?.seq).toBe(1);
		expect(appended[0]?.roomId).toBe("r1");
		expect(appended[0]?.event.showItemId).toBe("show_abc123");
		expect(appended[0]?.event.type).toBe("media.artifact");

		const corpus = readArtifactCorpus(dir);
		expect(corpus).toHaveLength(1);
		expect(corpus[0]?.title).toBe("Auth flow");
		expect(corpus[0]?.produce.args.mermaidSource).toBe(
			"sequenceDiagram\n  A->>B: hi",
		);
	});

	it("never writes a byte key, even though the show item carried a data uri", () => {
		const dir = scratch();
		recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r1",
			before: [],
			after: [showItem()],
		});

		const raw = eventsJsonl(dir);
		expect(raw).not.toContain("data:image/svg+xml");
		for (const key of [
			"uri",
			"dataUri",
			"svg",
			"image",
			"bytes",
			"thumbnail",
		]) {
			expect(raw).not.toContain(`"${key}":`);
		}
		expect(raw).toContain('"mermaidSource":');
	});

	it("strips byte keys nested inside produce args, not just top-level ones", () => {
		const dir = scratch();
		const appended = recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r1",
			before: [],
			after: [
				showItem({
					produce: {
						tool: "render_mermaid",
						args: {
							mermaidSource: "graph TD; a-->b",
							render: {
								dataUri: "data:image/png;base64,NESTEDPAYLOAD",
								width: 800,
							},
							frames: [{ thumbnail: "data:image/png;base64,FRAMEPAYLOAD" }],
						},
					},
				}),
			],
		});

		expect(appended).toHaveLength(1);
		expect(appended[0]?.event.produce.args).toEqual({
			mermaidSource: "graph TD; a-->b",
			render: { width: 800 },
			frames: [{}],
		});
		const raw = eventsJsonl(dir);
		expect(raw).not.toContain("NESTEDPAYLOAD");
		expect(raw).not.toContain("FRAMEPAYLOAD");
	});

	it("records an artifact whose tags contain a blank label", () => {
		const dir = scratch();
		// ShowBacklogItem allows "" but the event schema requires min(1); an
		// unusable chip label must not cost the artifact its corpus record.
		const appended = recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r1",
			before: [],
			after: [showItem({ tags: ["", "  ", "auth"] })],
		});

		expect(appended).toHaveLength(1);
		expect(readArtifactCorpus(dir)[0]?.tags).toEqual(["auth"]);
	});

	it("keeps reading the corpus past a corrupt line", () => {
		const dir = scratch();
		recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r1",
			before: [],
			after: [showItem({ id: "show_good" })],
		});
		// A crash mid-append, or a record from a superseded schemaVersion.
		appendFileSync(
			join(dir, ".cline", "drive", "artifacts", "events.jsonl"),
			'{"family":"artifact","seq":2,"roomId":"r1","event":{"trunc\n',
			"utf8",
		);
		resetArtifactLogRetentionCacheForTests();

		expect(readArtifactCorpus(dir).map((entry) => entry.showItemId)).toEqual([
			"show_good",
		]);
		expect(
			restoreShowBacklogFromArtifacts({ configParent: dir, roomId: "r1" }),
		).toHaveLength(1);
	});

	it("is insensitive to produce-arg key order when deciding to re-record", () => {
		const dir = scratch();
		const first = showItem({
			produce: { tool: "render_mermaid", args: { a: "1", b: "2" } },
		});
		recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r1",
			before: [],
			after: [first],
		});
		const reordered = showItem({
			produce: { tool: "render_mermaid", args: { b: "2", a: "1" } },
		});

		expect(
			recordShowBacklogArtifacts({
				configParent: dir,
				roomId: "r1",
				before: [first],
				after: [reordered],
			}),
		).toHaveLength(0);
	});

	it("drops a byte-bearing produce arg instead of losing the record", () => {
		const dir = scratch();
		const appended = recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r1",
			before: [],
			after: [
				showItem({
					produce: {
						tool: "render_mermaid",
						args: {
							mermaidSource: "graph TD; a-->b",
							dataUri: "data:image/png;base64,AAAA",
							thumbnail: "data:image/png;base64,BBBB",
						},
					},
				}),
			],
		});

		expect(appended).toHaveLength(1);
		expect(appended[0]?.event.produce.args).toEqual({
			mermaidSource: "graph TD; a-->b",
		});
		expect(eventsJsonl(dir)).not.toContain("AAAA");
	});

	it("records nothing when the durable projection is unchanged", () => {
		const dir = scratch();
		const item = showItem();
		recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r1",
			before: [],
			after: [item],
		});

		// A mutation that only re-renders: same item, fresh uri, no durable change.
		const appended = recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r1",
			before: [item],
			after: [{ ...item, uri: "data:image/svg+xml;base64,Wg==" }],
		});

		expect(appended).toHaveLength(0);
		expect(readArtifactEvents(dir)).toHaveLength(1);
	});

	it("re-records on status advance and folds to the newest status", () => {
		const dir = scratch();
		const planned = showItem({ status: "planned" });
		recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r1",
			before: [],
			after: [planned],
		});
		const shown = { ...planned, status: "shown" as const };
		recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r1",
			before: [planned],
			after: [shown],
		});

		expect(readArtifactEvents(dir)).toHaveLength(2);
		const corpus = readArtifactCorpus(dir);
		expect(corpus).toHaveLength(1);
		expect(corpus[0]?.status).toBe("shown");
	});

	it("keeps the same showItemId in two rooms as two artifacts", () => {
		const dir = scratch();
		// Producers content-hash showItemId, so one diagram shown in two rooms
		// arrives with one id — the room is what makes them distinct.
		const item = showItem();
		recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r1",
			before: [],
			after: [item],
		});
		recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r2",
			before: [],
			after: [item],
		});

		const corpus = readArtifactCorpus(dir);
		expect(corpus).toHaveLength(2);
		expect(corpus.map((entry) => entry.roomId).sort()).toEqual(["r1", "r2"]);
	});

	it("carries the item's own tags onto the corpus for filter chips", () => {
		const dir = scratch();
		recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r1",
			before: [],
			after: [showItem({ tags: ["onboarding", "auth"] })],
		});
		expect(readArtifactCorpus(dir)[0]?.tags).toEqual(["onboarding", "auth"]);
	});

	it("re-records when only the tags change", () => {
		const dir = scratch();
		const untagged = showItem();
		recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r1",
			before: [],
			after: [untagged],
		});
		const tagged = { ...untagged, tags: ["auth"] };
		expect(
			recordShowBacklogArtifacts({
				configParent: dir,
				roomId: "r1",
				before: [untagged],
				after: [tagged],
			}),
		).toHaveLength(1);
		expect(readArtifactCorpus(dir)[0]?.tags).toEqual(["auth"]);
	});

	it("trims oldest artifacts at the cap, counted in artifact records", () => {
		const dir = scratch();
		for (let i = 0; i < 6; i += 1) {
			recordShowBacklogArtifacts({
				configParent: dir,
				roomId: "r1",
				before: [],
				after: [showItem({ id: `show_${i}` })],
				options: { maxRecords: 4 },
			});
		}
		const kept = readArtifactEvents(dir);
		expect(kept).toHaveLength(4);
		expect(kept.map((event) => event.showItemId)).toEqual([
			"show_2",
			"show_3",
			"show_4",
			"show_5",
		]);
		// seq stays monotonic across the trim so gap reads keep working.
		expect(readArtifactLogSince(dir, 4).map((env) => env.seq)).toEqual([5, 6]);
	});

	it("records nothing when no workspace root owns the corpus yet", () => {
		expect(
			recordShowBacklogArtifacts({
				configParent: undefined,
				roomId: "r1",
				before: [],
				after: [showItem()],
			}),
		).toHaveLength(0);
	});

	describe("restoreShowBacklogFromArtifacts", () => {
		it("rebuilds a re-materializable backlog item without bytes", () => {
			const dir = scratch();
			recordShowBacklogArtifacts({
				configParent: dir,
				roomId: "r1",
				before: [],
				after: [showItem({ status: "shown" })],
			});

			const restored = restoreShowBacklogFromArtifacts({
				configParent: dir,
				roomId: "r1",
			});

			expect(restored).toHaveLength(1);
			const item = restored[0];
			expect(item?.id).toBe("show_abc123");
			expect(item?.uri).toBeUndefined();
			expect(item?.title).toBe("Auth flow");
			expect(item?.caption).toBe("Login hits the token service first");
			expect(item?.produce).toEqual({
				tool: "render_mermaid",
				templateId: "seq_overview",
				args: { mermaidSource: "sequenceDiagram\n  A->>B: hi" },
			});
			// An artifact that already had its moment must not re-enter the
			// present-next competition on restart.
			expect(item?.status).toBe("shown");
			expect(item?.priority).toBe(0);
			expect(item?.scoreReasons).toContain("restored_from_artifact_log");
		});

		it("brings a still-owed artifact back as a presentable candidate", () => {
			const dir = scratch();
			recordShowBacklogArtifacts({
				configParent: dir,
				roomId: "r1",
				before: [],
				after: [showItem({ status: "planned" })],
			});
			expect(
				restoreShowBacklogFromArtifacts({ configParent: dir, roomId: "r1" })[0]
					?.status,
			).toBe("planned");
		});

		it("brings the artifact's tags back with it", () => {
			const dir = scratch();
			recordShowBacklogArtifacts({
				configParent: dir,
				roomId: "r1",
				before: [],
				after: [showItem({ tags: ["onboarding"] })],
			});
			expect(
				restoreShowBacklogFromArtifacts({ configParent: dir, roomId: "r1" })[0]
					?.tags,
			).toEqual(["onboarding"]);
		});

		it("restores only the asked-for room's artifacts", () => {
			const dir = scratch();
			recordShowBacklogArtifacts({
				configParent: dir,
				roomId: "r1",
				before: [],
				after: [showItem({ id: "show_r1" })],
			});
			recordShowBacklogArtifacts({
				configParent: dir,
				roomId: "r2",
				before: [],
				after: [showItem({ id: "show_r2" })],
			});

			expect(
				restoreShowBacklogFromArtifacts({
					configParent: dir,
					roomId: "r2",
				}).map((item) => item.id),
			).toEqual(["show_r2"]);
		});

		it("leaves cancelled artifacts out of the restored backlog", () => {
			const dir = scratch();
			const item = showItem();
			recordShowBacklogArtifacts({
				configParent: dir,
				roomId: "r1",
				before: [],
				after: [item],
			});
			recordShowBacklogArtifacts({
				configParent: dir,
				roomId: "r1",
				before: [item],
				after: [{ ...item, status: "cancelled" }],
			});

			expect(
				restoreShowBacklogFromArtifacts({ configParent: dir, roomId: "r1" }),
			).toHaveLength(0);
			// The record itself survives — the corpus is history, the backlog is not.
			expect(readArtifactCorpus(dir)).toHaveLength(1);
		});

		it("survives a workspace switch that migrated the room's log", () => {
			const from = scratch();
			const to = scratch();
			recordShowBacklogArtifacts({
				configParent: from,
				roomId: "r1",
				before: [],
				after: [showItem()],
			});
			recordShowBacklogArtifacts({
				configParent: from,
				roomId: "r_other",
				before: [],
				after: [showItem({ id: "show_other" })],
			});

			migrateArtifactCorpus(from, to, ["r1"]);

			// Only the scoped room moves — another workspace's rooms must not
			// ride along.
			expect(readArtifactCorpus(to).map((entry) => entry.roomId)).toEqual([
				"r1",
			]);
			expect(
				restoreShowBacklogFromArtifacts({ configParent: to, roomId: "r1" })[0]
					?.id,
			).toBe("show_abc123");

			// Rebinding to the same root again must not duplicate records.
			migrateArtifactCorpus(from, to, ["r1"]);
			expect(readArtifactEvents(to)).toHaveLength(1);
		});

		it("re-records nothing when a restored backlog is handed straight back", () => {
			const dir = scratch();
			recordShowBacklogArtifacts({
				configParent: dir,
				roomId: "r1",
				before: [],
				after: [showItem({ status: "ready" })],
			});
			const restored = restoreShowBacklogFromArtifacts({
				configParent: dir,
				roomId: "r1",
			});

			expect(
				recordShowBacklogArtifacts({
					configParent: dir,
					roomId: "r1",
					before: restored,
					after: restored,
				}),
			).toHaveLength(0);
		});
	});
});
