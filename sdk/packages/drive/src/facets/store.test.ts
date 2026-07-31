import { describe, expect, it } from "vitest";
import type { DriveFacetDiskSnapshot } from "@cline/shared";
import { DRIVE_FACET_CATALOG, listFacetDefs } from "./catalog";
import { createFacetStore } from "./store";

describe("DRIVE_FACET_CATALOG", () => {
	it("ships the Phase 0 durable pair plus live subMode and debugRetention", () => {
		expect(Object.keys(DRIVE_FACET_CATALOG).sort()).toEqual([
			"agent.appearance",
			"drive.defaults.subMode",
			"privacy.debugRetention",
			"room.live.subMode",
		]);
		expect(DRIVE_FACET_CATALOG["drive.defaults.subMode"].lane).toBe(
			"durable",
		);
		expect(DRIVE_FACET_CATALOG["room.live.subMode"].conflict).toBe(
			"live_wins",
		);
		expect(DRIVE_FACET_CATALOG["privacy.debugRetention"]).toMatchObject({
			lane: "live",
			scope: "session",
			defaultValue: false,
			privacy: "sensitive",
		});
	});

	it("lists defs by lane", () => {
		expect(listFacetDefs({ lane: "durable" })).toHaveLength(2);
		expect(listFacetDefs({ lane: "live" })).toHaveLength(2);
	});
});

describe("createFacetStore", () => {
	it("returns catalog defaults for an empty snapshot", () => {
		const store = createFacetStore();
		expect(store.get("drive.defaults.subMode")).toBe("plan");
		expect(store.get("agent.appearance").bodyInk).toEqual({
			kind: "token",
			token: "muted",
		});
		expect(store.get("room.live.subMode")).toBe("plan");
		expect(store.get("privacy.debugRetention")).toBe(false);
	});

	it("setLive toggles privacy.debugRetention for the session", () => {
		const store = createFacetStore();
		store.setLive("privacy.debugRetention", true);
		expect(store.get("privacy.debugRetention")).toBe(true);
		store.reload({
			schemaVersion: 1,
			values: {},
			maps: {},
		});
		// live_wins: disk reload must not clear the session debug flag
		expect(store.get("privacy.debugRetention")).toBe(true);
	});

	it("reload is idempotent and preserves live_wins values", () => {
		const store = createFacetStore();
		store.seedLiveFromDurable();
		store.setLive("room.live.subMode", "act");

		const disk: DriveFacetDiskSnapshot = {
			schemaVersion: 1,
			values: { "drive.defaults.subMode": "debug" },
			maps: {},
		};
		store.reload(disk);
		store.reload(disk);

		expect(store.get("drive.defaults.subMode")).toBe("debug");
		// Disk reload must not move the live value mid-call.
		expect(store.get("room.live.subMode")).toBe("act");
	});

	it("seeds live subMode from durable defaults once", () => {
		const store = createFacetStore({
			schemaVersion: 1,
			values: { "drive.defaults.subMode": "ask" },
			maps: {},
		});
		store.seedLiveFromDurable();
		expect(store.get("room.live.subMode")).toBe("ask");
	});

	it("reads agent.appearance from durable map by instance id", () => {
		const store = createFacetStore({
			schemaVersion: 1,
			values: {},
			maps: {
				"agent.appearance": {
					"agent.reviewer": {
						displayName: "Reviewer",
						nameInk: { kind: "palette", index: 2 },
						bodyInk: { kind: "token", token: "info" },
					},
				},
			},
		});
		expect(store.get("agent.appearance", "agent.reviewer").displayName).toBe(
			"Reviewer",
		);
		expect(store.get("agent.appearance", "missing").displayName).toBeUndefined();
	});
});
