"use client";

import type { DriveSection } from "@/lib/drive/drive-section";
import { DriveSectionPlaceholder } from "./drive-section-placeholder";

export type CallViewProps = {
	onNavigateSection: (section: DriveSection) => void;
};

/** Placeholder — replaced by the real call surface. */
export function CallView(_props: CallViewProps) {
	return <DriveSectionPlaceholder section="call" />;
}
