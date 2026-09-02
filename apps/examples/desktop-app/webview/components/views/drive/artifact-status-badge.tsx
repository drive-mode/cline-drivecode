"use client";

/**
 * Status ink for an artifact. Total over the status union, matching the
 * Rooms page — a new status has to be given ink here rather than quietly
 * inheriting whatever `planned` looks like.
 */

import type { MediaArtifactStatus } from "@cline/shared";
import { Badge } from "@/components/ui/badge";
import {
	ARTIFACT_STATUSES,
	artifactStatusLabel,
} from "@/lib/drive/artifact-filters";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<MediaArtifactStatus, string> = {
	showing: "border-primary/40 bg-primary/10 text-primary",
	ready: "border-warning-border bg-warning-surface text-warning-text",
	planned: "border-border text-muted-foreground",
	shown: "border-success-border bg-success-surface text-success-text",
	cancelled: "border-border text-muted-foreground line-through",
};

export function ArtifactStatusBadge({
	status,
	className,
}: {
	status: MediaArtifactStatus;
	className?: string;
}) {
	const hint = ARTIFACT_STATUSES.find((entry) => entry.id === status)?.hint;
	return (
		<Badge
			className={cn("shrink-0 text-[10px]", STATUS_CLASS[status], className)}
			title={hint}
			variant="outline"
		>
			{artifactStatusLabel(status)}
		</Badge>
	);
}
