/**
 * Live room stack for Drive home — phone-only power glance (PU1).
 * Thin list; full directory stays on Rooms.
 */

import type { DriveRoomDirectoryEntry } from "@cline/drive";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DriveOpenCallRequest } from "./driveLaunch";
import type { DriveRoomsSource } from "../rooms/drive-rooms-source";
import { roomCardModel } from "../rooms/roomCardModel";

const LIVE_STACK_CAP = 3;

export function DriveLiveStack({
	roomsSource,
	workspaceRoot,
	onOpenCall,
}: {
	roomsSource: DriveRoomsSource;
	workspaceRoot?: string;
	onOpenCall: (request: DriveOpenCallRequest) => void;
}) {
	const [live, setLive] = useState<DriveRoomDirectoryEntry[]>([]);
	const [error, setError] = useState<string | null>(null);
	// Same race as RoomsView: a slow listRooms for the previous workspaceRoot
	// must not paint over the current one. Only the newest request may write.
	const requestSeqRef = useRef(0);

	const refresh = useCallback(async () => {
		const seq = ++requestSeqRef.current;
		const requestedRoot = workspaceRoot;
		try {
			const entries = await roomsSource.listRooms(requestedRoot);
			if (seq !== requestSeqRef.current) {
				return;
			}
			setLive(
				entries
					.filter((entry: DriveRoomDirectoryEntry) => entry.status === "live")
					.slice(0, LIVE_STACK_CAP),
			);
			setError(null);
		} catch (cause) {
			if (seq !== requestSeqRef.current) {
				return;
			}
			setError(cause instanceof Error ? cause.message : "Could not list rooms");
			setLive([]);
		}
	}, [roomsSource, workspaceRoot]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	if (error || live.length === 0) {
		return null;
	}

	return (
		<section
			aria-label="Live rooms"
			className="mb-6 rounded-lg border border-primary/30 bg-card"
		>
			<div className="flex items-center justify-between border-b border-primary/20 px-4 py-2">
				<h2 className="text-xs font-semibold uppercase tracking-wide text-primary">
					Live
				</h2>
				<span className="text-[11px] text-muted-foreground">
					{live.length === LIVE_STACK_CAP ? `Up to ${LIVE_STACK_CAP}` : live.length}{" "}
					{live.length === 1 ? "room" : "rooms"}
				</span>
			</div>
			<ul className="divide-y divide-border">
				{live.map((entry) => {
					const card = roomCardModel(entry);
					return (
						<li
							className="flex min-w-0 items-center gap-3 px-4 py-3"
							key={entry.roomId}
						>
							<span
								aria-hidden
								className="size-2 shrink-0 rounded-full bg-[color:var(--brand-green,#2BCC28)]"
							/>
							<div className="min-w-0 flex-1">
								<div className="flex min-w-0 items-center gap-2">
									<span className="truncate text-sm font-semibold">
										{card.roomId}
									</span>
									<Badge
										className={cn(
											"shrink-0 text-[10px] border-primary/40 text-primary",
										)}
										variant="outline"
									>
										Live
									</Badge>
								</div>
								<p className="mt-0.5 truncate text-xs text-muted-foreground">
									{card.meta}
								</p>
							</div>
							<Button
								onClick={() =>
									onOpenCall({
										action: "join",
										roomId: entry.roomId,
									})
								}
								size="sm"
								type="button"
							>
								Join
							</Button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
