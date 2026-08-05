/**
 * Self-check: DriveMarkMotion layers + motion prop for conversation load.
 * Run: bun -F @cline/cline-hub test src/webview/src/components/icons/drive-mark-motion.test.ts
 */
import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { DriveMarkMotion, type DriveMarkMotionKind } from "./drive-mark-motion";

const kinds: DriveMarkMotionKind[] = ["idle", "loading", "peek", "drive"];

describe("DriveMarkMotion", () => {
	it("exposes idle/loading/peek/drive", () => {
		expect(kinds).toEqual(["idle", "loading", "peek", "drive"]);
	});

	it("renders layered wheel + head with data-motion", () => {
		const tree = DriveMarkMotion({
			motion: "loading",
		}) as ReactElement<{
			"data-motion": string;
			"aria-hidden"?: boolean;
			children: ReactElement[];
		}>;
		expect(tree.props["data-motion"]).toBe("loading");
		expect(tree.props["aria-hidden"]).toBe(true);
		const kids = tree.props.children;
		const groups = (Array.isArray(kids) ? kids : [kids]).filter(
			(c): c is ReactElement<{ className?: string }> =>
				!!c && typeof c === "object" && "props" in c,
		);
		expect(groups.some((g) => g.props.className === "dm-wheel")).toBe(true);
		expect(groups.some((g) => g.props.className === "dm-head")).toBe(true);
	});

	it("createElement accepts loading for conversation hydrate", () => {
		const el = createElement(DriveMarkMotion, { motion: "loading" });
		expect(el.props.motion).toBe("loading");
	});
});
