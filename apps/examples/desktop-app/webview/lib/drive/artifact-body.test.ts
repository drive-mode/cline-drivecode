import type { DriveArtifactDirectoryEntry } from "@cline/drive";
import { describe, expect, it } from "vitest";
import {
	artifactEntryBodySource,
	parsePlanStep,
	projectArtifactBody,
	projectWalkthroughLines,
	showItemFromArtifact,
} from "./artifact-body";

describe("projectArtifactBody", () => {
	it("renders mermaid source as a mermaid body, refusing fences", () => {
		expect(
			projectArtifactBody({
				artifactKind: "diagram.architecture",
				produce: {
					tool: "render_mermaid",
					args: { mermaidSource: "flowchart LR\n a --> b" },
				},
			}),
		).toEqual({ kind: "mermaid", source: "flowchart LR\n a --> b" });
		expect(
			projectArtifactBody({
				artifactKind: "diagram.architecture",
				mediaClass: "still",
				produce: {
					tool: "render_mermaid",
					args: { mermaidSource: "```bad```" },
				},
			}),
		).toEqual({ kind: "media", mediaClass: "still" });
	});

	it("renders markdown for prose plans and reviews", () => {
		expect(
			projectArtifactBody({
				artifactKind: "doc.plan",
				produce: { tool: "render_markdown", args: { markdown: "1. Guard" } },
			}),
		).toEqual({ kind: "markdown", markdown: "1. Guard" });
		expect(
			projectArtifactBody({
				artifactKind: "doc.review",
				produce: { tool: "render_markdown", args: { markdown: " 42 passed " } },
			}),
		).toEqual({ kind: "markdown", markdown: "42 passed" });
	});

	it("renders a stepped plan with progress markers", () => {
		expect(
			projectArtifactBody({
				artifactKind: "doc.plan",
				title: "Router fix",
				produce: {
					tool: "render_plan_card",
					args: { steps: ["- [x] Reproduce", "2. [>] Guard", "Commit", ""] },
				},
			}),
		).toEqual({
			kind: "plan",
			title: "Router fix",
			steps: [
				{ label: "Reproduce", state: "done" },
				{ label: "Guard", state: "now" },
				{ label: "Commit", state: "next" },
			],
		});
		expect(parsePlanStep("✓ done thing")).toEqual({
			label: "done thing",
			state: "done",
		});
	});

	it("renders a walkthrough with numbered lines and a symbol", () => {
		const body = projectArtifactBody({
			artifactKind: "walkthrough.code",
			produce: {
				tool: "render_code_walkthrough",
				args: {
					path: "router.ts",
					symbol: "scheduleRetry",
					startLine: 10,
					endLine: 11,
					snippet: "\nfunction a() {\n  b();\n}\n",
				},
			},
		});
		expect(body.kind).toBe("walkthrough");
		if (body.kind !== "walkthrough") {
			throw new Error("expected walkthrough");
		}
		expect(body.path).toBe("router.ts");
		expect(body.symbol).toBe("scheduleRetry");
		expect(body.startLine).toBe(10);
		expect(body.endLine).toBe(11);
		expect(body.lines.map((line) => [line.number, line.highlighted])).toEqual([
			[10, true],
			[11, true],
			[12, false],
		]);
		// No snippet: still a walkthrough, with an empty line list.
		expect(
			projectArtifactBody({
				artifactKind: "walkthrough.code",
				produce: { tool: "render_code_walkthrough", args: { path: "a.ts" } },
			}),
		).toMatchObject({ kind: "walkthrough", path: "a.ts", lines: [] });
		expect(projectWalkthroughLines("", 1, 1)).toEqual([]);
	});

	it("renders a capture without trusting a data uri as the shot", () => {
		expect(
			projectArtifactBody({
				artifactKind: "capture.screenshot",
				uri: "data:image/svg+xml,stub",
				produce: {
					tool: "drive_browser_snapshot",
					args: { url: "https://x.test" },
				},
			}),
		).toEqual({ kind: "capture", url: "https://x.test", shot: null });
		expect(
			projectArtifactBody({
				artifactKind: "capture.screenshot",
				uri: "https://cdn.test/shot.png",
				produce: {
					tool: "drive_browser_snapshot",
					args: { url: "https://x.test" },
				},
			}),
		).toEqual({
			kind: "capture",
			url: "https://x.test",
			shot: "https://cdn.test/shot.png",
		});
	});

	it("renders structured shares as items plus the remaining recipe", () => {
		expect(
			projectArtifactBody({
				artifactKind: "share.structured",
				produce: {
					tool: "share_structured",
					args: { items: ["Lobby", " Call "], owner: "sam" },
				},
			}),
		).toEqual({
			kind: "structured",
			items: ["Lobby", "Call"],
			json: JSON.stringify({ owner: "sam" }, null, 2),
		});
	});

	it("falls back honestly: pointer, then placeholder, then empty", () => {
		expect(
			projectArtifactBody({
				artifactKind: "diagram.sequence",
				uri: "data:image/svg+xml,x",
				produce: { tool: "render_mermaid", args: {} },
			}),
		).toEqual({ kind: "image", uri: "data:image/svg+xml,x" });
		expect(
			projectArtifactBody({
				artifactKind: "walkthrough.animation",
				mediaClass: "animation",
				produce: { tool: "render_change_animation", args: {} },
			}),
		).toEqual({ kind: "media", mediaClass: "animation" });
		expect(
			projectArtifactBody({
				artifactKind: "work.card",
				mediaClass: "work",
				produce: { tool: "work_card", args: {} },
			}),
		).toEqual({ kind: "empty" });
		expect(projectArtifactBody(null)).toEqual({ kind: "empty" });
	});
});

describe("showItemFromArtifact", () => {
	const entry: DriveArtifactDirectoryEntry = {
		showItemId: "show-retry-path",
		roomId: "router-fix",
		artifactKind: "diagram.architecture",
		mediaClass: "still",
		title: "Retry path",
		ownerParticipantId: "drive:partner",
		produce: {
			tool: "render_mermaid",
			templateId: "arch.overview",
			args: { mermaidSource: "flowchart LR" },
		},
		tags: ["router"],
		status: "shown",
		createdAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
	};

	it("builds a ready show item that reproduces the entry", () => {
		const item = showItemFromArtifact(entry);
		expect(item).toMatchObject({
			id: "show-retry-path",
			ownerParticipantId: "drive:partner",
			title: "Retry path",
			artifactKind: "diagram.architecture",
			mediaClass: "still",
			status: "ready",
			priority: 50,
			scoreReasons: ["artifacts.present"],
			tags: ["router"],
			produce: {
				tool: "render_mermaid",
				templateId: "arch.overview",
				args: { mermaidSource: "flowchart LR" },
			},
		});
		expect(item.produce.args).not.toBe(entry.produce.args);
		expect(Object.keys(item)).not.toContain("uri");
	});

	it("lets the caller re-own and re-prioritise", () => {
		const item = showItemFromArtifact(entry, {
			ownerParticipantId: "agent:riley",
			priority: 90,
		});
		expect(item.ownerParticipantId).toBe("agent:riley");
		expect(item.priority).toBe(90);
	});

	it("derives a body source from an entry", () => {
		expect(artifactEntryBodySource(entry)).toEqual({
			artifactKind: "diagram.architecture",
			mediaClass: "still",
			title: "Retry path",
			produce: {
				tool: "render_mermaid",
				templateId: "arch.overview",
				args: { mermaidSource: "flowchart LR" },
			},
		});
	});
});
