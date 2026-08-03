/**
 * Per-agent appearance over a real hub (DRV-AGENT-PROFILE).
 *
 * Drives the real WS protocol against a real `startHubServer` and asserts the
 * one thing that separates a working persistence layer from a convincing
 * imitation of one: the bytes on disk, after a write that never read them, and
 * again after the hub has been torn down and rebuilt.
 *
 * Every assertion here is on an outcome — the catalog envelope re-read from
 * disk, or a `drive_config_get` issued by a hub that did not perform the
 * upsert. None of them trust the reply to the upsert itself, because a command
 * that broadcasts and returns a profile it never persisted passes that check
 * and fails on the user's next reload.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentAppearance,
	AgentProfile,
	AgentRef,
	DriveFacetValues,
	HubReplyEnvelope,
} from "@cline/shared";
import { agentProfileId, BUILTIN_BROWSER_TTS_ID } from "@cline/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { HubCommandError, NodeHubClient } from "./client";
import { createLocalHubScheduleRuntimeHandlers } from "./daemon/runtime-handlers";
import { type HubServer, startHubServer } from "./daemon/start-shared-server";
import {
	__resetCatalogFacetStoresForTests,
	resolveCatalogFacetsPath,
} from "./drive-config/driveCatalogFacetStore";

/**
 * Scratch ports, distinct from every other suite that binds a real hub.
 *
 * `drive-artifact-corpus.e2e.test.ts` holds 25963/8987 and
 * `status/status-tag-filter.e2e.test.ts` holds 25971/8993; vitest runs e2e
 * files in parallel, so sharing either pair fails whichever file loses the race
 * with EADDRINUSE — an error about ports, reported as an appearance failure.
 * Overridable on top of that, because several worktrees run their suites at
 * once.
 */
const HUB_PORT = Number(process.env.CLINE_TEST_APPEARANCE_HUB_PORT ?? 25983);
const DASHBOARD_PORT = Number(
	process.env.CLINE_TEST_APPEARANCE_DASHBOARD_PORT ?? 8999,
);

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

const envSnapshot = {
	CLINE_HUB_PORT: process.env.CLINE_HUB_PORT,
	CLINE_HUB_DASHBOARD_PORT: process.env.CLINE_HUB_DASHBOARD_PORT,
	CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
};

const scratchDirs: string[] = [];

function scratch(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratchDirs.push(dir);
	return dir;
}

function okPayload(reply: HubReplyEnvelope): Record<string, unknown> {
	if (!reply.ok) {
		throw new Error(
			`hub command failed: ${reply.error?.code} ${reply.error?.message}`,
		);
	}
	return reply.payload ?? {};
}

/**
 * The error code the hub replied with, for a command expected to fail.
 *
 * `NodeHubClient.command` raises on a non-ok reply rather than returning it,
 * so a rejection is the only way to see the code — and a command that wrongly
 * succeeds has to fail the test rather than fall through silently.
 */
async function errorCodeOf(
	send: () => Promise<HubReplyEnvelope>,
): Promise<string | undefined> {
	try {
		await send();
	} catch (error) {
		if (error instanceof HubCommandError) {
			return error.code;
		}
		throw error;
	}
	throw new Error("expected the hub to reject this command, but it succeeded");
}

describe("per-agent appearance over a real hub", () => {
	let workspaceRoot: string;
	let server: HubServer | undefined;
	let client: NodeHubClient | undefined;

	async function startHub(): Promise<void> {
		server = await startHubServer({
			host: "127.0.0.1",
			port: HUB_PORT,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		client = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientType: "agent-appearance-e2e",
			workspaceRoot,
		});
	}

	async function stopHub(): Promise<void> {
		client?.close();
		client = undefined;
		await server?.close().catch(() => undefined);
		server = undefined;
	}

	/**
	 * Hub restart: same disk, no carried-over state.
	 *
	 * The catalog facet stores are memoised per workspace root at module scope,
	 * which a real process restart would not preserve. Clearing them is what
	 * makes the post-restart read actually come off disk — without it, an
	 * upsert that only ever touched memory would still answer correctly.
	 */
	async function restartHub(): Promise<void> {
		await stopHub();
		__resetCatalogFacetStoresForTests();
		await startHub();
	}

	function requireClient(): NodeHubClient {
		if (!client) {
			throw new Error("hub client not started");
		}
		return client;
	}

	async function upsertProfile(
		ref: AgentRef,
		appearance: AgentAppearance,
	): Promise<HubReplyEnvelope> {
		return await requireClient().command("drive_config_upsert_profile", {
			workspaceRoot,
			profile: { ref, ...appearance },
		});
	}

	async function readProfiles(): Promise<AgentProfile[]> {
		const payload = okPayload(
			await requireClient().command("drive_config_get", { workspaceRoot }),
		);
		return (payload.profiles ?? []) as AgentProfile[];
	}

	async function readFacets(): Promise<DriveFacetValues> {
		const payload = okPayload(
			await requireClient().command("drive_config_get", { workspaceRoot }),
		);
		return payload.facets as DriveFacetValues;
	}

	/** The appearance exactly as the catalog envelope holds it on disk. */
	function appearanceOnDisk(ref: AgentRef): unknown {
		const raw = JSON.parse(
			readFileSync(resolveCatalogFacetsPath(workspaceRoot), "utf8"),
		) as {
			entries: Record<
				string,
				{ kind: string; entries?: Record<string, { value?: unknown }> }
			>;
		};
		const entry = raw.entries["agent.appearance"];
		expect(entry?.kind).toBe("map");
		return entry?.entries?.[agentProfileId(ref)]?.value;
	}

	/** A `drive_config_put` that changes voice and says nothing about agents. */
	async function putUnrelatedTtsFacets(): Promise<void> {
		const facets = await readFacets();
		okPayload(
			await requireClient().command("drive_config_put", {
				workspaceRoot,
				facets: {
					...facets,
					"providers.ttsId": BUILTIN_BROWSER_TTS_ID,
					"tts.enabled": true,
					"tts.maxSpokenSentences": 4,
				},
			}),
		);
	}

	beforeEach(async () => {
		process.env.CLINE_HUB_PORT = String(HUB_PORT);
		process.env.CLINE_HUB_DASHBOARD_PORT = String(DASHBOARD_PORT);
		process.env.CLINE_DATA_DIR = scratch("drive-appearance-e2e-data-");
		workspaceRoot = scratch("drive-appearance-e2e-ws-");
		__resetCatalogFacetStoresForTests();
		await startHub();
	});

	afterEach(async () => {
		await stopHub();
		__resetCatalogFacetStoresForTests();
	});

	afterAll(() => {
		for (const dir of scratchDirs.splice(0)) {
			// The hub's sqlite handle can outlive close() on Windows; a scratch
			// tmpdir left behind is not worth failing the suite over.
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				// best-effort
			}
		}
		process.env.CLINE_HUB_PORT = envSnapshot.CLINE_HUB_PORT;
		process.env.CLINE_HUB_DASHBOARD_PORT = envSnapshot.CLINE_HUB_DASHBOARD_PORT;
		process.env.CLINE_DATA_DIR = envSnapshot.CLINE_DATA_DIR;
	});

	it("keeps each agent's appearance across an unrelated config put and a hub restart", async () => {
		// Guard: with nothing stored, the read path returns no profiles, so a
		// later non-empty result cannot be something that was always there.
		expect(await readProfiles()).toEqual([]);

		okPayload(await upsertProfile(PARTNER, PARTNER_LOOK));
		okPayload(await upsertProfile(REVIEWER, REVIEWER_LOOK));

		// The upsert reached disk at all — the failure this catches is a command
		// that broadcasts and paints while the file never gains the entry.
		expect(appearanceOnDisk(PARTNER)).toEqual(PARTNER_LOOK);
		expect(appearanceOnDisk(REVIEWER)).toEqual(REVIEWER_LOOK);

		// A user changes their TTS provider. Nothing about that write reads,
		// mentions, or has any business touching agent colours.
		await putUnrelatedTtsFacets();

		expect(appearanceOnDisk(PARTNER)).toEqual(PARTNER_LOOK);
		expect(appearanceOnDisk(REVIEWER)).toEqual(REVIEWER_LOOK);

		// And the voice change itself landed, so the assertion above is not
		// passing because the put quietly did nothing.
		expect((await readFacets())["providers.ttsId"]).toBe(
			BUILTIN_BROWSER_TTS_ID,
		);

		await restartHub();

		// The reload. A hub that never wrote the bytes answers this wrong.
		const profiles = await readProfiles();
		expect(profiles).toHaveLength(2);

		const partner = profiles.find(
			(profile) => profile.id === agentProfileId(PARTNER),
		);
		const reviewer = profiles.find(
			(profile) => profile.id === agentProfileId(REVIEWER),
		);

		expect(partner).toMatchObject({ ref: PARTNER, ...PARTNER_LOOK });
		expect(reviewer).toMatchObject({ ref: REVIEWER, ...REVIEWER_LOOK });

		// Independently coloured, which is the whole point: one global ink would
		// have made these two equal.
		expect(partner?.nameInk).not.toEqual(reviewer?.nameInk);
		expect(partner?.bodyInk).not.toEqual(reviewer?.bodyInk);
	});

	it("re-colours one agent without disturbing the other, across a restart", async () => {
		okPayload(await upsertProfile(PARTNER, PARTNER_LOOK));
		okPayload(await upsertProfile(REVIEWER, REVIEWER_LOOK));

		const recoloured: AgentAppearance = {
			...PARTNER_LOOK,
			nameInk: { kind: "palette", index: 7 },
			bodyInk: { kind: "token", token: "success" },
		};
		okPayload(await upsertProfile(PARTNER, recoloured));

		await restartHub();

		const profiles = await readProfiles();
		expect(
			profiles.find((profile) => profile.id === agentProfileId(PARTNER)),
		).toMatchObject(recoloured);
		expect(
			profiles.find((profile) => profile.id === agentProfileId(REVIEWER)),
		).toMatchObject(REVIEWER_LOOK);
	});

	it("exposes the same bytes through the catalog facet snapshot", async () => {
		okPayload(await upsertProfile(PARTNER, PARTNER_LOOK));
		await restartHub();

		// The typed facet store's own read of the map lane, over the wire.
		const payload = okPayload(
			await requireClient().command("drive_catalog_get", { workspaceRoot }),
		);
		const durable = payload.durable as {
			maps: Record<string, Record<string, unknown>>;
		};
		expect(durable.maps["agent.appearance"]?.[agentProfileId(PARTNER)]).toEqual(
			PARTNER_LOOK,
		);
	});

	it("refuses a scalar catalog put that would flatten the appearance map", async () => {
		okPayload(await upsertProfile(PARTNER, PARTNER_LOOK));

		const code = await errorCodeOf(() =>
			requireClient().command("drive_catalog_put", {
				workspaceRoot,
				values: { "agent.appearance": REVIEWER_LOOK },
			}),
		);
		expect(code).toBe("map_facet_rejected");

		// Rejected means untouched, not partially applied.
		expect(appearanceOnDisk(PARTNER)).toEqual(PARTNER_LOOK);
	});

	it("rejects a malformed profile at the schema boundary, writing nothing", async () => {
		okPayload(await upsertProfile(PARTNER, PARTNER_LOOK));

		const bad: ReadonlyArray<Record<string, unknown>> = [
			// Raw hex ink, which the ink schema exists to keep off disk.
			{ ref: PARTNER, nameInk: { kind: "hex", hex: "#ff00ff" } },
			// Prompt / model fields, which appearance must never carry.
			{ ref: PARTNER, ...PARTNER_LOOK, systemPrompt: "leak me" },
			// An id that disagrees with the ref would file the appearance under
			// a key no reader looks up.
			{ ref: PARTNER, ...PARTNER_LOOK, id: "builtin.somebody-else" },
			// Not an AgentRef at all.
			{ ref: { kind: "nonsense", id: "x" }, ...PARTNER_LOOK },
		];

		for (const profile of bad) {
			const code = await errorCodeOf(() =>
				requireClient().command("drive_config_upsert_profile", {
					workspaceRoot,
					profile,
				}),
			);
			expect(code).toBe("invalid_payload");
		}

		await restartHub();
		expect(appearanceOnDisk(PARTNER)).toEqual(PARTNER_LOOK);
		expect(await readProfiles()).toHaveLength(1);
	});
});
