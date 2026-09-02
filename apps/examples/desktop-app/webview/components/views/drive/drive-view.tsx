"use client";

/**
 * The Drive shell: one `DriveHubProvider`, the connection banner, and the
 * section switch. Sections are their own files so later work replaces a
 * body without touching this file.
 *
 * `demoWorld` is decided by the composition root (`app/page.tsx`). This
 * component never reads the query string or env itself; the only other way
 * into the demo is the person opting in from the unreachable state, which
 * is a local preference and is shown as such.
 */

import { useEffect, useMemo } from "react";
import { createDemoDriveSource, DEMO_ROOM_ID } from "@/lib/drive/demo-world";
import { useDrivePrefs } from "@/lib/drive/drive-prefs";
import type { DriveSection } from "@/lib/drive/drive-section";
import {
	createHubDriveSource,
	type DriveDataSource,
} from "@/lib/drive/drive-source";
import { DriveHubProvider, useDriveHub } from "@/lib/drive/use-drive-hub";
import { AgentsView } from "./agents-view";
import { AnalyticsView } from "./analytics-view";
import { ArtifactsView } from "./artifacts-view";
import { CallView } from "./call-view";
import { DriveConnectionBanner } from "./drive-connection-banner";
import { DriveSettingsView } from "./drive-settings-view";
import { DriveUnreachableState } from "./drive-unreachable-state";
import { LobbyView } from "./lobby-view";
import { RoomsView } from "./rooms-view";
import { StatusView } from "./status-view";
import { TasksView } from "./tasks-view";

export type DriveViewProps = {
	section: DriveSection;
	/** Hub room to bind; null = the default room. */
	roomId: string | null;
	/** Composition-root decision: mount the labeled demo world. */
	demoWorld: boolean;
	onNavigateSection: (section: DriveSection) => void;
};

function DriveSectionPane({
	section,
	onNavigateSection,
}: {
	section: DriveSection;
	onNavigateSection: (section: DriveSection) => void;
}) {
	switch (section) {
		case "lobby":
			return <LobbyView onNavigateSection={onNavigateSection} />;
		case "call":
			return <CallView onNavigateSection={onNavigateSection} />;
		case "rooms":
			return <RoomsView onNavigateSection={onNavigateSection} />;
		case "artifacts":
			return <ArtifactsView />;
		case "tasks":
			return <TasksView />;
		case "status":
			return <StatusView />;
		case "analytics":
			return <AnalyticsView />;
		case "agents":
			return <AgentsView />;
		case "settings":
			return <DriveSettingsView />;
		default: {
			const _exhaustive: never = section;
			return _exhaustive;
		}
	}
}

function DriveSectionSwitch({
	section,
	demoForced,
	onExploreDemo,
	onNavigateSection,
}: {
	section: DriveSection;
	demoForced: boolean;
	onExploreDemo: () => void;
	onNavigateSection: (section: DriveSection) => void;
}) {
	const { phase } = useDriveHub();
	if (phase === "unreachable" && !demoForced) {
		return (
			<DriveUnreachableState onExploreDemo={onExploreDemo} section={section} />
		);
	}
	return (
		<div
			className="cline-view-enter flex min-h-0 flex-1 flex-col"
			key={section}
		>
			<DriveSectionPane
				onNavigateSection={onNavigateSection}
				section={section}
			/>
		</div>
	);
}

export function DriveView({
	section,
	roomId,
	demoWorld,
	onNavigateSection,
}: DriveViewProps) {
	const [prefs, updatePrefs] = useDrivePrefs();
	const useDemo = demoWorld || prefs.demoOptIn;
	const source = useMemo<DriveDataSource>(
		() => (useDemo ? createDemoDriveSource() : createHubDriveSource()),
		[useDemo],
	);
	useEffect(() => () => source.dispose(), [source]);

	return (
		<div
			className="cline-view-enter flex h-full min-h-0 flex-1 flex-col bg-background text-foreground"
			data-drive-section={section}
		>
			<DriveHubProvider
				// The demo world has exactly one room; an unbound location lands
				// there instead of on the hub's default room id.
				roomId={useDemo ? (roomId ?? DEMO_ROOM_ID) : roomId}
				source={source}
			>
				<DriveConnectionBanner
					demoForced={demoWorld}
					onLeaveDemo={() => updatePrefs({ demoOptIn: false })}
				/>
				<DriveSectionSwitch
					demoForced={demoWorld}
					onExploreDemo={() => updatePrefs({ demoOptIn: true })}
					onNavigateSection={onNavigateSection}
					section={section}
				/>
			</DriveHubProvider>
		</div>
	);
}
