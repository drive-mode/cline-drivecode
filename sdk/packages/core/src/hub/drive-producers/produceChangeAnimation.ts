import { getShowTemplate } from "@cline/drive";
import type { ShowBacklogItem } from "@cline/shared";
import { buildCardSvg, svgDataUri } from "./svgStub";

export type ProduceChangeAnimationInput = {
	ownerParticipantId: string;
	title?: string;
	caption?: string;
	templateId?: string;
	/** Column headings, e.g. "Before · every beat rebuilds". */
	beforeLabel?: string;
	afterLabel?: string;
	/** One-line takeaway under each column. */
	beforeCaption?: string;
	afterCaption?: string;
	/** The check that makes the repaint unnecessary ("sig ✓ unchanged"). */
	signal?: string;
	/** Rows present on both sides — what re-mounts on the left, rests on the right. */
	rows?: string[];
	/** Rows that enter once, on the right only. */
	entering?: string[];
};

export type ProduceChangeAnimationResult = {
	item: ShowBacklogItem;
	svg: string;
};

/**
 * Before/after change animation producer.
 *
 * The motion lives in the webview (`ScreenArtifact`), which re-renders from
 * these args; the SVG here is the same still stub every producer emits, so a
 * surface that cannot animate still shows the comparison as text.
 */
export function produceChangeAnimationShowArtifact(
	input: ProduceChangeAnimationInput,
): ProduceChangeAnimationResult {
	const template = input.templateId
		? getShowTemplate(input.templateId)
		: getShowTemplate("anim.change");
	const title = input.title ?? template?.title ?? "Before / after";
	const beforeLabel = input.beforeLabel ?? "Before";
	const afterLabel = input.afterLabel ?? "After";
	const rows = input.rows ?? [];
	const entering = input.entering ?? [];
	const body = [
		`${beforeLabel}:`,
		...rows.map((row) => `  - ${row}`),
		input.beforeCaption ? `  ${input.beforeCaption}` : "",
		"",
		`${afterLabel}:`,
		...rows.map((row) => `  - ${row}`),
		...entering.map((row) => `  + ${row}`),
		input.afterCaption ? `  ${input.afterCaption}` : "",
	]
		.filter((line, index, all) => line !== "" || all[index - 1] !== "")
		.join("\n");
	const svg = buildCardSvg({ title, body });
	const item: ShowBacklogItem = {
		id: `show-anim-${title.slice(0, 24).toLowerCase().replace(/\W+/g, "-")}`,
		ownerParticipantId: input.ownerParticipantId,
		title,
		intent: template?.intent ?? "Explain a change with motion",
		artifactKind: "walkthrough.animation",
		mediaClass: "animation",
		uri: svgDataUri(svg),
		caption: input.caption ?? title,
		produce: {
			tool: "render_change_animation",
			templateId: input.templateId ?? "anim.change",
			args: {
				beforeLabel,
				afterLabel,
				...(input.beforeCaption ? { beforeCaption: input.beforeCaption } : {}),
				...(input.afterCaption ? { afterCaption: input.afterCaption } : {}),
				...(input.signal ? { signal: input.signal } : {}),
				rows,
				entering,
			},
		},
		priority: 10,
		status: "ready",
		scoreReasons: ["produced"],
	};
	return { item, svg };
}
