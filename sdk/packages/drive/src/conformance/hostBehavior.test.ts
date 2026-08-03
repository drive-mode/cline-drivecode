import { describe, expect, it } from "vitest";
import { CLINE_HOST_CAPABILITIES, type DriveHostPort } from "../hostPort";
import {
	HOST_BEHAVIOR_CASES,
	runHostBehaviorConformance,
} from "./hostBehavior";
import { memoryDriveHost } from "./memoryHost";

describe("runHostBehaviorConformance", () => {
	it("passes against a real memoryDriveHost", async () => {
		const host = memoryDriveHost();
		const report = await runHostBehaviorConformance(host);
		expect(report.issues).toEqual([]);
		expect(report.ok).toBe(true);
	});

	it("exercises more than the five capability-field checks", () => {
		// The suite this replaces asserted five boolean HostCapabilities fields
		// and invoked zero methods. Guard that regression: every case here must
		// actually call into the host.
		expect(HOST_BEHAVIOR_CASES.length).toBeGreaterThan(5);
	});

	it("rejects a host whose mute is a silent no-op", async () => {
		const real = memoryDriveHost();
		const noopMuteHost: DriveHostPort = {
			...real,
			async commitRoomOp(op) {
				if (op.type === "mute") {
					// Deliberately broken: pretend to commit but never touch
					// muteByParticipantId — the exact bug this suite exists to catch.
					const current = await real.getRoom?.(op.roomId);
					if (!current) {
						throw new Error(`room_not_found:${op.roomId}`);
					}
					return current;
				}
				return real.commitRoomOp(op);
			},
		};

		const report = await runHostBehaviorConformance(noopMuteHost);
		expect(report.ok).toBe(false);
		expect(
			report.issues.some((issue) =>
				issue.code.startsWith("behavior_failed:mute_reflects_and_emits"),
			),
		).toBe(true);
	});

	it("rejects a host that never emits on commit", async () => {
		const real = memoryDriveHost();
		const silentHost: DriveHostPort = {
			...real,
			subscribe() {
				// Deliberately broken: accepts subscribers but never calls them.
				return () => {};
			},
		};

		const report = await runHostBehaviorConformance(silentHost);
		expect(report.ok).toBe(false);
		expect(
			report.issues.some((issue) =>
				issue.code.startsWith(
					"behavior_failed:subscribe_receives_commit_events",
				),
			),
		).toBe(true);
	});

	it("rejects a host that returns null/stub data from every method", async () => {
		// The exact host the old capability-only kit could not catch: declares
		// a legal capability matrix, invokes nothing, returns nothing real.
		const stubHost: DriveHostPort = {
			capabilities: CLINE_HOST_CAPABILITIES,
			async resolveKnownAgents() {
				return [];
			},
			async readDurableFacets() {
				return null;
			},
			async writeDurableFacets() {},
			async commitRoomOp() {
				return null as never;
			},
			async getRoom() {
				return null;
			},
			async broadcast() {},
			subscribe() {
				return () => {};
			},
			bridgeWorkEvents() {
				return () => {};
			},
			async applyPromptRewrite() {},
		};

		const report = await runHostBehaviorConformance(stubHost);
		expect(report.ok).toBe(false);
		expect(report.issues.length).toBeGreaterThan(0);
	});
});
