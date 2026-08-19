import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clampPipPosition,
	DRIVE_PIP_POSITION_STORAGE_KEY,
	defaultPipPosition,
	parseDrivePipPositionStorage,
	readDrivePipPosition,
	writeDrivePipPosition,
} from "./drive-pip-position";

function stubSessionStorage(seed?: string) {
	const store = new Map<string, string>();
	if (seed !== undefined) {
		store.set(DRIVE_PIP_POSITION_STORAGE_KEY, seed);
	}
	vi.stubGlobal("window", {
		sessionStorage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => {
				store.set(key, value);
			},
		},
	});
	return store;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("parseDrivePipPositionStorage", () => {
	it("keeps finite left/top under non-empty keys", () => {
		expect(
			parseDrivePipPositionStorage(
				JSON.stringify({
					a: { left: 10, top: 20 },
					b: { left: "x", top: 1 },
					"": { left: 0, top: 0 },
					c: null,
				}),
			),
		).toEqual({ a: { left: 10, top: 20 } });
	});

	it("falls back to empty for missing or malformed state", () => {
		expect(parseDrivePipPositionStorage(null)).toEqual({});
		expect(parseDrivePipPositionStorage("nope")).toEqual({});
		expect(parseDrivePipPositionStorage("[1]")).toEqual({});
	});
});

describe("clampPipPosition / defaultPipPosition", () => {
	const viewport = { width: 800, height: 600 };
	const size = { width: 240, height: 120 };

	it("clamps into the viewport", () => {
		expect(clampPipPosition({ left: -40, top: 900 }, viewport, size)).toEqual({
			left: 0,
			top: 480,
		});
		expect(clampPipPosition({ left: 900, top: -10 }, viewport, size)).toEqual({
			left: 560,
			top: 0,
		});
	});

	it("defaults to bottom-right with a 16px margin", () => {
		expect(defaultPipPosition(viewport, size)).toEqual({
			left: 544,
			top: 464,
		});
	});
});

describe("drive pip position session persistence", () => {
	it("defaults to null for an unseen room", () => {
		stubSessionStorage();
		expect(readDrivePipPosition("default")).toBeNull();
	});

	it("round-trips per room", () => {
		const store = stubSessionStorage(
			JSON.stringify({ other: { left: 1, top: 2 } }),
		);
		writeDrivePipPosition("default", { left: 40, top: 50 });
		expect(readDrivePipPosition("default")).toEqual({ left: 40, top: 50 });
		expect(readDrivePipPosition("other")).toEqual({ left: 1, top: 2 });
		expect(store.get(DRIVE_PIP_POSITION_STORAGE_KEY)).toBe(
			JSON.stringify({
				other: { left: 1, top: 2 },
				default: { left: 40, top: 50 },
			}),
		);
	});

	it("survives storage that throws", () => {
		vi.stubGlobal("window", {
			sessionStorage: {
				getItem: () => {
					throw new Error("blocked");
				},
				setItem: () => {
					throw new Error("blocked");
				},
			},
		});
		expect(readDrivePipPosition("default")).toBeNull();
		expect(() =>
			writeDrivePipPosition("default", { left: 1, top: 2 }),
		).not.toThrow();
	});
});
