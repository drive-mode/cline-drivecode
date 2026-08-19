import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubCommandEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createClineDriveHost } from "../../clineDriveHost";
import { DriveRoomStore } from "../../collaboration/room";
import {
	__resetCatalogFacetStoresForTests,
	getCatalogDefaultSubMode,
	loadCatalogFacetStore,
} from "../../drive-config/driveCatalogFacetStore";
import type { HubTransportContext } from "./context";
import { handleDriveCatalogCommand } from "./drive-catalog-handlers";

function envelope(
	command: HubCommandEnvelope["command"],
	payload?: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		command,
		requestId: "req-catalog-1",
		payload,
	};
}

describe("drive catalog facet IO", () => {
	let root = "";

	afterEach(async () => {
		__resetCatalogFacetStoresForTests();
		if (root) {
			await rm(root, { recursive: true, force: true });
			root = "";
		}
	});

	it("rejects put of live-lane keys", async () => {
		root = await mkdtemp(join(tmpdir(), "drive-catalog-"));
		const ctx = {} as HubTransportContext;
		const reply = handleDriveCatalogCommand(
			ctx,
			envelope("drive_catalog_put", {
				workspaceRoot: root,
				values: { "room.live.subMode": "act" },
			}),
		);
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("live_key_rejected");
	});

	it("preserves live_wins across durable reload", async () => {
		root = await mkdtemp(join(tmpdir(), "drive-catalog-"));
		const store = loadCatalogFacetStore({ workspaceRoot: root });
		store.setLive("room.live.subMode", "act");
		expect(store.get("room.live.subMode")).toBe("act");

		const ctx = {} as HubTransportContext;
		const put = handleDriveCatalogCommand(
			ctx,
			envelope("drive_catalog_put", {
				workspaceRoot: root,
				values: { "drive.defaults.subMode": "debug" },
			}),
		);
		expect(put.ok).toBe(true);

		const reloaded = loadCatalogFacetStore({ workspaceRoot: root });
		expect(reloaded.get("drive.defaults.subMode")).toBe("debug");
		expect(reloaded.get("room.live.subMode")).toBe("act");
	});

	it("seeds room subMode from catalog default on create", async () => {
		root = await mkdtemp(join(tmpdir(), "drive-catalog-"));
		const ctx = {} as HubTransportContext;
		handleDriveCatalogCommand(
			ctx,
			envelope("drive_catalog_put", {
				workspaceRoot: root,
				values: { "drive.defaults.subMode": "ask" },
			}),
		);
		expect(getCatalogDefaultSubMode(root)).toBe("ask");

		const store = new DriveRoomStore();
		const host = createClineDriveHost({ store, configParent: root });
		const room = await host.commitRoomOp({
			type: "create",
			roomId: "room_seed",
			hostParticipantId: "human_1",
		});
		expect(room.subMode).toBe("ask");
	});
});
