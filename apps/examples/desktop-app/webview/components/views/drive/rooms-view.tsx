"use client";

import type { DriveSection } from "@/lib/drive/drive-section";
import { DriveSectionPlaceholder } from "./drive-section-placeholder";

export type RoomsViewProps = {
	onNavigateSection: (section: DriveSection) => void;
};

/** Placeholder — replaced by the real rooms surface. */
export function RoomsView(_props: RoomsViewProps) {
	return <DriveSectionPlaceholder section="rooms" />;
}
