"use client";

/**
 * The presented Director artifact, drawn inside the shared screen.
 *
 * The hub materialises a show into a `uri` and keeps the source it produced
 * from in the backlog item's `produce.args`. The desktop renders mermaid and
 * markdown *sources as code blocks* (no diagram runtime here — the CONTRACT
 * forbids new dependencies, and a readable source is honest about what the
 * event carried), images by their uri, and everything else as a titled card
 * with the uri as a chip. Pixels never stream: the frame shows typed events.
 *
 * Lives on the fixed-dark screen, so it styles off the screen-scoped tokens
 * (`drive.css` → `.drive-screen`) rather than app chrome.
 */

import type { ShowBacklogItem } from "@cline/shared";
import { Braces, Image as ImageIcon, Link2, Presentation } from "lucide-react";
import type { DrivePresentedShow } from "@/lib/drive/room-state";
import { cn } from "@/lib/utils";

export type PresentedArtifactSource = {
	kind: "mermaid" | "markdown" | "image" | "uri" | "empty";
	source?: string;
	uri?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStringArg(
	args: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = args?.[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function looksLikeImage(uri: string): boolean {
	if (uri.startsWith("data:image/")) {
		return true;
	}
	return /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(uri);
}

/** Decide what the screen draws from the show + its backlog item. */
export function projectPresentedArtifact(
	show: DrivePresentedShow,
	item: ShowBacklogItem | null | undefined,
): PresentedArtifactSource {
	const args = isRecord(item?.produce.args) ? item?.produce.args : undefined;
	const mermaid =
		readStringArg(args, "mermaidSource") ?? readStringArg(args, "mermaid");
	if (mermaid) {
		return { kind: "mermaid", source: mermaid };
	}
	const markdown = readStringArg(args, "markdown") ?? readStringArg(args, "md");
	if (markdown) {
		return { kind: "markdown", source: markdown };
	}
	const uri = show.uri ?? item?.uri;
	if (uri && looksLikeImage(uri) && !uri.startsWith("data:image/svg")) {
		return { kind: "image", uri };
	}
	if (uri) {
		return { kind: "uri", uri };
	}
	return { kind: "empty" };
}

function shortUri(uri: string): string {
	if (uri.startsWith("data:")) {
		const [head] = uri.split(",", 1);
		return `${head ?? "data:"} · ${Math.round(uri.length / 1024)} KB inline`;
	}
	return uri.length > 72 ? `${uri.slice(0, 69)}…` : uri;
}

function ArtifactCard({
	children,
	eyebrow,
	title,
	className,
}: {
	children: React.ReactNode;
	eyebrow: string;
	title: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex max-h-full min-h-0 w-full max-w-[44rem] flex-col overflow-hidden rounded-lg border border-(--drive-share)/45 bg-card",
				className,
			)}
		>
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-(--drive-share)/85">
						{eyebrow}
					</span>
					<span className="truncate text-[13px] font-medium text-foreground">
						{title}
					</span>
				</div>
			</div>
			{children}
		</div>
	);
}

function SourceBlock({
	language,
	source,
}: {
	language: string;
	source: string;
}) {
	return (
		<div className="drive-scroll min-h-0 flex-1 overflow-auto">
			<div className="sticky top-0 flex items-center gap-1.5 border-b border-border bg-card/95 px-3 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur-sm">
				<Braces aria-hidden="true" className="size-3" />
				{language} · source
			</div>
			<pre className="cline-chat-selectable whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-[1.55] text-foreground">
				{source}
			</pre>
		</div>
	);
}

export function PresentedArtifact({
	show,
	item,
	ownerName,
	className,
}: {
	show: DrivePresentedShow;
	/** The backlog item the show was produced from, when the hub sent it. */
	item: ShowBacklogItem | null | undefined;
	ownerName?: string;
	className?: string;
}) {
	const body = projectPresentedArtifact(show, item);
	const title = show.title?.trim() || item?.title || "Presented artifact";
	const kind = show.artifactKind ?? item?.artifactKind ?? "artifact";
	const eyebrow = ownerName ? `${kind} · ${ownerName}` : kind;

	switch (body.kind) {
		case "mermaid":
			return (
				<ArtifactCard
					className={cn("self-stretch", className)}
					eyebrow={eyebrow}
					title={title}
				>
					<SourceBlock language="mermaid" source={body.source ?? ""} />
				</ArtifactCard>
			);
		case "markdown":
			return (
				<ArtifactCard className={className} eyebrow={eyebrow} title={title}>
					<SourceBlock language="markdown" source={body.source ?? ""} />
				</ArtifactCard>
			);
		case "image":
			return (
				<figure
					className={cn(
						"flex max-h-full min-h-0 w-full max-w-3xl flex-col items-center gap-2",
						className,
					)}
				>
					{/* biome-ignore lint/performance/noImgElement: artifact URIs are hub-local or inline data — next/image cannot be configured for them. */}
					<img
						alt={show.caption?.trim() || title}
						className="min-h-0 w-full flex-1 rounded-md border border-border bg-background object-contain"
						src={body.uri}
					/>
					<figcaption className="flex w-full items-center justify-center gap-1.5 text-center text-xs text-foreground">
						<ImageIcon
							aria-hidden="true"
							className="size-3 text-muted-foreground"
						/>
						{title}
					</figcaption>
				</figure>
			);
		case "uri":
			return (
				<ArtifactCard className={className} eyebrow={eyebrow} title={title}>
					<div className="flex min-h-0 flex-col gap-2 p-3">
						{item?.intent ? (
							<p className="text-xs text-muted-foreground">{item.intent}</p>
						) : null}
						<span className="inline-flex max-w-full items-center gap-1.5 self-start rounded-full border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground">
							<Link2 aria-hidden="true" className="size-3 shrink-0" />
							<span className="truncate">{shortUri(body.uri ?? "")}</span>
						</span>
					</div>
				</ArtifactCard>
			);
		case "empty":
			return (
				<div
					className={cn(
						"flex max-w-sm flex-col items-center gap-2 text-center",
						className,
					)}
				>
					<Presentation
						aria-hidden="true"
						className="size-6 text-muted-foreground"
					/>
					<p className="text-sm font-medium text-foreground">{title}</p>
					{item?.intent ? (
						<p className="text-xs text-muted-foreground">{item.intent}</p>
					) : null}
				</div>
			);
		default: {
			const _exhaustive: never = body.kind;
			return _exhaustive;
		}
	}
}
