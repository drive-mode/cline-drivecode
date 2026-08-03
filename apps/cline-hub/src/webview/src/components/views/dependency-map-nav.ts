/**
 * Roving focus and camera-follow for the Status Hub dependency graph.
 *
 * Kept out of `dependency-map.tsx` because the hub webview suite runs under
 * `environment: "node"` and only collects `src/**\/*.test.ts` — a component
 * test cannot exist here, so the keyboard contract the graph inherited from
 * the card grid (Tab → arrows → Enter/Space → Escape → Home/End) has to live
 * in a module the suite can import. The component imports the same functions;
 * nothing here is re-implemented on either side.
 */

import type { ScreenRect, ViewportSize } from "./dependency-graph-layout";

export type DependencyNavAction =
	| { kind: "none" }
	| { kind: "clear" }
	| { kind: "select"; key: string };

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
 * Step `delta` places through `keys`, wrapping at both ends.
 *
 * With nothing selected a forward step opens on the first node and a backward
 * step on the last. The card grid clamped an empty selection to index 0 for
 * both directions, so ArrowUp from cold skipped past the head of the list.
 */
export function stepSelection(
	keys: readonly string[],
	selected: string | null,
	delta: number,
): string | null {
	if (!keys.length) return null;
	const index = selected === null ? -1 : keys.indexOf(selected);
	if (index < 0) return (delta < 0 ? keys[keys.length - 1] : keys[0]) ?? null;
	const next = (index + delta) % keys.length;
	return keys[next < 0 ? next + keys.length : next] ?? null;
}

/**
 * What a keydown over the graph viewport should do.
 *
 * Modified and composing keystrokes are never claimed: the host owns
 * Ctrl/Cmd/Alt chords, and an IME composition must reach the input method
 * intact. Enter and Space are deliberately absent — nodes are real `<button>`
 * elements, so their native activation already opens the detail panel, and
 * intercepting the keys here would fire selection twice.
 */
export function resolveDependencyNavAction(
	event: DependencyNavKeyEvent,
	keys: readonly string[],
	selected: string | null,
): DependencyNavAction {
	if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing)
		return NONE;
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
		default:
			return NONE;
	}
}

/**
 * The single node that carries `tabIndex={0}`; every other node is `-1`.
 *
 * Forty-two tab stops is not navigation, it is an obstacle course — one stop
 * lands Tab on the graph and hands the rest to the arrow keys. The anchor
 * follows the selection so Tab returns to where the user left off, and falls
 * back to the first node while nothing is selected (or when the selection
 * points at a node the latest snapshot dropped).
 */
export function rovingAnchor(
	keys: readonly string[],
	selected: string | null,
): string | null {
	if (selected !== null && keys.includes(selected)) return selected;
	return keys[0] ?? null;
}

/**
 * Camera translation that brings `rect` fully inside `viewport`.
 *
 * Keyboard selection cannot lean on the browser scrolling a node into view:
 * the viewport clips with `overflow: hidden`, and a scroll there would shift
 * the content out from under the camera transform and break the fit
 * guarantee. Focus is taken with `preventScroll`, and the camera moves
 * instead. A node larger than the viewport on an axis is centred on it.
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

function axisPan(
	start: number,
	size: number,
	extent: number,
	margin: number,
): number {
	if (!Number.isFinite(start) || !Number.isFinite(size) || extent <= 0)
		return 0;
	const centred = (extent - size) / 2 - start;
	const slack = Math.min(margin, Math.max(0, (extent - size) / 2));
	const min = slack;
	const max = extent - size - slack;
	if (max < min) return centred;
	if (start < min) return min - start;
	if (start > max) return max - start;
	return 0;
}
