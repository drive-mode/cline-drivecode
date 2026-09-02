"use client";

import type { DriveSection } from "@/lib/drive/drive-section";
import { DriveSectionPlaceholder } from "./drive-section-placeholder";

export type LobbyViewProps = {
	onNavigateSection: (section: DriveSection) => void;
};

/** Placeholder — replaced by the real lobby surface. */
export function LobbyView(_props: LobbyViewProps) {
	return <DriveSectionPlaceholder section="lobby" />;
}
