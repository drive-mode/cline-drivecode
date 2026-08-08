/**
 * Consumer Browse lite — rooms / tasks / artifacts / status lists for `?app=1`.
 * Fixtures only until hub adapters wire (B02 / NOW-IOS-GLANCE). Not full Status Hub.
 */

import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DriveBrowseSurface } from "@/lib/drive-shell";
import { cn } from "@/lib/utils";
import { ScreenArtifact } from "./ScreenArtifact";
import {
	readBrowserVisualHints,
	resolveVisualEngineParams,
	shouldAutoRenderMermaidForParams,
} from "./visualEngine";

export type BrowseLiteIndexProps = {
	onOpen: (surface: DriveBrowseSurface) => void;
	onJoin: () => void;
};

export type BrowseLitePageProps = {
	surface: DriveBrowseSurface;
	onBack: () => void;
	onJoin: () => void;
};

const INDEX: Array<{
	id: DriveBrowseSurface;
	title: string;
	detail: string;
}> = [
	{ id: "rooms", title: "Rooms", detail: "Live + quiet calls" },
	{ id: "tasks", title: "Tasks", detail: "NOW / NEXT / blocked on you" },
	{ id: "artifacts", title: "Artifacts", detail: "Diagrams, diffs, handoffs" },
	{ id: "status", title: "Status", detail: "Board · changelog · deps (lite)" },
];

const ROOMS = [
	{ title: "Auth middleware", detail: "Live · Maya + Coder", join: true },
	{ title: "Release train", detail: "Quiet · 2 agents idle", join: false },
	{ title: "Docs polish", detail: "Quiet · 1 agent", join: false },
];

const TASKS = [
	{ title: "Gate JWT refresh", detail: "NOW · Needs approval" },
	{ title: "Run auth tests", detail: "NEXT · In call" },
	{ title: "Docs pass", detail: "Queued" },
];

const ARTIFACTS = [
	{ title: "diagram · auth flow", detail: "Mermaid · tap to render on phone" },
	{ title: "diff · auth.ts", detail: "Open in Spotlight" },
	{ title: "handoff · session", detail: "Leave note" },
];

const STATUS_LENSES = [
	{ title: "Board", detail: "2 blocked · 1 running" },
	{ title: "Changelog", detail: "Today’s shipped notes" },
	{ title: "Dependency map", detail: "Simplified on phone · tap Mermaid" },
];

const DEMO_MERMAID = `flowchart TB
  Join[Join call] --> Spot[Spotlight]
  Spot --> Steer[Hold to talk]
  Steer --> Gate[Approval]
  Gate --> Leave[Leave · room keeps running]`;

function Row({
	title,
	detail,
	trailing,
	onClick,
}: {
	title: string;
	detail: string;
	trailing?: string;
	onClick?: () => void;
}) {
	const Tag = onClick ? "button" : "div";
	return (
		<Tag
			className={cn(
				"flex w-full items-center gap-3 rounded-xl border border-transparent bg-card/60 px-3 py-3 text-left",
				onClick && "hover:border-primary/35 hover:bg-primary/5",
			)}
			onClick={onClick}
			type={onClick ? "button" : undefined}
		>
			<span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-sm font-bold text-primary">
				{title.slice(0, 1).toUpperCase()}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-semibold">{title}</span>
				<span className="block truncate text-xs text-muted-foreground">
					{detail}
				</span>
			</span>
			{trailing ? (
				<span className="shrink-0 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary">
					{trailing}
				</span>
			) : onClick ? (
				<ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
			) : null}
		</Tag>
	);
}

function PageChrome({
	title,
	onBack,
	children,
}: {
	title: string;
	onBack: () => void;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col" data-slot="drive-browse-lite">
			<div className="mb-3 flex items-center gap-2">
				<Button
					aria-label="Back to Browse"
					onClick={onBack}
					size="sm"
					type="button"
					variant="ghost"
				>
					<ArrowLeftIcon className="size-4" />
					Browse
				</Button>
				<h2 className="text-lg font-bold tracking-tight">{title}</h2>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
				{children}
			</div>
		</div>
	);
}

function PhoneDiagramPreview() {
	const [box, setBox] = useState(() =>
		typeof window === "undefined"
			? { widthPx: 1024, heightPx: 768 }
			: { widthPx: window.innerWidth, heightPx: window.innerHeight },
	);
	const [armed, setArmed] = useState(false);

	useEffect(() => {
		const onResize = () =>
			setBox({
				widthPx: window.innerWidth,
				heightPx: window.innerHeight,
			});
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const params = useMemo(
		() =>
			resolveVisualEngineParams({
				...box,
				...readBrowserVisualHints(),
			}),
		[box],
	);
	const auto = shouldAutoRenderMermaidForParams("browse", params);
	const show = auto || armed;

	return (
		<div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
			<p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-amber-800 dark:text-amber-200">
				Diagram · {params.format} · {params.layout}
				{params.compactChrome ? " · app" : ""}
			</p>
			{show ? (
				<div className="min-h-[12rem]">
					<ScreenArtifact
						artifact={{
							kind: "diagram.architecture",
							title: "Auth consumer path",
							produce: {
								tool: "render_mermaid",
								args: { mermaidSource: DEMO_MERMAID },
							},
						}}
						surface="browse"
					/>
				</div>
			) : (
				<Button
					className="w-full"
					onClick={() => setArmed(true)}
					size="sm"
					type="button"
					variant="outline"
				>
					Tap to render diagram
				</Button>
			)}
		</div>
	);
}

export function DriveBrowseLiteIndex({ onJoin, onOpen }: BrowseLiteIndexProps) {
	return (
		<div data-slot="drive-browse-index">
			<h2 className="mb-1 text-2xl font-extrabold tracking-tight">Browse</h2>
			<p className="mb-4 text-sm text-muted-foreground">
				Glance without hub sprawl. Call stays Home.
			</p>
			<div className="flex flex-col gap-2">
				{INDEX.map((item) => (
					<Row
						detail={item.detail}
						key={item.id}
						onClick={() => onOpen(item.id)}
						title={item.title}
					/>
				))}
			</div>
			<p className="mt-4 text-center text-xs text-muted-foreground">
				Live room still one tap away —{" "}
				<button
					className="font-semibold text-primary underline-offset-2 hover:underline"
					onClick={onJoin}
					type="button"
				>
					Join call
				</button>
			</p>
		</div>
	);
}

export function DriveBrowseLitePage({
	onBack,
	onJoin,
	surface,
}: BrowseLitePageProps) {
	switch (surface) {
		case "rooms":
			return (
				<PageChrome onBack={onBack} title="Rooms">
					{ROOMS.map((room) => (
						<Row
							detail={room.detail}
							key={room.title}
							onClick={room.join ? onJoin : undefined}
							title={room.title}
							trailing={room.join ? "Join" : undefined}
						/>
					))}
				</PageChrome>
			);
		case "tasks":
			return (
				<PageChrome onBack={onBack} title="Tasks">
					{TASKS.map((task) => (
						<Row detail={task.detail} key={task.title} title={task.title} />
					))}
				</PageChrome>
			);
		case "artifacts":
			return (
				<PageChrome onBack={onBack} title="Artifacts">
					{ARTIFACTS.map((item) => (
						<Row detail={item.detail} key={item.title} title={item.title} />
					))}
					<PhoneDiagramPreview />
				</PageChrome>
			);
		case "status":
			return (
				<PageChrome onBack={onBack} title="Status">
					{STATUS_LENSES.map((lens) => (
						<Row detail={lens.detail} key={lens.title} title={lens.title} />
					))}
					<PhoneDiagramPreview />
					<p className="mt-2 text-xs text-muted-foreground">
						Full Status Hub stays desk-side. Phone = glance + tap Mermaid.
					</p>
				</PageChrome>
			);
		default: {
			const _exhaustive: never = surface;
			return _exhaustive;
		}
	}
}
