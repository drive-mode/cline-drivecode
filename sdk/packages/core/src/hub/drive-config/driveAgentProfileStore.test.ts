import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_AGENT_APPEARANCE,
	defaultFacetValuesFromProfile,
} from "@cline/drive";
import type { AgentAppearance, AgentRef } from "@cline/shared";
import {
	agentProfileId,
	BUILTIN_BROWSER_TTS_ID,
	DEFAULT_AGENT_PROFILE_ID,
} from "@cline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
	__resetCatalogFacetStoresForTests,
	getAgentAppearance,
	listAgentProfiles,
	loadCatalogFacetStore,
	putCatalogDurableValues,
	resolveCatalogFacetsPath,
	upsertAgentProfile,
} from "./driveCatalogFacetStore";
import { setDriveFacets, writeDriveFacetsFile } from "./driveFacetsStore";

/**
 * Durability of per-agent appearance against writes that never read it.
 *
 * Appearance is stored as a `{ kind: "map" }` entry, and every writer in this
 * tree replaces its whole file atomically. So the failure mode is not an error
 * — it is a later, unrelated `put` rebuilding the file from the keys it knows
 * about and dropping the map on the floor. These assertions are all on bytes
 * read back off disk after such a write, never on the return value of the
 * upsert that produced them.
 */

const PARTNER: AgentRef = { kind: "driveagent", slug: "pair-partner" };
const REVIEWER: AgentRef = { kind: "builtin", id: "reviewer" };

const PARTNER_LOOK: AgentAppearance = {
	displayName: "Partner",
	nameInk: { kind: "palette", index: 5 },
	bodyInk: { kind: "token", token: "info" },
};
const REVIEWER_LOOK: AgentAppearance = {
	displayName: "Reviewer",
	nameInk: { kind: "palette", index: 2 },
	bodyInk: { kind: "token", token: "warning" },
};

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "drive-agent-profile-"));
	// The store memoises per workspace root; a stale entry from a sibling test
	// would let a read pass without the file on disk saying anything.
	__resetCatalogFacetStoresForTests();
});

/** The appearance as the catalog envelope actually holds it, parsed fresh. */
function appearanceOnDisk(ref: AgentRef): unknown {
	const raw = JSON.parse(
		readFileSync(resolveCatalogFacetsPath(root), "utf8"),
	) as {
		entries: Record<
			string,
			{ kind: string; entries?: Record<string, unknown> }
		>;
	};
	const entry = raw.entries["agent.appearance"];
	expect(entry?.kind).toBe("map");
	return (
		entry?.entries?.[agentProfileId(ref)] as
			| { kind: string; value: unknown }
			| undefined
	)?.value;
}

describe("upsertAgentProfile", () => {
	it("writes appearance the facet store reads back by ref", () => {
		expect(
			upsertAgentProfile({
				workspaceRoot: root,
				ref: PARTNER,
				appearance: PARTNER_LOOK,
			}).ok,
		).toBe(true);

		expect(appearanceOnDisk(PARTNER)).toEqual(PARTNER_LOOK);
		__resetCatalogFacetStoresForTests();
		expect(getAgentAppearance({ workspaceRoot: root, ref: PARTNER })).toEqual(
			PARTNER_LOOK,
		);
	});

	it("keys agents independently rather than sharing one global ink", () => {
		upsertAgentProfile({
			workspaceRoot: root,
			ref: PARTNER,
			appearance: PARTNER_LOOK,
		});
		upsertAgentProfile({
			workspaceRoot: root,
			ref: REVIEWER,
			appearance: REVIEWER_LOOK,
		});

		// The second write must not have replaced the first.
		expect(appearanceOnDisk(PARTNER)).toEqual(PARTNER_LOOK);
		expect(appearanceOnDisk(REVIEWER)).toEqual(REVIEWER_LOOK);

		__resetCatalogFacetStoresForTests();
		const profiles = listAgentProfiles(root);
		expect(profiles).toHaveLength(2);
		expect(profiles.map((profile) => profile.ref)).toEqual(
			expect.arrayContaining([PARTNER, REVIEWER]),
		);
		expect(
			profiles.find((profile) => profile.id === agentProfileId(REVIEWER))
				?.nameInk,
		).toEqual(REVIEWER_LOOK.nameInk);
	});

	it("overwrites only the agent named, on a second upsert", () => {
		upsertAgentProfile({
			workspaceRoot: root,
			ref: PARTNER,
			appearance: PARTNER_LOOK,
		});
		upsertAgentProfile({
			workspaceRoot: root,
			ref: REVIEWER,
			appearance: REVIEWER_LOOK,
		});
		upsertAgentProfile({
			workspaceRoot: root,
			ref: PARTNER,
			appearance: { ...PARTNER_LOOK, nameInk: { kind: "palette", index: 7 } },
		});

		expect(appearanceOnDisk(PARTNER)).toMatchObject({
			nameInk: { kind: "palette", index: 7 },
		});
		expect(appearanceOnDisk(REVIEWER)).toEqual(REVIEWER_LOOK);
	});

	it("rejects appearance carrying prompt / model fields", () => {
		const result = upsertAgentProfile({
			workspaceRoot: root,
			ref: PARTNER,
			appearance: {
				...PARTNER_LOOK,
				systemPrompt: "leak me",
			} as unknown as AgentAppearance,
		});
		expect(result.ok).toBe(false);
	});
});

describe("appearance survives writes that never read it", () => {
	it("survives a drive_config_put of unrelated TTS facets", () => {
		upsertAgentProfile({
			workspaceRoot: root,
			ref: PARTNER,
			appearance: PARTNER_LOOK,
		});

		// The voice lane, exactly as `drive_config_put` drives it: a whole-object
		// write of every DriveFacetValues key, touching nothing about agents.
		const facets = defaultFacetValuesFromProfile("cloud");
		const result = setDriveFacets({
			configParent: root,
			facets: {
				...facets,
				"providers.ttsId": BUILTIN_BROWSER_TTS_ID,
				"tts.enabled": true,
				"tts.maxSpokenSentences": 4,
			},
			llm: { kind: "cloud", providerId: "anthropic" },
		});
		expect(result.ok).toBe(true);

		// The outcome, off disk, after the unrelated write.
		expect(appearanceOnDisk(PARTNER)).toEqual(PARTNER_LOOK);
		__resetCatalogFacetStoresForTests();
		expect(getAgentAppearance({ workspaceRoot: root, ref: PARTNER })).toEqual(
			PARTNER_LOOK,
		);
	});

	it("survives a drive_catalog_put of an unrelated durable facet", () => {
		upsertAgentProfile({
			workspaceRoot: root,
			ref: PARTNER,
			appearance: PARTNER_LOOK,
		});

		// Same file as the appearance map, so this is the closer call of the two.
		const put = putCatalogDurableValues({
			workspaceRoot: root,
			values: { "drive.defaults.subMode": "act" },
		});
		expect(put.ok).toBe(true);

		expect(appearanceOnDisk(PARTNER)).toEqual(PARTNER_LOOK);
		__resetCatalogFacetStoresForTests();
		expect(getAgentAppearance({ workspaceRoot: root, ref: PARTNER })).toEqual(
			PARTNER_LOOK,
		);
	});

	it("refuses to let a scalar catalog put flatten the map", () => {
		upsertAgentProfile({
			workspaceRoot: root,
			ref: PARTNER,
			appearance: PARTNER_LOOK,
		});

		// `putCatalogDurableValues` writes `{ kind: "value" }`; allowing this key
		// through would replace the whole map with one scalar.
		const put = putCatalogDurableValues({
			workspaceRoot: root,
			values: { "agent.appearance": REVIEWER_LOOK },
		});
		expect(put.ok).toBe(false);
		expect(put.ok === false && put.code).toBe("map_facet_rejected");
		expect(appearanceOnDisk(PARTNER)).toEqual(PARTNER_LOOK);
	});
});

describe("the default agent's profile id", () => {
	/**
	 * `@cline/drive` may only type-import `@cline/shared`, so the facet store's
	 * fallback instance id is a literal there while `agentProfileId` derives it
	 * here. Nothing in either package can see both — if they drift, the default
	 * agent's appearance is written under a key the no-instance read never
	 * looks up, and it silently renders as the catalog default forever.
	 */
	it("is the key the facet store falls back to with no instance id", () => {
		const ref: AgentRef = { kind: "builtin", id: "pair_partner" };
		expect(agentProfileId(ref)).toBe(DEFAULT_AGENT_PROFILE_ID);

		upsertAgentProfile({
			workspaceRoot: root,
			ref,
			appearance: PARTNER_LOOK,
		});
		__resetCatalogFacetStoresForTests();

		const store = loadCatalogFacetStore({ workspaceRoot: root });
		expect(store.get("agent.appearance")).toEqual(PARTNER_LOOK);
	});
});

describe("reading a hand-edited catalog file", () => {
	/** Replace one agent's stored appearance with arbitrary JSON. */
	function tamper(ref: AgentRef, value: unknown): void {
		const path = resolveCatalogFacetsPath(root);
		const file = JSON.parse(readFileSync(path, "utf8")) as {
			entries: Record<
				string,
				{ kind: string; entries: Record<string, unknown> }
			>;
		};
		file.entries["agent.appearance"].entries[agentProfileId(ref)] = {
			kind: "value",
			value,
		};
		writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
		__resetCatalogFacetStoresForTests();
	}

	beforeEach(() => {
		upsertAgentProfile({
			workspaceRoot: root,
			ref: PARTNER,
			appearance: PARTNER_LOOK,
		});
	});

	it("does not forward prompt / model keys smuggled into the file", () => {
		// The upsert validates, but it is not the only writer: this file is
		// plain JSON in the workspace, hand-editable and git-mergeable. A read
		// path that trusted it would hand a systemPrompt straight back out over
		// drive_config_get.
		tamper(PARTNER, { ...PARTNER_LOOK, systemPrompt: "leak me" });

		expect(listAgentProfiles(root)).toEqual([]);
		expect(getAgentAppearance({ workspaceRoot: root, ref: PARTNER })).toEqual(
			DEFAULT_AGENT_APPEARANCE,
		);
	});

	it("drops an entry whose ink is not a legal InkRef", () => {
		tamper(PARTNER, { ...PARTNER_LOOK, nameInk: { kind: "hex", hex: "#f0f" } });
		expect(listAgentProfiles(root)).toEqual([]);
	});

	it("keeps the readable agents when one entry is unreadable", () => {
		upsertAgentProfile({
			workspaceRoot: root,
			ref: REVIEWER,
			appearance: REVIEWER_LOOK,
		});
		tamper(PARTNER, { nonsense: true });

		const profiles = listAgentProfiles(root);
		expect(profiles).toHaveLength(1);
		expect(profiles[0]?.ref).toEqual(REVIEWER);
	});

	it("skips an id that names no agent", () => {
		const path = resolveCatalogFacetsPath(root);
		const file = JSON.parse(readFileSync(path, "utf8")) as {
			entries: Record<
				string,
				{ kind: string; entries: Record<string, unknown> }
			>;
		};
		file.entries["agent.appearance"].entries["not-a-ref-key"] = {
			kind: "value",
			value: REVIEWER_LOOK,
		};
		writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
		__resetCatalogFacetStoresForTests();

		const profiles = listAgentProfiles(root);
		expect(profiles.map((profile) => profile.id)).toEqual([
			agentProfileId(PARTNER),
		]);
	});
});

describe("writeDriveFacetsFile", () => {
	it("carries forward entries it does not own", () => {
		// The voice envelope is rebuilt from a fixed key list, and
		// `diskFileToFacetValues` drops anything that is not `kind: "value"` —
		// so without a merge, one provider change silently empties whatever else
		// the file holds. Appearance lives in a different file today; this keeps
		// that from being the only thing standing between it and deletion.
		const path = join(root, ".cline", "drive", "facets.v1.json");
		writeDriveFacetsFile(root, defaultFacetValuesFromProfile("cloud"));

		const seeded = JSON.parse(readFileSync(path, "utf8")) as {
			schemaVersion: number;
			entries: Record<string, unknown>;
		};
		const foreign = {
			kind: "map",
			entries: {
				"driveagent.pair-partner": { kind: "value", value: PARTNER_LOOK },
			},
		};
		seeded.entries["agent.appearance"] = foreign;
		writeFileSync(path, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

		// An unrelated voice change, as `drive_config_put` performs it.
		writeDriveFacetsFile(root, {
			...defaultFacetValuesFromProfile("cloud"),
			"tts.enabled": false,
		});

		const after = JSON.parse(readFileSync(path, "utf8")) as {
			entries: Record<string, unknown>;
		};
		expect(after.entries["tts.enabled"]).toEqual({
			kind: "value",
			value: false,
		});
		expect(after.entries["agent.appearance"]).toEqual(foreign);
	});
});
