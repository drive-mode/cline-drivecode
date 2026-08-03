import { buildDependencyMap, type DependencyNode } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { PLAN_DEPENDENCY_DEMO_TEAM } from "../../../../../../drivecode-demo/src/plan-tasks-fixture.js";
import {
	type Camera,
	chooseOrientation,
	contentBounds,
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
	toScreenRect,
	type ViewportSize,
	ZOOM_STEP,
	zoomCameraAt,
} from "./dependency-graph-layout.js";

const EPSILON = 1e-9;

const demoNodes: DependencyNode[] = buildDependencyMap([
	{
		teamId: PLAN_DEPENDENCY_DEMO_TEAM.teamId,
		tasks: PLAN_DEPENDENCY_DEMO_TEAM.tasks,
	},
]).nodes;

function chain(length: number): LayoutInputNode[] {
	return Array.from({ length }, (_, index) => ({
		key: `t${index}`,
		title: `Task ${index}`,
		layer: index,
	}));
}

function band(layers: number, perLayer: number): LayoutInputNode[] {
	const nodes: LayoutInputNode[] = [];
	for (let layer = 0; layer < layers; layer += 1)
		for (let index = 0; index < perLayer; index += 1)
			nodes.push({
				key: `l${layer}-n${index}`,
				title: `Task ${layer}-${index}`,
				layer,
			});
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
		if (!inside)
			throw new Error(
				`${box.key} escaped ${viewport.width}x${viewport.height}: ` +
					`x=${rect.x} y=${rect.y} w=${rect.width} h=${rect.height}`,
			);
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
	{ width: 60, height: 48 },
];

describe("layoutDependencyGraph fit (Tier 0)", () => {
	it("uses the whole demo plan fixture", () => {
		expect(demoNodes.length).toBeGreaterThanOrEqual(30);
	});

	for (const viewport of viewports)
		it(`frames every demo node inside ${viewport.width}x${viewport.height}`, () => {
			const layout = layoutDependencyGraph(demoNodes, viewport);
			expect(layout.positions).toHaveLength(demoNodes.length);
			expectFramed(layout.positions, layout.camera, viewport);
		});

	for (const orientation of ["lr", "td"] as GraphOrientation[])
		it(`frames every demo node when ${orientation} is forced`, () => {
			const viewport = { width: 1100, height: 620 };
			const layout = layoutDependencyGraph(demoNodes, viewport, {
				orientation,
			});
			expect(layout.orientation).toBe(orientation);
			expectFramed(layout.positions, layout.camera, viewport);
		});

	it("fills one viewport axis instead of shrinking arbitrarily", () => {
		const viewport = { width: 1100, height: 620 };
		const layout = layoutDependencyGraph(demoNodes, viewport);
		expect(layout.camera.scale).toBeLessThan(MAX_FIT_SCALE);
		const bounds = screenBounds(layout.positions, layout.camera);
		const padding = fitPadding(viewport);
		const availableWidth = viewport.width - padding * 2;
		const availableHeight = viewport.height - padding * 2;
		const filledWidth = bounds.maxX - bounds.minX;
		const filledHeight = bounds.maxY - bounds.minY;
		expect(
			Math.abs(filledWidth - availableWidth) < 1e-6 ||
				Math.abs(filledHeight - availableHeight) < 1e-6,
		).toBe(true);
	});

	it("centers the framed content in the viewport", () => {
		const viewport = { width: 1100, height: 620 };
		const layout = layoutDependencyGraph(demoNodes, viewport);
		const bounds = screenBounds(layout.positions, layout.camera);
		expect(bounds.minX + bounds.maxX).toBeCloseTo(viewport.width, 6);
		expect(bounds.minY + bounds.maxY).toBeCloseTo(viewport.height, 6);
	});

	it("caps up-scaling for tiny graphs", () => {
		const layout = layoutDependencyGraph(chain(1), {
			width: 1440,
			height: 900,
		});
		expect(layout.camera.scale).toBe(MAX_FIT_SCALE);
		expectFramed(layout.positions, layout.camera, { width: 1440, height: 900 });
	});

	it("returns an identity camera for an empty graph", () => {
		const layout = layoutDependencyGraph([], { width: 900, height: 600 });
		expect(layout.positions).toEqual([]);
		expect(layout.camera).toEqual({ x: 0, y: 0, scale: 1 });
	});

	it("returns a fresh identity camera each time", () => {
		const first = layoutDependencyGraph([], { width: 900, height: 600 });
		first.camera.x += 500;
		expect(
			layoutDependencyGraph([], { width: 900, height: 600 }).camera,
		).toEqual({ x: 0, y: 0, scale: 1 });
	});

	it("returns an identity camera for a collapsed viewport", () => {
		const layout = layoutDependencyGraph(chain(4), { width: 0, height: 0 });
		expect(layout.camera).toEqual({ x: 0, y: 0, scale: 1 });
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
			{
				orientation: "lr",
			},
		);
		expect(first.positions).toEqual(second.positions);
		expect(first.positions.map((box) => box.key)).toEqual(["m", "a", "z"]);
	});

	it("does not reorder or modify the input nodes", () => {
		const nodes = [...unsortedLayer];
		const snapshot = structuredClone(nodes);
		layoutDependencyGraph(nodes, { width: 900, height: 600 });
		expect(nodes).toEqual(snapshot);
		expect(nodes.map((node) => node.key)).toEqual(["z", "a", "m"]);
	});

	it("never overlaps two nodes", () => {
		for (const orientation of ["lr", "td"] as GraphOrientation[]) {
			const { positions } = layoutDependencyGraph(
				demoNodes,
				{ width: 1100, height: 620 },
				{ orientation },
			);
			expect(positions).toHaveLength(demoNodes.length);
			for (const [index, a] of positions.entries())
				for (const b of positions.slice(index + 1))
					if (overlaps(a, b))
						throw new Error(`${orientation}: ${a.key} overlaps ${b.key}`);
		}
	});

	it("truncates odd layers instead of letting nodes collide", () => {
		const nodes: LayoutInputNode[] = [
			{ key: "neg", title: "Neg", layer: -3 },
			{ key: "zero", title: "Zero", layer: 0 },
			{ key: "half", title: "Half", layer: 0.5 },
			{ key: "high", title: "High", layer: 1.9 },
			{ key: "nan", title: "Nan", layer: Number.NaN },
		];
		for (const orientation of ["lr", "td"] as GraphOrientation[]) {
			const { positions } = layoutDependencyGraph(
				nodes,
				{ width: 900, height: 600 },
				{ orientation },
			);
			expect(positions).toHaveLength(nodes.length);
			for (const box of positions) {
				expect(Number.isFinite(box.x)).toBe(true);
				expect(Number.isFinite(box.y)).toBe(true);
			}
			for (const [index, a] of positions.entries())
				for (const b of positions.slice(index + 1))
					if (overlaps(a, b))
						throw new Error(`${orientation}: ${a.key} overlaps ${b.key}`);
		}
	});

	it("stays finite for a non-finite viewport", () => {
		for (const viewport of [
			{ width: Number.NaN, height: 800 },
			{ width: 900, height: Number.POSITIVE_INFINITY },
		]) {
			const layout = layoutDependencyGraph(demoNodes, viewport);
			expect(layout.positions).toHaveLength(demoNodes.length);
			for (const box of layout.positions) {
				expect(Number.isFinite(box.x)).toBe(true);
				expect(Number.isFinite(box.y)).toBe(true);
			}
			expect(Number.isFinite(layout.camera.scale)).toBe(true);
			expect(Number.isFinite(layout.camera.x)).toBe(true);
			expect(Number.isFinite(layout.camera.y)).toBe(true);
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
		const byKey = new Map(demoNodes.map((node) => [node.key, node]));
		let checked = 0;
		for (const node of demoNodes) {
			if (node.inCycle) continue;
			for (const key of node.dependsOnKeys) {
				if (byKey.get(key)?.inCycle) continue;
				const lrFrom = lrBoxes.get(key);
				const lrTo = lrBoxes.get(node.key);
				const tdFrom = tdBoxes.get(key);
				const tdTo = tdBoxes.get(node.key);
				if (!lrFrom || !lrTo || !tdFrom || !tdTo)
					throw new Error(`missing box for ${key} -> ${node.key}`);
				checked += 1;
				expect(lrFrom.x).toBeLessThan(lrTo.x);
				expect(tdFrom.y).toBeLessThan(tdTo.y);
			}
		}
		expect(checked).toBeGreaterThan(0);
	});

	it("keeps node chips at their nominal size", () => {
		const { positions } = layoutDependencyGraph(demoNodes, {
			width: 1100,
			height: 620,
		});
		expect(positions).toHaveLength(demoNodes.length);
		for (const box of positions) {
			expect(box.width).toBe(NODE_WIDTH);
			expect(box.height).toBe(NODE_HEIGHT);
		}
	});
});

describe("contentBounds", () => {
	const boxes: NodeBox[] = [
		{ key: "a", x: 10, y: 20, width: 100, height: 40 },
		{ key: "b", x: 200, y: 5, width: 100, height: 40 },
	];

	it("spans every node", () => {
		expect(contentBounds(boxes)).toEqual({
			minX: 10,
			minY: 5,
			maxX: 300,
			maxY: 60,
			width: 290,
			height: 55,
		});
	});

	it("narrows to a selection subset", () => {
		expect(contentBounds(boxes, ["b"])).toMatchObject({
			minX: 200,
			width: 100,
			height: 40,
		});
	});

	it("is empty when nothing matches", () => {
		expect(contentBounds(boxes, [])).toMatchObject({ width: 0, height: 0 });
		expect(contentBounds([])).toMatchObject({ width: 0, height: 0 });
	});

	it("ignores non-finite boxes rather than poisoning the bounds", () => {
		const poisoned: NodeBox[] = [
			...boxes,
			{
				key: "bad",
				x: Number.NaN,
				y: 0,
				width: NODE_WIDTH,
				height: NODE_HEIGHT,
			},
		];
		expect(contentBounds(poisoned)).toEqual(contentBounds(boxes));
		const camera = fitCamera(poisoned, { width: 900, height: 600 });
		expect(Number.isFinite(camera.scale)).toBe(true);
		expect(Number.isFinite(camera.x)).toBe(true);
		expect(Number.isFinite(camera.y)).toBe(true);
	});

	it("hands back a fresh object each call", () => {
		const first = contentBounds([]);
		first.width = 999;
		expect(contentBounds([]).width).toBe(0);
	});
});

describe("fitCamera selection", () => {
	const viewport = { width: 1100, height: 620 };

	it("frames only the selection when one is supplied", () => {
		const { positions } = layoutDependencyGraph(demoNodes, viewport);
		const keys = positions.slice(0, 3).map((box) => box.key);
		const camera = fitCamera(positions, viewport, keys);
		const selected = positions.filter((box) => keys.includes(box.key));
		expectFramed(selected, camera, viewport);
		expect(camera.scale).toBeGreaterThan(fitCamera(positions, viewport).scale);
	});

	it("falls back to every node when the selection is empty", () => {
		const { positions } = layoutDependencyGraph(demoNodes, viewport);
		expect(fitCamera(positions, viewport, [])).toEqual(
			fitCamera(positions, viewport),
		);
		expect(fitCamera(positions, viewport, ["nope"])).toEqual(
			fitCamera(positions, viewport),
		);
	});
});

describe("orientation (Tier 3)", () => {
	it("never fits smaller than a forced orientation", () => {
		const cases: Array<[LayoutInputNode[], ViewportSize]> = [
			[demoNodes, { width: 1100, height: 620 }],
			[demoNodes, { width: 700, height: 1000 }],
			[chain(20), { width: 600, height: 900 }],
			[band(2, 20), { width: 1400, height: 400 }],
		];
		for (const [nodes, viewport] of cases) {
			const auto = layoutDependencyGraph(nodes, viewport);
			const lr = layoutDependencyGraph(nodes, viewport, { orientation: "lr" });
			const td = layoutDependencyGraph(nodes, viewport, { orientation: "td" });
			expect(auto.camera.scale).toBeGreaterThanOrEqual(lr.camera.scale);
			expect(auto.camera.scale).toBeGreaterThanOrEqual(td.camera.scale);
			expectFramed(auto.positions, auto.camera, viewport);
		}
	});

	it("flips a deep chain to top-down in a tall viewport", () => {
		const viewport = { width: 600, height: 900 };
		expect(chooseOrientation(chain(20), viewport)).toBe("td");
		expect(
			layoutDependencyGraph(chain(20), viewport).camera.scale,
		).toBeGreaterThan(
			layoutDependencyGraph(chain(20), viewport, { orientation: "lr" }).camera
				.scale,
		);
	});

	it("prefers left-to-right on a tie", () => {
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
		expect(levelOfDetail(1.4)).toBe("detail");
	});

	it("reports overview for the fitted demo graph", () => {
		const layout = layoutDependencyGraph(demoNodes, {
			width: 1100,
			height: 620,
		});
		expect(levelOfDetail(layout.camera.scale)).toBe("overview");
	});
});

describe("camera controls", () => {
	it("recovers from a degenerate scale", () => {
		const focus = { x: 10, y: 10 };
		expect(zoomCameraAt({ x: 0, y: 0, scale: 0 }, focus, 2).scale).toBe(1);
		expect(
			zoomCameraAt({ x: 0, y: 0, scale: Number.NaN }, focus, 2).scale,
		).toBe(1);
		const stuck = zoomCameraAt({ x: 4, y: 5, scale: 1 }, focus, Number.NaN);
		expect(stuck).toEqual({ x: 4, y: 5, scale: 1 });
	});

	it("pans without changing scale", () => {
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
		expect(zoomed.scale).toBeCloseTo(0.92, 10);
		expect(zoomed.x + world.x * zoomed.scale).toBeCloseTo(focus.x, 10);
		expect(zoomed.y + world.y * zoomed.scale).toBeCloseTo(focus.y, 10);
	});

	it("respects the zoom clamp at the focus point", () => {
		const focus = { x: 100, y: 100 };
		const out = zoomCameraAt({ x: 0, y: 0, scale: MIN_SCALE }, focus, 0.5);
		expect(out.scale).toBe(MIN_SCALE);
		expect(out.x).toBe(0);
		expect(out.y).toBe(0);
		expect(zoomCameraAt({ x: 0, y: 0, scale: MAX_SCALE }, focus, 2).scale).toBe(
			MAX_SCALE,
		);
	});

	it("never snaps a below-floor fitted camera back up", () => {
		const viewport = { width: 600, height: 400 };
		const layout = layoutDependencyGraph(chain(30), viewport);
		expect(layout.camera.scale).toBeLessThan(MIN_SCALE);
		const focus = { x: viewport.width / 2, y: viewport.height / 2 };
		const out = zoomCameraAt(layout.camera, focus, 1 / ZOOM_STEP);
		expect(out.scale).toBe(layout.camera.scale);
		const inward = zoomCameraAt(layout.camera, focus, ZOOM_STEP);
		expect(inward.scale).toBeCloseTo(layout.camera.scale * ZOOM_STEP, 10);
	});
});
