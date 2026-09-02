"use client";

/**
 * One stage card — the kernel's last-event-wins projection of an agent's
 * work in one category (edit / command / test / plan / decision / other).
 * Ported from the hub's `drive/Spotlight.tsx` card views onto the desktop
 * kit: the deck is themed chrome (it sits beside the screen, not on it).
 */

import type { StageCard } from "@cline/shared";
import {
	CircleCheck,
	CircleX,
	FileCode2,
	FlaskConical,
	Lightbulb,
	ListChecks,
	LoaderCircle,
	type LucideIcon,
	Scale,
	SquareTerminal,
} from "lucide-react";
import type { ParticipantInk } from "@/lib/drive/agent-ink";
import {
	formatRelativeAge,
	STAGE_CARD_CATEGORY_LABEL,
	type StageCardCategory,
	stageCardTestStatus,
} from "@/lib/drive/stage-cards";
import { cn } from "@/lib/utils";

const CATEGORY_ICON: Record<StageCardCategory, LucideIcon> = {
	edit: FileCode2,
	command: SquareTerminal,
	test: FlaskConical,
	plan: ListChecks,
	decision: Scale,
	other: Lightbulb,
};

export function stageCardIcon(category: StageCardCategory): LucideIcon {
	return CATEGORY_ICON[category];
}

function TestStatusPill({ summary }: { summary: string | undefined }) {
	const status = stageCardTestStatus(summary);
	switch (status) {
		case "passed":
			return (
				<span className="inline-flex items-center gap-1 rounded-full border border-success-border bg-success-surface px-1.5 py-0.5 text-[10px] font-medium text-success-text">
					<CircleCheck aria-hidden="true" className="size-3" />
					passed
				</span>
			);
		case "failed":
			return (
				<span className="inline-flex items-center gap-1 rounded-full border border-error-border bg-error-surface px-1.5 py-0.5 text-[10px] font-medium text-error-text">
					<CircleX aria-hidden="true" className="size-3" />
					failed
				</span>
			);
		case "running":
			return (
				<span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
					<LoaderCircle
						aria-hidden="true"
						className="size-3 motion-safe:animate-spin"
					/>
					running
				</span>
			);
		default: {
			const _exhaustive: never = status;
			return _exhaustive;
		}
	}
}

/** Up to six plan lines with keys that survive duplicate text. */
function planSteps(
	summary: string | undefined,
	fallback: string,
): { key: string; line: string }[] {
	const seen = new Map<string, number>();
	return (summary ? summary.split("\n") : [fallback])
		.filter((line) => line.trim())
		.slice(0, 6)
		.map((line) => {
			const count = (seen.get(line) ?? 0) + 1;
			seen.set(line, count);
			return { key: count > 1 ? `${line}#${count}` : line, line };
		});
}

function CardBody({ card }: { card: StageCard }) {
	const summary = card.summary?.trim();
	switch (card.category) {
		case "edit":
			return (
				<pre className="cline-chat-selectable max-h-32 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-snug text-foreground">
					{summary || `// ${card.title}`}
				</pre>
			);
		case "command":
			return (
				<pre className="cline-chat-selectable dark drive-screen max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-b-md px-3 py-2 font-mono text-[11px] leading-snug">
					<span className="select-none text-(--drive-screen-text-dim)">$ </span>
					{card.title}
					{summary && summary !== card.title ? `\n${summary}` : ""}
				</pre>
			);
		case "test":
			return (
				<div className="flex flex-col gap-1.5 px-3 py-2">
					<div className="flex items-center gap-2">
						<TestStatusPill summary={summary} />
						<span className="truncate font-mono text-[11px] text-muted-foreground">
							{card.title}
						</span>
					</div>
					{summary ? (
						<p className="cline-chat-selectable line-clamp-3 text-xs text-foreground">
							{summary}
						</p>
					) : null}
				</div>
			);
		case "plan":
			return (
				<ol className="flex flex-col gap-1 px-3 py-2 text-xs text-foreground">
					{planSteps(summary, card.title).map(({ key, line }, index) => (
						<li className="flex items-start gap-2" key={key}>
							<span
								aria-hidden="true"
								className="mt-[3px] grid size-3.5 shrink-0 place-items-center rounded-full border border-border font-mono text-[9px] text-muted-foreground"
							>
								{index + 1}
							</span>
							<span className="cline-chat-selectable min-w-0">
								{line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "")}
							</span>
						</li>
					))}
				</ol>
			);
		case "decision":
			return (
				<blockquote className="cline-chat-selectable border-l-2 border-primary/50 px-3 py-2 text-xs text-foreground">
					{summary || card.title}
				</blockquote>
			);
		case "other":
			return (
				<p className="cline-chat-selectable line-clamp-4 px-3 py-2 text-xs text-foreground">
					{summary || card.title}
				</p>
			);
		default: {
			const _exhaustive: never = card.category;
			return _exhaustive;
		}
	}
}

export function StageCardView({
	card,
	nowMs,
	ink,
	actorName,
	animate,
	className,
}: {
	card: StageCard;
	nowMs: number;
	/** Ink of the agent whose work this is, when known. */
	ink?: ParticipantInk | null;
	actorName?: string;
	/** Play the entry animation (stilled by reduce-motion via CSS). */
	animate?: boolean;
	className?: string;
}) {
	const Icon = CATEGORY_ICON[card.category];
	const age = formatRelativeAge(card.updatedAt, nowMs);
	return (
		<article
			aria-label={`${STAGE_CARD_CATEGORY_LABEL[card.category]}: ${card.title}`}
			className={cn(
				"flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card",
				animate && "drive-card-in",
				className,
			)}
			data-stage-card={card.category}
		>
			<header className="flex items-center gap-2 border-b border-border px-3 py-1.5">
				<Icon
					aria-hidden="true"
					className="size-3.5 shrink-0 text-muted-foreground"
				/>
				<span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
					{STAGE_CARD_CATEGORY_LABEL[card.category]}
				</span>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-xs font-medium text-foreground",
						card.category === "edit" && "font-mono",
					)}
					title={card.title}
				>
					{card.title}
				</span>
				{actorName ? (
					<span
						className="shrink-0 truncate text-[10px] font-medium"
						style={ink ? { color: ink.css } : undefined}
					>
						{actorName}
					</span>
				) : null}
				<time
					className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
					dateTime={card.updatedAt}
				>
					{age}
				</time>
			</header>
			<CardBody card={card} />
		</article>
	);
}
