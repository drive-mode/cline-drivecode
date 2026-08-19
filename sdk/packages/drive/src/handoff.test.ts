/**
 * Tier-0 handoff assembler tests (DRV-RETURN-LOOP).
 */

import type { BankDriveEvent, BankSnapshot, DriveEvent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	assembleHandoffPacket,
	assertNoForbiddenHandoffKeys,
	formatHandoffNarration,
	formatWhileAwayLine,
	HANDOFF_FORBIDDEN_KEYS,
} from "./handoff.js";

const MEDIA_BYTE_KEYS = [
	"uri",
	"dataUri",
	"svg",
	"image",
	"bytes",
	"thumbnail",
];

const roomId = "room_handoff";
const baseAt = "2026-07-30T10:00:00.000Z";

function emptyBank(): BankSnapshot {
	return {
		activePlanId: null,
		openTaskIds: [],
		nowTaskId: null,
		nextTaskId: null,
		nowTitle: null,
		nextTitle: null,
		nowLastFailure: null,
	};
}

function workEdit(path: string, id: string, at = baseAt): DriveEvent {
	return {
		schemaVersion: 1,
		id,
		roomId,
		at,
		type: "work.edit",
		track: "work",
		path,
	};
}

function workCommand(
	command: string,
	id: string,
	opts: { failed?: boolean; exitCode?: number; at?: string } = {},
): DriveEvent {
	return {
		schemaVersion: 1,
		id,
		roomId,
		at: opts.at ?? baseAt,
		type: "work.command",
		track: "work",
		command,
		failed: opts.failed,
		exitCode: opts.exitCode,
	};
}

describe("assembleHandoffPacket", () => {
	it("names done / open / resume-next / evidence from typed sources", () => {
		const bankEvents: BankDriveEvent[] = [
			{
				schemaVersion: 1,
				id: "bo1",
				at: "2026-07-30T10:01:00.000Z",
				roomId,
				callSessionId: "cs1",
				type: "drive_task_opened",
				taskId: "t-parse",
				title: "Fix parser",
			},
			{
				schemaVersion: 1,
				id: "bc1",
				at: "2026-07-30T10:05:00.000Z",
				roomId,
				callSessionId: "cs1",
				type: "drive_task_completed",
				taskId: "t-parse",
			},
			{
				schemaVersion: 1,
				id: "bo2",
				at: "2026-07-30T10:02:00.000Z",
				roomId,
				callSessionId: "cs1",
				type: "drive_task_opened",
				taskId: "t-tests",
				title: "Rerun tests",
			},
		];
		const bankSnapshot: BankSnapshot = {
			activePlanId: "p1",
			openTaskIds: ["t-tests", "t-docs"],
			nowTaskId: "t-tests",
			nextTaskId: "t-docs",
			nowTitle: "Rerun tests",
			nextTitle: "Write docs",
			nowLastFailure: "assert failed",
		};
		const roomEvents: DriveEvent[] = [
			workEdit("src/parser.ts", "e1"),
			workCommand("bun test", "c1", { exitCode: 0 }),
			{
				schemaVersion: 1,
				id: "d1",
				roomId,
				at: baseAt,
				type: "work.decision",
				track: "work",
				title: "Approach",
				choice: "rewrite lexer",
			},
		];

		const packet = assembleHandoffPacket({
			roomEvents,
			bankSnapshot,
			bankEvents,
			rollup: {
				durationMs: 600_000,
				tasksCompleted: 1,
				midPlanAddCount: 0,
				completedTaskIds: ["t-parse"],
			},
		});

		expect(packet.done).toEqual([{ taskId: "t-parse", title: "Fix parser" }]);
		expect(packet.open[0]).toMatchObject({
			taskId: "t-tests",
			title: "Rerun tests",
			lastFailure: "assert failed",
		});
		expect(packet.resumeNext).toEqual({
			nowTaskId: "t-tests",
			nextTaskId: "t-docs",
			nowTitle: "Rerun tests",
			nextTitle: "Write docs",
		});
		expect(packet.evidence.editPaths).toEqual(["src/parser.ts"]);
		expect(packet.evidence.commands[0]).toMatchObject({
			command: "bun test",
			exitCode: 0,
		});
		expect(packet.evidence.decisions[0]).toEqual({
			title: "Approach",
			choice: "rewrite lexer",
		});
		expect(packet.counts.tasksCompleted).toBe(1);
		expect(packet.counts.durationMs).toBe(600_000);

		const narration = formatHandoffNarration(packet);
		expect(narration).toContain("Fix parser");
		expect(narration).toContain("Rerun tests");
		expect(narration).toContain("src/parser.ts");
		expect(narration).toContain("bun test");
		expect(narration).not.toMatch(/transcript|audio|utterance/i);
	});

	it("forbids transcript/audio/utterance keys on packets", () => {
		const packet = assembleHandoffPacket({
			roomEvents: [],
			bankSnapshot: emptyBank(),
		});
		expect(() => assertNoForbiddenHandoffKeys(packet)).not.toThrow();
		expect(() =>
			assertNoForbiddenHandoffKeys({ ...packet, transcript: "nope" }),
		).toThrow(/forbidden key "transcript"/);
		expect(HANDOFF_FORBIDDEN_KEYS).toContain("utterance");
		expect(HANDOFF_FORBIDDEN_KEYS).toContain("audio");
	});

	it("forbids artifact byte keys on packets", () => {
		const packet = assembleHandoffPacket({
			roomEvents: [],
			bankSnapshot: emptyBank(),
		});
		expect(() =>
			assertNoForbiddenHandoffKeys({
				...packet,
				evidence: {
					...packet.evidence,
					uri: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
				},
			}),
		).toThrow(/forbidden key "uri"/);
		for (const key of MEDIA_BYTE_KEYS) {
			expect(HANDOFF_FORBIDDEN_KEYS).toContain(key);
		}
	});

	it("draws no evidence from media.artifact events", () => {
		const packet = assembleHandoffPacket({
			roomEvents: [
				workEdit("src/parser.ts", "e1"),
				{
					schemaVersion: 1,
					id: "m1",
					roomId,
					at: baseAt,
					type: "media.artifact",
					track: "media",
					showItemId: "show-1",
					artifactKind: "diagram.architecture",
					mediaClass: "still",
					title: "Topology",
					caption: "Hub is the single writer",
					ownerParticipantId: "agent_partner",
					produce: {
						tool: "render_mermaid",
						args: { mermaidSource: "flowchart LR\n  A --> B" },
					},
					status: "shown",
				},
			],
			bankSnapshot: emptyBank(),
		});
		expect(packet.evidence.editPaths).toEqual(["src/parser.ts"]);
		expect(packet.evidence.commands).toEqual([]);
		expect(packet.evidence.decisions).toEqual([]);
		expect(packet.done).toEqual([]);
		expect(formatHandoffNarration(packet)).not.toContain("Topology");
	});

	it("scopes evidence to sinceAt for while-away catch-up", () => {
		const roomEvents: DriveEvent[] = [
			workEdit("old.ts", "e0", "2026-07-30T09:00:00.000Z"),
			workEdit("new.ts", "e1", "2026-07-30T11:00:00.000Z"),
			workCommand("bun lint", "c1", {
				at: "2026-07-30T11:05:00.000Z",
				exitCode: 0,
			}),
		];
		const bankSnapshot: BankSnapshot = {
			...emptyBank(),
			activePlanId: "p1",
			openTaskIds: ["t1"],
			nowTaskId: "t1",
			nowTitle: "Ship handoff",
		};
		const packet = assembleHandoffPacket({
			roomEvents,
			bankSnapshot,
			sinceAt: "2026-07-30T10:30:00.000Z",
		});
		expect(packet.evidence.editPaths).toEqual(["new.ts"]);
		expect(packet.evidence.commands).toHaveLength(1);
		const line = formatWhileAwayLine(packet);
		expect(line).toMatch(/^Since you left:/);
		expect(line).toContain("new.ts");
		expect(line).toContain("Ship handoff");
		expect(line).not.toContain("old.ts");
	});

	it("returns empty while-away line when nothing happened", () => {
		const packet = assembleHandoffPacket({
			roomEvents: [],
			bankSnapshot: emptyBank(),
		});
		expect(formatWhileAwayLine(packet)).toBe("");
	});
});
