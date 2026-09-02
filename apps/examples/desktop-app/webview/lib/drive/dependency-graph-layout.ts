/**
 * Pure layout, camera and keyboard engine for the Drive dependency map.
 *
 * Ported from the hub's `dependency-graph-layout.ts` and `dependency-map-nav.ts`
 * (`apps/cline-hub/src/webview/src/components/views/`), which in turn encode
 * the fit ladder in
 * `docs/drivecode/plans/cline-drivemode/initiatives/status-dependency-graph/UX.md`.
 * No DOM, no React: the SVG map owns rendering and measures its own viewport.
 */

export type GraphOrientation = "lr" | "td";

export type LayoutInputNode = {
	key: string;
	title: string;
	layer: number;
};

export type ViewportSize = {
	width: number;
	height: number;
};

export type NodeBox = {
	key: string;
	x: number;
	y: number;
	width: number;
	height: number;
};

export type ContentBounds = {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	width: number;
	height: number;
};

export type Camera = {
	x: number;
	y: number;
	scale: number;
};

export type ScreenRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type LevelOfDetail = "overview" | "detail";

export type GraphLayout = {
	orientation: GraphOrientation;
	positions: NodeBox[];
	bounds: ContentBounds;
	camera: Camera;
};

export type LayoutOptions = {
	orientation?: GraphOrientation | "auto";
};

export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 64;
export const GRAPH_PADDING = 24;
export const LABEL_LOD_SCALE = 0.85;
export const MIN_SCALE = 0.35;
export const MAX_SCALE = 2.2;
export const MAX_FIT_SCALE = 1.35;
export const ZOOM_STEP = 1.15;

const EMPTY_BOUNDS: ContentBounds = {
	minX: 0,
	minY: 0,
	maxX: 0,
	maxY: 0,
	width: 0,
	height: 0,
};

const IDENTITY_CAMERA: Camera = { x: 0, y: 0, scale: 1 };

function isUsableViewport(viewport: ViewportSize): boolean {
	return (
		Number.isFinite(viewport.width) &&
		Number.isFinite(viewport.height) &&
		viewport.width > 0 &&
		viewport.height > 0
	);
}

function isUsableBounds(bounds: ContentBounds): boolean {
	return (
		Number.isFinite(bounds.width) &&
		Number.isFinite(bounds.height) &&
		bounds.width > 0 &&
		bounds.height > 0
	);
}

function usableExtent(extent: number): number {
	return Number.isFinite(extent) && extent > 0 ? extent : 0;
}

/** Screen padding kept clear around the fitted content. */
export function fitPadding(viewport: ViewportSize): number {
	return Math.min(GRAPH_PADDING, viewport.width / 4, viewport.height / 4);
}

function normalizeLayer(layer: number): number {
	return Number.isFinite(layer) ? Math.max(0, Math.trunc(layer)) : 0;
}

function groupByLayer(nodes: LayoutInputNode[]): LayoutInputNode[][] {
	const byLayer = new Map<number, LayoutInputNode[]>();
	for (const node of nodes) {
		const layer = normalizeLayer(node.layer);
		const bucket = byLayer.get(layer);
		if (bucket) {
			bucket.push(node);
		} else {
			byLayer.set(layer, [node]);
		}
	}
	return [...byLayer.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, bucket]) =>
			bucket.sort(
				(a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key),
			),
		);
}

/** Tier 1 — pack layers into the viewport rectangle before the camera fit. */
function placeNodes(
	nodes: LayoutInputNode[],
	viewport: ViewportSize,
	orientation: GraphOrientation,
): NodeBox[] {
	const layers = groupByLayer(nodes);
	if (!layers.length) {
		return [];
	}
	const width = usableExtent(viewport.width);
	const height = usableExtent(viewport.height);
	const maxLayer = Math.max(...nodes.map((node) => normalizeLayer(node.layer)));
	const maxInLayer = Math.max(...layers.map((bucket) => bucket.length));
	const layerSpan = Math.max(1, maxLayer);
	const crossSpan = Math.max(1, maxInLayer - 1);
	const boxes: NodeBox[] = [];

	if (orientation === "lr") {
		const layerGap = Math.max(
			NODE_WIDTH + 36,
			Math.min(210, (width - GRAPH_PADDING * 2 - NODE_WIDTH) / layerSpan),
		);
		const rowGap = Math.max(
			NODE_HEIGHT + 16,
			Math.min(100, (height - GRAPH_PADDING * 2 - NODE_HEIGHT) / crossSpan),
		);
		const bandHeight = (maxInLayer - 1) * rowGap;
		for (const bucket of layers) {
			const startY =
				GRAPH_PADDING + (bandHeight - (bucket.length - 1) * rowGap) / 2;
			bucket.forEach((node, index) => {
				boxes.push({
					key: node.key,
					x: GRAPH_PADDING + normalizeLayer(node.layer) * layerGap,
					y: startY + index * rowGap,
					width: NODE_WIDTH,
					height: NODE_HEIGHT,
				});
			});
		}
		return boxes;
	}

	const layerGap = Math.max(
		NODE_HEIGHT + 28,
		Math.min(120, (height - GRAPH_PADDING * 2 - NODE_HEIGHT) / layerSpan),
	);
	const colGap = Math.max(
		NODE_WIDTH + 20,
		Math.min(200, (width - GRAPH_PADDING * 2 - NODE_WIDTH) / crossSpan),
	);
	const bandWidth = (maxInLayer - 1) * colGap;
	for (const bucket of layers) {
		const startX =
			GRAPH_PADDING + (bandWidth - (bucket.length - 1) * colGap) / 2;
		bucket.forEach((node, index) => {
			boxes.push({
				key: node.key,
				x: startX + index * colGap,
				y: GRAPH_PADDING + normalizeLayer(node.layer) * layerGap,
				width: NODE_WIDTH,
				height: NODE_HEIGHT,
			});
		});
	}
	return boxes;
}

/** Bounding box of every node, or of `keys` when a subset is supplied. */
export function contentBounds(
	boxes: readonly NodeBox[],
	keys?: Iterable<string>,
): ContentBounds {
	const wanted = keys ? new Set(keys) : null;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let count = 0;
	for (const box of boxes) {
		if (wanted && !wanted.has(box.key)) {
			continue;
		}
		if (
			!Number.isFinite(box.x) ||
			!Number.isFinite(box.y) ||
			!Number.isFinite(box.width) ||
			!Number.isFinite(box.height)
		) {
			continue;
		}
		count += 1;
		minX = Math.min(minX, box.x);
		minY = Math.min(minY, box.y);
		maxX = Math.max(maxX, box.x + box.width);
		maxY = Math.max(maxY, box.y + box.height);
	}
	if (!count) {
		return { ...EMPTY_BOUNDS };
	}
	return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Tier 0 — frame every node (or the selection set when non-empty) inside the
 * viewport with padding. The fit scale is never floored: framing everything is
 * the hard rule, readability is recovered by tiers 1-3.
 */
export function fitCamera(
	boxes: readonly NodeBox[],
	viewport: ViewportSize,
	keys?: Iterable<string>,
): Camera {
	if (!isUsableViewport(viewport)) {
		return { ...IDENTITY_CAMERA };
	}
	let bounds = contentBounds(boxes, keys);
	if (!isUsableBounds(bounds)) {
		bounds = contentBounds(boxes);
	}
	if (!isUsableBounds(bounds)) {
		return { ...IDENTITY_CAMERA };
	}
	const padding = fitPadding(viewport);
	const availableWidth = viewport.width - padding * 2;
	const availableHeight = viewport.height - padding * 2;
	const scale = Math.min(
		MAX_FIT_SCALE,
		availableWidth / bounds.width,
		availableHeight / bounds.height,
	);
	return {
		scale,
		x:
			padding +
			(availableWidth - bounds.width * scale) / 2 -
			bounds.minX * scale,
		y:
			padding +
			(availableHeight - bounds.height * scale) / 2 -
			bounds.minY * scale,
	};
}

function layoutWith(
	nodes: LayoutInputNode[],
	viewport: ViewportSize,
	orientation: GraphOrientation,
): GraphLayout {
	const positions = placeNodes(nodes, viewport, orientation);
	return {
		orientation,
		positions,
		bounds: contentBounds(positions),
		camera: fitCamera(positions, viewport),
	};
}

/**
 * Tier 3 — the orientation that frames the graph largest for this viewport
 * aspect, so deep graphs flip to top-down instead of shrinking. Ties go to
 * left-to-right (prerequisites → dependents reads as the default).
 */
function bestLayout(
	nodes: LayoutInputNode[],
	viewport: ViewportSize,
): GraphLayout {
	const lr = layoutWith(nodes, viewport, "lr");
	const td = layoutWith(nodes, viewport, "td");
	return td.camera.scale > lr.camera.scale ? td : lr;
}

export function chooseOrientation(
	nodes: LayoutInputNode[],
	viewport: ViewportSize,
): GraphOrientation {
	if (!nodes.length) {
		return "lr";
	}
	return bestLayout(nodes, viewport).orientation;
}

/** Layered layout plus the camera that frames all of it. */
export function layoutDependencyGraph(
	nodes: LayoutInputNode[],
	viewport: ViewportSize,
	options: LayoutOptions = {},
): GraphLayout {
	if (!nodes.length) {
		return {
			orientation: options.orientation === "td" ? "td" : "lr",
			positions: [],
			bounds: { ...EMPTY_BOUNDS },
			camera: { ...IDENTITY_CAMERA },
		};
	}
	const requested = options.orientation ?? "auto";
	if (requested === "auto") {
		return bestLayout(nodes, viewport);
	}
	return layoutWith(nodes, viewport, requested);
}

/**
 * Where a world-space node lands on screen under `camera`. Assumes the camera
 * group is transformed as `translate(x, y) scale(scale)` about the origin.
 */
export function toScreenRect(box: NodeBox, camera: Camera): ScreenRect {
	return {
		x: camera.x + box.x * camera.scale,
		y: camera.y + box.y * camera.scale,
		width: box.width * camera.scale,
		height: box.height * camera.scale,
	};
}

/** The world-space rectangle the viewport currently shows. */
export function visibleWorldRect(
	camera: Camera,
	viewport: ViewportSize,
): ScreenRect {
	const scale =
		Number.isFinite(camera.scale) && camera.scale > 0 ? camera.scale : 1;
	return {
		x: -camera.x / scale,
		y: -camera.y / scale,
		width: usableExtent(viewport.width) / scale,
		height: usableExtent(viewport.height) / scale,
	};
}

/** A camera at `scale` whose viewport centre sits on the world point. */
export function cameraCenteredOn(
	world: { x: number; y: number },
	viewport: ViewportSize,
	scale: number,
): Camera {
	const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
	return {
		scale: safeScale,
		x: usableExtent(viewport.width) / 2 - world.x * safeScale,
		y: usableExtent(viewport.height) / 2 - world.y * safeScale,
	};
}

/** Tier 2 — below the readability threshold, drop labels and truncate titles. */
export function levelOfDetail(scale: number): LevelOfDetail {
	return scale < LABEL_LOD_SCALE ? "overview" : "detail";
}

export function panCamera(camera: Camera, dx: number, dy: number): Camera {
	return { ...camera, x: camera.x + dx, y: camera.y + dy };
}

/**
 * Zoom by `factor` while holding `focus` (viewport-relative) still. A fitted
 * camera may sit below `MIN_SCALE` — framing every node outranks the zoom
 * floor — so the bounds act as a barrier the camera cannot cross, never as a
 * magnet that would snap an already-outside scale back the other way.
 */
export function zoomCameraAt(
	camera: Camera,
	focus: { x: number; y: number },
	factor: number,
): Camera {
	if (!Number.isFinite(camera.scale) || camera.scale <= 0) {
		return { ...camera, scale: 1 };
	}
	const lower = Math.min(MIN_SCALE, camera.scale);
	const upper = Math.max(MAX_SCALE, camera.scale);
	const target = camera.scale * factor;
	const scale = Number.isFinite(target)
		? Math.min(upper, Math.max(lower, target))
		: camera.scale;
	const ratio = scale / camera.scale;
	return {
		scale,
		x: focus.x - (focus.x - camera.x) * ratio,
		y: focus.y - (focus.y - camera.y) * ratio,
	};
}

/**
 * Prerequisite → dependent edge, bowing along the layout axis so the strands
 * of a fan-in stay tellable apart.
 */
export function edgePath(
	from: NodeBox,
	to: NodeBox,
	orientation: GraphOrientation,
): string {
	if (orientation === "td") {
		const x1 = from.x + from.width / 2;
		const y1 = from.y + from.height;
		const x2 = to.x + to.width / 2;
		const y2 = to.y;
		const bow = Math.max(28, (y2 - y1) * 0.45);
		return `M ${x1} ${y1} C ${x1} ${y1 + bow}, ${x2} ${y2 - bow}, ${x2} ${y2}`;
	}
	const x1 = from.x + from.width;
	const y1 = from.y + from.height / 2;
	const x2 = to.x;
	const y2 = to.y + to.height / 2;
	const bow = Math.max(40, (x2 - x1) * 0.45);
	return `M ${x1} ${y1} C ${x1 + bow} ${y1}, ${x2 - bow} ${y2}, ${x2} ${y2}`;
}

/* ---------------------------------------------------------------------------
 * Keyboard navigation
 * ------------------------------------------------------------------------ */

export type DependencyNavAction =
	| { kind: "none" }
	| { kind: "clear" }
	| { kind: "select"; key: string }
	| { kind: "zoom"; factor: number }
	| { kind: "fit" };

/** The parts of a `KeyboardEvent` the map reads. */
export type DependencyNavKeyEvent = {
	key: string;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	isComposing?: boolean;
};

const NONE: DependencyNavAction = { kind: "none" };

const select = (key: string | null | undefined): DependencyNavAction =>
	key == null ? NONE : { kind: "select", key };

/**
 * Step `delta` places through `keys`, wrapping at both ends. With nothing
 * selected a forward step opens on the first node and a backward step on the
 * last.
 */
export function stepSelection(
	keys: readonly string[],
	selected: string | null,
	delta: number,
): string | null {
	if (!keys.length) {
		return null;
	}
	const index = selected === null ? -1 : keys.indexOf(selected);
	if (index < 0) {
		return (delta < 0 ? keys[keys.length - 1] : keys[0]) ?? null;
	}
	const next = (index + delta) % keys.length;
	return keys[next < 0 ? next + keys.length : next] ?? null;
}

/**
 * What a keydown over the graph viewport should do. Modified and composing
 * keystrokes are never claimed. Enter and Space are deliberately absent —
 * nodes handle their own activation, so intercepting them here would fire
 * selection twice.
 */
export function resolveDependencyNavAction(
	event: DependencyNavKeyEvent,
	keys: readonly string[],
	selected: string | null,
): DependencyNavAction {
	if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) {
		return NONE;
	}
	switch (event.key) {
		case "ArrowDown":
		case "ArrowRight":
			return select(stepSelection(keys, selected, 1));
		case "ArrowUp":
		case "ArrowLeft":
			return select(stepSelection(keys, selected, -1));
		case "Home":
			return select(keys[0]);
		case "End":
			return select(keys[keys.length - 1]);
		case "Escape":
			return { kind: "clear" };
		case "+":
		case "=":
			return { kind: "zoom", factor: ZOOM_STEP };
		case "-":
		case "_":
			return { kind: "zoom", factor: 1 / ZOOM_STEP };
		case "0":
			return { kind: "fit" };
		default:
			return NONE;
	}
}

/**
 * The single node that carries `tabIndex={0}`; every other node is `-1`. The
 * anchor follows the selection so Tab returns to where the user left off, and
 * falls back to the first node while nothing is selected.
 */
export function rovingAnchor(
	keys: readonly string[],
	selected: string | null,
): string | null {
	if (selected !== null && keys.includes(selected)) {
		return selected;
	}
	return keys[0] ?? null;
}

function axisPan(
	start: number,
	size: number,
	extent: number,
	margin: number,
): number {
	if (!Number.isFinite(start) || !Number.isFinite(size) || extent <= 0) {
		return 0;
	}
	const centred = (extent - size) / 2 - start;
	const slack = Math.min(margin, Math.max(0, (extent - size) / 2));
	const min = slack;
	const max = extent - size - slack;
	if (max < min) {
		return centred;
	}
	if (start < min) {
		return min - start;
	}
	if (start > max) {
		return max - start;
	}
	return 0;
}

/**
 * Camera translation that brings `rect` fully inside `viewport`. The viewport
 * clips, so the browser must not scroll a focused node into view — the camera
 * moves instead. A node larger than the viewport on an axis is centred on it.
 */
export function panIntoView(
	rect: ScreenRect,
	viewport: ViewportSize,
	margin = 24,
): { dx: number; dy: number } {
	return {
		dx: axisPan(rect.x, rect.width, viewport.width, margin),
		dy: axisPan(rect.y, rect.height, viewport.height, margin),
	};
}
