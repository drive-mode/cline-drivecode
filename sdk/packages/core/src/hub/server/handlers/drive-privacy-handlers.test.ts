import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getLiveRetentionFacets,
	resetLiveRetentionFacetsForTests,
} from "../../collaboration/retentionCaps";
import type { HubTransportContext } from "./context";
import { handleDrivePrivacyCommand } from "./drive-privacy-handlers";

function command(
	name: HubCommandEnvelope["command"],
	payload?: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		requestId: "req_privacy",
		clientId: "test",
		command: name,
		payload,
	};
}

function ctx(): HubTransportContext {
	return {
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		pendingDriveToolInputs: new Map(),
		activeRpcTurnCountBySession: new Map(),
		sessionHost: {} as HubTransportContext["sessionHost"],
		publish: () => {},
		buildEvent: (
			event: HubEventEnvelope["event"],
			payload?: Record<string, unknown>,
		) =>
			({
				version: "v1",
				event,
				payload,
			}) as unknown as HubEventEnvelope,
		requestCapability: vi.fn(),
	} as unknown as HubTransportContext;
}

describe("handleDrivePrivacyCommand", () => {
	afterEach(() => {
		resetLiveRetentionFacetsForTests();
	});

	it("requires configParent or workspaceRoot", () => {
		const reply = handleDrivePrivacyCommand(
			ctx(),
			command("drive_privacy_put", { debugRetention: true }),
		);
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("invalid_payload");
	});

	it("sets the live debugRetention facet for the given workspace only", () => {
		const reply = handleDrivePrivacyCommand(
			ctx(),
			command("drive_privacy_put", {
				workspaceRoot: "/ws/a",
				debugRetention: true,
			}),
		);
		expect(reply.ok).toBe(true);
		expect(getLiveRetentionFacets("/ws/a")).toEqual({ debugRetention: true });
		expect(getLiveRetentionFacets("/ws/b")).toEqual({});
	});

	it("accepts configParent as an alias for workspaceRoot", () => {
		handleDrivePrivacyCommand(
			ctx(),
			command("drive_privacy_put", {
				configParent: "/ws/c",
				retentionRoomMax: 10,
				retentionBankMax: 20,
			}),
		);
		expect(getLiveRetentionFacets("/ws/c")).toEqual({
			retentionRoomMax: 10,
			retentionBankMax: 20,
		});
	});

	it("turning debugRetention off again clears the raised cap", () => {
		handleDrivePrivacyCommand(
			ctx(),
			command("drive_privacy_put", {
				workspaceRoot: "/ws/a",
				debugRetention: true,
			}),
		);
		handleDrivePrivacyCommand(
			ctx(),
			command("drive_privacy_put", {
				workspaceRoot: "/ws/a",
				debugRetention: false,
			}),
		);
		expect(getLiveRetentionFacets("/ws/a")).toEqual({ debugRetention: false });
	});

	it("merges onto existing facets instead of replacing them", () => {
		handleDrivePrivacyCommand(
			ctx(),
			command("drive_privacy_put", {
				workspaceRoot: "/ws/a",
				retentionRoomMax: 10,
				retentionBankMax: 20,
			}),
		);
		// A follow-up call that only sets debugRetention must not silently
		// drop the previously set retention overrides.
		handleDrivePrivacyCommand(
			ctx(),
			command("drive_privacy_put", {
				workspaceRoot: "/ws/a",
				debugRetention: true,
			}),
		);
		expect(getLiveRetentionFacets("/ws/a")).toEqual({
			debugRetention: true,
			retentionRoomMax: 10,
			retentionBankMax: 20,
		});
	});

	// A record count that accepts 0.5 floors to 0 downstream, and a cap of 0
	// means "write an empty file" — so an unusable cap must not be storable.
	it.each([
		["fractional below one", 0.5],
		["fractional above one", 10.5],
		["zero", 0],
		["negative", -5],
		["NaN", Number.NaN],
		["Infinity", Number.POSITIVE_INFINITY],
	])("drops a %s retention cap rather than storing it", (_label, value) => {
		const reply = handleDrivePrivacyCommand(
			ctx(),
			command("drive_privacy_put", {
				workspaceRoot: "/ws/frac",
				retentionRoomMax: value,
				retentionBankMax: value,
			}),
		);
		expect(reply.ok).toBe(true);
		expect(getLiveRetentionFacets("/ws/frac")).toEqual({});
	});

	it("does not clobber a previously valid cap with an unusable one", () => {
		handleDrivePrivacyCommand(
			ctx(),
			command("drive_privacy_put", {
				workspaceRoot: "/ws/keep",
				retentionRoomMax: 500,
			}),
		);
		handleDrivePrivacyCommand(
			ctx(),
			command("drive_privacy_put", {
				workspaceRoot: "/ws/keep",
				retentionRoomMax: 0.5,
			}),
		);
		expect(getLiveRetentionFacets("/ws/keep")).toEqual({
			retentionRoomMax: 500,
		});
	});

	it("echoes the applied facets so a dropped value is visible to the caller", () => {
		const reply = handleDrivePrivacyCommand(
			ctx(),
			command("drive_privacy_put", {
				workspaceRoot: "/ws/echo",
				retentionRoomMax: 0.5,
				retentionBankMax: 64,
			}),
		);
		expect(reply.ok).toBe(true);
		expect(reply.payload?.facets).toEqual({ retentionBankMax: 64 });
	});
});
