/**
 * Events-first Spotlight surface for Drive Mode Chat — who is sharing right now.
 * Live rooms render hub roomSnapshot.stage; offline/demo may use fixtures.
 * `stage` on the wire is the hub-side name for the same thing.
 */

import type { StageCard, StagePin } from "@cline/shared";
import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
	CodeBlock,
	CodeBlockCopyButton,
	CodeBlockFilename,
	CodeBlockHeader,
	CodeBlockTitle,
} from "@/components/ai-elements/code-block";
import {
	Terminal,
	TerminalContent,
	TerminalHeader,
	TerminalTitle,
} from "@/components/ai-elements/terminal";
import {
	Test,
	TestName,
	TestResults,
	TestResultsContent,
	TestResultsHeader,
	TestResultsSummary,
	TestStatus,
} from "@/components/ai-elements/test-results";
import { ClineMarkIcon } from "@/components/icons/cline-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SpotlightProduce } from "./artifactBody";
import { ScreenArtifact } from "./ScreenArtifact";
import {
	projectShowRail,
	type ShowRailEntry,
	type ShowRailSource,
	type ShowRailStatus,
} from "./showRail";

export type SpotlightHumanPin = Pick<StagePin, "kind" | "label"> & {
	ref?: string;
};

/** Presented show bound to the frame (director artifact, hub-authored). */
export type SpotlightArtifact = {
	/** ShowArtifactKind of the presented item — presenter-bar eyebrow. */
	kind?: string;
	/** Director sticky policy for this show ("hold" | "replace"). */
	sticky?: string;
	title?: string;
	/**
	 * Live narration for this show — the backlog caption until a script beat
	 * overwrites it. It renders in the frame's subtitle slot rather than the
	 * figcaption, so a beat that lands before anything is staged stays readable.
	 */
	caption?: string;
	uri?: string;
	/**
	 * The backlog item's `produce` block for this show. The hub keeps the
	 * source it materialized `uri` from, so the screen re-renders the real
	 * artifact client-side instead of the SVG stub where it can.
	 */
	produce?: SpotlightProduce;
};

export type SpotlightViewProps = {
	cards: readonly StageCard[];
	/** Who holds the spotlight (agent partner or You). */
	sharerLabel: string;
	/** True when the primary agent (Cline) holds the spotlight, for the idle avatar mark. */
	sharerIsAgent?: boolean;
	demo?: boolean;
	/** Structured human share when you take the spotlight (hub pin). */
	humanPin?: SpotlightHumanPin | null;
	/** When true, agent work cards are dimmed under the human pin. */
	humanSharing?: boolean;
	/** Presented director artifact rendered inside the frame. */
	artifact?: SpotlightArtifact | null;
	/**
	 * Live narration for the subtitle slot under the screen. Passing the prop
	 * (even as null) reserves the slot so arriving text never shifts layout.
	 */
	narration?: string | null;
	/**
	 * Director's show backlog (`room.director.showBacklog`) as the queue rail
	 * under the frame. Read-only; an empty queue hides the rail.
	 */
	backlog?: readonly ShowRailSource[];
	/** Show bound to the frame — its chip is the one that reads `showing`. */
	activeShowId?: string | null;
	nowLabel?: string;
	nextLabel?: string;
	emptyHint?: string;
	/** Fold state of the feed drawer beside the Spotlight. */
	feedCollapsed?: boolean;
	/** Omit to hide the fold toggle — surfaces without a feed have nothing to fold. */
	onToggleFeed?: () => void;
	className?: string;
	children?: ReactNode;
};

/**
 * The screen is fixed-dark in both themes: a share reads as a screen, not as a
 * themed panel. `dark` re-scopes every shadcn token for the subtree (the
 * `&:is(.dark *)` variant), and these overrides pin the surface ladder to the
 * canvas values so artifact bodies sit on the screen, not on app chrome.
 */
const SCREEN_SURFACE = {
	"--background": "#0e0f13",
	"--card": "#171923",
	"--muted": "#1b1d26",
	"--popover": "#171923",
	"--secondary": "#1b1d26",
} as CSSProperties;

/** Faint dot grid — the display reads as a surface, not as empty space. */
const SCREEN_BODY_TEXTURE = {
	backgroundImage:
		"radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px)",
	backgroundSize: "18px 18px",
} as CSSProperties;

function languageFromTitle(title: string): string {
	const lower = title.toLowerCase();
	if (lower.endsWith(".tsx")) return "tsx";
	if (lower.endsWith(".ts")) return "typescript";
	if (lower.endsWith(".jsx")) return "jsx";
	if (lower.endsWith(".js")) return "javascript";
	if (lower.endsWith(".json")) return "json";
	if (lower.endsWith(".md")) return "markdown";
	if (lower.endsWith(".py")) return "python";
	if (lower.endsWith(".css")) return "css";
	if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
	if (lower.endsWith(".html")) return "html";
	return "typescript";
}

function testStatusFromSummary(
	summary: string | undefined,
): "passed" | "failed" | "running" {
	const text = (summary ?? "").toLowerCase();
	if (
		text.includes("fail") ||
		text.includes("error") ||
		text.includes("✗") ||
		text.includes("×")
	) {
		return "failed";
	}
	if (text.includes("running") || text.includes("pending")) {
		return "running";
	}
	return "passed";
}

function EditStageCard({ card }: { card: StageCard }) {
	const code = card.summary?.trim() || `// ${card.title}`;
	const language = languageFromTitle(card.title);
	return (
		<CodeBlock code={code} language={language} showLineNumbers={false}>
			<CodeBlockHeader>
				<CodeBlockTitle>
					<Badge className="text-[10px] uppercase" variant="outline">
						edit
					</Badge>
					<CodeBlockFilename>{card.title}</CodeBlockFilename>
				</CodeBlockTitle>
				<CodeBlockCopyButton />
			</CodeBlockHeader>
		</CodeBlock>
	);
}

function CommandStageCard({ card }: { card: StageCard }) {
	const output = card.summary?.trim() || card.title;
	return (
		<Terminal isStreaming={false} output={output}>
			<TerminalHeader>
				<TerminalTitle>
					<span className="mr-2 inline-flex">
						{/* Terminal is fixed-dark in both themes, so the badge is too. */}
						<Badge
							className="border-zinc-700 text-[10px] text-zinc-300 uppercase"
							variant="outline"
						>
							command
						</Badge>
					</span>
					{card.title}
				</TerminalTitle>
			</TerminalHeader>
			{/* Plain children avoid ansi-to-react default-import ESM quirk in TerminalContent. */}
			<TerminalContent>
				<pre className="whitespace-pre-wrap break-words text-zinc-100">
					{output}
				</pre>
			</TerminalContent>
		</Terminal>
	);
}

function TestStageCard({ card }: { card: StageCard }) {
	const status = testStatusFromSummary(card.summary);
	const summary =
		status === "failed"
			? { passed: 0, failed: 1, skipped: 0, total: 1 }
			: status === "running"
				? { passed: 0, failed: 0, skipped: 0, total: 1 }
				: { passed: 1, failed: 0, skipped: 0, total: 1 };

	return (
		<TestResults summary={summary}>
			<TestResultsHeader>
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<Badge className="text-[10px] uppercase" variant="outline">
						test
					</Badge>
					<span className="truncate font-mono text-xs">{card.title}</span>
				</div>
				<TestResultsSummary />
			</TestResultsHeader>
			<TestResultsContent>
				<Test name={card.title} status={status}>
					<TestStatus />
					<TestName>{card.summary ?? card.title}</TestName>
				</Test>
			</TestResultsContent>
		</TestResults>
	);
}

function StageCardView({ card }: { card: StageCard }) {
	switch (card.category) {
		case "edit":
			return <EditStageCard card={card} />;
		case "command":
			return <CommandStageCard card={card} />;
		case "test":
			return <TestStageCard card={card} />;
		case "plan":
		case "decision":
		case "other":
			return (
				<div className="rounded-md border bg-background p-2">
					<div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
						<span className="rounded border px-1.5 py-0.5">
							{card.category}
						</span>
						<span className="truncate font-medium normal-case text-foreground">
							{card.title}
						</span>
					</div>
					{card.summary ? (
						<pre className="mt-1 overflow-auto font-mono text-[11px] text-muted-foreground">
							{card.summary}
						</pre>
					) : null}
				</div>
			);
		default: {
			const _exhaustive: never = card.category;
			return _exhaustive;
		}
	}
}

function HumanPinContent({ pin }: { pin: SpotlightHumanPin }) {
	const body = pin.ref?.trim() || pin.label;
	switch (pin.kind) {
		case "selection":
			return (
				<div className="rounded-md border border-amber-500/40 bg-amber-500/5">
					<div className="flex items-center gap-2 border-b border-amber-500/20 px-3 py-2 text-[10px] uppercase tracking-wide text-amber-800 dark:text-amber-200">
						<span className="rounded border border-amber-500/40 px-1.5 py-0.5">
							selection
						</span>
						<span className="truncate normal-case text-foreground">
							{pin.label}
						</span>
					</div>
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] text-foreground">
						{body}
					</pre>
				</div>
			);
		case "file":
			return (
				<div className="rounded-md border bg-background">
					<div className="flex items-center gap-2 border-b px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
						<span className="rounded border px-1.5 py-0.5">file</span>
						<span className="truncate font-mono normal-case text-foreground">
							{pin.label}
						</span>
					</div>
					<pre className="overflow-auto p-3 font-mono text-[11px] text-muted-foreground">
						{body}
					</pre>
				</div>
			);
		case "terminal":
			return (
				<Terminal isStreaming={false} output={body}>
					<TerminalHeader>
						<TerminalTitle>
							<span className="mr-2 inline-flex">
								<Badge
									className="border-zinc-700 text-[10px] text-zinc-300 uppercase"
									variant="outline"
								>
									terminal
								</Badge>
							</span>
							{pin.label}
						</TerminalTitle>
					</TerminalHeader>
					<TerminalContent>
						<pre className="whitespace-pre-wrap break-words text-zinc-100">
							{body}
						</pre>
					</TerminalContent>
				</Terminal>
			);
		default: {
			const _exhaustive: never = pin.kind;
			return _exhaustive;
		}
	}
}

/** Nothing staged — the sharer's plain workspace is what the room sees. */
function ScreenIdle({
	hint,
	sharerIsAgent,
	sharerLabel,
}: {
	hint?: string;
	/** The primary agent (Cline) gets its bot mark; every human keeps an initial. */
	sharerIsAgent?: boolean;
	sharerLabel: string;
}) {
	// Match ScreenFrame: "You are sharing", everyone else "Riley is sharing".
	const sharingVerb = sharerLabel === "You" ? "are" : "is";
	return (
		<div className="flex max-h-full flex-col items-center gap-2 overflow-auto text-center">
			<span
				aria-hidden
				className={cn(
					"grid size-11 shrink-0 place-items-center rounded-full border",
					sharerIsAgent
						? "border-violet-500/45 bg-violet-500/15 text-violet-300"
						: "border-amber-500/45 bg-amber-500/15 font-mono text-base font-bold text-amber-300",
				)}
			>
				{sharerIsAgent ? (
					<ClineMarkIcon className="size-5" />
				) : (
					sharerLabel.slice(0, 1).toUpperCase()
				)}
			</span>
			<p className="text-[13px] font-semibold text-zinc-100">
				{sharerLabel} {sharingVerb} sharing
			</p>
			<p className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">
				workspace
			</p>
			{hint ? (
				<p className="max-w-sm text-[11px] text-zinc-400">{hint}</p>
			) : null}
		</div>
	);
}

/**
 * The shared screen — a fixed-dark display in both themes, with the presenter
 * bar on top and a reserved narration subtitle slot beneath.
 */
export function ScreenFrame({
	artifactKind,
	children,
	className,
	controls,
	human,
	narration,
	presenter,
	stickyMode,
}: {
	/** Eyebrow describing what is on screen ("diagram.architecture", …). */
	artifactKind: string;
	/**
	 * Screen body. The box clips, so a body that can outgrow the screen must
	 * cap itself (`max-h-full overflow-auto`) rather than rely on the frame.
	 */
	children: ReactNode;
	className?: string;
	/** Chrome pinned to the right of the presenter bar (badges, fold toggle). */
	controls?: ReactNode;
	/** A human pin holds the screen — amber frame + second-person copy. */
	human: boolean;
	/** Undefined hides the subtitle slot; null/"" reserves it empty. */
	narration?: string | null;
	presenter: string;
	stickyMode?: string;
}) {
	// Second person is special-cased: "You are presenting", everyone else
	// "Riley is presenting".
	const presentingVerb = presenter === "You" ? "are" : "is";

	return (
		<div
			className={cn(
				"dark @container relative flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background",
				human ? "border-amber-500/55" : "border-white/15",
				className,
			)}
			style={SCREEN_SURFACE}
		>
			<div className="flex shrink-0 items-center gap-2 border-b border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5">
				<span
					aria-hidden
					className={cn(
						"size-[7px] shrink-0 rounded-full",
						human ? "bg-amber-400 motion-safe:animate-pulse" : "bg-emerald-400",
					)}
				/>
				<p
					aria-atomic="true"
					aria-live="polite"
					className="flex min-w-0 flex-1 items-center gap-x-1.5 whitespace-nowrap text-[11px] font-medium text-zinc-300"
					role="status"
				>
					<span className="max-w-40 shrink-0 truncate font-semibold text-white">
						{presenter}
					</span>
					<span className="shrink-0">{presentingVerb} presenting ·</span>
					<span className="min-w-0 truncate font-semibold text-[10px] uppercase tracking-[0.07em] text-amber-300">
						{artifactKind}
					</span>
					{stickyMode ? (
						// Narrow screens drop the chip rather than wrap the bar.
						<span className="hidden shrink-0 rounded-full border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 @min-[26rem]:inline">
							sticky · {stickyMode}
						</span>
					) : null}
				</p>
				{controls}
			</div>
			<div
				className="grid min-h-0 flex-1 place-items-center overflow-hidden p-4"
				style={SCREEN_BODY_TEXTURE}
			>
				{children}
			</div>
			{narration === undefined ? null : (
				<p
					aria-atomic="true"
					aria-live="polite"
					className="line-clamp-2 h-12 shrink-0 border-t border-white/[0.08] px-4 py-2 text-center text-xs italic leading-tight text-amber-100"
					role="status"
				>
					{narration}
				</p>
			)}
		</div>
	);
}

/**
 * Every state carries a cue that survives without hue — dashed rule (planned),
 * solid rule (ready), filled with a live dot (showing), struck through
 * (shown) — so the queue reads for colour-blind viewers too.
 */
const RAIL_CHIP_STYLE: Record<ShowRailStatus, string> = {
	planned: "border-dashed text-muted-foreground",
	ready: "text-foreground",
	showing:
		"border-amber-600/60 bg-amber-500/10 font-medium text-amber-800 dark:border-amber-400/60 dark:text-amber-200",
	shown: "text-muted-foreground line-through opacity-60",
};

/**
 * The director's queue, made visible: one chip per show under the frame. The
 * row scrolls rather than wraps — a wrapping rail would steal frame height as
 * the backlog grows.
 */
function ShowBacklogRail({
	dimmed,
	entries,
}: {
	/** A human pin holds the screen, so the director's queue is on hold. */
	dimmed: boolean;
	entries: readonly ShowRailEntry[];
}) {
	return (
		<section
			aria-label="Show backlog"
			className={cn(
				"flex shrink-0 items-center gap-2 motion-safe:transition-opacity",
				dimmed && "opacity-40 saturate-50",
			)}
		>
			{/* Quieter than the Now/Next eyebrow, as in the canvas: the queue is
			    reference, the plan cursor is the live line. */}
			<span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
				show backlog
			</span>
			{/* Only the chips scroll, so the rail keeps its label at any width. */}
			<ol className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
				{entries.map((entry) => (
					<li
						className={cn(
							"flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] leading-4",
							RAIL_CHIP_STYLE[entry.status],
						)}
						key={entry.id}
						title={entry.title}
					>
						{entry.status === "showing" ? (
							<span
								aria-hidden
								className="size-[5px] shrink-0 rounded-full bg-amber-600 motion-safe:animate-pulse dark:bg-amber-400"
							/>
						) : null}
						{entry.label}
						<span className="sr-only">status: {entry.status}</span>
					</li>
				))}
			</ol>
		</section>
	);
}

/**
 * Full spotlight column: the shared screen, the show-backlog rail, the work
 * deck beneath it, and the plan cursor. Prefer this over DriveStagePanel +
 * DriveStageCards for live projection.
 */
export function Spotlight({
	cards,
	sharerLabel,
	sharerIsAgent,
	demo,
	humanPin,
	humanSharing,
	artifact,
	narration,
	backlog,
	activeShowId,
	nowLabel,
	nextLabel,
	emptyHint = "Waiting for partner tool activity on this session.",
	feedCollapsed,
	onToggleFeed,
	className,
	children,
}: SpotlightViewProps) {
	const showHumanPrimary = Boolean(humanPin);
	const suppressAgentCards = Boolean(humanPin) && humanSharing !== false;
	const feedToggleLabel = feedCollapsed ? "Show chat feed" : "Hide chat feed";
	const staged = Boolean(artifact?.uri || artifact?.title);
	const railEntries = projectShowRail(backlog, activeShowId);
	const artifactKind = showHumanPrimary
		? "structured share"
		: staged
			? (artifact?.kind ?? "artifact")
			: "workspace";

	return (
		<div
			className={cn(
				"flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-auto bg-muted/20 p-3",
				className,
			)}
		>
			<ScreenFrame
				artifactKind={artifactKind}
				// The stage is the primary surface: it is the only `flex-1` item in
				// this column, and its min-height is the layout contract's floor —
				// 352px, comfortably above the 320px design-floor gate (1280×640).
				// Every other child here is `shrink-0`/bounded chrome that must fit
				// in what is left, and this pane (not the page) is what scrolls if
				// it doesn't — see the column's own `overflow-auto` above.
				className="min-h-[22rem] flex-1"
				controls={
					<>
						<Badge className="shrink-0 text-[10px]" variant="outline">
							{demo
								? "Demo fixture"
								: showHumanPrimary
									? "Human share"
									: "Live room"}
						</Badge>
						{onToggleFeed ? (
							<Tooltip>
								<TooltipTrigger
									render={
										<Button
											aria-expanded={!feedCollapsed}
											aria-label={feedToggleLabel}
											// The ghost variant styles aria-expanded like a popover
											// trigger; here it only reports the drawer's fold state.
											className={cn(
												"shrink-0 aria-expanded:bg-transparent",
												feedCollapsed
													? "text-amber-300"
													: "text-zinc-400 hover:text-white aria-expanded:text-zinc-400",
											)}
											onClick={onToggleFeed}
											size="icon-sm"
											type="button"
											variant="ghost"
										/>
									}
								>
									{feedCollapsed ? (
										<PanelRightOpenIcon className="size-3.5" />
									) : (
										<PanelRightCloseIcon className="size-3.5" />
									)}
								</TooltipTrigger>
								<TooltipContent side="bottom">{feedToggleLabel}</TooltipContent>
							</Tooltip>
						) : null}
					</>
				}
				human={showHumanPrimary}
				narration={narration}
				presenter={sharerLabel}
				stickyMode={showHumanPrimary || !staged ? undefined : artifact?.sticky}
			>
				{humanPin ? (
					<div className="max-h-full w-full max-w-2xl overflow-auto">
						<HumanPinContent pin={humanPin} />
					</div>
				) : staged && artifact ? (
					<ScreenArtifact artifact={artifact} />
				) : (
					<ScreenIdle
						hint={cards.length === 0 ? emptyHint : undefined}
						sharerIsAgent={sharerIsAgent}
						sharerLabel={sharerLabel}
					/>
				)}
			</ScreenFrame>
			{railEntries.length > 0 ? (
				<ShowBacklogRail dimmed={showHumanPrimary} entries={railEntries} />
			) : null}
			{cards.length > 0 ? (
				<section
					aria-label="Agent work deck"
					className={cn(
						"shrink-0 motion-safe:transition-opacity",
						suppressAgentCards && "opacity-40",
					)}
				>
					{suppressAgentCards ? (
						<p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
							Agent deck paused while you hold the spotlight
						</p>
					) : null}
					<div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
						{cards.map((card) => (
							<div className="max-h-56 min-w-0 overflow-auto" key={card.id}>
								<StageCardView card={card} />
							</div>
						))}
					</div>
				</section>
			) : null}
			{nowLabel != null || nextLabel != null ? (
				<div className="flex shrink-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px]">
					<span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-amber-700 dark:text-amber-300">
						now
					</span>
					<span className="min-w-0 truncate text-muted-foreground">
						{nowLabel ?? "—"}
					</span>
					<span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-amber-700 dark:text-amber-300">
						next
					</span>
					<span className="min-w-0 truncate text-muted-foreground">
						{nextLabel ?? "—"}
					</span>
				</div>
			) : null}
			{children ? (
				// Everything a caller hangs off Spotlight (recovery forks, the
				// worker audit, the plan editor) is secondary to the stage: bounded
				// to a predictable share of the column and scrolling on its own
				// rather than pushing the frame below its floor.
				<div className="max-h-52 shrink-0 space-y-3 overflow-y-auto">
					{children}
				</div>
			) : null}
		</div>
	);
}
