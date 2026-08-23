import { describe, expect, it } from "bun:test";
import { PLANNING_FACT_REGISTRY } from "../src/catalog";
import { canonicalJson } from "../src/core";
import {
	applyPlanningAttestationCommand,
	createPlanningSessionStore,
} from "../src/core/planning-session";

describe("M4 planning session authority", () => {
	it("applies controlled facts atomically and preserves state after invalid batches", () => {
		const store = createPlanningSessionStore();
		const applied = store.applyAttestations(
			"data.persisted=true tenancy.multiple=false",
		);
		expect(applied.ok).toBe(true);
		expect(applied.added).toBe(2);
		expect(applied.snapshot.revision).toBe(1);
		const before = canonicalJson(store.snapshot());

		for (const invalid of [
			"data.persisted=yes",
			"unknown.private_canary=true",
			"data.persisted=true data.persisted=false",
			"surface.kinds=true",
		]) {
			const receipt = store.applyAttestations(invalid);
			expect(receipt.ok).toBe(false);
			expect(canonicalJson(store.snapshot())).toBe(before);
			expect(JSON.stringify(receipt)).not.toContain("private_canary");
		}
	});

	it("is idempotent, records explicit replacement, and clears without residue", () => {
		const store = createPlanningSessionStore();
		const first = store.applyAttestations("data.persisted=true");
		const replay = store.applyAttestations("data.persisted=true");
		expect(replay.unchanged).toBe(1);
		expect(replay.snapshot.revision).toBe(first.snapshot.revision);

		const replacement = store.applyAttestations("data.persisted=false");
		expect(replacement.replaced).toBe(1);
		expect(replacement.snapshot.revision).toBe(first.snapshot.revision + 1);
		expect(replacement.snapshot.attestations[0]?.fact.value).toBe(false);

		const cleared = store.applyAttestations("clear");
		expect(cleared.cleared).toBe(1);
		expect(cleared.snapshot.attestations).toEqual([]);
		expect(store.applyAttestations("status").message).toContain("0 controlled");
	});

	it("rejects over-limit batches before mutation", () => {
		const store = createPlanningSessionStore();
		const keys = Object.entries(PLANNING_FACT_REGISTRY)
			.filter(([, definition]) => definition.valueKind === "boolean")
			.slice(0, 17)
			.map(([key]) => `${key}=true`);
		const receipt = store.applyAttestations(keys.join(" "));
		expect(receipt.ok).toBe(false);
		expect(store.snapshot().attestations).toEqual([]);
	});

	it("keeps stores isolated and workflow selection explicit", () => {
		const first = createPlanningSessionStore();
		const second = createPlanningSessionStore();
		first.applyAttestations("delivery.production=true");
		first.selectWorkflow("plan", "release");
		expect(first.snapshot().requestedGate).toBe("release");
		expect(first.snapshot().mode).toBe("plan");
		expect(second.snapshot()).toMatchObject({
			revision: 0,
			mode: "preplan",
			requestedGate: "preplan",
			attestations: [],
		});
	});

	it("can derive an atomic replacement from a host snapshot without shared memory", () => {
		const first = applyPlanningAttestationCommand("data.persisted=true");
		const second = applyPlanningAttestationCommand(
			"tenancy.multiple=false",
			first.snapshot,
		);
		expect(second.snapshot.attestations.map((entry) => entry.fact.key)).toEqual(
			["data.persisted", "tenancy.multiple"],
		);
		expect(second.snapshot.attestations[0]?.evidence.source).toBe(
			"host-attributed slash command",
		);
	});
});
