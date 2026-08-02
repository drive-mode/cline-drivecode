/**
 * Presented director artifact, rendered for real inside the ScreenFrame.
 *
 * The hub always materializes a show into an SVG data URI, but that stub is
 * the *source as text* on a fixed 640×360 card — a long diagram clips and a
 * plan reads as a wall of monospace. Where the show carries the source it was
 * produced from, the screen re-renders it client-side instead (mermaid via
 * the streamdown plugin, plans via `ai-elements/plan.tsx`, code walkthroughs
 * as a file+range panel) and keeps the stub only as the fallback.
 *
 * Everything here lives on the frame's fixed-dark surface in both app themes,
 * so it styles off the frame-scoped shadcn tokens rather than app chrome.
 */

import type { MermaidConfig } from "mermaid";
import { useMemo } from "react";
import {
	type ControlsConfig,
	type MermaidErrorComponentProps,
	Streamdown,
} from "streamdown";
import {
	Plan,
	PlanAction,
	PlanContent,
	PlanDescription,
	PlanHeader,
	PlanTitle,
	PlanTrigger,
} from "@/components/ai-elements/plan";
import { createHubStreamdownPlugins } from "@/components/ai-elements/streamdown";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
	type ArtifactBodySource,
	type PlanStep,
	projectArtifactBody,
	type WalkthroughLine,
} from "./artifactBody";

/**
 * The screen is fixed-dark in both themes, so its diagrams are too. Own
 * plugin instance: the mermaid plugin keeps config on the instance, so a
 * shared one would push the screen's dark theme onto the chat's diagrams.
 */
const SCREEN_STREAMDOWN_PLUGINS = createHubStreamdownPlugins();

const SCREEN_MERMAID_CONFIG = {
	theme: "dark",
	// Mermaid measures label boxes from the font; keeping it explicit stops
	// the diagram reflowing when the app's font stack differs.
	fontFamily: "monospace",
	fontSize: 13,
} satisfies MermaidConfig;

/** A presented diagram is not a download surface — the room is watching it. */
const SCREEN_MERMAID_CONTROLS = {
	code: false,
	mermaid: false,
} satisfies ControlsConfig;

/**
 * Streamdown wraps a diagram in code-block chrome (bordered card, language
 * caption) and shrink-wraps the SVG to its natural size. On the screen the
 * artifact card is already the frame, so the chrome is stripped and every
 * wrapper down to the `<svg>` is made a stretching flex row — the diagram
 * then scales to the height the frame gives it (mermaid emits a `viewBox`,
 * so `preserveAspectRatio` letterboxes rather than distorting) instead of
 * running off the bottom of a scrolling card.
 */
const MERMAID_BLOCK_CLASS = cn(
	"flex min-h-0 flex-1",
	"[&>[data-streamdown]]:my-0! [&>[data-streamdown]]:gap-0! [&>[data-streamdown]]:rounded-none! [&>[data-streamdown]]:border-0! [&>[data-streamdown]]:bg-transparent! [&>[data-streamdown]]:p-0!",
	"[&>[data-streamdown]]:flex [&>[data-streamdown]]:min-h-0 [&>[data-streamdown]]:flex-1",
	"[&_div:has(>[data-streamdown='mermaid'])]:rounded-none! [&_div:has(>[data-streamdown='mermaid'])]:border-0! [&_div:has(>[data-streamdown='mermaid'])]:bg-transparent!",
	"[&_div:has(>[data-streamdown='mermaid'])]:flex [&_div:has(>[data-streamdown='mermaid'])]:min-h-0 [&_div:has(>[data-streamdown='mermaid'])]:flex-1",
	"[&_[data-streamdown='mermaid']]:flex [&_[data-streamdown='mermaid']]:min-h-0 [&_[data-streamdown='mermaid']]:flex-1",
	"[&_[data-streamdown='mermaid']>div]:min-h-0! [&_[data-streamdown='mermaid']>div]:flex-1",
	"[&_[role=application]]:min-h-0 [&_[role=application]]:items-stretch!",
	"[&_[role=img]]:min-h-0 [&_[role=img]]:w-full [&_[role=img]]:flex-1",
	"[&_svg]:mx-auto [&_svg]:h-full [&_svg]:max-h-full [&_svg]:min-h-0 [&_svg]:w-full",
	// Streamdown's per-block caption row — a direct child of the block, so the
	// selector cannot reach its deeper control chrome. The presenter bar
	// already names the artifact kind, so a second "mermaid" label is noise.
	"[&>[data-streamdown]>.h-8]:hidden",
);

/** Canvas `.ov-card`: an amber-edged card floating on the agent's screen. */
function ArtifactCard({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				// The frame clips, so the card caps itself and scrolls its body.
				// Sized to content by default (screen-body's grid hugs it) — plan
				// and walkthrough cards want that, so a short one stays small
				// rather than ballooning into empty space. `MermaidArtifact` opts
				// into `self-stretch` itself, where it is load-bearing (below).
				"flex max-h-full min-h-0 w-full max-w-[42rem] flex-col overflow-hidden rounded-lg border border-amber-400/45 bg-card",
				className,
			)}
		>
			{children}
		</div>
	);
}

function ArtifactCardHeader({
	eyebrow,
	title,
	trailing,
}: {
	eyebrow?: string;
	title: string;
	trailing?: React.ReactNode;
}) {
	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-white/[0.08] px-3 py-2">
			<div className="flex min-w-0 flex-1 flex-col">
				{eyebrow ? (
					<span className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-amber-300/80">
						{eyebrow}
					</span>
				) : null}
				<span className="truncate text-[13px] font-medium text-zinc-100">
					{title}
				</span>
			</div>
			{trailing}
		</div>
	);
}

/**
 * Mermaid failed to parse or the diagram runtime failed to load. Show the
 * source rather than a blank screen — an unreadable diagram is still work the
 * room can talk about, and silence looks like the call dropped.
 */
function ScreenMermaidError({ chart, error }: MermaidErrorComponentProps) {
	return (
		<div className="min-h-0 overflow-auto rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
			<p className="text-[11px] font-medium text-amber-200">
				Diagram source did not render
			</p>
			<p className="mt-0.5 font-mono text-[10px] text-zinc-400">{error}</p>
			<pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-zinc-300">
				{chart}
			</pre>
		</div>
	);
}

/** Stable prop identity — a new object per render churns the block context. */
const SCREEN_MERMAID_OPTIONS = {
	config: SCREEN_MERMAID_CONFIG,
	errorComponent: ScreenMermaidError,
};

function MermaidArtifact({ source, title }: { source: string; title: string }) {
	// Streamdown renders diagrams from a fenced block, dispatched inside its
	// own `code` component — so this goes to Streamdown directly rather than
	// through HubStreamdown, whose `code` override would swallow the fence
	// and print the source as a code block (which is what the hub stub is).
	const markdown = useMemo(
		() => `\`\`\`mermaid\n${source.trim()}\n\`\`\``,
		[source],
	);
	return (
		// `self-stretch` overrides screen-body's grid `place-items-center` (which
		// sizes grid items to content) so this card gets a definite height to
		// hand its `flex-1` body — without it the diagram's `h-full` SVG has no
		// real height to resolve against and collapses to a few px regardless of
		// how tall the frame is. Plan/walkthrough cards don't need this: their
		// content sizes itself and stretching them would leave empty space under
		// a short one.
		<ArtifactCard className="self-stretch">
			<ArtifactCardHeader eyebrow="mermaid · live render" title={title} />
			{/* The diagram fits rather than scrolls — a scrolled diagram is half
			    a diagram, and the room only sees what is on screen. */}
			<div className="flex min-h-0 flex-1 overflow-hidden p-3">
				<Streamdown
					className={MERMAID_BLOCK_CLASS}
					// Remount per source: without this the diagram node keeps the
					// last SVG it rendered, so a show whose source fails to parse
					// would keep presenting the *previous* show's diagram.
					key={source}
					controls={SCREEN_MERMAID_CONTROLS}
					mermaid={SCREEN_MERMAID_OPTIONS}
					plugins={SCREEN_STREAMDOWN_PLUGINS}
				>
					{markdown}
				</Streamdown>
			</div>
		</ArtifactCard>
	);
}

/** Canvas `.stage-plan` tick: filled for now, ringed for done/next. */
const PLAN_TICK_STYLE: Record<PlanStep["state"], string> = {
	done: "border-emerald-400/45 text-emerald-300",
	now: "border-amber-400/55 bg-amber-400/15 text-amber-200",
	next: "border-white/15 text-zinc-500",
};

const PLAN_TICK_GLYPH: Record<PlanStep["state"], string> = {
	done: "✓",
	now: "●",
	next: "○",
};

function PlanArtifact({ steps, title }: { steps: PlanStep[]; title: string }) {
	const done = steps.filter((step) => step.state === "done").length;
	return (
		<ArtifactCard className="border-amber-400/45">
			<Plan
				className="min-h-0 gap-3 overflow-hidden rounded-none border-0 bg-transparent py-3 ring-0"
				defaultOpen
			>
				<PlanHeader className="shrink-0">
					<div className="min-w-0">
						<PlanTitle className="truncate text-[13px] text-zinc-100">
							{title}
						</PlanTitle>
						<PlanDescription className="text-[11px] text-zinc-400">
							{`${done} of ${steps.length} done`}
						</PlanDescription>
					</div>
					<PlanAction>
						<PlanTrigger className="text-zinc-400 hover:text-white" />
					</PlanAction>
				</PlanHeader>
				<PlanContent className="min-h-0 overflow-auto">
					<ol className="flex flex-col gap-1">
						{steps.map((step, index) => (
							<li
								className={cn(
									"flex items-center gap-2 py-0.5 text-xs",
									step.state === "now" ? "text-zinc-100" : "text-zinc-400",
								)}
								key={`${index}-${step.label}`}
							>
								<span
									aria-hidden
									className={cn(
										"grid size-[15px] shrink-0 place-items-center rounded-full border font-mono text-[9px] leading-none",
										PLAN_TICK_STYLE[step.state],
									)}
								>
									{PLAN_TICK_GLYPH[step.state]}
								</span>
								<span className="min-w-0">{step.label}</span>
								<span className="sr-only">— {step.state}</span>
							</li>
						))}
					</ol>
				</PlanContent>
			</Plan>
		</ArtifactCard>
	);
}

function WalkthroughArtifact({
	endLine,
	lines,
	path,
	startLine,
}: {
	endLine: number;
	lines: WalkthroughLine[];
	path: string;
	startLine: number;
}) {
	const range =
		startLine === endLine ? `L${startLine}` : `L${startLine}–L${endLine}`;
	return (
		<ArtifactCard>
			<ArtifactCardHeader
				eyebrow="walkthrough.code"
				title={path}
				trailing={
					<Badge
						className="shrink-0 border-amber-400/40 font-mono text-[10px] text-amber-200"
						variant="outline"
					>
						{range}
					</Badge>
				}
			/>
			{lines.length === 0 ? (
				<p className="p-3 text-[11px] text-zinc-400">
					No snippet was produced for this range — the show carries the file and
					range only.
				</p>
			) : (
				// Long files scroll inside the panel; the frame never grows.
				<div className="min-h-0 flex-1 overflow-auto py-1.5 font-mono text-[11px] leading-[1.55]">
					{lines.map((line) => (
						<div
							className={cn(
								"grid grid-cols-[3rem_1fr] gap-2",
								line.highlighted && "bg-amber-400/10",
							)}
							key={line.number}
						>
							<span
								className={cn(
									"select-none pr-1 text-right tabular-nums",
									line.highlighted ? "text-amber-300/80" : "text-zinc-600",
								)}
							>
								{line.number}
							</span>
							<span
								className={cn(
									"whitespace-pre-wrap break-words pr-3",
									line.highlighted ? "text-zinc-100" : "text-zinc-400",
								)}
							>
								{line.text || " "}
							</span>
						</div>
					))}
				</div>
			)}
		</ArtifactCard>
	);
}

/**
 * Kind-dispatched artifact body. Anything without a client renderer keeps the
 * hub's materialized stub, so a new ShowArtifactKind still lands on screen.
 */
export function ScreenArtifact({ artifact }: { artifact: ArtifactBodySource }) {
	const body = useMemo(() => projectArtifactBody(artifact), [artifact]);
	const title = artifact.title?.trim() || "Presented artifact";

	switch (body.kind) {
		case "mermaid":
			return <MermaidArtifact source={body.source} title={title} />;
		case "plan":
			return <PlanArtifact steps={body.steps} title={body.title} />;
		case "walkthrough":
			return (
				<WalkthroughArtifact
					endLine={body.endLine}
					lines={body.lines}
					path={body.path}
					startLine={body.startLine}
				/>
			);
		case "image":
			return (
				<figure className="flex max-h-full min-h-0 w-full max-w-3xl flex-col items-center gap-3">
					{/* The screen scales the artifact; it never scrolls out of frame. */}
					<img
						// The caption is the fuller description. It renders in the
						// frame's subtitle slot rather than here, so this is the only
						// place a screen reader can pick it up on this branch.
						alt={artifact.caption?.trim() || title}
						className="min-h-0 w-full flex-1 rounded-md border border-white/10 bg-background object-contain"
						src={body.uri}
					/>
					<figcaption className="w-full shrink-0 text-center">
						<p className="text-sm font-medium text-zinc-100">{title}</p>
					</figcaption>
				</figure>
			);
		case "empty":
			return (
				<p className="max-w-sm text-center text-sm font-medium text-zinc-100">
					{title}
				</p>
			);
		default: {
			const _exhaustive: never = body;
			return _exhaustive;
		}
	}
}
