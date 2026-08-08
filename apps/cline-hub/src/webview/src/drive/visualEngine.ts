/**
 * Visual engine — screen-size / format parameters for Spotlight artifacts.
 *
 * Hub producers emit viewport-blind stubs + source (`produce.args`). The
 * webview is the real layout engine: measure the screen frame, resolve
 * format, adapt Mermaid / before-after panels so phone and ultrawide do not
 * share one layout (22-default-posture).
 *
 * Measure the *frame*, not `window` — an ultrawide desk with a narrow
 * Spotlight column is still "phone" for the diagram.
 */

import { type RefObject, useEffect, useMemo, useState } from "react";

/** Short-side / width band for phone Spotlight columns. */
export const DIAGRAM_NARROW_MAX_PX = 720;
export const DIAGRAM_TABLET_MAX_PX = 1024;
/** Soft cue for wide desk layouts (side-by-side before/after, larger type). */
export const DIAGRAM_WIDE_MIN_PX = 1440;

export type DiagramSurface = "spotlight" | "browse" | "status";

export type DiagramLayout = "stack" | "fit" | "wide";

/** Device band derived from the measured screen frame. */
export type VisualFormat = "phone" | "tablet" | "desk" | "ultrawide";

/**
 * Parameters fed into every screen artifact renderer.
 * Gathered automatically from the frame + browser chrome hints.
 */
export type VisualEngineParams = {
	widthPx: number;
	heightPx: number;
	format: VisualFormat;
	orientation: "portrait" | "landscape";
	layout: DiagramLayout;
	mermaidFontSize: number;
	/**
	 * Consumer chrome: `?app=1`, PWA standalone, or iOS home-screen.
	 * Not a substitute for format — a phone browser without app=1 is still phone.
	 */
	compactChrome: boolean;
};

export type VisualEngineInput = {
	widthPx: number;
	heightPx: number;
	compactChrome?: boolean;
};

export function visualFormatForSize(
	widthPx: number,
	heightPx: number,
): VisualFormat {
	const shortSide = Math.min(widthPx, heightPx);
	// Landscape phones stay phone (short side ~390).
	if (shortSide <= 500 || widthPx <= DIAGRAM_NARROW_MAX_PX) {
		return "phone";
	}
	if (widthPx <= DIAGRAM_TABLET_MAX_PX) {
		return "tablet";
	}
	if (widthPx >= DIAGRAM_WIDE_MIN_PX) {
		return "ultrawide";
	}
	return "desk";
}

export function diagramLayoutForFormat(format: VisualFormat): DiagramLayout {
	switch (format) {
		case "phone":
			return "stack";
		case "ultrawide":
			return "wide";
		default:
			return "fit";
	}
}

export function mermaidFontSizeForFormat(format: VisualFormat): number {
	switch (format) {
		case "phone":
			return 11;
		case "tablet":
			return 12;
		case "ultrawide":
			return 14;
		default:
			return 13;
	}
}

/** Browser-only hints — safe no-ops under SSR / tests. */
export function readBrowserVisualHints(): { compactChrome: boolean } {
	if (typeof window === "undefined") {
		return { compactChrome: false };
	}
	const appShell =
		new URLSearchParams(window.location.search).get("app") === "1";
	const displayStandalone = window.matchMedia(
		"(display-mode: standalone)",
	).matches;
	const iosStandalone =
		"standalone" in navigator &&
		(navigator as Navigator & { standalone?: boolean }).standalone === true;
	return { compactChrome: appShell || displayStandalone || iosStandalone };
}

export function resolveVisualEngineParams(
	input: VisualEngineInput,
): VisualEngineParams {
	const widthPx = Math.max(0, Math.round(input.widthPx));
	const heightPx = Math.max(0, Math.round(input.heightPx));
	const format = visualFormatForSize(widthPx, heightPx);
	return {
		widthPx,
		heightPx,
		format,
		orientation: heightPx >= widthPx ? "portrait" : "landscape",
		layout: diagramLayoutForFormat(format),
		mermaidFontSize: mermaidFontSizeForFormat(format),
		compactChrome: Boolean(input.compactChrome),
	};
}

export function shouldAutoRenderMermaid(options: {
	surface: DiagramSurface;
	widthPx: number;
}): boolean {
	if (options.surface === "spotlight") {
		return true;
	}
	return options.widthPx > DIAGRAM_NARROW_MAX_PX;
}

export function shouldAutoRenderMermaidForParams(
	surface: DiagramSurface,
	params: VisualEngineParams,
): boolean {
	return shouldAutoRenderMermaid({ surface, widthPx: params.widthPx });
}

/** Before/after panels: stack on phone, and on tablet portrait. */
export function shouldStackPanels(params: VisualEngineParams): boolean {
	return (
		params.layout === "stack" ||
		(params.format === "tablet" && params.orientation === "portrait")
	);
}

/**
 * Phone / tablet: rewrite top-level `flowchart LR|RL` → `TB` so wide kit
 * diagrams do not clip. Leaves explicit TB/TD and non-flowchart charts alone.
 * // ponytail: first-line only — nested direction overrides stay as authored
 */
export function adaptMermaidSourceForFormat(
	source: string,
	format: VisualFormat,
): string {
	if (format !== "phone" && format !== "tablet") {
		return source;
	}
	return source.replace(/^(flowchart|graph)\s+(LR|RL)\b/im, "$1 TB");
}

/** @deprecated Prefer mermaidFontSizeForFormat via resolveVisualEngineParams. */
export function mermaidFontSizeForViewport(widthPx: number): number {
	return resolveVisualEngineParams({ widthPx, heightPx: widthPx }).mermaidFontSize;
}

/** @deprecated Prefer resolveVisualEngineParams(...).layout. */
export function diagramLayoutForViewport(widthPx: number): DiagramLayout {
	return resolveVisualEngineParams({ widthPx, heightPx: 800 }).layout;
}

/**
 * Observe an element (Spotlight frame / artifact host). Falls back to window
 * until the node mounts, then tracks the content box.
 */
export function useVisualEngineParams(
	hostRef: RefObject<HTMLElement | null>,
): VisualEngineParams {
	const [box, setBox] = useState(() => {
		if (typeof window === "undefined") {
			return { widthPx: 1024, heightPx: 768 };
		}
		return {
			widthPx: window.innerWidth,
			heightPx: window.innerHeight,
		};
	});
	const [compactChrome, setCompactChrome] = useState(
		() => readBrowserVisualHints().compactChrome,
	);

	useEffect(() => {
		setCompactChrome(readBrowserVisualHints().compactChrome);
	}, []);

	useEffect(() => {
		const node = hostRef.current;
		if (!node || typeof ResizeObserver === "undefined") {
			const onResize = () =>
				setBox({
					widthPx: window.innerWidth,
					heightPx: window.innerHeight,
				});
			window.addEventListener("resize", onResize);
			return () => window.removeEventListener("resize", onResize);
		}
		const ro = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const { width, height } = entry.contentRect;
			if (width < 1 && height < 1) return;
			setBox({ widthPx: width, heightPx: height });
		});
		ro.observe(node);
		return () => ro.disconnect();
	}, [hostRef]);

	return useMemo(
		() =>
			resolveVisualEngineParams({
				widthPx: box.widthPx,
				heightPx: box.heightPx,
				compactChrome,
			}),
		[box.widthPx, box.heightPx, compactChrome],
	);
}
