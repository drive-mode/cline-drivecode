"use client";

/**
 * Dependency map — the spatial lens over `buildDependencyMap`, hand-drawn SVG.
 *
 * Two surfaces mount it: the Status Hub's third lens, and the Tasks page,
 * which is the same graph plus the Plans rail (`plansRail`). One component,
 * so the two can never drift into two different maps.
 *
 * Positions and the camera come wholesale from
 * `lib/drive/dependency-graph-layout.ts` (pure, tested), highlights from
 * `lib/drive/dependency-map-model.ts`. The viewport owns panning, zooming and
 * the arrow-key contract; every node is a focusable SVG group with a button
 * role, so roving focus, a polite live region for the selection and the
 * `role="alert"` integrity banner all survive the move from HTML to SVG.
 */

import type { TeamTaskStatus } from "@cline/shared";
import {
	ArrowDown,
	ArrowRight,
	Focus,
	GitBranch,
	Maximize,
	Minus,
	Plus,
	RefreshCw,
	ShieldAlert,
	Sparkles,
} from "lucide-react";
import {
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import {
	type Camera,
	cameraCenteredOn,
	edgePath,
	fitCamera,
	type GraphOrientation,
	layoutDependencyGraph,
	levelOfDetail,
	type NodeBox,
	panCamera,
	panIntoView,
	resolveDependencyNavAction,
	rovingAnchor,
	toScreenRect,
	type ViewportSize,
	visibleWorldRect,
	ZOOM_STEP,
	zoomCameraAt,
} from "@/lib/drive/dependency-graph-layout";
import {
	buildDependencyMap,
	criticalPathKeys,
	type DependencyNode,
	dedupeEdges,
	displayName,
	EMPTY_TASKS_SNAPSHOT,
	edgeId,
	nodeAccent,
	nodeRelations,
	type PlanAccent,
	type PlanRailRow,
	parseTasksSnapshot,
	planEmphasis,
	planRailRows,
	resolveActivePlanId,
	stateNote,
	statusLabel,
	summarizeDependencyMap,
	type TasksSnapshot,
	togglePlanFilter,
	truncateLabel,
} from "@/lib/drive/dependency-map-model";
import { parseDriveCommandError } from "@/lib/drive/drive-client";
import { useDrivePrefs } from "@/lib/drive/drive-prefs";
import { useDriveHub } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * Data
 * ------------------------------------------------------------------------ */

export type TasksSnapshotState = {
	snapshot: TasksSnapshot;
	/** A request is in flight (first load or refresh). */
	loading: boolean;
	/** At least one reply has landed since the source was bound. */
	loaded: boolean;
	error: string | null;
	refresh: () => Promise<void>;
};

/**
 * Teams and annotations from `status.tasks_snapshot`, through the Drive port.
 * Requested once the hub is live (or the demo world is mounted), on every
 * explicit refresh, and again when the transport comes back.
 */
export function useTasksSnapshot(active = true): TasksSnapshotState {
	const { source, phase } = useDriveHub();
	const enabled = active && (phase === "live" || phase === "demo");
	const [snapshot, setSnapshot] = useState<TasksSnapshot>(EMPTY_TASKS_SNAPSHOT);
	const [loading, setLoading] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const requestRef = useRef(0);

	const refresh = useCallback(async () => {
		const id = ++requestRef.current;
		setLoading(true);
		setError(null);
		try {
			const reply = await source.status<unknown>("tasks_snapshot");
			if (id !== requestRef.current) {
				return;
			}
			setSnapshot(parseTasksSnapshot(reply));
			setLoaded(true);
		} catch (cause) {
			if (id !== requestRef.current) {
				return;
			}
			setError(parseDriveCommandError(cause).text);
			setLoaded(true);
		} finally {
			if (id === requestRef.current) {
				setLoading(false);
			}
		}
	}, [source]);

	useEffect(() => {
		if (!enabled) {
			requestRef.current += 1;
			setSnapshot(EMPTY_TASKS_SNAPSHOT);
			setLoaded(false);
			setError(null);
			return;
		}
		void refresh();
	}, [enabled, refresh]);

	return { snapshot, loading, loaded, error, refresh };
}

/* ---------------------------------------------------------------------------
 * Hooks
 * ------------------------------------------------------------------------ */

/** System preference OR the in-app Drive setting: either stills the camera. */
function useReducedMotion(): boolean {
	const [prefs] = useDrivePrefs();
	const [system, setSystem] = useState(false);
	useEffect(() => {
		if (
			typeof window === "undefined" ||
			typeof window.matchMedia !== "function"
		) {
			return;
		}
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		setSystem(query.matches);
		const onChange = () => setSystem(query.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);
	return system || prefs.reduceMotion;
}

/**
 * Live viewport box, so the layout targets the rectangle it will fill. Takes
 * the element rather than a ref: the graph mounts only after the loading and
 * empty states clear, and a ref object's identity never changes.
 */
function useMeasuredSize(element: HTMLElement | null): ViewportSize {
	const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 });
	useLayoutEffect(() => {
		if (!element) {
			return;
		}
		const measure = () => {
			const rect = element.getBoundingClientRect();
			setSize((current) =>
				current.width === rect.width && current.height === rect.height
					? current
					: { width: rect.width, height: rect.height },
			);
		};
		measure();
		if (typeof ResizeObserver === "undefined") {
			return;
		}
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);
	return size;
}

/* ---------------------------------------------------------------------------
 * Presentation constants
 * ------------------------------------------------------------------------ */

type Highlight = "none" | "blocked" | "critical";
type OrientationChoice = "auto" | GraphOrientation;

/** Wheel notches are finer than the button step so trackpads stay usable. */
const WHEEL_ZOOM_STEP = 1.08;
/** Pointer travel past which a viewport press is a pan, not a background click. */
const DRAG_SLOP_PX = 4;
const TITLE_MAX_CHARS = 24;
const MINIMAP = { width: 168, height: 104 };

const STATUS_DOT: Record<TeamTaskStatus, string> = {
	pending: "fill-muted-foreground",
	in_progress: "fill-primary",
	blocked: "fill-warning-solid",
	completed: "fill-success-solid",
};

const STATUS_TEXT: Record<TeamTaskStatus, string> = {
	pending: "fill-muted-foreground",
	in_progress: "fill-primary",
	blocked: "fill-warning-text",
	completed: "fill-success-text",
};

const STATUS_BADGE: Record<TeamTaskStatus, string> = {
	pending: "border-border text-muted-foreground",
	in_progress: "border-primary/40 text-primary",
	blocked: "border-warning-border text-warning-text",
	completed: "border-success-border text-success-text",
};

const LEGEND: ReadonlyArray<{ status: TeamTaskStatus; dot: string }> = [
	{ status: "blocked", dot: "bg-warning-solid" },
	{ status: "in_progress", dot: "bg-primary" },
	{ status: "pending", dot: "bg-muted-foreground" },
	{ status: "completed", dot: "bg-success-solid" },
];

const CHIP_CLASS =
	"inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-left text-[11px] text-muted-foreground outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";

/* ---------------------------------------------------------------------------
 * Sub-components
 * ------------------------------------------------------------------------ */

type SegmentedOption<T extends string> = {
	value: T;
	label?: string;
	icon?: ReactNode;
	/** Accessible name and tooltip; required when there is no label. */
	title: string;
	disabled?: boolean;
};

/** A compact single-choice control for the map toolbar. */
function Segmented<T extends string>({
	label,
	options,
	value,
	onChange,
}: {
	label: string;
	options: SegmentedOption<T>[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<fieldset className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
			<legend className="sr-only">{label}</legend>
			{options.map((option) => {
				const active = option.value === value;
				return (
					<button
						aria-label={option.title}
						aria-pressed={active}
						className={cn(
							"inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-[5px] px-2 text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40",
							active
								? "bg-primary/15 font-medium text-foreground"
								: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
						)}
						disabled={option.disabled}
						key={option.value}
						onClick={() => onChange(option.value)}
						title={option.title}
						type="button"
					>
						{option.icon}
						{option.label}
					</button>
				);
			})}
		</fieldset>
	);
}

/**
 * Plans, beside the graph rather than over it. A row is a filter, not a
 * destination: it highlights its tasks and dims the rest, and every node stays
 * focusable either way. The empty state is the load-bearing one — production
 * reaches it every time, because nothing in the team runtime carries plan
 * membership yet.
 */
function PlansRail({
	activePlanId,
	onSelect,
	rows,
}: {
	activePlanId: string | null;
	onSelect: (planId: string | null) => void;
	rows: PlanRailRow[];
}) {
	const headingId = useId();
	return (
		<aside aria-labelledby={headingId} className="p-3">
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-sm font-semibold text-foreground" id={headingId}>
					Plans
				</h3>
				{rows.length > 0 ? (
					<span className="text-xs tabular-nums text-muted-foreground">
						{rows.length}
					</span>
				) : null}
			</div>
			{rows.length === 0 ? (
				<p className="mt-2 text-xs leading-5 text-muted-foreground">
					No plans for these tasks. Plan membership comes from the task bank —
					until it reaches this map, every task is unfiled and the graph is the
					whole story.
				</p>
			) : (
				<ul className="mt-2 space-y-0.5">
					<li>
						<button
							aria-pressed={activePlanId === null}
							className={cn(
								"w-full rounded-md px-2 py-1.5 text-left text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
								activePlanId === null
									? "bg-primary/10 font-medium text-foreground"
									: "text-muted-foreground hover:bg-surface-hover",
							)}
							onClick={() => onSelect(null)}
							type="button"
						>
							All tasks
						</button>
					</li>
					{rows.map((row) => {
						const active = row.id === activePlanId;
						return (
							<li key={row.id}>
								<button
									aria-pressed={active}
									className={cn(
										"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
										active
											? "bg-primary/10 text-foreground"
											: "text-foreground hover:bg-surface-hover",
									)}
									onClick={() =>
										onSelect(togglePlanFilter(activePlanId, row.id))
									}
									title={`${row.displayId} · ${row.title}`}
									type="button"
								>
									<span
										aria-hidden="true"
										className={cn(
											"size-2.5 shrink-0 rounded-full",
											row.accent.bg,
										)}
									/>
									<span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
										{row.displayId}
									</span>
									<span className="min-w-0 flex-1 truncate">{row.title}</span>
									<span className="shrink-0 tabular-nums text-muted-foreground">
										{row.taskCount}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</aside>
	);
}

function SelectedTaskPanel({
	node,
	rows,
	activePlanId,
	byKey,
	onSelect,
	onPlan,
	onFrame,
}: {
	node: DependencyNode | null;
	rows: PlanRailRow[];
	activePlanId: string | null;
	byKey: Map<string, DependencyNode>;
	onSelect: (key: string) => void;
	onPlan: (planId: string | null) => void;
	onFrame: () => void;
}) {
	const titleOf = (key: string) => byKey.get(key)?.title ?? key;
	const relations = node ? nodeRelations(node) : null;
	const plans = node
		? rows.filter((row) => node.planIds?.includes(row.id))
		: [];
	return (
		<aside aria-label="Selected task" aria-live="polite" className="p-3">
			{node && relations ? (
				<>
					<div className="flex items-start justify-between gap-2">
						<div className="min-w-0">
							{node.displayId ? (
								<span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
									{node.displayId}
								</span>
							) : null}
							<h3 className="text-sm font-semibold leading-5 text-foreground">
								{node.title}
							</h3>
						</div>
						<Button
							aria-label="Frame this task and its neighbours"
							className="h-7 shrink-0 px-2"
							onClick={onFrame}
							size="xs"
							title="Frame this task and its neighbours"
							type="button"
							variant="outline"
						>
							<Focus aria-hidden="true" className="size-3.5" />
						</Button>
					</div>
					<div className="mt-2 flex flex-wrap items-center gap-1.5">
						<Badge
							className={cn(
								"h-5 px-1.5 text-[10px]",
								STATUS_BADGE[node.status],
							)}
							variant="outline"
						>
							{statusLabel(node)}
						</Badge>
						<Badge className="h-5 px-1.5 text-[10px]" variant="outline">
							{stateNote(node)}
						</Badge>
						{node.assignee ? (
							<Badge className="h-5 px-1.5 text-[10px]" variant="outline">
								{node.assignee}
							</Badge>
						) : null}
					</div>
					{plans.length ? (
						<div className="mt-2 flex flex-wrap gap-1.5">
							{plans.map((row) => (
								<button
									aria-pressed={row.id === activePlanId}
									className={CHIP_CLASS}
									key={row.id}
									onClick={() => onPlan(togglePlanFilter(activePlanId, row.id))}
									type="button"
								>
									<span
										aria-hidden="true"
										className={cn(
											"size-2 shrink-0 rounded-full",
											row.accent.bg,
										)}
									/>
									<span className="truncate">
										{row.displayId} · {row.title}
									</span>
								</button>
							))}
						</div>
					) : null}
					{node.description ? (
						<p className="mt-2 text-xs leading-5 text-muted-foreground">
							{node.description}
						</p>
					) : null}
					<dl className="mt-3 space-y-2 text-xs">
						<div>
							<dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
								Blocked by
							</dt>
							<dd className="mt-1 flex flex-wrap gap-1.5">
								{relations.blockedBy.length ? (
									relations.blockedBy.map((key) => (
										<button
											className={CHIP_CLASS}
											key={key}
											onClick={() => onSelect(key)}
											type="button"
										>
											<span className="truncate">{titleOf(key)}</span>
										</button>
									))
								) : (
									<span className="text-muted-foreground">Nothing</span>
								)}
								{node.missingDependencies.map((id) => (
									<span
										className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-2 py-1 text-[11px] text-destructive"
										key={`missing-${id}`}
										title="This prerequisite is not in any active team"
									>
										{id} · missing
									</span>
								))}
							</dd>
						</div>
						<div>
							<dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
								Unblocks
							</dt>
							<dd className="mt-1 flex flex-wrap gap-1.5">
								{relations.unblocks.length ? (
									relations.unblocks.map((key) => (
										<button
											className={CHIP_CLASS}
											key={key}
											onClick={() => onSelect(key)}
											type="button"
										>
											<span className="truncate">{titleOf(key)}</span>
										</button>
									))
								) : (
									<span className="text-muted-foreground">Nothing</span>
								)}
							</dd>
						</div>
					</dl>
				</>
			) : (
				<>
					<h3 className="text-sm font-semibold text-foreground">
						Select a task
					</h3>
					<p className="mt-1 text-xs leading-5 text-muted-foreground">
						Activate a node to inspect its status, prerequisites and dependents.
						Prerequisites read left to right (or top down).
					</p>
					<div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
						<span className="flex items-center gap-1">
							<KbdGroup>
								<Kbd>Tab</Kbd>
								<Kbd>←</Kbd>
								<Kbd>→</Kbd>
							</KbdGroup>
							move
						</span>
						<span className="flex items-center gap-1">
							<Kbd>Enter</Kbd> details
						</span>
						<span className="flex items-center gap-1">
							<Kbd>Esc</Kbd> clear
						</span>
						<span className="flex items-center gap-1">
							<KbdGroup>
								<Kbd>+</Kbd>
								<Kbd>−</Kbd>
								<Kbd>0</Kbd>
							</KbdGroup>
							zoom / fit
						</span>
					</div>
				</>
			)}
		</aside>
	);
}

function Minimap({
	boxes,
	byKey,
	camera,
	viewport,
	onJump,
}: {
	boxes: NodeBox[];
	byKey: Map<string, DependencyNode>;
	camera: Camera;
	viewport: ViewportSize;
	onJump: (world: { x: number; y: number }) => void;
}) {
	const mini = useMemo(() => fitCamera(boxes, MINIMAP), [boxes]);
	const visible = visibleWorldRect(camera, viewport);
	const toWorld = (event: ReactPointerEvent<SVGSVGElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		return {
			x: (event.clientX - rect.left - mini.x) / mini.scale,
			y: (event.clientY - rect.top - mini.y) / mini.scale,
		};
	};
	return (
		<svg
			aria-label="Minimap. Click to move the view."
			className="absolute right-3 top-3 cursor-pointer rounded-md border border-border bg-card/90 shadow-xs backdrop-blur-sm"
			height={MINIMAP.height}
			onPointerDown={(event) => {
				event.stopPropagation();
				event.preventDefault();
				onJump(toWorld(event));
			}}
			role="img"
			width={MINIMAP.width}
		>
			<title>Minimap</title>
			<g transform={`translate(${mini.x} ${mini.y}) scale(${mini.scale})`}>
				{boxes.map((box) => (
					<rect
						className={cn(
							byKey.get(box.key)?.status === "blocked"
								? "fill-warning-solid"
								: byKey.get(box.key)?.status === "completed"
									? "fill-success-solid/70"
									: "fill-muted-foreground/50",
						)}
						height={box.height}
						key={box.key}
						rx={6}
						width={box.width}
						x={box.x}
						y={box.y}
					/>
				))}
				<rect
					className="fill-primary/10 stroke-primary"
					height={visible.height}
					strokeWidth={1.5}
					vectorEffect="non-scaling-stroke"
					width={visible.width}
					x={visible.x}
					y={visible.y}
				/>
			</g>
		</svg>
	);
}

/* ---------------------------------------------------------------------------
 * The map
 * ------------------------------------------------------------------------ */

export type DependencyMapProps = {
	snapshot: TasksSnapshot;
	loading: boolean;
	loaded: boolean;
	error: string | null;
	onRetry?: () => void;
	/**
	 * Whether this surface carries the Plans rail. The Tasks page does; the
	 * Status Hub lens does not, so it keeps the graph at its own width.
	 */
	plansRail?: boolean;
	className?: string;
};

export function DependencyMap({
	snapshot,
	loading,
	loaded,
	error,
	onRetry,
	plansRail = false,
	className,
}: DependencyMapProps) {
	const graph = useMemo(
		() =>
			buildDependencyMap(
				snapshot.teams.map((team) => ({
					teamId: team.teamId,
					tasks: team.tasks,
				})),
				snapshot.annotations ?? undefined,
			),
		[snapshot],
	);
	const [selected, setSelected] = useState<string | null>(null);
	const [planFilter, setPlanFilter] = useState<string | null>(null);
	const [highlight, setHighlight] = useState<Highlight>("none");
	const [orientationChoice, setOrientationChoice] =
		useState<OrientationChoice>("auto");
	const [camera, setCamera] = useState<Camera | null>(null);
	const [animate, setAnimate] = useState(false);
	const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);
	const nodeRefs = useRef(new Map<string, SVGGElement>());
	const dragRef = useRef<{
		pointerId: number;
		x: number;
		y: number;
		moved: boolean;
	} | null>(null);
	const viewport = useMeasuredSize(viewportEl);
	const reducedMotion = useReducedMotion();
	const markerId = useId();
	const headingId = useId();

	const keys = useMemo(() => graph.nodes.map((node) => node.key), [graph]);
	const byKey = useMemo(
		() => new Map(graph.nodes.map((node) => [node.key, node])),
		[graph],
	);
	const railRows = useMemo(() => planRailRows(graph.plans), [graph]);
	const activePlanId = resolveActivePlanId(railRows, planFilter);
	const edges = useMemo(() => dedupeEdges(graph.edges), [graph]);
	const summary = useMemo(() => summarizeDependencyMap(graph), [graph]);
	const critical = useMemo(() => criticalPathKeys(graph), [graph]);
	const criticalNodes = useMemo(() => new Set(critical), [critical]);
	const criticalEdges = useMemo(() => {
		const set = new Set<string>();
		for (let index = 1; index < critical.length; index += 1) {
			set.add(edgeId(critical[index - 1] ?? "", critical[index] ?? ""));
		}
		return set;
	}, [critical]);
	const blockedNodes = useMemo(
		() =>
			new Set(
				graph.nodes
					.filter((node) => node.status === "blocked")
					.map((node) => node.key),
			),
		[graph],
	);
	const blockedEdges = useMemo(
		() =>
			new Set(
				edges
					.filter((edge) => blockedNodes.has(edge.to))
					.map((edge) => edgeId(edge.from, edge.to)),
			),
		[blockedNodes, edges],
	);

	const layout = useMemo(
		() =>
			layoutDependencyGraph(
				graph.nodes.map((node) => ({
					key: node.key,
					title: node.title,
					layer: node.layer,
				})),
				viewport,
				{ orientation: orientationChoice },
			),
		[graph, orientationChoice, viewport],
	);
	const boxes = useMemo(
		() => new Map(layout.positions.map((box) => [box.key, box])),
		[layout],
	);
	/**
	 * Where every node sits, as a value. `layout` is a fresh object on every
	 * snapshot; resetting the camera on its identity would yank the view back
	 * to Fit on every refresh. Nothing has moved unless a position changed.
	 */
	const layoutSignature = useMemo(
		() =>
			`${layout.orientation}|${layout.positions
				.map((box) => `${box.key}@${Math.round(box.x)},${Math.round(box.y)}`)
				.join("|")}`,
		[layout],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the signature is the trigger, not a value the body reads.
	useEffect(() => {
		setCamera(null);
	}, [layoutSignature]);
	// A selection the snapshot dropped must not linger in the panel.
	useEffect(() => {
		setSelected((current) =>
			current !== null && !byKey.has(current) ? null : current,
		);
	}, [byKey]);

	const activeCamera = camera ?? layout.camera;
	const lod = levelOfDetail(activeCamera.scale);

	const fitView = useCallback(() => {
		setAnimate(true);
		setCamera(null);
	}, []);

	const zoomBy = useCallback(
		(factor: number, focus?: { x: number; y: number }) => {
			const at = focus ?? { x: viewport.width / 2, y: viewport.height / 2 };
			setAnimate(!focus);
			setCamera((current) =>
				zoomCameraAt(current ?? layout.camera, at, factor),
			);
		},
		[layout, viewport.height, viewport.width],
	);

	/**
	 * React registers `wheel` passively at the root, so `preventDefault` from
	 * an `onWheel` prop is ignored and the page scrolls out from under the
	 * zoom. The listener has to be native and explicitly non-passive.
	 */
	useEffect(() => {
		if (!viewportEl) {
			return;
		}
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			const rect = viewportEl.getBoundingClientRect();
			zoomBy(event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP, {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
			});
		};
		viewportEl.addEventListener("wheel", onWheel, { passive: false });
		return () => viewportEl.removeEventListener("wheel", onWheel);
	}, [viewportEl, zoomBy]);

	/**
	 * Bring a node inside the frame on focus, so "focused implies visible"
	 * holds however focus arrived. The viewport clips, so the browser must not
	 * scroll; the camera moves instead.
	 */
	const bringIntoView = useCallback(
		(key: string) => {
			const box = boxes.get(key);
			if (!box || viewport.width <= 0) {
				return;
			}
			setCamera((current) => {
				const base = current ?? layout.camera;
				const { dx, dy } = panIntoView(toScreenRect(box, base), viewport);
				if (dx === 0 && dy === 0) {
					return current;
				}
				setAnimate(true);
				return panCamera(base, dx, dy);
			});
		},
		[boxes, layout, viewport],
	);

	const selectNode = useCallback((key: string) => {
		setSelected(key);
		nodeRefs.current.get(key)?.focus({ preventScroll: true });
	}, []);

	const frameSelection = useCallback(() => {
		if (!selected) {
			return;
		}
		const node = byKey.get(selected);
		if (!node) {
			return;
		}
		const { blockedBy, unblocks } = nodeRelations(node);
		setAnimate(true);
		setCamera(
			fitCamera(layout.positions, viewport, [
				selected,
				...blockedBy,
				...unblocks,
			]),
		);
	}, [byKey, layout.positions, selected, viewport]);

	const onViewportKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
		const action = resolveDependencyNavAction(
			event.nativeEvent,
			keys,
			selected,
		);
		switch (action.kind) {
			case "none":
				return;
			case "clear":
				event.preventDefault();
				setSelected(null);
				return;
			case "select":
				event.preventDefault();
				selectNode(action.key);
				return;
			case "zoom":
				event.preventDefault();
				zoomBy(action.factor);
				return;
			case "fit":
				event.preventDefault();
				fitView();
				return;
			default: {
				const _exhaustive: never = action;
				return _exhaustive;
			}
		}
	};

	const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
		if (event.button !== 0 || dragRef.current) {
			return;
		}
		if ((event.target as Element).closest("[data-node]")) {
			return;
		}
		dragRef.current = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			moved: false,
		};
		setAnimate(false);
		event.currentTarget.setPointerCapture(event.pointerId);
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}
		if (event.buttons === 0) {
			dragRef.current = null;
			return;
		}
		const dx = event.clientX - drag.x;
		const dy = event.clientY - drag.y;
		if (
			!drag.moved &&
			Math.abs(dx) < DRAG_SLOP_PX &&
			Math.abs(dy) < DRAG_SLOP_PX
		) {
			return;
		}
		drag.moved = true;
		drag.x = event.clientX;
		drag.y = event.clientY;
		setCamera((current) => panCamera(current ?? layout.camera, dx, dy));
	};

	const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
		const drag = dragRef.current;
		dragRef.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (drag && !drag.moved) {
			setSelected(null);
		}
	};

	/**
	 * One card for every state: the body on the left, and a right column that
	 * stacks the Plans rail (on a surface that owns one) over the selection
	 * panel. The rail outlives the graph — a cold hub has no tasks *and* no
	 * plans, and dropping the rail with the nodes would hide the page's one
	 * honest statement about plan membership behind a message about tasks.
	 */
	const shell = (body: ReactNode, panel: ReactNode | null) => (
		<section
			aria-labelledby={headingId}
			className={cn(
				"overflow-hidden rounded-lg border border-border bg-card",
				className,
			)}
		>
			<h2 className="sr-only" id={headingId}>
				Dependency map
			</h2>
			<div className="flex max-[1100px]:flex-col">
				<div className="min-w-0 flex-1">{body}</div>
				{plansRail || panel ? (
					<div className="flex w-72 shrink-0 flex-col divide-y divide-border border-l border-border max-[1100px]:w-full max-[1100px]:border-l-0 max-[1100px]:border-t">
						{plansRail ? (
							<PlansRail
								activePlanId={activePlanId}
								onSelect={setPlanFilter}
								rows={railRows}
							/>
						) : null}
						{panel}
					</div>
				) : null}
			</div>
		</section>
	);

	/* A refresh is not an empty graph: `loading` goes true on every re-request,
	 * and unmounting the viewport for it would drop the camera and focus. */
	if (!loaded && !graph.nodes.length) {
		return shell(
			<div
				aria-busy="true"
				aria-label="Loading dependency map"
				className="space-y-3 p-4"
				role="status"
			>
				<Skeleton className="h-4 w-48" />
				<Skeleton className="h-[min(56vh,540px)] min-h-72 w-full rounded-md" />
			</div>,
			null,
		);
	}
	if (error && !graph.nodes.length) {
		return shell(
			<div
				className="m-4 flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
				role="alert"
			>
				<div>
					<p className="font-medium text-destructive">
						The dependency map could not be loaded.
					</p>
					<p className="mt-0.5 text-muted-foreground">{error}</p>
				</div>
				{onRetry ? (
					<Button onClick={onRetry} size="sm" type="button" variant="outline">
						<RefreshCw aria-hidden="true" className="size-3.5" />
						Try again
					</Button>
				) : null}
			</div>,
			null,
		);
	}
	if (!graph.nodes.length) {
		return shell(
			<Empty className="min-h-72 rounded-none border-0">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<GitBranch aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No active team tasks</EmptyTitle>
					<EmptyDescription>
						Dependency maps appear when a team session is running and its tasks
						declare what they depend on.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>,
			null,
		);
	}

	const selectedNode = selected ? (byKey.get(selected) ?? null) : null;
	const relations = selectedNode ? nodeRelations(selectedNode) : null;
	const anchor = rovingAnchor(keys, selected);
	const highlightNodes =
		highlight === "critical"
			? criticalNodes
			: highlight === "blocked"
				? blockedNodes
				: null;
	const highlightEdges =
		highlight === "critical"
			? criticalEdges
			: highlight === "blocked"
				? blockedEdges
				: null;
	const cameraStyle: CSSProperties = {
		transform: `translate(${activeCamera.x}px, ${activeCamera.y}px) scale(${activeCamera.scale})`,
		transformOrigin: "0 0",
		transition: animate && !reducedMotion ? "transform 160ms ease-out" : "none",
	};

	const nodeEmphasis = (node: DependencyNode) => {
		if (planEmphasis(node.planIds, activePlanId) === "dim") {
			return "dim";
		}
		if (highlightNodes && !highlightNodes.has(node.key)) {
			return "dim";
		}
		return "none";
	};

	return shell(
		<>
			<div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
				<p className="min-w-0 text-xs text-muted-foreground">
					<span className="font-medium tabular-nums text-foreground">
						{summary.tasks}
					</span>{" "}
					tasks ·{" "}
					<span className="tabular-nums text-warning-text">
						{summary.blocked}
					</span>{" "}
					blocked ·{" "}
					<span className="tabular-nums text-success-text">
						{summary.ready}
					</span>{" "}
					ready
					{loading ? (
						<span className="ml-2 inline-flex items-center gap-1">
							<RefreshCw
								aria-hidden="true"
								className={cn(
									"size-3",
									!reducedMotion && "animate-spin motion-reduce:animate-none",
								)}
							/>
							refreshing
						</span>
					) : null}
				</p>
				<span className="flex-1" />
				<Segmented
					label="Highlight"
					onChange={setHighlight}
					options={[
						{ value: "none", label: "All", title: "No highlight" },
						{
							value: "blocked",
							label: "Blocked",
							icon: <ShieldAlert aria-hidden="true" className="size-3.5" />,
							title: "Highlight blocked work",
						},
						{
							value: "critical",
							label: "Critical path",
							icon: <Sparkles aria-hidden="true" className="size-3.5" />,
							title: "Highlight the critical path",
							disabled: critical.length < 2,
						},
					]}
					value={highlight}
				/>
				<Segmented
					label="Orientation"
					onChange={setOrientationChoice}
					options={[
						{ value: "auto", label: "Auto", title: "Automatic orientation" },
						{
							value: "lr",
							icon: <ArrowRight aria-hidden="true" className="size-3.5" />,
							title: "Left to right",
						},
						{
							value: "td",
							icon: <ArrowDown aria-hidden="true" className="size-3.5" />,
							title: "Top down",
						},
					]}
					value={orientationChoice}
				/>
				<div className="flex shrink-0 items-center gap-1">
					<Button
						aria-label="Zoom out"
						className="h-7 w-7 px-0"
						onClick={() => zoomBy(1 / ZOOM_STEP)}
						size="xs"
						type="button"
						variant="outline"
					>
						<Minus aria-hidden="true" className="size-3.5" />
					</Button>
					{/* Live, or the zoom and Fit buttons are silent to a screen reader. */}
					<span
						aria-live="polite"
						className="min-w-12 text-center text-xs tabular-nums text-muted-foreground"
					>
						{Math.round(activeCamera.scale * 100)}%
					</span>
					<Button
						aria-label="Zoom in"
						className="h-7 w-7 px-0"
						onClick={() => zoomBy(ZOOM_STEP)}
						size="xs"
						type="button"
						variant="outline"
					>
						<Plus aria-hidden="true" className="size-3.5" />
					</Button>
					<Button
						className="h-7 px-2 text-xs"
						onClick={fitView}
						size="xs"
						title="Reset the view so every task is framed"
						type="button"
						variant="outline"
					>
						<Maximize aria-hidden="true" className="size-3.5" />
						Fit
					</Button>
				</div>
			</div>

			{summary.cycles || summary.missingReferences ? (
				<div
					className="flex items-start gap-2 border-b border-destructive/40 bg-destructive/5 px-3 py-2 text-xs"
					role="alert"
				>
					<ShieldAlert
						aria-hidden="true"
						className="mt-0.5 size-3.5 shrink-0 text-destructive"
					/>
					<span>
						<strong className="text-destructive">
							Dependency integrity warning.
						</strong>{" "}
						{summary.cycles
							? `${summary.cycles} cycle${summary.cycles === 1 ? "" : "s"} detected. `
							: ""}
						{summary.missingReferences
							? `${summary.missingReferences} missing reference${summary.missingReferences === 1 ? "" : "s"} detected.`
							: ""}
					</span>
				</div>
			) : null}

			{/*
			 * The viewport is the camera surface: pointer panning and the
			 * arrow-key contract belong to it, while everything selectable
			 * inside is a focusable node. `tabIndex={-1}` only lets a
			 * background click park focus so the arrow keys keep arriving.
			 */}
			<section
				aria-label="Task dependency graph. Drag to pan, wheel to zoom, arrow keys to move between tasks."
				className="relative h-[min(60vh,600px)] min-h-80 min-w-0 flex-1 cursor-grab touch-none select-none overflow-hidden bg-background/60 outline-none active:cursor-grabbing"
				onKeyDown={onViewportKeyDown}
				onLostPointerCapture={(event) => {
					if (dragRef.current?.pointerId === event.pointerId) {
						dragRef.current = null;
					}
				}}
				onPointerCancel={() => {
					dragRef.current = null;
				}}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				ref={setViewportEl}
				tabIndex={-1}
			>
				<svg
					aria-label="Tasks in dependency order"
					className="absolute inset-0 size-full"
				>
					<title>Dependency map</title>
					<defs>
						<marker
							id={`${markerId}-arrow`}
							markerHeight="6"
							markerWidth="6"
							orient="auto-start-reverse"
							refX="9"
							refY="5"
							viewBox="0 0 10 10"
						>
							<path
								className="fill-muted-foreground/60"
								d="M 0 0 L 10 5 L 0 10 z"
							/>
						</marker>
						<marker
							id={`${markerId}-arrow-hot`}
							markerHeight="6"
							markerWidth="6"
							orient="auto-start-reverse"
							refX="9"
							refY="5"
							viewBox="0 0 10 10"
						>
							<path className="fill-primary" d="M 0 0 L 10 5 L 0 10 z" />
						</marker>
						<marker
							id={`${markerId}-arrow-warn`}
							markerHeight="6"
							markerWidth="6"
							orient="auto-start-reverse"
							refX="9"
							refY="5"
							viewBox="0 0 10 10"
						>
							<path className="fill-warning-solid" d="M 0 0 L 10 5 L 0 10 z" />
						</marker>
					</defs>
					<g style={cameraStyle}>
						<g>
							{edges.map((edge) => {
								const from = boxes.get(edge.from);
								const to = boxes.get(edge.to);
								if (!from || !to) {
									return null;
								}
								const id = edgeId(edge.from, edge.to);
								const hot = relations?.incident.has(id) ?? false;
								const lit = highlightEdges?.has(id) ?? false;
								const cyclic = Boolean(
									byKey.get(edge.from)?.inCycle && byKey.get(edge.to)?.inCycle,
								);
								const dim =
									(relations !== null && !hot) ||
									(highlightEdges !== null && !lit && !hot);
								const tone = hot
									? "stroke-primary"
									: lit
										? highlight === "blocked"
											? "stroke-warning-solid"
											: "stroke-primary"
										: cyclic
											? "stroke-destructive/70"
											: "stroke-muted-foreground/35";
								const marker = hot
									? `url(#${markerId}-arrow-hot)`
									: lit && highlight === "blocked"
										? `url(#${markerId}-arrow-warn)`
										: lit
											? `url(#${markerId}-arrow-hot)`
											: `url(#${markerId}-arrow)`;
								return (
									<path
										className={cn("fill-none", tone, dim && "opacity-30")}
										d={edgePath(from, to, layout.orientation)}
										key={id}
										markerEnd={marker}
										strokeDasharray={cyclic ? "4 3" : undefined}
										strokeWidth={hot || lit ? 2.25 : 1.5}
										// A fitted deep graph sits near a third of full size,
										// where a scaled stroke thins to half a pixel. Edges
										// hold their screen weight at every zoom.
										vectorEffect="non-scaling-stroke"
									/>
								);
							})}
						</g>

						{/* Artifact labels are the first thing to go at overview scale. */}
						{lod === "detail" ? (
							<g>
								{edges.map((edge) => {
									const from = boxes.get(edge.from);
									const to = boxes.get(edge.to);
									if (!from || !to || !edge.artifactLabel) {
										return null;
									}
									const x = (from.x + from.width / 2 + to.x + to.width / 2) / 2;
									const y =
										(from.y + from.height / 2 + to.y + to.height / 2) / 2;
									return (
										<text
											className="fill-muted-foreground stroke-card"
											dominantBaseline="middle"
											fontSize={10}
											key={edgeId(edge.from, edge.to)}
											paintOrder="stroke"
											strokeLinejoin="round"
											strokeWidth={4}
											textAnchor="middle"
											x={x}
											y={y}
										>
											{edge.artifactLabel}
										</text>
									);
								})}
							</g>
						) : null}

						{graph.nodes.map((node) => {
							const box = boxes.get(node.key);
							if (!box) {
								return null;
							}
							const isSelected = selected === node.key;
							const accent: PlanAccent | undefined = nodeAccent(
								node.planIds,
								railRows,
								activePlanId,
							);
							const emphasis = nodeEmphasis(node);
							const lit = highlightNodes?.has(node.key) ?? false;
							const label = displayName(node);
							const title = truncateLabel(node.title, TITLE_MAX_CHARS);
							const showId = Boolean(node.displayId);
							const detail = lod === "detail";
							const titleY = !detail ? 30 : showId ? 35 : 28;
							const statusY = !detail ? 48 : showId ? 51 : 46;
							const frameTone = isSelected
								? "stroke-primary"
								: lit && highlight === "blocked"
									? "stroke-warning-solid"
									: lit
										? "stroke-primary/80"
										: node.inCycle
											? "stroke-destructive/60"
											: node.status === "blocked"
												? "stroke-warning-border"
												: "stroke-border";
							return (
								// biome-ignore lint/a11y/useSemanticElements: SVG has no button element; the group carries the role.
								<g
									aria-label={`${label}. ${statusLabel(node)}, ${stateNote(node)}.`}
									aria-pressed={isSelected}
									className={cn(
										"cursor-pointer outline-none transition-opacity [&:focus-visible>.node-frame]:stroke-ring [&:focus-visible>.node-frame]:[stroke-width:3px] [&:hover>.node-frame]:stroke-foreground/40",
										emphasis === "dim" && "opacity-40",
									)}
									data-node={node.key}
									id={`dependency-${node.key}`}
									key={node.key}
									onClick={(event) => {
										event.stopPropagation();
										selectNode(node.key);
									}}
									onFocus={() => bringIntoView(node.key)}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											event.stopPropagation();
											selectNode(node.key);
										}
									}}
									ref={(element) => {
										if (element) {
											nodeRefs.current.set(node.key, element);
										} else {
											nodeRefs.current.delete(node.key);
										}
									}}
									role="button"
									tabIndex={node.key === anchor ? 0 : -1}
									transform={`translate(${box.x} ${box.y})`}
								>
									<title>{label}</title>
									<rect
										className={cn(
											"node-frame transition-[stroke]",
											isSelected ? "fill-primary/10" : "fill-card",
											frameTone,
										)}
										height={box.height}
										rx={10}
										strokeWidth={isSelected || lit ? 2 : 1}
										vectorEffect="non-scaling-stroke"
										width={box.width}
									/>
									{accent ? (
										<rect
											className={accent.fill}
											height={box.height - 12}
											rx={2}
											width={4}
											x={5}
											y={6}
										/>
									) : null}
									{showId && detail ? (
										<text
											className="fill-muted-foreground font-mono"
											fontSize={9.5}
											letterSpacing={0.6}
											x={16}
											y={19}
										>
											{node.displayId?.toUpperCase()}
										</text>
									) : null}
									<text
										className="fill-foreground font-semibold"
										fontSize={detail ? 12 : 13}
										x={16}
										y={titleY}
									>
										{title}
									</text>
									<circle
										className={STATUS_DOT[node.status]}
										cx={19.5}
										cy={statusY - 3.5}
										r={detail ? 3 : 4}
									/>
									<text
										className={cn(STATUS_TEXT[node.status])}
										fontSize={detail ? 9.5 : 11}
										letterSpacing={0.5}
										x={detail ? 27 : 28}
										y={statusY}
									>
										{statusLabel(node).toUpperCase()}
										{detail ? (
											<tspan className="fill-muted-foreground">
												{` · ${stateNote(node)}`}
											</tspan>
										) : null}
									</text>
								</g>
							);
						})}
					</g>
				</svg>

				<div
					aria-hidden="true"
					className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card/90 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground backdrop-blur-sm"
				>
					{LEGEND.map((entry) => (
						<span className="flex items-center gap-1" key={entry.status}>
							<span className={cn("size-1.5 rounded-full", entry.dot)} />
							{entry.status.replace("_", " ")}
						</span>
					))}
					<span>{layout.orientation === "lr" ? "→ depends" : "↓ depends"}</span>
				</div>

				{graph.nodes.length > 1 ? (
					<Minimap
						boxes={layout.positions}
						byKey={byKey}
						camera={activeCamera}
						onJump={(world) => {
							setAnimate(true);
							setCamera(cameraCenteredOn(world, viewport, activeCamera.scale));
						}}
						viewport={viewport}
					/>
				) : null}
			</section>
		</>,
		<SelectedTaskPanel
			activePlanId={activePlanId}
			byKey={byKey}
			node={selectedNode}
			onFrame={frameSelection}
			onPlan={setPlanFilter}
			onSelect={selectNode}
			rows={railRows}
		/>,
	);
}
