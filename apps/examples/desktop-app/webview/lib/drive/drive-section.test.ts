import { describe, expect, it } from "vitest";
import {
	DEFAULT_DRIVE_SECTION,
	DRIVE_SECTION_IDS,
	DRIVE_SECTIONS,
	driveSectionDefinition,
	driveSectionTitle,
	driveWindowTitle,
	isDriveSection,
	parseDriveSection,
} from "./drive-section";

describe("drive sections", () => {
	it("lists every section exactly once, in navigation order", () => {
		expect(DRIVE_SECTIONS.map((section) => section.id)).toEqual([
			...DRIVE_SECTION_IDS,
		]);
		expect(DRIVE_SECTIONS[0]?.id).toBe(DEFAULT_DRIVE_SECTION);
		for (const section of DRIVE_SECTIONS) {
			expect(section.label.length).toBeGreaterThan(0);
			expect(section.description.length).toBeGreaterThan(0);
			expect(["function", "object"]).toContain(typeof section.icon);
		}
	});

	it("parses tolerant input and falls back to the lobby", () => {
		expect(parseDriveSection("call")).toBe("call");
		expect(parseDriveSection(" Status ")).toBe("status");
		expect(parseDriveSection("nope")).toBe("lobby");
		expect(parseDriveSection(undefined)).toBe("lobby");
		expect(parseDriveSection(42)).toBe("lobby");
		expect(isDriveSection("agents")).toBe(true);
		expect(isDriveSection("chat")).toBe(false);
	});

	it("titles sections for the header and the window", () => {
		expect(driveSectionTitle("status")).toBe("Status Hub");
		expect(driveSectionDefinition("settings").label).toBe("Drive Settings");
		expect(driveWindowTitle("call")).toBe("Drive · Call");
	});
});
