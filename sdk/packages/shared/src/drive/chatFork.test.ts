import { describe, expect, it } from "vitest";
import {
	ChatForkRecordSchema,
	parseChatForkRecord,
	parsePromotePacket,
	parseSeedPacket,
	SeedPacketSchema,
} from "./chatFork";

describe("chatFork schemas", () => {
	it("parses a path_disjoint seed packet", () => {
		const seed = parseSeedPacket({
			doItemId: "do-1",
			title: "Fix flake",
			goal: "Stabilize auth test",
			parentBriefing: "Keep auth green",
			assigneeParticipantId: "agent-1",
			allowedPathPrefixes: ["src/auth"],
			linkedShowTemplateIds: ["work.card"],
			workspace: { mode: "path_disjoint" },
			parentSessionId: "sess-main",
		});
		expect(seed.workspace.mode).toBe("path_disjoint");
	});

	it("requires worktreePath for worktree_isolated", () => {
		expect(() =>
			SeedPacketSchema.parse({
				doItemId: "do-1",
				title: "Fix flake",
				goal: "Stabilize auth test",
				parentBriefing: "Keep auth green",
				assigneeParticipantId: "agent-1",
				allowedPathPrefixes: [],
				linkedShowTemplateIds: [],
				workspace: { mode: "worktree_isolated" },
				parentSessionId: "sess-main",
			}),
		).toThrow();
	});

	it("parses a seed packet without depth (legacy record)", () => {
		const seed = parseSeedPacket({
			doItemId: "do-1",
			title: "Fix flake",
			goal: "Stabilize auth test",
			parentBriefing: "Keep auth green",
			assigneeParticipantId: "agent-1",
			allowedPathPrefixes: [],
			linkedShowTemplateIds: [],
			workspace: { mode: "shared_readonly" },
			parentSessionId: "sess-main",
		});
		expect(seed.depth).toBeUndefined();
	});

	it("carries depth through parsing", () => {
		const seed = parseSeedPacket({
			doItemId: "do-1",
			title: "Fix flake",
			goal: "Stabilize auth test",
			parentBriefing: "",
			assigneeParticipantId: "agent-1",
			allowedPathPrefixes: [],
			linkedShowTemplateIds: [],
			workspace: { mode: "shared_readonly" },
			parentSessionId: "sess-worker",
			depth: 2,
		});
		expect(seed.depth).toBe(2);
	});

	it("parses a refused chat fork record with a refusal reason", () => {
		const record = parseChatForkRecord({
			workerSessionId: "refused_abc",
			lifecycle: "refused",
			seed: {
				doItemId: "do-1",
				title: "Fix flake",
				goal: "Stabilize auth test",
				parentBriefing: "",
				assigneeParticipantId: "agent-1",
				allowedPathPrefixes: [],
				linkedShowTemplateIds: [],
				workspace: { mode: "shared_readonly" },
				parentSessionId: "sess-worker",
				depth: 2,
			},
			promote: null,
			visibleToHuman: true,
			refusal: {
				code: "depth_exceeded",
				message: "Fork depth 2 exceeds max depth 1",
			},
		});
		expect(record.lifecycle).toBe("refused");
		expect(record.refusal?.code).toBe("depth_exceeded");
	});

	it("still accepts a record with no refusal (normal fork)", () => {
		expect(() =>
			ChatForkRecordSchema.parse({
				workerSessionId: "w1",
				lifecycle: "running",
				seed: {
					doItemId: "do-1",
					title: "Fix flake",
					goal: "Stabilize auth test",
					parentBriefing: "",
					assigneeParticipantId: "agent-1",
					allowedPathPrefixes: [],
					linkedShowTemplateIds: [],
					workspace: { mode: "shared_readonly" },
					parentSessionId: "sess-main",
				},
				promote: null,
				visibleToHuman: false,
			}),
		).not.toThrow();
	});

	it("parses a promote packet", () => {
		const promote = parsePromotePacket({
			workerSessionId: "sess-worker",
			doItemId: "do-1",
			status: "done",
			summary: "Fixed",
			decisions: ["Prefer waitFor"],
			showItemIds: ["show-1"],
			eventRefs: ["evt-1"],
			auditHandle: "audit-sess-worker",
			retainForAudit: true,
		});
		expect(promote.retainForAudit).toBe(true);
	});
});
