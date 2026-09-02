"use client";

/**
 * Artifacts — everything the director produced, across every room of the
 * workspace, sortable and filterable (DRV-ARTIFACTS).
 *
 * One card per entry in the durable, bytes-free corpus: kind, title,
 * owner, status and tags — never a thumbnail, because the entry carries
 * the produce recipe and not the rendered image. Filtering is local: the
 * hub returns the corpus, the page narrows it (`lib/drive/artifact-filters.ts`).
 *
 * Works against the live hub and the labeled demo world alike; before the
 * first Drive call the hub has no corpus for the workspace, which is shown
 * as an honest unbound state, not an error.
 */

import type { DriveArtifactDirectoryEntry } from "@cline/drive";
import type { AgentProfile, ShowArtifactKind } from "@cline/shared";
import {
	ArrowLeftRight,
	Camera,
	Clapperboard,
	ClipboardCheck,
	FileCode,
	Film,
	FolderOpen,
	GitBranch,
	Images,
	LayoutGrid,
	LayoutList,
	List,
	ListChecks,
	type LucideIcon,
	Network,
	RefreshCw,
	Search,
	SquareKanban,
	Workflow,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	PageEmptyState,
	PageFrame,
	PageHeader,
} from "@/components/views/page-layout";
import {
	ARTIFACT_KIND_LABELS,
	ARTIFACT_SORTS,
	type ArtifactFilters,
	type ArtifactSortKey,
	type ArtifactViewMode,
	artifactDirectoryFromReply,
	artifactFacetSets,
	DEFAULT_ARTIFACT_SORT,
	EMPTY_ARTIFACT_FILTERS,
	filterArtifacts,
	hasActiveArtifactFilters,
	isArtifactViewMode,
	isWorkspaceUnboundError,
	MEDIA_CLASS_LABELS,
} from "@/lib/drive/artifact-filters";
import {
	artifactOwnerInitials,
	artifactOwnerInk,
	artifactOwnerLabel,
} from "@/lib/drive/artifact-owner";
import { parseDriveCommandError } from "@/lib/drive/drive-client";
import {
	type DriveSection,
	driveSectionDefinition,
} from "@/lib/drive/drive-section";
import { relativeTimeLabel } from "@/lib/drive/relative-time";
import { selectRoster } from "@/lib/drive/room-state";
import { useDriveHub } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";
import { ArtifactDetailSheet } from "./artifact-detail";
import { ArtifactStatusBadge } from "./artifact-status-badge";
import { useDriveInkTheme } from "./use-drive-ink-theme";

export type ArtifactsViewProps = {
	/** Optional: lets the unbound state offer a jump to the Lobby. */
	onNavigateSection?: (section: DriveSection) => void;
};

/** Total over the kind union — a new kind must pick a glyph to compile. */
const KIND_ICON: Record<ShowArtifactKind, LucideIcon> = {
	"doc.plan": ListChecks,
	"doc.review": ClipboardCheck,
	"diagram.architecture": Workflow,
	"diagram.data_flow": ArrowLeftRight,
	"diagram.network_security": Network,
	"diagram.sequence": GitBranch,
	"walkthrough.code": FileCode,
	"walkthrough.animation": Clapperboard,
	"capture.demo_clip": Film,
	"capture.screenshot": Camera,
	"share.structured": LayoutList,
	"work.card": SquareKanban,
};

const VIEW_MODE_STORAGE_KEY = "cline.code.drive.artifacts.view.v1";
const LIVE_REFRESH_DEBOUNCE_MS = 600;

function readStoredViewMode(): ArtifactViewMode | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		const raw = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
		return isArtifactViewMode(raw) ? raw : null;
	} catch {
		return null;
	}
}

function writeStoredViewMode(mode: ArtifactViewMode): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
	} catch {
		// Session-only from here on.
	}
}

function entryKey(entry: DriveArtifactDirectoryEntry): string {
	return `${entry.roomId} ${entry.showItemId}`;
}

/** Events after which the corpus may have changed. */
function touchesArtifacts(event: {
	event: string;
	payload: Record<string, unknown>;
}): boolean {
	if (
		event.event === "drive.show.presented" ||
		event.event === "drive.show.planned"
	) {
		return true;
	}
	if (event.event !== "room.event") {
		return false;
	}
	const inner = event.payload.event;
	return (
		inner !== null &&
		typeof inner === "object" &&
		(inner as { type?: unknown }).type === "media.artifact"
	);
}

function FacetChip({
	active,
	count,
	label,
	onClick,
	title,
}: {
	active: boolean;
	count: number;
	label: string;
	onClick: () => void;
	title?: string;
}) {
	return (
		<Button
			aria-pressed={active}
			className="h-8 gap-1.5 text-xs"
			onClick={onClick}
			size="sm"
			title={title}
			type="button"
			variant={active ? "secondary" : "outline"}
		>
			<span className="truncate">{label}</span>
			<span
				className={cn(
					"rounded-sm px-1 font-mono text-[10px] tabular-nums",
					active ? "bg-background/40" : "bg-muted text-muted-foreground",
				)}
			>
				{count}
			</span>
		</Button>
	);
}

function OwnerMark({
	label,
	ink,
	className,
}: {
	label: string;
	ink: string | undefined;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-flex size-5 shrink-0 items-center justify-center rounded-full border bg-background text-[9px] font-semibold text-muted-foreground",
				className,
			)}
			style={ink ? { color: ink, borderColor: ink } : undefined}
		>
			{artifactOwnerInitials(label)}
		</span>
	);
}

type CardProps = {
	entry: DriveArtifactDirectoryEntry;
	ownerLabel: string;
	ownerInk: string | undefined;
	onStage: boolean;
	onOpen: () => void;
	now: number;
};

function ArtifactCard({
	entry,
	ownerLabel,
	ownerInk,
	onStage,
	onOpen,
	now,
}: CardProps) {
	const Icon = KIND_ICON[entry.artifactKind];
	return (
		<li className="min-w-0">
			<button
				aria-label={`Open ${entry.title}`}
				className={cn(
					"flex h-full w-full min-w-0 flex-col gap-2.5 rounded-lg border border-border bg-card px-4 py-3 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/50",
					onStage && "border-primary/50",
				)}
				onClick={onOpen}
				type="button"
			>
				<div className="flex min-w-0 items-center justify-between gap-2">
					<span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
						<Icon aria-hidden="true" className="size-3.5 shrink-0" />
						<span className="truncate">
							{ARTIFACT_KIND_LABELS[entry.artifactKind]}
						</span>
					</span>
					<ArtifactStatusBadge status={entry.status} />
				</div>
				<div
					className="line-clamp-2 text-sm font-semibold leading-snug text-foreground"
					title={entry.title}
				>
					{entry.title}
				</div>
				<div className="mt-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
					<OwnerMark ink={ownerInk} label={ownerLabel} />
					<span
						className="truncate"
						style={ownerInk ? { color: ownerInk } : undefined}
					>
						{ownerLabel}
					</span>
					<span aria-hidden="true">·</span>
					<span className="truncate font-mono">{entry.roomId}</span>
					<span className="ml-auto shrink-0">
						{relativeTimeLabel(entry.updatedAt, now)}
					</span>
				</div>
				{entry.tags.length > 0 ? (
					<div className="flex flex-wrap gap-1">
						{entry.tags.map((tag) => (
							<span
								className="rounded-sm border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
								key={tag}
							>
								{tag}
							</span>
						))}
					</div>
				) : null}
			</button>
		</li>
	);
}

function ArtifactRow({
	entry,
	ownerLabel,
	ownerInk,
	onStage,
	onOpen,
	now,
}: CardProps) {
	const Icon = KIND_ICON[entry.artifactKind];
	return (
		<li className="min-w-0">
			<button
				aria-label={`Open ${entry.title}`}
				className={cn(
					"grid w-full min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_7rem_5rem] items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 max-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem]",
					onStage && "bg-primary/5",
				)}
				onClick={onOpen}
				type="button"
			>
				<span className="flex min-w-0 items-center gap-2.5">
					<Icon
						aria-hidden="true"
						className="size-4 shrink-0 text-muted-foreground"
					/>
					<span className="min-w-0">
						<span className="block truncate text-sm font-medium text-foreground">
							{entry.title}
						</span>
						<span className="block truncate text-[11px] text-muted-foreground">
							{ARTIFACT_KIND_LABELS[entry.artifactKind]} ·{" "}
							{MEDIA_CLASS_LABELS[entry.mediaClass]}
							{entry.tags.length > 0 ? ` · ${entry.tags.join(", ")}` : ""}
						</span>
					</span>
				</span>
				<span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
					<OwnerMark ink={ownerInk} label={ownerLabel} />
					<span
						className="truncate"
						style={ownerInk ? { color: ownerInk } : undefined}
					>
						{ownerLabel}
					</span>
				</span>
				<span className="truncate font-mono text-xs text-muted-foreground max-[900px]:hidden">
					{entry.roomId}
				</span>
				<span className="flex justify-start">
					<ArtifactStatusBadge status={entry.status} />
				</span>
				<span className="text-right text-xs text-muted-foreground max-[900px]:hidden">
					{relativeTimeLabel(entry.updatedAt, now)}
				</span>
			</button>
		</li>
	);
}

function CardSkeletons({ mode }: { mode: ArtifactViewMode }) {
	const keys = ["a", "b", "c", "d", "e", "f"];
	if (mode === "list") {
		return (
			<div className="divide-y divide-border rounded-lg border border-border bg-card">
				{keys.map((key) => (
					<div className="flex items-center gap-3 px-4 py-3" key={key}>
						<Skeleton className="size-4 rounded-sm" />
						<Skeleton className="h-4 w-1/3" />
						<Skeleton className="ml-auto h-4 w-16" />
					</div>
				))}
			</div>
		);
	}
	return (
		<div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]">
			{keys.map((key) => (
				<div
					className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3"
					key={key}
				>
					<div className="flex justify-between">
						<Skeleton className="h-3 w-24" />
						<Skeleton className="h-4 w-12" />
					</div>
					<Skeleton className="h-4 w-4/5" />
					<Skeleton className="h-3 w-2/3" />
				</div>
			))}
		</div>
	);
}

type LoadState = "idle" | "loading" | "ready" | "unbound" | "error";

export function ArtifactsView({ onNavigateSection }: ArtifactsViewProps = {}) {
	const { phase, hub, source, room } = useDriveHub();
	const definition = driveSectionDefinition("artifacts");
	const theme = useDriveInkTheme();
	const [entries, setEntries] = useState<DriveArtifactDirectoryEntry[]>([]);
	const [loadState, setLoadState] = useState<LoadState>("idle");
	const [error, setError] = useState<string | null>(null);
	const [filters, setFilters] = useState<ArtifactFilters>(
		EMPTY_ARTIFACT_FILTERS,
	);
	const [sort, setSort] = useState<ArtifactSortKey>(DEFAULT_ARTIFACT_SORT);
	const [viewMode, setViewMode] = useState<ArtifactViewMode>("grid");
	const [profiles, setProfiles] = useState<AgentProfile[]>([]);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [detailOpen, setDetailOpen] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	const requestSeqRef = useRef(0);
	const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const sourceReady = phase === "live" || phase === "demo";
	const workspaceRoot = hub.workspaceRoot;
	const participants = useMemo(() => selectRoster(room), [room]);

	useEffect(() => {
		const stored = readStoredViewMode();
		if (stored) {
			setViewMode(stored);
		}
	}, []);

	const changeViewMode = useCallback((mode: ArtifactViewMode) => {
		setViewMode(mode);
		writeStoredViewMode(mode);
	}, []);

	const load = useCallback(
		async (options: { quiet?: boolean } = {}) => {
			if (!sourceReady) {
				return;
			}
			const seq = ++requestSeqRef.current;
			if (!options.quiet) {
				setLoadState("loading");
			}
			try {
				const reply = await source.command("drive.artifacts.list", {
					...(workspaceRoot ? { workspaceRoot } : {}),
				});
				if (seq !== requestSeqRef.current) {
					return;
				}
				setEntries(artifactDirectoryFromReply(reply));
				setError(null);
				setLoadState("ready");
				setNow(Date.now());
			} catch (cause) {
				if (seq !== requestSeqRef.current) {
					return;
				}
				if (isWorkspaceUnboundError(cause)) {
					setEntries([]);
					setError(null);
					setLoadState("unbound");
					return;
				}
				setError(parseDriveCommandError(cause).text);
				setLoadState("error");
			}
		},
		[source, sourceReady, workspaceRoot],
	);

	useEffect(() => {
		void load();
	}, [load]);

	// Stored appearance, so owner names wear the ink the person chose.
	useEffect(() => {
		if (!sourceReady) {
			return;
		}
		let cancelled = false;
		void source
			.agentProfiles<{ profiles?: unknown }>("get")
			.then((reply) => {
				if (cancelled) {
					return;
				}
				setProfiles(
					Array.isArray(reply?.profiles)
						? (reply.profiles as AgentProfile[])
						: [],
				);
			})
			.catch(() => {
				// Ink falls back to the resolver's per-agent default.
			});
		return () => {
			cancelled = true;
		};
	}, [source, sourceReady]);

	// The corpus grows as shows are planned and presented: refresh quietly.
	useEffect(() => {
		if (!sourceReady) {
			return;
		}
		const unsubscribe = source.subscribe((event) => {
			if (!touchesArtifacts(event)) {
				return;
			}
			if (refreshTimerRef.current) {
				clearTimeout(refreshTimerRef.current);
			}
			refreshTimerRef.current = setTimeout(() => {
				refreshTimerRef.current = null;
				void load({ quiet: true });
			}, LIVE_REFRESH_DEBOUNCE_MS);
		});
		return () => {
			unsubscribe();
			if (refreshTimerRef.current) {
				clearTimeout(refreshTimerRef.current);
				refreshTimerRef.current = null;
			}
		};
	}, [load, source, sourceReady]);

	const filtersActive = hasActiveArtifactFilters(filters);
	const facets = useMemo(
		() => artifactFacetSets(entries, filters),
		[entries, filters],
	);
	const visible = useMemo(
		() => filterArtifacts(entries, filters, sort),
		[entries, filters, sort],
	);
	const selected = useMemo(
		() => entries.find((entry) => entryKey(entry) === selectedKey) ?? null,
		[entries, selectedKey],
	);
	const ownerInkFor = useCallback(
		(ownerId: string) =>
			artifactOwnerInk({ ownerId, participants, profiles, theme }),
		[participants, profiles, theme],
	);

	const loading =
		loadState === "loading" || (loadState === "idle" && sourceReady);
	const waitingForHub = !sourceReady && phase === "connecting";
	const onStageId = room.presentedShow?.showItemId ?? null;

	const openEntry = (entry: DriveArtifactDirectoryEntry) => {
		setSelectedKey(entryKey(entry));
		setDetailOpen(true);
	};

	return (
		<PageFrame>
			<PageHeader
				actions={
					<>
						<ToggleGroup
							aria-label="Layout"
							onValueChange={(value) => {
								if (isArtifactViewMode(value)) {
									changeViewMode(value);
								}
							}}
							size="sm"
							type="single"
							value={viewMode}
							variant="outline"
						>
							<ToggleGroupItem aria-label="Grid layout" value="grid">
								<LayoutGrid aria-hidden="true" className="size-4" />
							</ToggleGroupItem>
							<ToggleGroupItem aria-label="List layout" value="list">
								<List aria-hidden="true" className="size-4" />
							</ToggleGroupItem>
						</ToggleGroup>
						<Button
							disabled={!sourceReady || loading}
							onClick={() => void load()}
							size="sm"
							type="button"
							variant="outline"
						>
							<RefreshCw
								aria-hidden="true"
								className={cn("size-3.5", loading && "animate-spin")}
							/>
							Refresh
						</Button>
					</>
				}
				description="Everything the director produced — plans, diagrams, walkthroughs, captures — kept across every room of this workspace. Filter by kind, tag or status; open one to read its recipe or present it on the Spotlight."
				icon={definition.icon}
				meta={
					entries.length > 0 ? (
						<Badge className="text-[10px]" variant="outline">
							{entries.length}
						</Badge>
					) : null
				}
				title={definition.label}
			/>

			{loadState === "error" && error ? (
				<PageEmptyState className="mb-5 flex items-center justify-between gap-3 border-destructive/40 text-destructive">
					<span className="truncate">Could not load artifacts: {error}</span>
					<Button
						onClick={() => void load()}
						size="sm"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
				</PageEmptyState>
			) : null}

			{entries.length > 0 || filtersActive ? (
				<div className="mb-5 grid gap-3">
					<div className="flex flex-wrap items-center gap-2">
						<div className="relative min-w-56 max-w-md flex-1">
							<Search
								aria-hidden="true"
								className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								aria-label="Search artifacts"
								className="h-9 pl-8 pr-8"
								onChange={(event) =>
									setFilters((current) => ({
										...current,
										query: event.target.value,
									}))
								}
								placeholder="Search title, kind, owner, room or tag"
								value={filters.query}
							/>
							{filters.query ? (
								<Button
									aria-label="Clear search"
									className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
									onClick={() =>
										setFilters((current) => ({ ...current, query: "" }))
									}
									size="icon"
									type="button"
									variant="ghost"
								>
									<X aria-hidden="true" className="size-3.5" />
								</Button>
							) : null}
						</div>
						<Select
							onValueChange={(value) => setSort(value as ArtifactSortKey)}
							value={sort}
						>
							<SelectTrigger
								aria-label="Sort artifacts"
								className="w-44"
								size="sm"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ARTIFACT_SORTS.map((option) => (
									<SelectItem key={option.id} value={option.id}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{facets.kinds.length > 0 ? (
						<fieldset className="flex min-w-0 flex-wrap gap-1.5">
							<legend className="sr-only">Filter by kind</legend>
							{facets.kinds.map((facet) => (
								<FacetChip
									active={filters.kindFacet === facet.id}
									count={facet.count}
									key={facet.id}
									label={facet.label}
									onClick={() =>
										setFilters((current) => ({
											...current,
											kindFacet:
												current.kindFacet === facet.id ? null : facet.id,
										}))
									}
								/>
							))}
						</fieldset>
					) : null}

					<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
						{facets.statuses.length > 0 ? (
							<fieldset className="flex min-w-0 flex-wrap gap-1.5">
								<legend className="sr-only">Filter by status</legend>
								{facets.statuses.map((facet) => (
									<FacetChip
										active={filters.status === facet.id}
										count={facet.count}
										key={facet.id}
										label={facet.label}
										onClick={() =>
											setFilters((current) => ({
												...current,
												status: current.status === facet.id ? null : facet.id,
											}))
										}
									/>
								))}
							</fieldset>
						) : null}
						{facets.tags.length > 0 ? (
							<fieldset className="flex min-w-0 flex-wrap gap-1.5">
								<legend className="sr-only">Filter by tag</legend>
								{facets.tags.map((facet) => (
									<FacetChip
										active={filters.tag === facet.tag}
										count={facet.count}
										key={facet.tag}
										label={`#${facet.tag}`}
										onClick={() =>
											setFilters((current) => ({
												...current,
												tag: current.tag === facet.tag ? null : facet.tag,
											}))
										}
									/>
								))}
							</fieldset>
						) : null}
					</div>

					<div className="flex min-h-7 items-center gap-2 text-xs text-muted-foreground">
						<span className="font-medium text-foreground">
							{visible.length}
						</span>
						<span>{visible.length === 1 ? "artifact" : "artifacts"}</span>
						{filtersActive ? (
							<Button
								className="h-6 px-2 text-xs"
								onClick={() => setFilters(EMPTY_ARTIFACT_FILTERS)}
								size="xs"
								type="button"
								variant="ghost"
							>
								Clear filters
							</Button>
						) : null}
					</div>
				</div>
			) : null}

			{waitingForHub ? <CardSkeletons mode={viewMode} /> : null}

			{loadState === "unbound" ? (
				<Empty className="border border-dashed border-border bg-card">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<FolderOpen aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>This workspace has no Drive room yet</EmptyTitle>
						<EmptyDescription>
							The hub binds the artifact directory the first time a Drive call
							joins in{" "}
							<span className="font-mono">
								{workspaceRoot ?? "this workspace"}
							</span>
							. Start a call and anything presented lands here — and stays after
							the room stops.
						</EmptyDescription>
					</EmptyHeader>
					{onNavigateSection ? (
						<EmptyContent>
							<Button onClick={() => onNavigateSection("lobby")} type="button">
								Go to the Lobby
							</Button>
						</EmptyContent>
					) : null}
				</Empty>
			) : null}

			{loadState === "ready" && entries.length === 0 ? (
				<Empty className="border border-dashed border-border bg-card">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Images aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>No artifacts yet</EmptyTitle>
						<EmptyDescription>
							Present a plan, diagram or walkthrough in a Drive call and it will
							show up here — and stay here after the room stops.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}

			{loading && entries.length === 0 ? (
				<CardSkeletons mode={viewMode} />
			) : null}

			{entries.length > 0 && visible.length === 0 ? (
				<PageEmptyState className="flex items-center justify-between gap-3">
					<span>No artifacts match these filters.</span>
					<Button
						onClick={() => setFilters(EMPTY_ARTIFACT_FILTERS)}
						size="sm"
						type="button"
						variant="ghost"
					>
						Clear filters
					</Button>
				</PageEmptyState>
			) : null}

			{visible.length > 0 ? (
				viewMode === "grid" ? (
					<ul className="grid list-none gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]">
						{visible.map((entry) => (
							<ArtifactCard
								entry={entry}
								key={entryKey(entry)}
								now={now}
								onOpen={() => openEntry(entry)}
								onStage={entry.showItemId === onStageId}
								ownerInk={ownerInkFor(entry.ownerParticipantId)}
								ownerLabel={artifactOwnerLabel(
									entry.ownerParticipantId,
									participants,
								)}
							/>
						))}
					</ul>
				) : (
					<ul className="list-none divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
						{visible.map((entry) => (
							<ArtifactRow
								entry={entry}
								key={entryKey(entry)}
								now={now}
								onOpen={() => openEntry(entry)}
								onStage={entry.showItemId === onStageId}
								ownerInk={ownerInkFor(entry.ownerParticipantId)}
								ownerLabel={artifactOwnerLabel(
									entry.ownerParticipantId,
									participants,
								)}
							/>
						))}
					</ul>
				)
			) : null}

			<ArtifactDetailSheet
				entry={selected}
				onOpenChange={setDetailOpen}
				open={detailOpen && selected !== null}
				participants={participants}
				profiles={profiles}
			/>
		</PageFrame>
	);
}
