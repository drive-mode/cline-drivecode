"use client";

import { RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { PageFrame, PageHeader } from "@/components/views/page-layout";
import {
	type DriveSection,
	driveSectionDefinition,
} from "@/lib/drive/drive-section";
import { useDriveHub } from "@/lib/drive/use-drive-hub";

/**
 * Honest empty state: the hub is not there, so nothing on this surface is
 * real yet. The demo is offered, never silently substituted.
 */
export function DriveUnreachableState({
	section,
	onExploreDemo,
}: {
	section: DriveSection;
	onExploreDemo: () => void;
}) {
	const { hub, retry } = useDriveHub();
	const definition = driveSectionDefinition(section);
	return (
		<PageFrame>
			<PageHeader
				description={definition.description}
				icon={definition.icon}
				title={definition.label}
			/>
			<Empty className="border border-dashed border-border bg-card">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Unplug aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>Cline Hub is unreachable</EmptyTitle>
					<EmptyDescription>
						Drive runs against the Cline Hub daemon this app started. It is not
						answering right now
						{hub.error ? ` (${hub.error})` : ""}. Retry once it is back, or look
						around the labeled demo world — nothing in the demo touches a real
						room.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<div className="flex flex-wrap items-center justify-center gap-2">
						<Button
							onClick={() => void retry()}
							type="button"
							variant="outline"
						>
							<RefreshCw aria-hidden="true" className="size-4" />
							Retry
						</Button>
						<Button onClick={onExploreDemo} type="button">
							Explore the demo world
						</Button>
					</div>
				</EmptyContent>
			</Empty>
		</PageFrame>
	);
}
