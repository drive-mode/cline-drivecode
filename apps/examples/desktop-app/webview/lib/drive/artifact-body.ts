/**
 * Artifact body projection — what the detail drawer draws for a directory
 * entry, and the show item it hands the Spotlight on "Present".
 *
 * The corpus is bytes-free: an entry carries the produce recipe, never the
 * rendered image. Where the recipe holds the source the artifact was
 * produced from (mermaid text, markdown, a plan's steps, a code snippet) the
 * drawer renders that; mermaid stays a code block on this surface (no
 * diagram runtime in the desktop app). Otherwise the drawer is honest about
 * it: a labeled placeholder says the pixels live on the Spotlight, not here.
 *
 * Pure, so it is tested without a DOM — the same shape as the hub's
 * `artifactBody.ts`, which this follows for the shared kinds.
 */

import type { DriveArtifactDirectoryEntry } from "@cline/drive";
import type { ShowBacklogItem } from "@cline/shared";

export type ArtifactProduce = {
	tool?: string;
	templateId?: string;
	args?: Record<string, unknown>;
};

/** Structural slice of an entry (or a presented show) the projection reads. */
export type ArtifactBodySource = {
	artifactKind?: string;
	mediaClass?: string;
	title?: string;
	caption?: string;
	/** Out-of-band pointer; never bytes off the event log. */
	uri?: string;
	produce?: ArtifactProduce;
};

export type PlanStepState = "done" | "now" | "next";

export type PlanStep = { label: string; state: PlanStepState };

export type WalkthroughLine = {
	number: number;
	text: string;
	highlighted: boolean;
};

export type ArtifactBody =
	| { kind: "mermaid"; source: string }
	| { kind: "markdown"; markdown: string }
	| { kind: "plan"; title: string; steps: PlanStep[] }
	| {
			kind: "walkthrough";
			path: string;
			symbol: string | null;
			startLine: number;
			endLine: number;
			lines: WalkthroughLine[];
	  }
	| { kind: "capture"; url: string; shot: string | null }
	| { kind: "structured"; items: string[]; json: string | null }
	| { kind: "image"; uri: string }
	| { kind: "media"; mediaClass: string }
	| { kind: "empty" };

/** `[x]` done, `[>]`/`[~]` in progress, `[ ]`/bare next. Glyphs too. */
const PLAN_STEP_MARKER = /^(?:\[([ xX>~])\]|([✓●○]))\s*/;
const PLAN_STEP_LEAD_IN = /^\s*(?:[-*•]\s+)?(?:\d+[.)]\s+)?/;
const WALKTHROUGH_LINE_CAP = 400;
const STRUCTURED_ITEM_CAP = 50;
/** A fence inside mermaid source would break out of any code block. */
const MERMAID_FENCE = /```/;

type BodyKind =
	| "mermaid"
	| "markdown"
	| "plan"
	| "walkthrough"
	| "capture"
	| "structured"
	| "media"
	| null;

function bodyKindFor(
	artifactKind: string | undefined,
	tool: string | undefined,
): BodyKind {
	switch (tool) {
		case "render_mermaid":
			return "mermaid";
		case "render_markdown":
			return "markdown";
		case "render_plan_card":
			return "plan";
		case "render_code_walkthrough":
			return "walkthrough";
		case "drive_browser_snapshot":
			return "capture";
		case "share_structured":
			return "structured";
		default:
			break;
	}
	switch (artifactKind) {
		case "diagram.architecture":
		case "diagram.data_flow":
		case "diagram.network_security":
		case "diagram.sequence":
			return "mermaid";
		case "doc.plan":
			return "plan";
		case "doc.review":
			return "markdown";
		case "walkthrough.code":
			return "walkthrough";
		case "capture.screenshot":
			return "capture";
		case "share.structured":
			return "structured";
		case "walkthrough.animation":
		case "capture.demo_clip":
			return "media";
		default:
			return null;
	}
}

function readString(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
}

function readStringList(args: Record<string, unknown>, key: string): string[] {
	const value = args[key];
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function readInt(
	args: Record<string, unknown>,
	key: string,
): number | undefined {
	const value = args[key];
	return typeof value === "number" && Number.isFinite(value)
		? Math.trunc(value)
		: undefined;
}

export function parsePlanStep(raw: string): PlanStep {
	const body = raw.replace(PLAN_STEP_LEAD_IN, "");
	const marker = body.match(PLAN_STEP_MARKER);
	const mark = marker?.[1] ?? marker?.[2];
	const state: PlanStepState =
		mark === "x" || mark === "X" || mark === "✓"
			? "done"
			: mark === ">" || mark === "~" || mark === "●"
				? "now"
				: "next";
	return { label: body.slice(marker?.[0].length ?? 0).trim(), state };
}

/**
 * Split a snippet into absolutely-numbered lines. `startLine` anchors the
 * first line; lines up to `endLine` are the focus range.
 */
export function projectWalkthroughLines(
	snippet: string,
	startLine: number,
	endLine: number,
): WalkthroughLine[] {
	const text = snippet.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
	if (!text) {
		return [];
	}
	return text
		.split("\n")
		.slice(0, WALKTHROUGH_LINE_CAP)
		.map((line, index) => {
			const number = startLine + index;
			return { number, text: line, highlighted: number <= endLine };
		});
}

function fallbackFor(source: ArtifactBodySource): ArtifactBody {
	const uri = source.uri?.trim();
	if (uri) {
		return { kind: "image", uri };
	}
	switch (source.mediaClass) {
		case "still":
		case "animation":
		case "video":
			return { kind: "media", mediaClass: source.mediaClass };
		default:
			return { kind: "empty" };
	}
}

/**
 * Decide what the drawer draws. Embedded source outranks a `uri` pointer;
 * the pointer outranks a placeholder; the placeholder outranks nothing.
 */
export function projectArtifactBody(
	source: ArtifactBodySource | null | undefined,
): ArtifactBody {
	if (!source) {
		return { kind: "empty" };
	}
	const fallback = fallbackFor(source);
	const args = source.produce?.args ?? {};
	switch (bodyKindFor(source.artifactKind, source.produce?.tool)) {
		case "mermaid": {
			const text = readString(args, "mermaidSource").trim();
			return text && !MERMAID_FENCE.test(text)
				? { kind: "mermaid", source: text }
				: fallback;
		}
		case "markdown": {
			const markdown = readString(args, "markdown").trim();
			return markdown ? { kind: "markdown", markdown } : fallback;
		}
		case "plan": {
			const rawSteps = Array.isArray(args.steps) ? args.steps : [];
			const steps = rawSteps
				.filter((step): step is string => typeof step === "string")
				.map(parsePlanStep)
				.filter((step) => step.label.length > 0);
			if (steps.length === 0) {
				// A plan produced as prose (the demo's `render_markdown` plans).
				const markdown = readString(args, "markdown").trim();
				return markdown ? { kind: "markdown", markdown } : fallback;
			}
			const planTitle = readString(args, "planTitle").trim();
			return {
				kind: "plan",
				title: planTitle || source.title?.trim() || "Plan",
				steps,
			};
		}
		case "walkthrough": {
			const path = readString(args, "path").trim();
			if (!path) {
				return fallback;
			}
			const symbol = readString(args, "symbol").trim() || null;
			const startLine = Math.max(1, readInt(args, "startLine") ?? 1);
			const lines = projectWalkthroughLines(
				readString(args, "snippet"),
				startLine,
				Number.POSITIVE_INFINITY,
			);
			const snippetEnd = startLine + Math.max(0, lines.length - 1);
			const endLine = Math.max(
				startLine,
				readInt(args, "endLine") ?? snippetEnd,
			);
			return {
				kind: "walkthrough",
				path,
				symbol,
				startLine,
				endLine,
				lines: lines.map((line) => ({
					...line,
					highlighted: line.number <= endLine,
				})),
			};
		}
		case "capture": {
			const url = readString(args, "url").trim();
			if (!url) {
				return fallback;
			}
			const uri = source.uri?.trim();
			// A `data:` uri on a capture is the hub's placeholder card, not a
			// picture of the page — never frame it as one.
			return {
				kind: "capture",
				url,
				shot: uri && !uri.startsWith("data:") ? uri : null,
			};
		}
		case "structured": {
			const items = readStringList(args, "items").slice(0, STRUCTURED_ITEM_CAP);
			const rest = Object.fromEntries(
				Object.entries(args).filter(([key]) => key !== "items"),
			);
			const json =
				Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : null;
			return items.length > 0 || json
				? { kind: "structured", items, json }
				: fallback;
		}
		case "media":
			return fallback.kind === "empty"
				? { kind: "media", mediaClass: source.mediaClass ?? "animation" }
				: fallback;
		default:
			return fallback;
	}
}

/** The source of a directory entry, for `projectArtifactBody`. */
export function artifactEntryBodySource(
	entry: DriveArtifactDirectoryEntry,
): ArtifactBodySource {
	return {
		artifactKind: entry.artifactKind,
		mediaClass: entry.mediaClass,
		title: entry.title,
		produce: {
			tool: entry.produce.tool,
			...(entry.produce.templateId
				? { templateId: entry.produce.templateId }
				: {}),
			args: entry.produce.args,
		},
	};
}

/**
 * The show item `drive.show.present` takes for a directory entry. The
 * caption is the intent line the hub would have written; nothing here is a
 * transcript. `scoreReasons` names where the request came from so the
 * Director's audit trail reads honestly.
 */
export function showItemFromArtifact(
	entry: DriveArtifactDirectoryEntry,
	options: { ownerParticipantId?: string; priority?: number } = {},
): ShowBacklogItem {
	return {
		id: entry.showItemId,
		ownerParticipantId: options.ownerParticipantId ?? entry.ownerParticipantId,
		title: entry.title,
		intent: `Present "${entry.title}" from the artifact directory`,
		artifactKind: entry.artifactKind,
		mediaClass: entry.mediaClass,
		caption: entry.title,
		produce: {
			tool: entry.produce.tool,
			...(entry.produce.templateId
				? { templateId: entry.produce.templateId }
				: {}),
			args: { ...entry.produce.args },
		},
		priority: options.priority ?? 50,
		status: "ready",
		scoreReasons: ["artifacts.present"],
		...(entry.tags.length > 0 ? { tags: [...entry.tags] } : {}),
	};
}
