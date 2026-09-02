"use client";

/**
 * Mounts the one `DriveHubProvider` for the whole shell.
 *
 * It lives above both the sidebar and the main pane (see `app/page.tsx`) so
 * the sidebar's live dot and Demo badge see the same room the Drive view
 * renders, and so a call keeps its presence while another view is on
 * screen. `demoWorld` is the composition root's decision; the only other way
 * into the demo is the person opting in from the unreachable state, which is
 * a local preference.
 */

import { type ReactNode, useEffect, useMemo } from "react";
import { createDemoDriveSource, DEMO_ROOM_ID } from "./demo-world";
import { useDrivePrefs } from "./drive-prefs";
import { createHubDriveSource, type DriveDataSource } from "./drive-source";
import { DriveHubProvider } from "./use-drive-hub";

export function DriveHubRoot({
	demoWorld,
	roomId,
	children,
}: {
	demoWorld: boolean;
	roomId: string | null;
	children: ReactNode;
}) {
	const [prefs] = useDrivePrefs();
	const useDemo = demoWorld || prefs.demoOptIn;
	const source = useMemo<DriveDataSource>(
		() => (useDemo ? createDemoDriveSource() : createHubDriveSource()),
		[useDemo],
	);
	useEffect(() => () => source.dispose(), [source]);
	return (
		<DriveHubProvider
			// The demo world has exactly one room; an unbound location lands
			// there instead of on the hub's default room id.
			roomId={useDemo ? (roomId ?? DEMO_ROOM_ID) : roomId}
			source={source}
		>
			{children}
		</DriveHubProvider>
	);
}
