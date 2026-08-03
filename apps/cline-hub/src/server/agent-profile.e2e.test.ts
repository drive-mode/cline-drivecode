/**
 * The agent profile chain over a real hub (DRV-AGENT-PROFILE).
 *
 * Drives the real WS protocol against a real `startHubServer`, exercising the
 * three things this feature is worth nothing without:
 *
 *  1. **A seat that carries a real `ref`.** `call_seat` grew the field, but
 *     until now no browser frame could send one, so every seat landed ref-less
 *     and every agent shared one identity. Asserted by reading the room back,
 *     not by trusting the seat reply.
 *  2. **Colours that survive a reload.** The webview's inks were localStorage
 *     only. Asserted against a hub torn down and rebuilt, whose in-process
 *     store caches were cleared — i.e. against the bytes on disk, which is
 *     what a reload actually reads.
 *  3. **Avatars that differ.** The Cline mark used to be gated on a boolean, so
 *     every agent wore it. Asserted by running the real `agentAvatarKind` over
 *     the participants the hub returns.
 *
 * Plus the policy write path, which must survive the same restart: a config
 * editor that only holds its value in memory is a form, not configuration.
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HubCommandError, NodeHubClient } from "@cline/core/hub/client";
import { resetDriveRoomStoreForTests } from "@cline/core/hub/collaboration";
import { createLocalHubScheduleRuntimeHandlers } from "@cline/core/hub/daemon/runtime-handlers";
import {
	type HubServer,
	startHubServer,
} from "@cline/core/hub/daemon/start-shared-server";
import {
	__resetCatalogFacetStoresForTests,
	resolveCatalogFacetsPath,
} from "@cline/core/hub/drive-config/driveCatalogFacetStore";
import type {
	AgentProfile,
	AgentRef,
	HubReplyEnvelope,
	Participant,
	RoomSnapshot,
} from "@cline/shared";
import { agentProfileId } from "@cline/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	agentAvatarKind,
	isClineParticipant,
} from "../webview/src/drive/agentMark";
import { resolveSeatRef } from "../webview/src/drive/seatRef";

/**
 * Scratch ports, distinct from every other suite that binds a real hub:
 * 25963/8987, 25971/8993, 25983/8999, 25991/9013 and 26007/9027 are taken, and
 * vitest runs e2e files in parallel. Overridable because several worktrees run
 * their suites at once.
 */
const HUB_PORT = Number(process.env.CLINE_TEST_AGENT_PROFILE_HUB_PORT ?? 26019);
const DASHBOARD_PORT = Number(
	process.env.CLINE_TEST_AGENT_PROFILE_DASHBOARD_PORT ?? 9039,
);
const ROOM_ID = "room_agent_profile_e2e";

const NOVA: AgentRef = { kind: "driveagent", slug: "nova" };
const NOVA_ID = agentProfileId(NOVA);
const CLINE: AgentRef = { kind: "builtin", id: "pair_partner" };
const CLINE_ID = agentProfileId(CLINE);

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

/** The hub's error code for a command it was expected to refuse. */
async function expectRejection(
	send: () => Promise<unknown>,
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

function okPayload(reply: HubReplyEnvelope): Record<string, unknown> {
	if (!reply.ok) {
		throw new Error(
			`hub command failed: ${reply.error?.code} ${reply.error?.message}`,
		);
	}
	return reply.payload ?? {};
}

/** A minimal but real `.driveagent/<slug>/` home on disk. */
function writeHome(workspaceRoot: string, slug: string, description: string) {
	const dir = join(workspaceRoot, ".driveagent", slug);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "agent.yaml"),
		[
			`name: ${slug}`,
			`description: ${description}`,
			"tools:",
			"  - read_file",
			"skills:",
			"  - drive-persona",
			"systemPrompt: |",
			"  Secret prompt that must never reach a browser.",
			"editable: true",
			"",
		].join("\n"),
		"utf8",
	);
	writeFileSync(
		join(dir, "permissions.yaml"),
		["presetIntent: readonly", "approvalHooks: []", ""].join("\n"),
		"utf8",
	);
	// The loader requires all three files. A home missing one still appears in
	// the listing, by slug alone — covered separately below.
	writeFileSync(join(dir, "env.yaml"), "{}\n", "utf8");
}

describe("agent profile chain over a real hub", () => {
	let workspaceRoot: string;
	let dataDir: string;
	let server: HubServer | undefined;
	let client: NodeHubClient | undefined;

	function requireClient(): NodeHubClient {
		if (!client) {
			throw new Error("hub client not started");
		}
		return client;
	}

	async function startHub(): Promise<void> {
		resetDriveRoomStoreForTests();
		__resetCatalogFacetStoresForTests();
		server = await startHubServer({
			host: "127.0.0.1",
			port: HUB_PORT,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		client = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientType: "agent-profile-e2e",
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
	 * A cold hub: torn down, in-process caches cleared, started again against
	 * the same directories. This is what a reload sees — anything that only
	 * lived in a module-scope memo does not survive it.
	 */
	async function restartHub(): Promise<void> {
		await stopHub();
		resetDriveRoomStoreForTests();
		__resetCatalogFacetStoresForTests();
		await startHub();
	}

	async function readRoom(): Promise<RoomSnapshot> {
		const payload = okPayload(
			await requireClient().command("call_get_room", {
				roomId: ROOM_ID,
				workspaceRoot,
			}),
		);
		return payload.snapshot as RoomSnapshot;
	}

	async function readProfiles(): Promise<AgentProfile[]> {
		const payload = okPayload(
			await requireClient().command("drive_config_get", { workspaceRoot }),
		);
		return payload.profiles as AgentProfile[];
	}

	type AgentParticipant = Extract<Participant, { kind: "agent" }>;

	function agentsIn(snapshot: RoomSnapshot): AgentParticipant[] {
		return snapshot.participants.filter(
			(participant): participant is AgentParticipant =>
				participant.kind === "agent",
		);
	}

	/** The seat frame the webview builds, ref resolution and all. */
	async function seatFromUi(
		slug: string,
		displayName: string,
		knownHomes: ReadonlySet<string>,
	): Promise<void> {
		const ref = resolveSeatRef(slug, knownHomes);
		okPayload(
			await requireClient().command("call_seat", {
				roomId: ROOM_ID,
				agent: {
					id: slug,
					displayName,
					role: "specialist",
					...(ref ? { ref } : {}),
				},
			}),
		);
	}

	beforeEach(async () => {
		process.env.CLINE_HUB_PORT = String(HUB_PORT);
		process.env.CLINE_HUB_DASHBOARD_PORT = String(DASHBOARD_PORT);
		dataDir = scratch("agent-profile-e2e-data-");
		process.env.CLINE_DATA_DIR = dataDir;
		workspaceRoot = scratch("agent-profile-e2e-ws-");
		writeHome(workspaceRoot, "nova", "Regression checks and review.");
		await startHub();
	}, 60_000);

	afterEach(async () => {
		await stopHub();
		resetDriveRoomStoreForTests();
		__resetCatalogFacetStoresForTests();
	}, 60_000);

	afterAll(() => {
		for (const [key, value] of Object.entries(envSnapshot)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
		for (const dir of scratchDirs.splice(0)) {
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				// Scratch dir leak is not a test failure.
			}
		}
	});

	it("lists the workspace's Driveagent homes", async () => {
		const payload = okPayload(
			await requireClient().command("drive_agent_home_list", {
				workspaceRoot,
			}),
		);
		const homes = payload.homes as Array<Record<string, unknown>>;
		expect(homes.map((home) => home.slug)).toContain("nova");
		const nova = homes.find((home) => home.slug === "nova");
		expect(nova?.tier).toBe("workspace");
		expect(nova?.description).toBe("Regression checks and review.");
		expect(nova?.skills).toEqual(["drive-persona"]);
		// The listing feeds a directory page in a browser; the prompt is not on
		// it, and never should be.
		expect(JSON.stringify(homes)).not.toContain("Secret prompt");
	}, 60_000);

	it("lists a home whose YAML does not load, by slug alone", async () => {
		// It exists on disk, so hiding it would make the directory quietly
		// disagree with the filesystem it is a view of.
		const broken = join(workspaceRoot, ".driveagent", "broken");
		mkdirSync(broken, { recursive: true });
		writeFileSync(join(broken, "agent.yaml"), "name: broken\n", "utf8");

		const payload = okPayload(
			await requireClient().command("drive_agent_home_list", {
				workspaceRoot,
			}),
		);
		const homes = payload.homes as Array<Record<string, unknown>>;
		const row = homes.find((home) => home.slug === "broken");
		expect(row).toBeDefined();
		expect(row?.displayName).toBeUndefined();
	}, 60_000);

	it("seats an agent whose ref is real, and omits it when it is not", async () => {
		okPayload(
			await requireClient().command("call_join", {
				roomId: ROOM_ID,
				human: { id: "you", displayName: "You", role: "host" },
				// A legacy-shaped seat: no ref, exactly like every join written
				// before `ref` existed.
				agent: { id: "adam", displayName: "Adam", role: "partner" },
				workspaceRoot,
				activateDrive: true,
			}),
		);
		const knownHomes = new Set(["nova"]);
		await seatFromUi("nova", "Nova", knownHomes);
		await seatFromUi("drive:partner", "Cline", knownHomes);
		// A picker fixture with no home on disk: no evidence, so no ref.
		await seatFromUi("security-reviewer", "Security Reviewer", knownHomes);

		const agents = agentsIn(await readRoom());
		const byId = new Map(agents.map((agent) => [agent.id, agent]));

		expect(byId.get("nova")?.ref).toEqual(NOVA);
		expect(byId.get("drive:partner")?.ref).toEqual(CLINE);
		expect(byId.get("security-reviewer")?.ref).toBeUndefined();
	}, 60_000);

	it("gives the Cline mark to exactly one of two seated agents", async () => {
		okPayload(
			await requireClient().command("call_join", {
				roomId: ROOM_ID,
				human: { id: "you", displayName: "You", role: "host" },
				// A legacy-shaped seat: no ref, exactly like every join written
				// before `ref` existed.
				agent: { id: "adam", displayName: "Adam", role: "partner" },
				workspaceRoot,
				activateDrive: true,
			}),
		);
		const knownHomes = new Set(["nova"]);
		await seatFromUi("nova", "Nova", knownHomes);
		await seatFromUi("drive:partner", "Cline", knownHomes);

		const agents = agentsIn(await readRoom());
		const marks = new Map(
			agents.map((agent) => [agent.id, agentAvatarKind(agent)]),
		);
		expect(marks.get("drive:partner")).toBe("cline-mark");
		expect(marks.get("nova")).toBe("initial");
		expect(marks.get("nova")).not.toBe(marks.get("drive:partner"));
		expect(agents.filter((agent) => isClineParticipant(agent))).toHaveLength(1);
	}, 60_000);

	it("keeps two agents' inks apart across a hub restart", async () => {
		okPayload(
			await requireClient().command("drive_config_upsert_profile", {
				workspaceRoot,
				profile: {
					ref: NOVA,
					displayName: "Nova",
					nameInk: { kind: "palette", index: 3 },
					bodyInk: { kind: "palette", index: 4 },
				},
			}),
		);
		okPayload(
			await requireClient().command("drive_config_upsert_profile", {
				workspaceRoot,
				profile: {
					ref: CLINE,
					displayName: "Cline",
					nameInk: { kind: "palette", index: 6 },
					bodyInk: { kind: "token", token: "muted" },
				},
			}),
		);

		// The upsert reply proves nothing about a reload, so read the envelope
		// off disk before anything can serve it from a memo.
		const onDisk = JSON.parse(
			readFileSync(resolveCatalogFacetsPath(workspaceRoot), "utf8"),
		);
		expect(onDisk.entries["agent.appearance"].entries[NOVA_ID]).toEqual({
			kind: "value",
			value: {
				displayName: "Nova",
				nameInk: { kind: "palette", index: 3 },
				bodyInk: { kind: "palette", index: 4 },
			},
		});

		await restartHub();

		const profiles = await readProfiles();
		const byId = new Map(profiles.map((profile) => [profile.id, profile]));
		expect(byId.get(NOVA_ID)?.nameInk).toEqual({ kind: "palette", index: 3 });
		expect(byId.get(NOVA_ID)?.bodyInk).toEqual({ kind: "palette", index: 4 });
		expect(byId.get(CLINE_ID)?.nameInk).toEqual({ kind: "palette", index: 6 });
		expect(byId.get(CLINE_ID)?.bodyInk).toEqual({
			kind: "token",
			token: "muted",
		});
		// The two agents must not have converged on one colour.
		expect(byId.get(NOVA_ID)?.nameInk).not.toEqual(byId.get(CLINE_ID)?.nameInk);
	}, 60_000);

	it("stores name and body independently", async () => {
		okPayload(
			await requireClient().command("drive_config_upsert_profile", {
				workspaceRoot,
				profile: {
					ref: NOVA,
					nameInk: { kind: "palette", index: 2 },
					bodyInk: { kind: "palette", index: 7 },
				},
			}),
		);
		await restartHub();
		const nova = (await readProfiles()).find(
			(profile) => profile.id === NOVA_ID,
		);
		expect(nova?.nameInk).not.toEqual(nova?.bodyInk);

		// Changing one channel must leave the other where it was.
		okPayload(
			await requireClient().command("drive_config_upsert_profile", {
				workspaceRoot,
				profile: {
					ref: NOVA,
					nameInk: { kind: "palette", index: 2 },
					bodyInk: { kind: "palette", index: 1 },
				},
			}),
		);
		await restartHub();
		const updated = (await readProfiles()).find(
			(profile) => profile.id === NOVA_ID,
		);
		expect(updated?.nameInk).toEqual({ kind: "palette", index: 2 });
		expect(updated?.bodyInk).toEqual({ kind: "palette", index: 1 });
	}, 60_000);

	it("refuses an appearance write aimed outside the bound workspace", async () => {
		// This op became browser-reachable in this change, and `configParent`
		// arrives in the payload. Unchecked it names any directory on the host
		// and the store creates `<dir>/.cline/drive/` on the way, which turns an
		// appearance editor into a writer for other people's repositories.
		okPayload(
			await requireClient().command("call_join", {
				roomId: ROOM_ID,
				human: { id: "you", displayName: "You", role: "host" },
				agent: { id: "adam", displayName: "Adam", role: "partner" },
				workspaceRoot,
				activateDrive: true,
			}),
		);
		const elsewhere = scratch("agent-profile-e2e-elsewhere-");

		const code = await expectRejection(() =>
			requireClient().command("drive_config_upsert_profile", {
				workspaceRoot: elsewhere,
				profile: {
					ref: NOVA,
					nameInk: { kind: "palette", index: 3 },
					bodyInk: { kind: "palette", index: 4 },
				},
			}),
		);
		expect(code).toBe("workspace_not_bound");
		// Refused before the write, so nothing was created out there.
		expect(existsSync(resolveCatalogFacetsPath(elsewhere))).toBe(false);

		// The bound workspace still writes.
		okPayload(
			await requireClient().command("drive_config_upsert_profile", {
				workspaceRoot,
				profile: {
					ref: NOVA,
					nameInk: { kind: "palette", index: 3 },
					bodyInk: { kind: "palette", index: 4 },
				},
			}),
		);
		expect(existsSync(resolveCatalogFacetsPath(workspaceRoot))).toBe(true);
	}, 60_000);

	it("never stores a resolved colour, only a theme-agnostic ink ref", async () => {
		okPayload(
			await requireClient().command("drive_config_upsert_profile", {
				workspaceRoot,
				profile: {
					ref: NOVA,
					nameInk: { kind: "palette", index: 3 },
					bodyInk: { kind: "palette", index: 4 },
				},
			}),
		);
		const raw = readFileSync(resolveCatalogFacetsPath(workspaceRoot), "utf8");
		expect(raw).not.toContain("oklch");
		expect(raw).not.toMatch(/#[0-9a-f]{6}/i);
	}, 60_000);

	it("keeps a policy edit across a hub restart", async () => {
		okPayload(
			await requireClient().command("drive_agent_home_put", {
				workspaceRoot,
				slug: "nova",
				patch: {
					agent: { description: "Edited through the profile page." },
					permissions: { presetIntent: "standard" },
				},
			}),
		);

		await restartHub();

		const payload = okPayload(
			await requireClient().command("drive_agent_home_get", {
				workspaceRoot,
				slug: "nova",
			}),
		);
		const home = payload.home as {
			agent: { description: string; systemPrompt?: string };
			permissions: { presetIntent: string };
		};
		expect(home.agent.description).toBe("Edited through the profile page.");
		expect(home.permissions.presetIntent).toBe("standard");
		// Absence means unchanged: the prompt was never in the patch and must
		// still be on disk.
		expect(home.agent.systemPrompt).toContain("Secret prompt");
	}, 60_000);
});
