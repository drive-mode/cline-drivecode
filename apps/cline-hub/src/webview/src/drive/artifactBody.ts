/**
 * Presented-artifact body projection — what the screen actually draws.
 *
 * The hub materializes every show into an SVG data URI so any surface can
 * render something, but it also keeps the source it produced from in
 * `produce.args` (`produceMermaid.ts`: "Webview may re-render from embedded
 * source"). Where that source is present the webview re-renders it live —
 * a real mermaid diagram, a real plan, a real file+range panel, a real
 * before/after animation, a real capture card — and falls back to the hub's
 * `uri` stub only when it is not.
 *
 * A capture is the one body that reads `uri` as content rather than as a
 * fallback, and even then only as an out-of-band pointer: the recipe in
 * `produce.args` is what the event log carries, and `DRIVE_EVENT_FORBIDDEN_KEYS`
 * keeps bytes out of it.
 *
 * Pure projection so it can be tested without a DOM, the same shape as
 * `showRail.ts`.
 */

/** Structural slice of the hub `ShowBacklogItem.produce` the screen reads. */
export type SpotlightProduce = {
	tool?: string;
	templateId?: string;
	args?: Record<string, unknown>;
};

/** Structural slice of the presented artifact this projection consumes. */
export type ArtifactBodySource = {
	/** ShowArtifactKind of the presented item. */
	kind?: string;
	title?: string;
	caption?: string;
	uri?: string;
	produce?: SpotlightProduce;
};

/** Structural slice of `PresentedShow` — the wire projection of the show. */
export type PresentedShowSource = {
	showItemId: string;
	artifactKind?: string;
	sticky?: string;
	title?: string;
	caption?: string;
	uri?: string;
};

/** Structural slice of the hub `ShowBacklogItem` the frame reads. */
export type ShowArtifactSource = {
	id: string;
	artifactKind?: string;
	title?: string;
	uri?: string;
	produce?: SpotlightProduce;
};

/** What the frame binds: the presented show, completed from the backlog. */
export type PresentedArtifact = ArtifactBodySource & { sticky?: string };

/**
 * Plan step progress. The hub ships `steps: string[]` with no state, so a
 * step is `next` unless it carries a leading marker — an unmarked plan reads
 * as a flat list rather than claiming progress nobody reported.
 */
export type PlanStepState = "done" | "now" | "next";

export type PlanStep = {
	label: string;
	state: PlanStepState;
};

export type WalkthroughLine = {
	/** Absolute file line number, as the editor would show it. */
	number: number;
	text: string;
	/** Inside `[startLine, endLine]` — the range the show is about. */
	highlighted: boolean;
};

/**
 * One row of a before/after animation panel. `entering` rows are the only
 * thing that moves on the AFTER side — that contrast is the whole artifact.
 */
export type AnimationRow = {
	label: string;
	entering: boolean;
};

export type AnimationPanel = {
	role: "before" | "after";
	label: string;
	caption: string;
	rows: AnimationRow[];
	/**
	 * AFTER-side chip naming the check that makes the repaint unnecessary
	 * (the canvas beat's "sig ✓ unchanged"). Absent when the show does not
	 * name one.
	 */
	signal?: string;
};

export type ArtifactBody =
	| { kind: "mermaid"; source: string }
	| { kind: "plan"; title: string; steps: PlanStep[] }
	| {
			kind: "walkthrough";
			path: string;
			startLine: number;
			endLine: number;
			lines: WalkthroughLine[];
	  }
	| { kind: "animation"; before: AnimationPanel; after: AnimationPanel }
	/**
	 * A capture is metadata plus an out-of-band pointer. `shot` is the
	 * artifact `uri` — never bytes read off an event, which is why it may be
	 * null and the card still renders.
	 */
	| { kind: "capture"; url: string; shot: string | null }
	| { kind: "image"; uri: string }
	| { kind: "empty" };

/** `[x]` done, `[>]`/`[~]` in progress, `[ ]`/bare next. Glyphs too. */
const PLAN_STEP_MARKER = /^(?:\[([ xX>~])\]|([✓●○]))\s*/;
/**
 * Producer step text usually arrives already bulleted or numbered
 * ("- [x] Reproduce", "1. Reproduce"); the renderer owns the ordering, and
 * the marker can only be read once the lead-in is gone.
 */
const PLAN_STEP_LEAD_IN = /^\s*(?:[-*•]\s+)?(?:\d+[.)]\s+)?/;

/**
 * A snippet longer than this is a file, not a walkthrough. The frame clips
 * either way; the cap keeps a runaway `produce.args.snippet` from building
 * thousands of DOM rows nobody can see.
 */
const WALKTHROUGH_LINE_CAP = 400;

/**
 * The frame clips, and a two-up comparison is only legible while both
 * columns fit without scrolling. Rows past the cap are dropped rather than
 * scrolled: half a comparison the room cannot see is worse than a short one.
 * `entering` rows are capped first and kept, because they are the point of
 * the AFTER panel — the settled rows give way to them.
 */
const ANIMATION_ROW_CAP = 8;
const ANIMATION_ENTERING_CAP = 3;

/** Mermaid source is fenced into markdown to render; a fence inside it would
 * close that block early and turn the rest into arbitrary markdown on a
 * screen the whole room is watching. The hub rejects fences on its own
 * materialize path (`assertMermaidSource`), but a caller-supplied item that
 * already carries a `uri` skips that check — so re-check here. */
const MERMAID_FENCE = /```/;

function bodyKindFor(
	artifactKind: string | undefined,
	tool: string | undefined,
): "mermaid" | "plan" | "walkthrough" | "animation" | "capture" | null {
	switch (artifactKind) {
		case "diagram.architecture":
		case "diagram.data_flow":
		case "diagram.network_security":
		case "diagram.sequence":
			return "mermaid";
		case "doc.plan":
			return "plan";
		case "walkthrough.code":
			return "walkthrough";
		case "walkthrough.animation":
			return "animation";
		case "capture.screenshot":
			return "capture";
		default:
			break;
	}
	// `drive_show_presented` carries no artifactKind, so a show presented
	// before its room sync lands has only the produce tool to go on.
	switch (tool) {
		case "render_mermaid":
			return "mermaid";
		case "render_plan_card":
			return "plan";
		case "render_code_walkthrough":
			return "walkthrough";
		case "render_change_animation":
			return "animation";
		case "drive_browser_snapshot":
			return "capture";
		default:
			return null;
	}
}

function readString(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
}

/** Non-empty trimmed strings from an args array; everything else dropped. */
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
 * first line, and lines up to `endLine` are the focus range — a snippet wider
 * than the range renders its extra lines as plain trailing context.
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
			// Numbering starts at `startLine`, so the lower bound is implicit.
			return { number, text: line, highlighted: number <= endLine };
		});
}

/**
 * Bind the frame's artifact: the presented show, completed from the backlog
 * item it names.
 *
 * `drive_show_presented` and `drive_script_beat` both set a presented show,
 * and neither carries `artifactKind` or `produce` — a beat carries only a
 * caption. The backlog item is the authority for everything the wire message
 * left out, and resolving by id means either broadcast can land first.
 *
 * Completing `title`/`uri` from the backlog is also what keeps the Spotlight's
 * `staged` gate honest: `ShowBacklogItem.title` is a required non-empty
 * string, so any show whose body can be rendered from embedded source also
 * has a title, and a caption-only beat with nothing in the backlog still
 * reads as narration rather than staging an empty screen.
 */
export function resolvePresentedArtifact(
	presented: PresentedShowSource | null | undefined,
	backlog: readonly ShowArtifactSource[] | undefined,
): PresentedArtifact | null {
	if (!presented) {
		return null;
	}
	const item = backlog?.find((entry) => entry.id === presented.showItemId);
	return {
		caption: presented.caption,
		kind: presented.artifactKind ?? item?.artifactKind,
		produce: item?.produce,
		sticky: presented.sticky,
		title: presented.title ?? item?.title,
		uri: presented.uri ?? item?.uri,
	};
}

/**
 * Decide what the screen draws for a presented artifact. Embedded source
 * outranks the hub's `uri` stub; the stub outranks nothing at all.
 */
export function projectArtifactBody(
	artifact: ArtifactBodySource | null | undefined,
): ArtifactBody {
	const uri = artifact?.uri?.trim();
	const fallback: ArtifactBody = uri
		? { kind: "image", uri }
		: { kind: "empty" };
	if (!artifact) {
		return fallback;
	}
	const args = artifact.produce?.args ?? {};
	switch (bodyKindFor(artifact.kind, artifact.produce?.tool)) {
		case "mermaid": {
			const source = readString(args, "mermaidSource").trim();
			return source && !MERMAID_FENCE.test(source)
				? { kind: "mermaid", source }
				: fallback;
		}
		case "plan": {
			const rawSteps = Array.isArray(args.steps) ? args.steps : [];
			const steps = rawSteps
				.filter((step): step is string => typeof step === "string")
				.map(parsePlanStep)
				.filter((step) => step.label.length > 0);
			if (steps.length === 0) {
				return fallback;
			}
			const planTitle = readString(args, "planTitle").trim();
			return {
				kind: "plan",
				title: planTitle || artifact.title?.trim() || "Plan",
				steps,
			};
		}
		case "walkthrough": {
			const path = readString(args, "path").trim();
			if (!path) {
				return fallback;
			}
			const startLine = Math.max(1, readInt(args, "startLine") ?? 1);
			// `endLine` is optional on the producer and never round-trips through
			// `materializeShowItem`, so it is routinely absent. Falling back to
			// `startLine` would highlight one line and dim the rest of the
			// snippet as "context"; the snippet itself is the range.
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
				startLine,
				endLine,
				lines: lines.map((line) => ({
					...line,
					highlighted: line.number <= endLine,
				})),
			};
		}
		case "animation": {
			const entering = readStringList(args, "entering").slice(
				0,
				ANIMATION_ENTERING_CAP,
			);
			const settled = readStringList(args, "rows").slice(
				0,
				Math.max(0, ANIMATION_ROW_CAP - entering.length),
			);
			// The artifact IS the comparison: without settled rows the BEFORE
			// panel is an empty feed with a white flash strobing over nothing,
			// under a caption claiming everything re-animates. The hub stub says
			// more than that does.
			if (settled.length === 0) {
				return fallback;
			}
			const signal = readString(args, "signal").trim();
			return {
				kind: "animation",
				before: {
					role: "before",
					label: readString(args, "beforeLabel").trim() || "Before",
					caption: readString(args, "beforeCaption").trim(),
					rows: settled.map((label) => ({ label, entering: false })),
				},
				after: {
					role: "after",
					label: readString(args, "afterLabel").trim() || "After",
					caption: readString(args, "afterCaption").trim(),
					rows: [
						...settled.map((label) => ({ label, entering: false })),
						...entering.map((label) => ({ label, entering: true })),
					],
					...(signal ? { signal } : {}),
				},
			};
		}
		case "capture": {
			// The recipe's `url` is what the event log carries; the bytes, if
			// any, live behind `uri`. Without the url there is no capture card
			// to draw — a browser frame around an empty address bar claims
			// nothing, so the hub stub is the better answer.
			const url = readString(args, "url").trim();
			if (!url) {
				return fallback;
			}
			// A capture's pixels live out-of-band; a `data:` uri is in-band by
			// definition. On this kind that is always the hub's placeholder card
			// (`produceBrowserSnapshot`, whose body reads "Demo capture stub") —
			// not a picture of the page. Framing it inside browser chrome under
			// the real address bar would assert it IS the page, so the card
			// shows its metadata state instead. Nothing else can honestly be
			// drawn from a recipe that produced no capture.
			return {
				kind: "capture",
				url,
				shot: uri && !uri.startsWith("data:") ? uri : null,
			};
		}
		default:
			return fallback;
	}
}
