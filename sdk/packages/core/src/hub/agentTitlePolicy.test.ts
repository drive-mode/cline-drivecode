import { createEmptyRoomSnapshot } from "@cline/drive";
import { describe, expect, it } from "vitest";
import {
	builtInAgentTitleDefinitions,
	mintClineAgentTitleGrant,
	validateAgentTitleAuthorization,
	verifyBuiltInAgentTitleDefinitions,
} from "./agentTitlePolicy";

const at = new Date("2026-08-18T12:00:00.000Z");

describe("built-in Agent Title policy", () => {
	it("publishes exactly six signed, sanitized core definitions", () => {
		expect(verifyBuiltInAgentTitleDefinitions()).toBe(true);
		const definitions = builtInAgentTitleDefinitions();
		expect(definitions.map((definition) => definition.title)).toEqual([
			"presenter",
			"researcher",
			"builder",
			"reviewer",
			"verifier",
			"scribe",
		]);
		expect(
			definitions.every(
				(definition) =>
					definition.signatureStatus === "verified" &&
					definition.exportable === false &&
					definition.obligations.length > 0,
			),
		).toBe(true);

		const encoded = JSON.stringify(definitions);
		for (const forbidden of [
			"systemPrompt",
			"modelId",
			"apiKey",
			"privateKey",
			"endpoint",
			"routingRules",
		]) {
			expect(encoded).not.toContain(forbidden);
		}
	});

	it("mints permissions, bundles, temporal metadata, and exclusivity from the host recipe", () => {
		const grant = mintClineAgentTitleGrant({
			title: "builder",
			agentId: "maya",
			scope: { kind: "target", ref: "opaque-target-1" },
			taskId: "task-15",
			at,
		});

		expect(grant).toMatchObject({
			agentId: "maya",
			title: "builder",
			definitionRef: "builder@1",
			taskId: "task-15",
			scope: { kind: "target", ref: "opaque-target-1" },
			skillBundleRefs: ["builder-target"],
			permissions: ["target.modify"],
			generation: 1,
			exclusivityKey: "target/opaque-target-1",
			grantedBy: "cline:coordinator",
			policyRef: "drive.agent-titles@1",
		});
		expect(grant.issuedAt).toBe(grant.grantedAt);
		expect(grant.notBefore).toBe(grant.grantedAt);
		expect(grant.id).toMatch(/^cline_builder_/);
		expect(() =>
			mintClineAgentTitleGrant({
				title: "builder",
				agentId: "maya",
				scope: { kind: "room", ref: "room-1" },
				at,
			}),
		).toThrow(/title_scope_not_allowed:builder:room/);
		expect(() =>
			mintClineAgentTitleGrant({
				title: "builder",
				agentId: "maya",
				scope: { kind: "target", ref: "/Users/example/private-repo" },
				at,
			}),
		).toThrow(/title_scope_ref_must_be_opaque:target/);
	});

	it("authorizes one explicit grant without unioning another title's permissions", () => {
		const presenter = mintClineAgentTitleGrant({
			title: "presenter",
			agentId: "maya",
			scope: { kind: "stage", ref: "room-1" },
			at,
		});
		const builder = mintClineAgentTitleGrant({
			title: "builder",
			agentId: "maya",
			scope: { kind: "target", ref: "opaque-target-1" },
			at,
		});
		const snapshot = {
			...createEmptyRoomSnapshot({
				roomId: "room-1",
				createdAt: at.toISOString(),
			}),
			titleGrantsById: { [presenter.id]: presenter, [builder.id]: builder },
		};

		expect(
			validateAgentTitleAuthorization({
				snapshot,
				at: at.toISOString(),
				request: {
					grantId: presenter.id,
					agentId: "maya",
					permission: "target.modify",
					scope: presenter.scope,
					generation: 1,
				},
			}),
		).toMatchObject({ ok: false, code: "permission_denied" });
		expect(
			validateAgentTitleAuthorization({
				snapshot,
				at: at.toISOString(),
				request: {
					grantId: builder.id,
					agentId: "maya",
					permission: "target.modify",
					scope: builder.scope,
					generation: 1,
				},
			}),
		).toEqual({ ok: true, grantId: builder.id, definitionRef: "builder@1" });
	});

	it("fails closed on stale generations and conflicting exclusive grants", () => {
		const first = mintClineAgentTitleGrant({
			title: "builder",
			agentId: "maya",
			scope: { kind: "target", ref: "opaque-target-1" },
			generation: 1,
			at,
		});
		const second = mintClineAgentTitleGrant({
			title: "builder",
			agentId: "scout",
			scope: { kind: "target", ref: "opaque-target-1" },
			generation: 2,
			at,
		});
		const snapshot = {
			...createEmptyRoomSnapshot({
				roomId: "room-1",
				createdAt: at.toISOString(),
			}),
			titleGrantsById: { [first.id]: first, [second.id]: second },
		};
		const baseRequest = {
			grantId: first.id,
			agentId: first.agentId,
			permission: "target.modify" as const,
			scope: first.scope,
		};

		expect(
			validateAgentTitleAuthorization({
				snapshot,
				at: at.toISOString(),
				request: { ...baseRequest, generation: 2 },
			}),
		).toMatchObject({ ok: false, code: "generation_mismatch" });
		expect(
			validateAgentTitleAuthorization({
				snapshot,
				at: at.toISOString(),
				request: { ...baseRequest, generation: 1 },
			}),
		).toMatchObject({ ok: false, code: "exclusivity_lost" });
	});

	it("refuses self-review when the same agent holds Builder on the target", () => {
		const builder = mintClineAgentTitleGrant({
			title: "builder",
			agentId: "maya",
			scope: { kind: "target", ref: "opaque-target-1" },
			at,
		});
		const reviewer = mintClineAgentTitleGrant({
			title: "reviewer",
			agentId: "maya",
			scope: { kind: "target", ref: "opaque-target-1" },
			at,
		});
		const snapshot = {
			...createEmptyRoomSnapshot({
				roomId: "room-1",
				createdAt: at.toISOString(),
			}),
			titleGrantsById: { [builder.id]: builder, [reviewer.id]: reviewer },
		};

		expect(
			validateAgentTitleAuthorization({
				snapshot,
				at: at.toISOString(),
				request: {
					grantId: reviewer.id,
					agentId: "maya",
					permission: "review.findings",
					scope: reviewer.scope,
					generation: 1,
				},
			}),
		).toMatchObject({ ok: false, code: "independence_lost" });
	});
});
