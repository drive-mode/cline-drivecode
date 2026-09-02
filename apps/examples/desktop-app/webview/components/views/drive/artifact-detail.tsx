"use client";

/**
 * Artifact detail drawer — the recipe rendered for real where the source is
 * embedded (markdown, plan steps, code walkthrough, structured share),
 * mermaid as a code block, and an honest placeholder where the pixels live
 * on the Spotlight rather than in the directory.
 *
 * "Present on Spotlight" hands the hub a show item built from the entry
 * (`drive.show.present`) — the hub materializes it and broadcasts
 * `drive.show.presented`; this drawer never draws the stage itself.
 */

import type { DriveArtifactDirectoryEntry } from "@cline/drive";
import type { AgentProfile, Participant } from "@cline/shared";
import {
	Check,
	Circle,
	CircleCheck,
	CircleDot,
	Copy,
	ExternalLink,
	FileCode,
	Hash,
	MonitorPlay,
	Presentation,
	Tag,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MemoizedMarkdown } from "@/components/ui/markdown";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/hooks/use-toast";
import { openExternalUrl } from "@/lib/desktop-client";
import {
	type ArtifactBody,
	artifactEntryBodySource,
	type PlanStep,
	projectArtifactBody,
	showItemFromArtifact,
} from "@/lib/drive/artifact-body";
import {
	ARTIFACT_KIND_LABELS,
	artifactStatusLabel,
	MEDIA_CLASS_LABELS,
} from "@/lib/drive/artifact-filters";
import {
	artifactOwnerInitials,
	artifactOwnerInk,
	artifactOwnerLabel,
} from "@/lib/drive/artifact-owner";
import { parseDriveCommandError } from "@/lib/drive/drive-client";
import {
	absoluteTimeLabel,
	relativeTimeLabel,
} from "@/lib/drive/relative-time";
import { copyTextToClipboard } from "@/lib/drive/text-export";
import { useDriveHub } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";
import { ArtifactStatusBadge } from "./artifact-status-badge";
import { useDriveInkTheme } from "./use-drive-ink-theme";

export type ArtifactDetailSheetProps = {
	entry: DriveArtifactDirectoryEntry | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	participants: readonly Participant[];
	profiles: readonly AgentProfile[];
};

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
			{children}
		</div>
	);
}

function CodeBlock({
	language,
	source,
	label,
}: {
	language: string;
	source: string;
	label: string;
}) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) {
			return;
		}
		const timer = setTimeout(() => setCopied(false), 1_600);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<div className="overflow-hidden rounded-md border border-border bg-background">
			<div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
				<span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
					{language}
				</span>
				<Button
					aria-label={`Copy ${label}`}
					className="h-6 px-2 text-xs has-[>svg]:px-2"
					onClick={() => {
						void copyTextToClipboard(source).then((ok) => setCopied(ok));
					}}
					size="sm"
					type="button"
					variant="ghost"
				>
					{copied ? (
						<Check aria-hidden="true" className="size-3" />
					) : (
						<Copy aria-hidden="true" className="size-3" />
					)}
					{copied ? "Copied" : "Copy"}
				</Button>
			</div>
			<pre className="cline-chat-selectable max-h-96 overflow-auto px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
				<code>{source}</code>
			</pre>
		</div>
	);
}

function PlanStepRow({ step }: { step: PlanStep }) {
	const Icon =
		step.state === "done"
			? CircleCheck
			: step.state === "now"
				? CircleDot
				: Circle;
	return (
		<li className="flex items-start gap-2 py-1 text-sm">
			<Icon
				aria-hidden="true"
				className={cn(
					"mt-0.5 size-4 shrink-0",
					step.state === "done" && "text-success-text",
					step.state === "now" && "text-primary",
					step.state === "next" && "text-muted-foreground",
				)}
			/>
			<span
				className={cn(
					step.state === "done" && "text-muted-foreground line-through",
					step.state === "now" && "font-medium text-foreground",
				)}
			>
				{step.label}
			</span>
			<span className="sr-only">
				{step.state === "done"
					? "done"
					: step.state === "now"
						? "in progress"
						: "next"}
			</span>
		</li>
	);
}

function MediaPlaceholder({
	title,
	mediaClass,
	tool,
}: {
	title: string;
	mediaClass: string;
	tool: string;
}) {
	return (
		<div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-card px-4 py-8 text-center">
			<MonitorPlay
				aria-hidden="true"
				className="size-6 text-muted-foreground"
			/>
			<p className="text-sm font-medium text-foreground">
				Rendered on the Spotlight, not stored here
			</p>
			<p className="max-w-sm text-xs text-muted-foreground">
				The directory keeps the recipe for “{title}” (
				<span className="font-mono">{tool}</span>, {mediaClass}) — never the
				pixels. Present it to see it on the stage.
			</p>
		</div>
	);
}

function ArtifactBodyView({
	body,
	entry,
}: {
	body: ArtifactBody;
	entry: DriveArtifactDirectoryEntry;
}) {
	switch (body.kind) {
		case "mermaid":
			return (
				<CodeBlock
					label="mermaid source"
					language="mermaid"
					source={body.source}
				/>
			);
		case "markdown":
			return (
				<div className="rounded-md border border-border bg-background px-4 py-3">
					<MemoizedMarkdown classNames="text-sm" content={body.markdown} />
				</div>
			);
		case "plan":
			return (
				<div className="rounded-md border border-border bg-background px-4 py-3">
					<div className="mb-1 text-sm font-semibold">{body.title}</div>
					<ol className="divide-y divide-border">
						{body.steps.map((step, index) => (
							<PlanStepRow key={`${index}-${step.label}`} step={step} />
						))}
					</ol>
				</div>
			);
		case "walkthrough":
			return (
				<div className="overflow-hidden rounded-md border border-border bg-background">
					<div className="flex items-center gap-2 border-b border-border px-3 py-1.5 font-mono text-xs">
						<FileCode
							aria-hidden="true"
							className="size-3.5 text-muted-foreground"
						/>
						<span className="truncate text-foreground">{body.path}</span>
						{body.symbol ? (
							<span className="truncate text-muted-foreground">
								· {body.symbol}
							</span>
						) : null}
						{body.lines.length > 0 ? (
							<span className="ml-auto shrink-0 text-muted-foreground">
								L{body.startLine}–{body.endLine}
							</span>
						) : null}
					</div>
					{body.lines.length === 0 ? (
						<p className="px-3 py-3 text-xs text-muted-foreground">
							The recipe names the file and symbol; the snippet is rendered on
							the Spotlight when presented.
						</p>
					) : (
						<pre className="cline-chat-selectable max-h-96 overflow-auto py-2 font-mono text-xs leading-relaxed">
							{body.lines.map((line) => (
								<div
									className={cn(
										"flex gap-3 px-3",
										line.highlighted
											? "bg-primary/10 text-foreground"
											: "text-muted-foreground",
									)}
									key={line.number}
								>
									<span className="w-8 shrink-0 select-none text-right text-muted-foreground/70">
										{line.number}
									</span>
									<code className="whitespace-pre">{line.text}</code>
								</div>
							))}
						</pre>
					)}
				</div>
			);
		case "capture":
			return (
				<div className="overflow-hidden rounded-md border border-border bg-background">
					<div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
						<span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
							{body.url}
						</span>
						<Button
							className="h-6 px-2 text-xs has-[>svg]:px-2"
							onClick={() => void openExternalUrl(body.url)}
							size="sm"
							type="button"
							variant="ghost"
						>
							<ExternalLink aria-hidden="true" className="size-3" />
							Open
						</Button>
					</div>
					{body.shot ? (
						// biome-ignore lint/performance/noImgElement: an out-of-band capture pointer, not a bundled asset
						<img
							alt={`Capture of ${body.url}`}
							className="block max-h-96 w-full object-contain"
							src={body.shot}
						/>
					) : (
						<p className="px-3 py-3 text-xs text-muted-foreground">
							No capture bytes are kept in the directory — only the address.
						</p>
					)}
				</div>
			);
		case "structured":
			return (
				<div className="space-y-3">
					{body.items.length > 0 ? (
						<ul className="divide-y divide-border rounded-md border border-border bg-background">
							{body.items.map((item, index) => (
								<li
									className="flex items-center gap-2 px-3 py-1.5 text-sm"
									key={`${index}-${item}`}
								>
									<Hash
										aria-hidden="true"
										className="size-3 text-muted-foreground"
									/>
									{item}
								</li>
							))}
						</ul>
					) : null}
					{body.json ? (
						<CodeBlock
							label="structured payload"
							language="json"
							source={body.json}
						/>
					) : null}
				</div>
			);
		case "image":
			return (
				<div className="overflow-hidden rounded-md border border-border bg-background p-2">
					{/* biome-ignore lint/performance/noImgElement: the show's own pointer, not a bundled asset */}
					<img
						alt={entry.title}
						className="block max-h-96 w-full object-contain"
						src={body.uri}
					/>
				</div>
			);
		case "media":
			return (
				<MediaPlaceholder
					mediaClass={MEDIA_CLASS_LABELS[entry.mediaClass].toLowerCase()}
					title={entry.title}
					tool={entry.produce.tool}
				/>
			);
		case "empty":
			return (
				<p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
					Nothing renders from this recipe here. Present it to see what the hub
					materializes.
				</p>
			);
		default: {
			const _exhaustive: never = body;
			return _exhaustive;
		}
	}
}

export function ArtifactDetailSheet({
	entry,
	open,
	onOpenChange,
	participants,
	profiles,
}: ArtifactDetailSheetProps) {
	const { phase, source, roomId, callLive, room, humanParticipantId } =
		useDriveHub();
	const theme = useDriveInkTheme();
	const [presenting, setPresenting] = useState(false);
	// Remembered per artifact, so opening a different entry never inherits a
	// stale "Presented just now" from the previous one.
	const [presented, setPresented] = useState<{
		key: string;
		at: string;
	} | null>(null);
	const entryKey = entry ? `${entry.roomId} ${entry.showItemId}` : null;
	const presentedAt =
		presented && presented.key === entryKey ? presented.at : null;

	const body = useMemo(
		() => (entry ? projectArtifactBody(artifactEntryBodySource(entry)) : null),
		[entry],
	);
	const ownerLabel = entry
		? artifactOwnerLabel(entry.ownerParticipantId, participants)
		: "";
	const ownerInk = entry
		? artifactOwnerInk({
				ownerId: entry.ownerParticipantId,
				participants,
				profiles,
				theme,
			})
		: undefined;

	const sourceReady = phase === "live" || phase === "demo";
	const canPresent = sourceReady && callLive;
	const onStageNow =
		entry !== null && room.presentedShow?.showItemId === entry.showItemId;

	const present = useCallback(async () => {
		if (!entry || !canPresent) {
			return;
		}
		setPresenting(true);
		try {
			await source.command("drive.show.present", {
				roomId,
				showItem: showItemFromArtifact(entry, {
					// The human asked for it; the Director records who requested.
					ownerParticipantId: humanParticipantId,
				}),
			});
			setPresented({
				key: `${entry.roomId} ${entry.showItemId}`,
				at: new Date().toISOString(),
			});
			toast({
				title: "Presented on the Spotlight",
				description: `“${entry.title}” is on the stage in ${roomId}.`,
			});
		} catch (cause) {
			const parsed = parseDriveCommandError(cause);
			toast({
				variant: "destructive",
				title: "Could not present",
				description: parsed.code
					? `${parsed.code}: ${parsed.text}`
					: parsed.text,
			});
		} finally {
			setPresenting(false);
		}
	}, [canPresent, entry, humanParticipantId, roomId, source]);

	return (
		<Sheet onOpenChange={onOpenChange} open={open}>
			<SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
				{entry ? (
					<>
						<SheetHeader className="border-b border-border pr-12">
							<div className="flex items-center gap-2">
								<span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
									{ARTIFACT_KIND_LABELS[entry.artifactKind]}
								</span>
								<ArtifactStatusBadge status={entry.status} />
								{onStageNow ? (
									<Badge className="text-[10px]" variant="secondary">
										On the Spotlight now
									</Badge>
								) : null}
							</div>
							<SheetTitle className="text-base leading-snug">
								{entry.title}
							</SheetTitle>
							<SheetDescription className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
								<span className="inline-flex items-center gap-1.5">
									<span
										aria-hidden="true"
										className="inline-flex size-5 items-center justify-center rounded-full border bg-background text-[9px] font-semibold"
										style={
											ownerInk
												? { color: ownerInk, borderColor: ownerInk }
												: undefined
										}
									>
										{artifactOwnerInitials(ownerLabel)}
									</span>
									<span style={ownerInk ? { color: ownerInk } : undefined}>
										{ownerLabel}
									</span>
								</span>
								<span aria-hidden="true">·</span>
								<span className="font-mono text-xs">{entry.roomId}</span>
								<span aria-hidden="true">·</span>
								<span>{MEDIA_CLASS_LABELS[entry.mediaClass]}</span>
								<span aria-hidden="true">·</span>
								<span title={absoluteTimeLabel(entry.updatedAt)}>
									updated {relativeTimeLabel(entry.updatedAt) || "—"}
								</span>
							</SheetDescription>
							<div className="mt-2 flex flex-wrap items-center gap-2">
								<Button
									disabled={!canPresent || presenting}
									onClick={() => void present()}
									size="sm"
									type="button"
								>
									<Presentation aria-hidden="true" className="size-3.5" />
									{presenting
										? "Presenting…"
										: presentedAt
											? "Present again"
											: "Present on Spotlight"}
								</Button>
								<span className="text-xs text-muted-foreground">
									{!sourceReady
										? "Waiting for the hub."
										: !callLive
											? "Join the call to present this on the Spotlight."
											: entry.roomId !== roomId
												? `Produced in ${entry.roomId}; it will be presented in ${roomId}.`
												: presentedAt
													? `Presented ${relativeTimeLabel(presentedAt) || "just now"}.`
													: "Hands the recipe to the hub; the room sees it on the stage."}
								</span>
							</div>
						</SheetHeader>

						<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
							<section>
								<SectionLabel>Body</SectionLabel>
								{body ? <ArtifactBodyView body={body} entry={entry} /> : null}
							</section>

							{entry.tags.length > 0 ? (
								<section>
									<SectionLabel>Tags</SectionLabel>
									<div className="flex flex-wrap gap-1">
										{entry.tags.map((tag) => (
											<span
												className="inline-flex items-center gap-1 rounded-sm border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground"
												key={tag}
											>
												<Tag aria-hidden="true" className="size-2.5" />
												{tag}
											</span>
										))}
									</div>
								</section>
							) : null}

							<section>
								<SectionLabel>Recipe</SectionLabel>
								<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
									<dt className="text-muted-foreground">Tool</dt>
									<dd className="font-mono">{entry.produce.tool}</dd>
									<dt className="text-muted-foreground">Template</dt>
									<dd className="font-mono">
										{entry.produce.templateId ?? "—"}
									</dd>
									<dt className="text-muted-foreground">Show item</dt>
									<dd className="truncate font-mono">{entry.showItemId}</dd>
									<dt className="text-muted-foreground">Status</dt>
									<dd>{artifactStatusLabel(entry.status)}</dd>
									<dt className="text-muted-foreground">Created</dt>
									<dd>{absoluteTimeLabel(entry.createdAt)}</dd>
									<dt className="text-muted-foreground">Updated</dt>
									<dd>{absoluteTimeLabel(entry.updatedAt)}</dd>
								</dl>
							</section>
						</div>

						<div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
							Bytes-free by construction: the directory records the recipe,
							never the rendered image.
						</div>
					</>
				) : (
					<SheetHeader>
						<SheetTitle>Artifact</SheetTitle>
						<SheetDescription>Nothing selected.</SheetDescription>
					</SheetHeader>
				)}
			</SheetContent>
		</Sheet>
	);
}
