"use client";

/**
 * The Drive shell: the connection banner and the section switch under the
 * shell-wide `DriveHubProvider` (mounted in `app/page.tsx`). Sections are their own files so later work replaces a
 * body without touching this file.
 *
 * `demoWorld` is decided by the composition root (`app/page.tsx`). This
 * component never reads the query string or env itself; the only other way
 * into the demo is the person opting in from the unreachable state, which
 * is a local preference and is shown as such.
 */

import type { ReactNode } from "react";
import { DriveHubRoot } from "@/lib/drive/drive-hub-root";
import { useDrivePrefs } from "@/lib/drive/drive-prefs";
import type { DriveSection } from "@/lib/drive/drive-section";
import { useDriveHub, useOptionalDriveHub } from "@/lib/drive/use-drive-hub";
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

function DriveShell({
	section,
	demoWorld,
	onNavigateSection,
}: Omit<DriveViewProps, "roomId">) {
	const [, updatePrefs] = useDrivePrefs();
	return (
		<>
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
		</>
	);
}

/**
 * Uses the shell-wide provider from `app/page.tsx` when there is one, and
 * mounts its own otherwise (tests, or a host that renders the view alone).
 */
function DriveHubBoundary({
	demoWorld,
	roomId,
	children,
}: {
	demoWorld: boolean;
	roomId: string | null;
	children: ReactNode;
}) {
	const hub = useOptionalDriveHub();
	if (hub) {
		return children;
	}
	return (
		<DriveHubRoot demoWorld={demoWorld} roomId={roomId}>
			{children}
		</DriveHubRoot>
	);
}

export function DriveView({
	section,
	roomId,
	demoWorld,
	onNavigateSection,
}: DriveViewProps) {
	return (
		<div
			className="cline-view-enter flex h-full min-h-0 flex-1 flex-col bg-background text-foreground"
			data-drive-section={section}
		>
			<DriveHubBoundary demoWorld={demoWorld} roomId={roomId}>
				<DriveShell
					demoWorld={demoWorld}
					onNavigateSection={onNavigateSection}
					section={section}
				/>
			</DriveHubBoundary>
		</div>
	);
}
