import { PLAN_DEPENDENCY_DEMO_TEAMS } from "@cline/drivecode-demo";
import { buildDependencyMap, type DependencyNode } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	type Camera,
	cameraCenteredOn,
	chooseOrientation,
	contentBounds,
	edgePath,
	fitCamera,
	fitPadding,
	type GraphOrientation,
	LABEL_LOD_SCALE,
	type LayoutInputNode,
	layoutDependencyGraph,
	levelOfDetail,
	MAX_FIT_SCALE,
	MAX_SCALE,
	MIN_SCALE,
	NODE_HEIGHT,
	NODE_WIDTH,
	type NodeBox,
	panCamera,
	panIntoView,
	resolveDependencyNavAction,
	rovingAnchor,
	stepSelection,
	toScreenRect,
	type ViewportSize,
	visibleWorldRect,
	ZOOM_STEP,
	zoomCameraAt,
} from "./dependency-graph-layout";

const EPSILON = 1e-9;

const demoNodes: DependencyNode[] = buildDependencyMap(
	PLAN_DEPENDENCY_DEMO_TEAMS.map((team) => ({
		teamId: team.teamId,
		tasks: team.tasks,
	})),
).nodes;

function chain(length: number): LayoutInputNode[] {
	return Array.from({ length }, (_, index) => ({
		key: `t${index}`,
		title: `Task ${index}`,
		layer: index,
	}));
}

function band(layers: number, perLayer: number): LayoutInputNode[] {
	const nodes: LayoutInputNode[] = [];
	for (let layer = 0; layer < layers; layer += 1) {
		for (let index = 0; index < perLayer; index += 1) {
			nodes.push({
				key: `l${layer}-n${index}`,
				title: `Task ${layer}-${index}`,
				layer,
			});
		}
	}
	return nodes;
}

function overlaps(a: NodeBox, b: NodeBox): boolean {
	return (
		a.x < b.x + b.width &&
		b.x < a.x + a.width &&
		a.y < b.y + b.height &&
		b.y < a.y + a.height
	);
}

function screenBounds(positions: NodeBox[], camera: Camera) {
	const rects = positions.map((box) => toScreenRect(box, camera));
	return {
		minX: Math.min(...rects.map((rect) => rect.x)),
		minY: Math.min(...rects.map((rect) => rect.y)),
		maxX: Math.max(...rects.map((rect) => rect.x + rect.width)),
		maxY: Math.max(...rects.map((rect) => rect.y + rect.height)),
	};
}

function expectFramed(
	positions: NodeBox[],
	camera: Camera,
	viewport: ViewportSize,
) {
	expect(positions.length).toBeGreaterThan(0);
	for (const box of positions) {
		const rect = toScreenRect(box, camera);
		const inside =
			rect.x >= -EPSILON &&
			rect.y >= -EPSILON &&
			rect.x + rect.width <= viewport.width + EPSILON &&
			rect.y + rect.height <= viewport.height + EPSILON;
		if (!inside) {
			throw new Error(
				`${box.key} escaped ${viewport.width}x${viewport.height}: x=${rect.x} y=${rect.y}`,
			);
		}
	}
}

const unsortedLayer: LayoutInputNode[] = [
	{ key: "z", title: "Beta", layer: 0 },
	{ key: "a", title: "Beta", layer: 0 },
	{ key: "m", title: "Alpha", layer: 0 },
];

const viewports: ViewportSize[] = [
	{ width: 1440, height: 900 },
	{ width: 1100, height: 620 },
	{ width: 900, height: 1200 },
	{ width: 720, height: 420 },
	{ width: 420, height: 320 },
	{ width: 140, height: 110 },
];

describe("layoutDependencyGraph fit (Tier 0)", () => {
	it("uses the whole demo plan fixture", () => {
		expect(demoNodes.length).toBeGreaterThanOrEqual(30);
	});

	for (const viewport of viewports) {
		it(`frames every demo node inside ${viewport.width}x${viewport.height}`, () => {
			const layout = layoutDependencyGraph(demoNodes, viewport);
			expect(layout.positions).toHaveLength(demoNodes.length);
			expectFramed(layout.positions, layout.camera, viewport);
		});
	}

	for (const orientation of ["lr", "td"] as GraphOrientation[]) {
		it(`frames every demo node when ${orientation} is forced`, () => {
			const viewport = { width: 1100, height: 620 };
			const layout = layoutDependencyGraph(demoNodes, viewport, {
				orientation,
			});
			expect(layout.orientation).toBe(orientation);
			expectFramed(layout.positions, layout.camera, viewport);
		});
	}

	it("fills one viewport axis and centres the content", () => {
		const viewport = { width: 1100, height: 620 };
		const layout = layoutDependencyGraph(demoNodes, viewport);
		expect(layout.camera.scale).toBeLessThan(MAX_FIT_SCALE);
		const bounds = screenBounds(layout.positions, layout.camera);
		const padding = fitPadding(viewport);
		const availableWidth = viewport.width - padding * 2;
		const availableHeight = viewport.height - padding * 2;
		expect(
			Math.abs(bounds.maxX - bounds.minX - availableWidth) < 1e-6 ||
				Math.abs(bounds.maxY - bounds.minY - availableHeight) < 1e-6,
		).toBe(true);
		expect(bounds.minX + bounds.maxX).toBeCloseTo(viewport.width, 6);
		expect(bounds.minY + bounds.maxY).toBeCloseTo(viewport.height, 6);
	});

	it("caps up-scaling for tiny graphs", () => {
		const layout = layoutDependencyGraph(chain(1), {
			width: 1440,
			height: 900,
		});
		expect(layout.camera.scale).toBe(MAX_FIT_SCALE);
	});

	it("returns a fresh identity camera for an empty graph or a collapsed viewport", () => {
		const first = layoutDependencyGraph([], { width: 900, height: 600 });
		expect(first.positions).toEqual([]);
		first.camera.x += 500;
		expect(
			layoutDependencyGraph([], { width: 900, height: 600 }).camera,
		).toEqual({ x: 0, y: 0, scale: 1 });
		expect(
			layoutDependencyGraph(chain(4), { width: 0, height: 0 }).camera,
		).toEqual({ x: 0, y: 0, scale: 1 });
	});
});

describe("placement (Tier 1)", () => {
	it("is deterministic and ordered by title then key within a layer", () => {
		const viewport = { width: 1000, height: 700 };
		const first = layoutDependencyGraph(unsortedLayer, viewport, {
			orientation: "lr",
		});
		const second = layoutDependencyGraph(
			[...unsortedLayer].reverse(),
			viewport,
			{ orientation: "lr" },
		);
		expect(first.positions).toEqual(second.positions);
		expect(first.positions.map((box) => box.key)).toEqual(["m", "a", "z"]);
	});

	it("does not reorder or modify the input nodes", () => {
		const nodes = [...unsortedLayer];
		const snapshot = structuredClone(nodes);
		layoutDependencyGraph(nodes, { width: 900, height: 600 });
		expect(nodes).toEqual(snapshot);
	});

	it("never overlaps two nodes and keeps chips at nominal size", () => {
		for (const orientation of ["lr", "td"] as GraphOrientation[]) {
			const { positions } = layoutDependencyGraph(
				demoNodes,
				{ width: 1100, height: 620 },
				{ orientation },
			);
			expect(positions).toHaveLength(demoNodes.length);
			for (const [index, a] of positions.entries()) {
				expect(a.width).toBe(NODE_WIDTH);
				expect(a.height).toBe(NODE_HEIGHT);
				for (const b of positions.slice(index + 1)) {
					if (overlaps(a, b)) {
						throw new Error(`${orientation}: ${a.key} overlaps ${b.key}`);
					}
				}
			}
		}
	});

	it("truncates odd layers and stays finite for a non-finite viewport", () => {
		const nodes: LayoutInputNode[] = [
			{ key: "neg", title: "Neg", layer: -3 },
			{ key: "zero", title: "Zero", layer: 0 },
			{ key: "half", title: "Half", layer: 0.5 },
			{ key: "high", title: "High", layer: 1.9 },
			{ key: "nan", title: "Nan", layer: Number.NaN },
		];
		const { positions } = layoutDependencyGraph(nodes, {
			width: Number.NaN,
			height: Number.POSITIVE_INFINITY,
		});
		expect(positions).toHaveLength(nodes.length);
		for (const [index, a] of positions.entries()) {
			expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
			for (const b of positions.slice(index + 1)) {
				expect(overlaps(a, b)).toBe(false);
			}
		}
	});

	it("places every prerequisite before its dependent", () => {
		const viewport = { width: 1100, height: 620 };
		const lr = layoutDependencyGraph(demoNodes, viewport, {
			orientation: "lr",
		});
		const td = layoutDependencyGraph(demoNodes, viewport, {
			orientation: "td",
		});
		const lrBoxes = new Map(lr.positions.map((box) => [box.key, box]));
		const tdBoxes = new Map(td.positions.map((box) => [box.key, box]));
		let checked = 0;
		for (const node of demoNodes) {
			for (const key of node.dependsOnKeys) {
				const lrFrom = lrBoxes.get(key);
				const lrTo = lrBoxes.get(node.key);
				const tdFrom = tdBoxes.get(key);
				const tdTo = tdBoxes.get(node.key);
				if (!lrFrom || !lrTo || !tdFrom || !tdTo) {
					throw new Error(`missing box for ${key} -> ${node.key}`);
				}
				checked += 1;
				expect(lrFrom.x).toBeLessThan(lrTo.x);
				expect(tdFrom.y).toBeLessThan(tdTo.y);
			}
		}
		expect(checked).toBeGreaterThan(0);
	});
});

describe("contentBounds and fitCamera", () => {
	const boxes: NodeBox[] = [
		{ key: "a", x: 10, y: 20, width: 100, height: 40 },
		{ key: "b", x: 200, y: 5, width: 100, height: 40 },
	];

	it("spans every node, narrows to a subset, and is empty when nothing matches", () => {
		expect(contentBounds(boxes)).toEqual({
			minX: 10,
			minY: 5,
			maxX: 300,
			maxY: 60,
			width: 290,
			height: 55,
		});
		expect(contentBounds(boxes, ["b"])).toMatchObject({ minX: 200 });
		expect(contentBounds(boxes, [])).toMatchObject({ width: 0, height: 0 });
	});

	it("ignores non-finite boxes rather than poisoning the bounds", () => {
		const poisoned: NodeBox[] = [
			...boxes,
			{ key: "bad", x: Number.NaN, y: 0, width: NODE_WIDTH, height: 1 },
		];
		expect(contentBounds(poisoned)).toEqual(contentBounds(boxes));
		const camera = fitCamera(poisoned, { width: 900, height: 600 });
		expect(Number.isFinite(camera.x) && Number.isFinite(camera.y)).toBe(true);
	});

	it("frames only the selection when one is supplied", () => {
		const viewport = { width: 1100, height: 620 };
		const { positions } = layoutDependencyGraph(demoNodes, viewport);
		const keys = positions.slice(0, 3).map((box) => box.key);
		const camera = fitCamera(positions, viewport, keys);
		expectFramed(
			positions.filter((box) => keys.includes(box.key)),
			camera,
			viewport,
		);
		expect(camera.scale).toBeGreaterThan(fitCamera(positions, viewport).scale);
		expect(fitCamera(positions, viewport, ["nope"])).toEqual(
			fitCamera(positions, viewport),
		);
	});
});

describe("orientation (Tier 3)", () => {
	it("never fits smaller than a forced orientation", () => {
		const cases: Array<[LayoutInputNode[], ViewportSize]> = [
			[demoNodes, { width: 1100, height: 620 }],
			[chain(20), { width: 600, height: 900 }],
			[band(2, 20), { width: 1400, height: 400 }],
		];
		for (const [nodes, viewport] of cases) {
			const auto = layoutDependencyGraph(nodes, viewport);
			const lr = layoutDependencyGraph(nodes, viewport, { orientation: "lr" });
			const td = layoutDependencyGraph(nodes, viewport, { orientation: "td" });
			expect(auto.camera.scale).toBeGreaterThanOrEqual(lr.camera.scale);
			expect(auto.camera.scale).toBeGreaterThanOrEqual(td.camera.scale);
		}
	});

	it("flips a deep chain to top-down in a tall viewport and prefers lr on a tie", () => {
		expect(chooseOrientation(chain(20), { width: 600, height: 900 })).toBe(
			"td",
		);
		expect(chooseOrientation(chain(1), { width: 1440, height: 900 })).toBe(
			"lr",
		);
		expect(chooseOrientation([], { width: 1440, height: 900 })).toBe("lr");
	});
});

describe("level of detail (Tier 2)", () => {
	it("switches at the readability threshold", () => {
		expect(levelOfDetail(LABEL_LOD_SCALE - 0.01)).toBe("overview");
		expect(levelOfDetail(LABEL_LOD_SCALE)).toBe("detail");
	});
});

describe("camera controls", () => {
	it("recovers from a degenerate scale and pans without changing scale", () => {
		expect(
			zoomCameraAt({ x: 0, y: 0, scale: 0 }, { x: 1, y: 1 }, 2).scale,
		).toBe(1);
		expect(panCamera({ x: 10, y: 20, scale: 0.5 }, -4, 6)).toEqual({
			x: 6,
			y: 26,
			scale: 0.5,
		});
	});

	it("holds the focus point still while zooming", () => {
		const camera: Camera = { x: -120, y: 40, scale: 0.8 };
		const focus = { x: 300, y: 210 };
		const world = {
			x: (focus.x - camera.x) / camera.scale,
			y: (focus.y - camera.y) / camera.scale,
		};
		const zoomed = zoomCameraAt(camera, focus, ZOOM_STEP);
		expect(zoomed.x + world.x * zoomed.scale).toBeCloseTo(focus.x, 10);
		expect(zoomed.y + world.y * zoomed.scale).toBeCloseTo(focus.y, 10);
	});

	it("clamps at the bounds but never snaps a below-floor fit back up", () => {
		const focus = { x: 100, y: 100 };
		expect(
			zoomCameraAt({ x: 0, y: 0, scale: MIN_SCALE }, focus, 0.5).scale,
		).toBe(MIN_SCALE);
		expect(zoomCameraAt({ x: 0, y: 0, scale: MAX_SCALE }, focus, 2).scale).toBe(
			MAX_SCALE,
		);
		const layout = layoutDependencyGraph(chain(30), {
			width: 600,
			height: 400,
		});
		expect(layout.camera.scale).toBeLessThan(MIN_SCALE);
		expect(zoomCameraAt(layout.camera, focus, 1 / ZOOM_STEP).scale).toBe(
			layout.camera.scale,
		);
	});

	it("maps the viewport to world space and back through the minimap helpers", () => {
		const viewport = { width: 800, height: 400 };
		const camera: Camera = { x: -100, y: 50, scale: 0.5 };
		const visible = visibleWorldRect(camera, viewport);
		expect(visible).toEqual({ x: 200, y: -100, width: 1600, height: 800 });
		const centred = cameraCenteredOn({ x: 300, y: 120 }, viewport, 0.5);
		expect(visibleWorldRect(centred, viewport)).toMatchObject({
			x: 300 - 800,
			y: 120 - 400,
		});
	});

	it("draws edges out of the trailing side and into the leading side", () => {
		const from: NodeBox = { key: "a", x: 0, y: 0, width: 100, height: 50 };
		const to: NodeBox = { key: "b", x: 300, y: 200, width: 100, height: 50 };
		expect(edgePath(from, to, "lr")).toMatch(/^M 100 25 C .* 300 225$/);
		expect(edgePath(from, to, "td")).toMatch(/^M 50 50 C .* 350 200$/);
	});
});

describe("keyboard navigation", () => {
	const KEYS = ["t:a", "t:b", "t:c"];
	const resolve = (event: Parameters<typeof resolveDependencyNavAction>[0]) =>
		resolveDependencyNavAction(event, KEYS, "t:b");

	it("steps with wrapping and opens from the nearest end", () => {
		expect(stepSelection(KEYS, "t:c", 1)).toBe("t:a");
		expect(stepSelection(KEYS, "t:a", -1)).toBe("t:c");
		expect(stepSelection(KEYS, null, 1)).toBe("t:a");
		expect(stepSelection(KEYS, null, -1)).toBe("t:c");
		expect(stepSelection(KEYS, "t:gone", 1)).toBe("t:a");
		expect(stepSelection([], null, 1)).toBeNull();
	});

	it("maps arrows, Home, End, Escape and the zoom keys", () => {
		expect(resolve({ key: "ArrowRight" })).toEqual({
			kind: "select",
			key: "t:c",
		});
		expect(resolve({ key: "ArrowUp" })).toEqual({ kind: "select", key: "t:a" });
		expect(resolve({ key: "Home" })).toEqual({ kind: "select", key: "t:a" });
		expect(resolve({ key: "End" })).toEqual({ kind: "select", key: "t:c" });
		expect(resolve({ key: "Escape" })).toEqual({ kind: "clear" });
		expect(resolve({ key: "+" })).toEqual({ kind: "zoom", factor: ZOOM_STEP });
		expect(resolve({ key: "-" })).toEqual({
			kind: "zoom",
			factor: 1 / ZOOM_STEP,
		});
		expect(resolve({ key: "0" })).toEqual({ kind: "fit" });
	});

	it("leaves host chords, IME composition, Enter and Space alone", () => {
		expect(resolve({ key: "ArrowDown", ctrlKey: true })).toEqual({
			kind: "none",
		});
		expect(resolve({ key: "ArrowDown", metaKey: true })).toEqual({
			kind: "none",
		});
		expect(resolve({ key: "ArrowDown", isComposing: true })).toEqual({
			kind: "none",
		});
		expect(resolve({ key: "Enter" })).toEqual({ kind: "none" });
		expect(resolve({ key: " " })).toEqual({ kind: "none" });
		expect(resolveDependencyNavAction({ key: "Home" }, [], null)).toEqual({
			kind: "none",
		});
	});

	it("keeps exactly one roving tab stop", () => {
		expect(rovingAnchor(KEYS, "t:b")).toBe("t:b");
		expect(rovingAnchor(KEYS, "t:gone")).toBe("t:a");
		expect(rovingAnchor([], null)).toBeNull();
	});

	it("pans a node into view without oscillating", () => {
		const viewport = { width: 400, height: 300 };
		const rect = (x: number, y: number) => ({ x, y, width: 100, height: 50 });
		expect(panIntoView(rect(150, 120), viewport)).toEqual({ dx: 0, dy: 0 });
		expect(panIntoView(rect(-60, -10), viewport)).toEqual({ dx: 84, dy: 34 });
		expect(panIntoView(rect(500, 400), viewport)).toEqual({
			dx: 400 - 100 - 24 - 500,
			dy: 300 - 50 - 24 - 400,
		});
		expect(
			panIntoView({ x: 10, y: 30, width: 900, height: 40 }, viewport),
		).toEqual({ dx: (400 - 900) / 2 - 10, dy: 0 });
		expect(panIntoView(rect(0, 0), { width: 0, height: 0 })).toEqual({
			dx: 0,
			dy: 0,
		});
	});
});
