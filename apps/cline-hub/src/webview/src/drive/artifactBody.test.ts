import { describe, expect, it } from "vitest";
import {
	type ArtifactBodySource,
	parsePlanStep,
	projectArtifactBody,
	projectWalkthroughLines,
	resolvePresentedArtifact,
} from "./artifactBody";

const STUB_URI = "data:image/svg+xml;base64,AAA";

function mermaidArtifact(source: string): ArtifactBodySource {
	return {
		kind: "diagram.architecture",
		title: "Architecture overview",
		uri: STUB_URI,
		produce: { tool: "render_mermaid", args: { mermaidSource: source } },
	};
}

describe("projectArtifactBody", () => {
	it("re-renders embedded mermaid source instead of the hub svg stub", () => {
		expect(
			projectArtifactBody(mermaidArtifact("flowchart LR\n  A --> B")),
		).toEqual({
			kind: "mermaid",
			source: "flowchart LR\n  A --> B",
		});
	});

	it("falls back to the hub stub when the embedded source is missing", () => {
		expect(projectArtifactBody(mermaidArtifact("   "))).toEqual({
			kind: "image",
			uri: STUB_URI,
		});
	});

	it("refuses a source carrying a markdown fence", () => {
		// The source is fenced into markdown to render, so a fence inside it
		// would close the diagram block early and put arbitrary markdown on the
		// screen. The hub rejects fences too, but only on the path that
		// materializes a `uri` — a caller-supplied item skips that check.
		expect(
			projectArtifactBody(
				mermaidArtifact("flowchart LR\n  A --> B\n```\n\n# injected"),
			),
		).toEqual({ kind: "image", uri: STUB_URI });
	});

	it("prefers the artifact kind over the produce tool", () => {
		expect(
			projectArtifactBody({
				kind: "doc.plan",
				uri: STUB_URI,
				produce: {
					tool: "render_mermaid",
					args: { steps: ["Ship it"], mermaidSource: "graph TD" },
				},
			}),
		).toEqual({
			kind: "plan",
			title: "Plan",
			steps: [{ label: "Ship it", state: "next" }],
		});
	});

	it("reads the produce tool when the show lands before its artifact kind", () => {
		// `drive_show_presented` carries no artifactKind.
		expect(
			projectArtifactBody({
				uri: STUB_URI,
				produce: {
					tool: "render_mermaid",
					args: { mermaidSource: "graph TD" },
				},
			}),
		).toEqual({ kind: "mermaid", source: "graph TD" });
	});

	it("keeps the stub for artifact kinds with no client renderer", () => {
		expect(
			projectArtifactBody({ kind: "capture.screenshot", uri: STUB_URI }),
		).toEqual({ kind: "image", uri: STUB_URI });
	});

	it("is empty when there is neither source nor stub", () => {
		expect(projectArtifactBody({ kind: "doc.plan", title: "Plan" })).toEqual({
			kind: "empty",
		});
		expect(projectArtifactBody(null)).toEqual({ kind: "empty" });
	});

	it("projects plan steps, preferring the produced plan title", () => {
		expect(
			projectArtifactBody({
				kind: "doc.plan",
				title: "Plan card",
				uri: STUB_URI,
				produce: {
					tool: "render_plan_card",
					args: {
						planTitle: "Fix plan · demo-polish",
						steps: [
							"[x] Reproduce",
							"[>] Fingerprint regions",
							"3. Gate animations",
						],
					},
				},
			}),
		).toEqual({
			kind: "plan",
			title: "Fix plan · demo-polish",
			steps: [
				{ label: "Reproduce", state: "done" },
				{ label: "Fingerprint regions", state: "now" },
				{ label: "Gate animations", state: "next" },
			],
		});
	});

	it("falls back when the plan carries no usable steps", () => {
		expect(
			projectArtifactBody({
				kind: "doc.plan",
				uri: STUB_URI,
				produce: { tool: "render_plan_card", args: { steps: [1, "  "] } },
			}),
		).toEqual({ kind: "image", uri: STUB_URI });
	});

	it("projects a walkthrough panel with absolute line numbers", () => {
		expect(
			projectArtifactBody({
				kind: "walkthrough.code",
				uri: STUB_URI,
				produce: {
					tool: "render_code_walkthrough",
					args: {
						path: "src/router.ts",
						startLine: 41,
						endLine: 42,
						snippet: "const a = 1;\nif (a) {\n  retry();\n}\n",
					},
				},
			}),
		).toEqual({
			kind: "walkthrough",
			path: "src/router.ts",
			startLine: 41,
			endLine: 42,
			lines: [
				{ number: 41, text: "const a = 1;", highlighted: true },
				{ number: 42, text: "if (a) {", highlighted: true },
				{ number: 43, text: "  retry();", highlighted: false },
				{ number: 44, text: "}", highlighted: false },
			],
		});
	});

	it("treats the whole snippet as the range when endLine is absent", () => {
		// `endLine` is optional on the producer and never round-trips through
		// materializeShowItem, so this is the common shape. Defaulting it to
		// startLine would highlight one line and dim the rest as context.
		expect(
			projectArtifactBody({
				kind: "walkthrough.code",
				produce: {
					tool: "render_code_walkthrough",
					args: {
						path: "src/router.ts",
						startLine: 10,
						snippet: "one\ntwo\nthree",
					},
				},
			}),
		).toEqual({
			kind: "walkthrough",
			path: "src/router.ts",
			startLine: 10,
			endLine: 12,
			lines: [
				{ number: 10, text: "one", highlighted: true },
				{ number: 11, text: "two", highlighted: true },
				{ number: 12, text: "three", highlighted: true },
			],
		});
	});

	it("clamps a nonsensical range rather than inverting it", () => {
		const body = projectArtifactBody({
			kind: "walkthrough.code",
			produce: {
				tool: "render_code_walkthrough",
				args: { path: "a.ts", startLine: 0, endLine: -4, snippet: "x" },
			},
		});
		expect(body).toMatchObject({ startLine: 1, endLine: 1 });
	});

	it("caps a runaway snippet instead of building unbounded rows", () => {
		const body = projectArtifactBody({
			kind: "walkthrough.code",
			produce: {
				tool: "render_code_walkthrough",
				args: {
					path: "a.ts",
					startLine: 1,
					endLine: 2,
					snippet: Array.from({ length: 900 }, (_, i) => `l${i}`).join("\n"),
				},
			},
		});
		expect(body.kind).toBe("walkthrough");
		expect(body.kind === "walkthrough" && body.lines.length).toBe(400);
	});

	it("renders a walkthrough with no snippet as a header-only panel", () => {
		const body = projectArtifactBody({
			kind: "walkthrough.code",
			uri: STUB_URI,
			produce: {
				tool: "render_code_walkthrough",
				args: { path: "src/router.ts", startLine: 7 },
			},
		});
		expect(body).toEqual({
			kind: "walkthrough",
			path: "src/router.ts",
			startLine: 7,
			endLine: 7,
			lines: [],
		});
	});
});

describe("parsePlanStep", () => {
	it("defaults to next so an unmarked plan claims no progress", () => {
		expect(parsePlanStep("Verify with hub tests")).toEqual({
			label: "Verify with hub tests",
			state: "next",
		});
		expect(parsePlanStep("[ ] Verify")).toEqual({
			label: "Verify",
			state: "next",
		});
	});

	it("reads glyph markers as well as checkboxes", () => {
		expect(parsePlanStep("✓ Reproduce").state).toBe("done");
		expect(parsePlanStep("● Fingerprint").state).toBe("now");
		expect(parsePlanStep("○ Gate").state).toBe("next");
	});

	it("strips a producer ordinal so the renderer owns numbering", () => {
		expect(parsePlanStep("1. Parse demoShareScreen query")).toEqual({
			label: "Parse demoShareScreen query",
			state: "next",
		});
	});

	it("reads the marker behind a bullet or an ordinal", () => {
		// Markdown task-list syntax is how an agent naturally writes a plan;
		// matching the marker first would leave a literal "[x]" on screen.
		expect(parsePlanStep("- [x] Reproduce")).toEqual({
			label: "Reproduce",
			state: "done",
		});
		expect(parsePlanStep("2. [>] Fingerprint regions")).toEqual({
			label: "Fingerprint regions",
			state: "now",
		});
	});
});

describe("resolvePresentedArtifact", () => {
	const backlog = [
		{
			id: "s1",
			artifactKind: "diagram.architecture",
			title: "Architecture overview",
			uri: STUB_URI,
			produce: {
				tool: "render_mermaid",
				args: { mermaidSource: "flowchart LR\n  A --> B" },
			},
		},
	];

	it("completes a beat-only show from its backlog item", () => {
		// `drive_script_beat` sets a presented show carrying only a caption.
		expect(
			resolvePresentedArtifact(
				{ showItemId: "s1", caption: "The layout." },
				backlog,
			),
		).toEqual({
			caption: "The layout.",
			kind: "diagram.architecture",
			produce: backlog[0].produce,
			sticky: undefined,
			title: "Architecture overview",
			uri: STUB_URI,
		});
	});

	it("keeps what the wire said over the backlog", () => {
		const resolved = resolvePresentedArtifact(
			{
				showItemId: "s1",
				artifactKind: "doc.plan",
				sticky: "hold",
				title: "Newer title",
				uri: "data:image/svg+xml;base64,BBB",
			},
			backlog,
		);
		expect(resolved).toMatchObject({
			kind: "doc.plan",
			sticky: "hold",
			title: "Newer title",
			uri: "data:image/svg+xml;base64,BBB",
		});
	});

	it("survives a present that lands before its room sync", () => {
		expect(
			resolvePresentedArtifact({ showItemId: "s9", title: "Unknown" }, backlog),
		).toEqual({
			caption: undefined,
			kind: undefined,
			produce: undefined,
			sticky: undefined,
			title: "Unknown",
			uri: undefined,
		});
		expect(resolvePresentedArtifact(null, backlog)).toBeNull();
	});
});

describe("projectWalkthroughLines", () => {
	it("returns nothing for an empty snippet", () => {
		expect(projectWalkthroughLines("", 1, 4)).toEqual([]);
		expect(projectWalkthroughLines("\n\n", 1, 4)).toEqual([]);
	});

	it("normalizes CRLF so windows snippets do not gain blank rows", () => {
		expect(projectWalkthroughLines("a\r\nb\r\n", 2, 3)).toEqual([
			{ number: 2, text: "a", highlighted: true },
			{ number: 3, text: "b", highlighted: true },
		]);
	});

	it("anchors the first real line at startLine despite leading blanks", () => {
		expect(projectWalkthroughLines("\n\nreal", 5, 5)).toEqual([
			{ number: 5, text: "real", highlighted: true },
		]);
	});
});
