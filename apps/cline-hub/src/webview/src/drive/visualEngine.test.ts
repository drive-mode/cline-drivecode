import { describe, expect, it } from "vitest";
import {
	adaptMermaidSourceForFormat,
	DIAGRAM_NARROW_MAX_PX,
	DIAGRAM_WIDE_MIN_PX,
	diagramLayoutForViewport,
	mermaidFontSizeForViewport,
	resolveVisualEngineParams,
	shouldAutoRenderMermaid,
	shouldStackPanels,
	visualFormatForSize,
} from "./visualEngine";

describe("visualFormatForSize", () => {
	it("classifies phone / tablet / desk / ultrawide", () => {
		expect(visualFormatForSize(390, 844)).toBe("phone");
		expect(visualFormatForSize(844, 390)).toBe("phone"); // landscape phone
		expect(visualFormatForSize(800, 1024)).toBe("tablet");
		expect(visualFormatForSize(1280, 800)).toBe("desk");
		expect(visualFormatForSize(DIAGRAM_WIDE_MIN_PX, 900)).toBe("ultrawide");
	});
});

describe("resolveVisualEngineParams", () => {
	it("fills layout, font, and orientation from the frame box", () => {
		const phone = resolveVisualEngineParams({
			widthPx: 360,
			heightPx: 640,
			compactChrome: true,
		});
		expect(phone.format).toBe("phone");
		expect(phone.layout).toBe("stack");
		expect(phone.mermaidFontSize).toBe(11);
		expect(phone.orientation).toBe("portrait");
		expect(phone.compactChrome).toBe(true);

		const wide = resolveVisualEngineParams({
			widthPx: 1600,
			heightPx: 900,
		});
		expect(wide.format).toBe("ultrawide");
		expect(wide.layout).toBe("wide");
		expect(wide.orientation).toBe("landscape");
	});
});

describe("shouldAutoRenderMermaid", () => {
	it("always renders on Spotlight", () => {
		expect(
			shouldAutoRenderMermaid({ surface: "spotlight", widthPx: 320 }),
		).toBe(true);
	});

	it("defers browse/status below the phone breakpoint", () => {
		expect(
			shouldAutoRenderMermaid({
				surface: "browse",
				widthPx: DIAGRAM_NARROW_MAX_PX,
			}),
		).toBe(false);
		expect(
			shouldAutoRenderMermaid({
				surface: "status",
				widthPx: DIAGRAM_NARROW_MAX_PX + 1,
			}),
		).toBe(true);
	});
});

describe("shouldStackPanels", () => {
	it("stacks phone and tablet portrait", () => {
		expect(
			shouldStackPanels(
				resolveVisualEngineParams({ widthPx: 390, heightPx: 800 }),
			),
		).toBe(true);
		expect(
			shouldStackPanels(
				resolveVisualEngineParams({ widthPx: 800, heightPx: 1000 }),
			),
		).toBe(true);
		expect(
			shouldStackPanels(
				resolveVisualEngineParams({ widthPx: 1000, heightPx: 700 }),
			),
		).toBe(false);
	});
});

describe("adaptMermaidSourceForFormat", () => {
	it("rewrites LR/RL to TB on phone and tablet only", () => {
		const src = "flowchart LR\n  A --> B";
		expect(adaptMermaidSourceForFormat(src, "phone")).toBe(
			"flowchart TB\n  A --> B",
		);
		expect(adaptMermaidSourceForFormat(src, "tablet")).toContain("TB");
		expect(adaptMermaidSourceForFormat(src, "desk")).toBe(src);
		expect(
			adaptMermaidSourceForFormat("flowchart TB\n  A --> B", "phone"),
		).toBe("flowchart TB\n  A --> B");
	});
});

describe("legacy viewport helpers", () => {
	it("still step phone → desk → ultrawide", () => {
		expect(mermaidFontSizeForViewport(390)).toBe(11);
		expect(diagramLayoutForViewport(390)).toBe("stack");
		expect(diagramLayoutForViewport(DIAGRAM_WIDE_MIN_PX)).toBe("wide");
	});
});
