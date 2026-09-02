// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard, downloadTextFile } from "./text-export";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("copyTextToClipboard", () => {
	it("uses the async clipboard when it works", async () => {
		const writeText = vi.fn(async () => {});
		expect(await copyTextToClipboard("hello", { writeText })).toBe(true);
		expect(writeText).toHaveBeenCalledWith("hello");
	});

	it("falls back to execCommand when the async API is missing or fails", async () => {
		const execCommand = vi.fn(() => true);
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});
		expect(await copyTextToClipboard("hello", null)).toBe(true);
		expect(execCommand).toHaveBeenCalledWith("copy");
		const failing = {
			writeText: vi.fn(async () => {
				throw new Error("denied");
			}),
		};
		expect(await copyTextToClipboard("again", failing)).toBe(true);
		expect(document.querySelector("textarea")).toBeNull();
	});

	it("reports failure honestly", async () => {
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: vi.fn(() => false),
		});
		expect(await copyTextToClipboard("nope", null)).toBe(false);
	});
});

describe("downloadTextFile", () => {
	it("offers a blob download through a temporary anchor", () => {
		const createObjectURL = vi.fn(() => "blob:test");
		const revokeObjectURL = vi.fn();
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: createObjectURL,
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: revokeObjectURL,
		});
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => {});
		expect(downloadTextFile({ filename: "digest.md", contents: "# hi" })).toBe(
			true,
		);
		expect(createObjectURL).toHaveBeenCalledTimes(1);
		expect(click).toHaveBeenCalledTimes(1);
		expect(document.querySelector("a[download]")).toBeNull();
	});

	it("returns false without object URLs", () => {
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: undefined,
		});
		expect(downloadTextFile({ filename: "x.md", contents: "" })).toBe(false);
	});
});
