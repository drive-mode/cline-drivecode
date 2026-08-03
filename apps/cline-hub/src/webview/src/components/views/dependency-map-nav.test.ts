import { describe, expect, it } from "vitest";
import {
	panIntoView,
	resolveDependencyNavAction,
	rovingAnchor,
	stepSelection,
} from "./dependency-map-nav";

const KEYS = ["t:a", "t:b", "t:c"];

describe("stepSelection", () => {
	it("wraps in both directions", () => {
		expect(stepSelection(KEYS, "t:c", 1)).toBe("t:a");
		expect(stepSelection(KEYS, "t:a", -1)).toBe("t:c");
		expect(stepSelection(KEYS, "t:a", 1)).toBe("t:b");
	});

	it("opens on the end nearest the direction travelled when nothing is selected", () => {
		expect(stepSelection(KEYS, null, 1)).toBe("t:a");
		expect(stepSelection(KEYS, null, -1)).toBe("t:c");
	});

	it("treats a selection the snapshot dropped as no selection", () => {
		expect(stepSelection(KEYS, "t:gone", 1)).toBe("t:a");
	});

	it("has nothing to step through in an empty graph", () => {
		expect(stepSelection([], null, 1)).toBeNull();
	});
});

describe("resolveDependencyNavAction", () => {
	const resolve = (event: Parameters<typeof resolveDependencyNavAction>[0]) =>
		resolveDependencyNavAction(event, KEYS, "t:b");

	it("moves forward on ArrowDown and ArrowRight", () => {
		expect(resolve({ key: "ArrowDown" })).toEqual({
			kind: "select",
			key: "t:c",
		});
		expect(resolve({ key: "ArrowRight" })).toEqual({
			kind: "select",
			key: "t:c",
		});
	});

	it("moves back on ArrowUp and ArrowLeft", () => {
		expect(resolve({ key: "ArrowUp" })).toEqual({ kind: "select", key: "t:a" });
		expect(resolve({ key: "ArrowLeft" })).toEqual({
			kind: "select",
			key: "t:a",
		});
	});

	it("jumps to the ends with Home and End", () => {
		expect(resolve({ key: "Home" })).toEqual({ kind: "select", key: "t:a" });
		expect(resolve({ key: "End" })).toEqual({ kind: "select", key: "t:c" });
	});

	it("clears the selection on Escape", () => {
		expect(resolve({ key: "Escape" })).toEqual({ kind: "clear" });
	});

	it("leaves host chords and IME composition alone", () => {
		expect(resolve({ key: "ArrowDown", ctrlKey: true })).toEqual({
			kind: "none",
		});
		expect(resolve({ key: "ArrowDown", metaKey: true })).toEqual({
			kind: "none",
		});
		expect(resolve({ key: "ArrowDown", altKey: true })).toEqual({
			kind: "none",
		});
		expect(resolve({ key: "ArrowDown", isComposing: true })).toEqual({
			kind: "none",
		});
	});

	it("leaves Enter and Space to the node button's native activation", () => {
		expect(resolve({ key: "Enter" })).toEqual({ kind: "none" });
		expect(resolve({ key: " " })).toEqual({ kind: "none" });
	});

	it("claims nothing when the graph has no nodes", () => {
		expect(resolveDependencyNavAction({ key: "Home" }, [], null)).toEqual({
			kind: "none",
		});
		expect(resolveDependencyNavAction({ key: "ArrowDown" }, [], null)).toEqual({
			kind: "none",
		});
	});
});

describe("rovingAnchor", () => {
	it("keeps exactly one tab stop, following the selection", () => {
		expect(rovingAnchor(KEYS, "t:b")).toBe("t:b");
	});

	it("falls back to the first node with no selection or a stale one", () => {
		expect(rovingAnchor(KEYS, null)).toBe("t:a");
		expect(rovingAnchor(KEYS, "t:gone")).toBe("t:a");
	});

	it("has no anchor in an empty graph", () => {
		expect(rovingAnchor([], null)).toBeNull();
	});
});

describe("panIntoView", () => {
	const viewport = { width: 400, height: 300 };
	const rect = (x: number, y: number) => ({ x, y, width: 100, height: 50 });

	it("stays put when the node already clears the margin", () => {
		expect(panIntoView(rect(150, 120), viewport)).toEqual({ dx: 0, dy: 0 });
	});

	it("pulls a node back past the leading edge to the margin", () => {
		expect(panIntoView(rect(-60, -10), viewport)).toEqual({ dx: 84, dy: 34 });
	});

	it("pulls a node back past the trailing edge to the margin", () => {
		expect(panIntoView(rect(500, 400), viewport)).toEqual({
			dx: 400 - 100 - 24 - 500,
			dy: 300 - 50 - 24 - 400,
		});
	});

	it("centres a node too large for the viewport instead of oscillating", () => {
		expect(
			panIntoView({ x: 10, y: 30, width: 900, height: 40 }, viewport),
		).toEqual({ dx: (400 - 900) / 2 - 10, dy: 0 });
	});

	it("ignores a viewport that has not been measured yet", () => {
		expect(panIntoView(rect(0, 0), { width: 0, height: 0 })).toEqual({
			dx: 0,
			dy: 0,
		});
	});
});
