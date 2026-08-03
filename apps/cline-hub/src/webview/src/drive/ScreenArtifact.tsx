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
	type AnimationPanel,
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
 * Before/after animation CSS, lifted from the demo canvas's `.stage-anim`
 * composition (`drive-product-demo.html`, the a3-bug beat) so the product and
 * the demo explain a change with one grammar rather than two.
 *
 * Every rule runs ONCE for `--screen-anim-total` and holds its end state:
 * a restart of the flash would read like the bug came back. The canvas binds
 * that duration to its narration clip; the product has no narration clock to
 * bind (ADR-0017 is deferred behind this slice), so the duration is fixed and
 * the keyframe percentages are the canvas's, unchanged.
 *
 * Windows: 0–48% "every beat, the whole page rebuilds" (BEFORE flashes through
 * three rebuild reps, AFTER dimmed); 48–58% focus crossfade; 56–82% the signal
 * chip glows on a still AFTER; 76–84% the entering rows land once; then hold.
 *
 * React 19 hoists and de-dupes this by `href`, so it is emitted next to the
 * only component that uses it instead of in the app's global sheet.
 */
const SCREEN_ANIMATION_CSS = `
.screen-anim { --screen-anim-total: 9s; }
.screen-anim-panel { animation-duration: var(--screen-anim-total); animation-timing-function: linear; animation-iteration-count: 1; animation-fill-mode: forwards; }
.screen-anim-panel.is-before { animation-name: screen-anim-before-focus; }
.screen-anim-panel.is-after { animation-name: screen-anim-after-focus; }
@keyframes screen-anim-before-focus { 0%, 48% { opacity: 1; } 58%, 100% { opacity: .45; } }
@keyframes screen-anim-after-focus { 0%, 48% { opacity: .45; } 58%, 100% { opacity: 1; } }

.screen-anim-tick { animation-duration: var(--screen-anim-total); animation-timing-function: linear; animation-iteration-count: 1; animation-fill-mode: forwards; }
.is-before .screen-anim-tick { animation-name: screen-anim-tick-before; }
.is-after .screen-anim-tick { animation-name: screen-anim-tick-after; }
@keyframes screen-anim-tick-before {
  0%, 1% { transform: scale(1); opacity: .55; }
  3% { transform: scale(1.4); opacity: 1; }
  8%, 16% { transform: scale(1); opacity: .55; }
  18% { transform: scale(1.4); opacity: 1; }
  23%, 31% { transform: scale(1); opacity: .55; }
  33% { transform: scale(1.4); opacity: 1; }
  38%, 100% { transform: scale(1); opacity: .55; }
}
@keyframes screen-anim-tick-after {
  0%, 55% { transform: scale(1); opacity: .55; }
  58% { transform: scale(1.4); opacity: 1; }
  63%, 76% { transform: scale(1); opacity: .55; }
  79% { transform: scale(1.4); opacity: 1; }
  84%, 100% { transform: scale(1); opacity: .55; }
}

/* BEFORE: every row blinks out and re-enters together — one shared keyframe,
   zero stagger, three reps. That simultaneity IS the bug. */
.is-before .screen-anim-row { animation: screen-anim-remount var(--screen-anim-total) cubic-bezier(.22,.61,.36,1) 1 forwards; }
@keyframes screen-anim-remount {
  0%, 2% { opacity: 1; transform: translateY(0); }
  4%, 8% { opacity: 0; transform: translateY(7px); }
  13%, 17% { opacity: 1; transform: translateY(0); }
  19%, 23% { opacity: 0; transform: translateY(7px); }
  28%, 32% { opacity: 1; transform: translateY(0); }
  34%, 38% { opacity: 0; transform: translateY(7px); }
  43%, 100% { opacity: 1; transform: translateY(0); }
}

/* The literal flash: a white sheet over the feed, once per rebuild rep. */
.screen-anim-flash { animation: screen-anim-flash var(--screen-anim-total) linear 1 forwards; }
@keyframes screen-anim-flash {
  0%, 1% { opacity: 0; }
  3% { opacity: .5; }
  5% { opacity: .1; }
  7% { opacity: .34; }
  10%, 15% { opacity: 0; }
  18% { opacity: .5; }
  20% { opacity: .1; }
  22% { opacity: .34; }
  25%, 30% { opacity: 0; }
  33% { opacity: .5; }
  35% { opacity: .1; }
  37% { opacity: .34; }
  40%, 100% { opacity: 0; }
}

.screen-anim-sig { animation: screen-anim-sig var(--screen-anim-total) cubic-bezier(.22,.61,.36,1) 1 forwards; }
@keyframes screen-anim-sig {
  0%, 56% { color: #a1a1aa; border-color: rgb(255 255 255 / 15%); background: transparent; }
  60%, 76% { color: #6ee7b7; border-color: rgb(52 211 153 / 55%); background: rgb(52 211 153 / 12%); }
  82%, 100% { color: #a1a1aa; border-color: rgb(255 255 255 / 15%); background: transparent; }
}

/* AFTER: the entering rows are the only thing that ever moves. */
.screen-anim-row-new { opacity: 0; animation: screen-anim-new var(--screen-anim-total) cubic-bezier(.22,.61,.36,1) 1 forwards; }
@keyframes screen-anim-new {
  0%, 76% { opacity: 0; transform: translateY(8px); }
  84%, 100% { opacity: 1; transform: translateY(0); }
}

/* Ghost outline of the previous mount — reduced-motion only. */
.screen-anim-ghost { display: none; }

@media (prefers-reduced-motion: reduce) {
  /* Static comparison: BEFORE freezes mid-re-entry over ghosted duplicates of
     the settled rows; AFTER shows the still feed with the chip lit and the
     entering rows landed. No loops anywhere. */
  .screen-anim-panel,
  .screen-anim-tick,
  .screen-anim-sig,
  .screen-anim-flash,
  .is-before .screen-anim-row,
  .screen-anim-row-new { animation: none !important; }
  .screen-anim-flash { opacity: 0; }
  .is-before .screen-anim-row { opacity: .55; transform: translateY(5px); }
  .screen-anim-ghost { display: block; }
  .screen-anim-row-new { opacity: 1; transform: none; }
  .screen-anim-sig { color: #6ee7b7; border-color: rgb(52 211 153 / 55%); background: rgb(52 211 153 / 12%); }
}
`;

function AnimationPanelColumn({ panel }: { panel: AnimationPanel }) {
	const isBefore = panel.role === "before";
	return (
		<section
			className={cn(
				"screen-anim-panel flex min-h-0 min-w-0 flex-col gap-2 rounded-md border p-2.5",
				isBefore
					? "is-before border-rose-400/35"
					: "is-after border-emerald-400/35",
			)}
		>
			<header className="flex shrink-0 items-center gap-2">
				<span
					aria-hidden
					className="screen-anim-tick size-[9px] shrink-0 rounded-full bg-amber-400 opacity-55"
				/>
				<h4
					className={cn(
						"min-w-0 truncate font-mono text-[9px] font-semibold uppercase tracking-[0.07em]",
						isBefore ? "text-rose-300" : "text-emerald-300",
					)}
				>
					{panel.label}
				</h4>
			</header>
			{/* The feed clips: an animation that outgrows the screen is not an
			    explanation, and the frame will not grow for it. */}
			<div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-white/[0.08] bg-background px-2 pb-2 pt-6">
				{isBefore ? (
					<span
						aria-hidden
						className="screen-anim-flash pointer-events-none absolute inset-0 z-10 bg-white opacity-0"
					/>
				) : panel.signal ? (
					<span className="screen-anim-sig absolute right-1.5 top-1.5 z-20 max-w-[calc(100%-0.75rem)] truncate rounded-full border px-1.5 py-[3px] font-mono text-[9px] text-zinc-400">
						{panel.signal}
					</span>
				) : null}
				<ol className="flex flex-col gap-1.5">
					{panel.rows.map((row, index) => (
						<li className="relative" key={`${index}-${row.label}`}>
							{/* Reduced motion only, and only here: the ghost stands for the
							    mount this row replaced, which is a thing that happens on
							    the broken side alone. */}
							{isBefore ? (
								<span
									aria-hidden
									className="screen-anim-ghost pointer-events-none absolute inset-0 rounded border border-dashed border-rose-400/45 opacity-60"
								/>
							) : null}
							<div
								className={cn(
									"screen-anim-row flex items-center gap-2 rounded border border-white/[0.08] bg-card px-1.5 py-1",
									row.entering && "screen-anim-row-new border-emerald-400/45",
								)}
							>
								<span
									aria-hidden
									className={cn(
										"size-[9px] shrink-0 rounded-full",
										row.entering ? "bg-emerald-400/55" : "bg-primary/55",
									)}
								/>
								{/* Two columns inside a frame under 24rem leave no room for
								    prose — at an 820px viewport the Spotlight is ~218px, so
								    each column is ~73px and every label is pure ellipsis.
								    There the label collapses to the canvas's abstract bar:
								    the motion is the explanation, and it survives any
								    width. */}
								<span className="min-w-0 flex-1 truncate text-[10px] text-zinc-300 @max-sm:hidden">
									{row.label}
								</span>
								<span
									aria-hidden
									className="hidden h-1 min-w-0 flex-1 rounded-full bg-white/15 @max-sm:block"
								/>
							</div>
						</li>
					))}
				</ol>
			</div>
			{panel.caption ? (
				<p
					className={cn(
						"shrink-0 font-mono text-[10px] leading-snug",
						isBefore ? "text-rose-300/85" : "text-zinc-400",
					)}
				>
					{panel.caption}
				</p>
			) : null}
		</section>
	);
}

/**
 * `walkthrough.animation` — a change explained with motion, before beside
 * after. The whole point is the contrast, so both columns stay on screen and
 * the piece plays once rather than looping.
 */
function AnimationArtifact({
	after,
	before,
	title,
}: {
	after: AnimationPanel;
	before: AnimationPanel;
	title: string;
}) {
	return (
		<ArtifactCard>
			<style href="drive-screen-animation" precedence="medium">
				{SCREEN_ANIMATION_CSS}
			</style>
			<ArtifactCardHeader
				eyebrow="walkthrough.animation · before and after"
				title={title}
			/>
			{/* Remount per artifact, for the same reason `MermaidArtifact` keys on
			    its source. Every rule runs once and holds, and the animation-name
			    never changes between two animation shows — so without a new key
			    React updates the existing nodes in place and the browser restarts
			    nothing. The second show would render frozen in the first one's end
			    state: no flash, chip already reverted, entering rows already
			    landed. The payload is the motion, so that is the whole artifact
			    missing. */}
			<div
				className="screen-anim grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-hidden p-3"
				key={animationReplayKey(before, after)}
			>
				<AnimationPanelColumn panel={before} />
				<AnimationPanelColumn panel={after} />
			</div>
		</ArtifactCard>
	);
}

/**
 * Identity of the comparison: a different one replays, the same one holds
 * its end state. Same semantics as `MermaidArtifact`'s `key={source}` —
 * re-presenting what the screen already shows is not a new thing to watch.
 */
function animationReplayKey(
	before: AnimationPanel,
	after: AnimationPanel,
): string {
	return JSON.stringify([before, after]);
}

/**
 * `capture.screenshot` — the feed card for a capture.
 *
 * Metadata rides the event; bytes do not. The address bar is drawn from the
 * produce recipe's `url` (which is what `media.artifact` persists), and the
 * pixels are fetched from the artifact's out-of-band `uri`. When there is no
 * such reference the card says so rather than inventing one — a capture whose
 * bytes never left the producer is still a real, presentable artifact.
 */
function CaptureArtifact({
	caption,
	shot,
	title,
	url,
}: {
	caption?: string;
	shot: string | null;
	title: string;
	url: string;
}) {
	return (
		<ArtifactCard>
			<ArtifactCardHeader eyebrow="capture.screenshot" title={title} />
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-white/10 bg-background">
					<div className="flex shrink-0 items-center gap-1.5 border-b border-white/[0.08] bg-card px-2 py-1.5">
						{[0, 1, 2].map((dot) => (
							<span
								aria-hidden
								className="size-[7px] shrink-0 rounded-full bg-white/15"
								key={dot}
							/>
						))}
						<span className="min-w-0 flex-1 truncate rounded-full border border-white/10 bg-background px-2 py-[3px] font-mono text-[10px] text-zinc-400">
							{url}
						</span>
					</div>
					{shot ? (
						<img
							alt={caption?.trim() || `Capture of ${url}`}
							className="min-h-0 w-full flex-1 object-contain"
							src={shot}
						/>
					) : (
						<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3">
							<span
								aria-hidden
								className="h-2.5 w-3/5 shrink-0 rounded border border-white/[0.08] bg-card"
							/>
							<span
								aria-hidden
								className="h-2.5 w-[85%] shrink-0 rounded border border-white/[0.08] bg-card"
							/>
							<span
								aria-hidden
								className="h-2.5 w-full shrink-0 rounded border border-white/[0.08] bg-card"
							/>
							<p className="mt-auto shrink-0 self-start rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-1 font-mono text-[10px] text-emerald-300">
								metadata only · pixels stay out of the event log
							</p>
						</div>
					)}
				</div>
			</div>
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
		case "animation":
			return (
				<AnimationArtifact
					after={body.after}
					before={body.before}
					title={title}
				/>
			);
		case "capture":
			return (
				<CaptureArtifact
					caption={artifact.caption}
					shot={body.shot}
					title={title}
					url={body.url}
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
