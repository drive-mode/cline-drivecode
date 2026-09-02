"use client";

/**
 * Placeholder body for a Drive section while its real surface is built.
 * Prints what the shell knows (phase, room, seq, last event) so the wiring
 * is visible on screen. Section files render this and nothing else; the
 * shell (`drive-view.tsx`) never needs to change when a body lands.
 */

import {
	CommandBadge,
	PageEmptyState,
	PageFrame,
	PageHeader,
} from "@/components/views/page-layout";
import {
	type DriveSection,
	driveSectionDefinition,
} from "@/lib/drive/drive-section";
import { selectRoster } from "@/lib/drive/room-state";
import { useDriveHub } from "@/lib/drive/use-drive-hub";

function hubPort(url: string | null): string | null {
	if (!url) {
		return null;
	}
	try {
		const parsed = new URL(url);
		return parsed.port || parsed.host || null;
	} catch {
		return null;
	}
}

export function DriveSectionPlaceholder({
	section,
}: {
	section: DriveSection;
}) {
	const { phase, hub, room, roomId, callLive } = useDriveHub();
	const definition = driveSectionDefinition(section);
	const roster = selectRoster(room);
	return (
		<PageFrame>
			<PageHeader
				description={definition.description}
				icon={definition.icon}
				meta={<CommandBadge>{phase}</CommandBadge>}
				title={definition.label}
			/>
			<PageEmptyState>
				<p className="font-medium text-foreground">
					{definition.label} is on its way.
				</p>
				<dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
					<dt className="text-muted-foreground">Phase</dt>
					<dd className="font-mono text-xs">{phase}</dd>
					<dt className="text-muted-foreground">Hub</dt>
					<dd className="font-mono text-xs">
						{hub.url ? `@${hubPort(hub.url) ?? "unknown"}` : "—"}
					</dd>
					<dt className="text-muted-foreground">Room</dt>
					<dd className="font-mono text-xs">
						{room.roomId ?? roomId}
						{callLive ? " · live" : ""}
					</dd>
					<dt className="text-muted-foreground">Seq</dt>
					<dd className="font-mono text-xs">{room.seq}</dd>
					<dt className="text-muted-foreground">Roster</dt>
					<dd className="font-mono text-xs">
						{roster.length > 0
							? roster.map((participant) => participant.displayName).join(", ")
							: "—"}
					</dd>
					<dt className="text-muted-foreground">Last event</dt>
					<dd className="font-mono text-xs">{room.lastEventAt ?? "—"}</dd>
				</dl>
			</PageEmptyState>
		</PageFrame>
	);
}
