/**
 * Driveagent home edits over a real hub (DRV-DRIVEAGENT-HOME, ADR-0023).
 *
 * Configuration-as-code is only editable if a save survives the thing that
 * makes it code: the file. So every assertion here is on `.driveagent/` bytes
 * re-read from disk, or on a `drive_agent_home_get` issued by a hub process
 * that was torn down and rebuilt after the write. None of them trust the
 * reply to the save.
 *
 * The sequence that matters is the first test's. The read path strips
 * `systemPrompt`, `promptPath`, `providerId` and `modelId` before a home
 * reaches a browser, so an editor that round-trips what it received sends a
 * payload with no prompt in it. Serialising that payload would not merely lose
 * the prompt — `DriveagentAgentYamlSchema` rejects an agent.yaml carrying
 * neither `systemPrompt` nor `promptPath`, so the agent would stop loading.
 * The test performs exactly that round trip and then asks the hub to load the
 * agent again.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HubReplyEnvelope } from "@cline/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { HubCommandError, NodeHubClient } from "./client";
import { resetDriveRoomStoreForTests } from "./collaboration";
import { createLocalHubScheduleRuntimeHandlers } from "./daemon/runtime-handlers";
import { type HubServer, startHubServer } from "./daemon/start-shared-server";

/**
 * Scratch ports, distinct from every other suite that binds a real hub.
 *
 * `drive-artifact-corpus.e2e.test.ts` holds 25963/8987,
 * `status/status-tag-filter.e2e.test.ts` holds 25971/8993 and
 * `drive-agent-appearance.e2e.test.ts` holds 25983/8999; vitest runs e2e files
 * in parallel, so sharing a pair fails whichever file loses the race with
 * EADDRINUSE — an error about ports, reported as a write-path failure.
 * Overridable on top of that, because several worktrees run at once.
 */
const HUB_PORT = Number(process.env.CLINE_TEST_HOME_WRITE_HUB_PORT ?? 25991);
const DASHBOARD_PORT = Number(
	process.env.CLINE_TEST_HOME_WRITE_DASHBOARD_PORT ?? 9007,
);

const SLUG = "pair-partner";
const LOCKED_SLUG = "locked-agent";

const EXAMPLE_HOME = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../../docs/drivecode/plans/cline-drivemode/examples/driveagent-pair-partner",
);

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

/** The error code for a command expected to fail; a success fails the test. */
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

/**
 * What the cline-hub bridge leaves in a home before it reaches the browser.
 *
 * Mirrors `sanitizeHome` in `apps/cline-hub/src/server/drive-agent-home.ts`,
 * which this package cannot import. The bridge's own suite drives the real
 * function; here the point is that the payload sent back carries no prompt.
 */
function sanitizeLikeTheBridge(home: Record<string, unknown>): {
	slug: unknown;
	agent: Record<string, unknown>;
	permissions: Record<string, unknown>;
} {
	const agent = home.agent as Record<string, unknown>;
	const permissions = home.permissions as Record<string, unknown>;
	return {
		slug: home.slug,
		agent: {
			name: agent.name,
			description: agent.description,
			...(Array.isArray(agent.tools) ? { tools: agent.tools } : {}),
			...(Array.isArray(agent.skills) ? { skills: agent.skills } : {}),
			...(typeof agent.editable === "boolean"
				? { editable: agent.editable }
				: {}),
		},
		permissions: {
			presetIntent: permissions.presetIntent,
			approvalHooks: permissions.approvalHooks ?? [],
			...(typeof permissions.notes === "string"
				? { notes: permissions.notes }
				: {}),
		},
	};
}

describe("Driveagent home writes over a real hub", () => {
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
			clientType: "agent-home-write-e2e",
			workspaceRoot,
		});
	}

	async function stopHub(): Promise<void> {
		client?.close();
		client = undefined;
		await server?.close().catch(() => undefined);
		server = undefined;
	}

	/** Hub restart: same disk, a process that carries nothing over. */
	async function restartHub(): Promise<void> {
		await stopHub();
		await startHub();
	}

	function requireClient(): NodeHubClient {
		if (!client) {
			throw new Error("hub client not started");
		}
		return client;
	}

	function homeDir(slug = SLUG): string {
		return join(workspaceRoot, ".driveagent", slug);
	}

	function agentYamlOnDisk(slug = SLUG): string {
		return readFileSync(join(homeDir(slug), "agent.yaml"), "utf8");
	}

	function seedHome(): void {
		mkdirSync(join(workspaceRoot, ".driveagent"), { recursive: true });
		cpSync(EXAMPLE_HOME, homeDir(), { recursive: true });
	}

	async function getHome(slug = SLUG): Promise<Record<string, unknown>> {
		const payload = okPayload(
			await requireClient().command("drive_agent_home_get", {
				workspaceRoot,
				slug,
			}),
		);
		return payload.home as Record<string, unknown>;
	}

	async function putHome(
		patch: unknown,
		slug = SLUG,
	): Promise<Record<string, unknown>> {
		return okPayload(
			await requireClient().command("drive_agent_home_put", {
				workspaceRoot,
				slug,
				patch,
			}),
		);
	}

	beforeEach(async () => {
		process.env.CLINE_HUB_PORT = String(HUB_PORT);
		process.env.CLINE_HUB_DASHBOARD_PORT = String(DASHBOARD_PORT);
		process.env.CLINE_DATA_DIR = scratch("drive-home-write-e2e-data-");
		workspaceRoot = scratch("drive-home-write-e2e-ws-");
		seedHome();
		await startHub();
	});

	afterEach(async () => {
		await stopHub();
		// The room store is process-global and outlives the server, so a root
		// bound by one test would make the next one's fresh scratch workspace
		// look out of bounds.
		resetDriveRoomStoreForTests();
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

	it("survives the round trip a naive editor produces, and still loads after a restart", async () => {
		const before = agentYamlOnDisk();
		expect(before).toContain("Narrate decision points");

		const loaded = await getHome();
		const roundTripped = sanitizeLikeTheBridge(loaded);
		// The premise: the payload really has lost the prompt on the way out.
		expect(roundTripped.agent.systemPrompt).toBeUndefined();
		expect(roundTripped.agent.promptPath).toBeUndefined();

		// The save must be accepted. A refusal would leave the prompt intact for
		// the wrong reason and hide the bug this test exists to catch.
		await putHome(roundTripped);

		expect(agentYamlOnDisk()).toContain("Narrate decision points");

		await restartHub();

		// A fresh process loading the file the save left behind. This is the
		// assertion a destroyed home fails: the loader enforces
		// `systemPrompt || promptPath`, so an emptied agent.yaml errors here.
		const reloaded = await getHome();
		expect((reloaded.agent as { systemPrompt?: string }).systemPrompt).toBe(
			(loaded.agent as { systemPrompt?: string }).systemPrompt,
		);
	});

	it("persists a real edit across a hub restart", async () => {
		const originalPrompt = (
			(await getHome()).agent as { systemPrompt?: string }
		).systemPrompt;

		await putHome({
			agent: {
				description: "Pair partner, retuned in the profile sheet.",
				tools: ["read_file", "list_files"],
			},
			permissions: { presetIntent: "readonly", approvalHooks: [] },
		});

		// On disk before anything reads it back through the hub.
		const text = agentYamlOnDisk();
		expect(text).toContain("Pair partner, retuned in the profile sheet.");
		expect(text).toContain("Narrate decision points");

		await restartHub();

		const reloaded = await getHome();
		expect(reloaded.agent).toMatchObject({
			description: "Pair partner, retuned in the profile sheet.",
			tools: ["read_file", "list_files"],
			systemPrompt: originalPrompt,
		});
		expect(reloaded.permissions).toMatchObject({
			presetIntent: "readonly",
			approvalHooks: [],
		});
	});

	it("refuses a payload that names a stripped field, leaving the file byte-identical", async () => {
		const before = agentYamlOnDisk();

		const code = await errorCodeOf(() =>
			requireClient().command("drive_agent_home_put", {
				workspaceRoot,
				slug: SLUG,
				patch: {
					agent: { description: "New.", systemPrompt: "overwritten" },
				},
			}),
		);
		expect(code).toBe("hidden_field_write");

		await restartHub();
		expect(agentYamlOnDisk()).toBe(before);
	});

	/**
	 * `workspaceRoot` crosses the wire from a page. Once the hub is bound to a
	 * workspace — which is what joining a room does — a payload naming any
	 * other directory must be refused, or a config editor writes other people's
	 * checkouts.
	 *
	 * The binding is asserted through the same public surface the hub uses, so
	 * this fails if the gate stops consulting it.
	 */
	it("refuses a workspaceRoot outside the workspace the hub is bound to", async () => {
		const stranger = scratch("drive-home-write-e2e-stranger-");
		mkdirSync(join(stranger, ".driveagent"), { recursive: true });
		cpSync(EXAMPLE_HOME, join(stranger, ".driveagent", SLUG), {
			recursive: true,
		});
		const before = readFileSync(
			join(stranger, ".driveagent", SLUG, "agent.yaml"),
			"utf8",
		);

		// Bind the hub to this test's workspace, which is what a room join does.
		okPayload(
			await requireClient().command("call_join", {
				roomId: "r_home_write",
				workspaceRoot,
				human: { id: "h_1", displayName: "Human" },
				agent: { id: "a_1", displayName: "Partner" },
			}),
		);

		const code = await errorCodeOf(() =>
			requireClient().command("drive_agent_home_put", {
				workspaceRoot: stranger,
				slug: SLUG,
				patch: { agent: { description: "Reaching next door." } },
			}),
		);
		expect(code).toBe("workspace_not_bound");

		// The bound workspace still writes, so this is a boundary and not a
		// blanket refusal.
		okPayload(
			await requireClient().command("drive_agent_home_put", {
				workspaceRoot,
				slug: SLUG,
				patch: { agent: { description: "Mine to edit." } },
			}),
		);

		await restartHub();
		expect(
			readFileSync(join(stranger, ".driveagent", SLUG, "agent.yaml"), "utf8"),
		).toBe(before);
		expect(agentYamlOnDisk()).toContain("Mine to edit.");
	});

	it("refuses a plaintext secret, leaving env.yaml byte-identical", async () => {
		const envPath = join(homeDir(), "env.yaml");
		const before = readFileSync(envPath, "utf8");

		const code = await errorCodeOf(() =>
			requireClient().command("drive_agent_home_put", {
				workspaceRoot,
				slug: SLUG,
				patch: { env: { values: { apiKey: "sk-live-not-a-real-credential" } } },
			}),
		);
		expect(code).toBe("plaintext_secret");

		await restartHub();
		expect(readFileSync(envPath, "utf8")).toBe(before);
		expect(readFileSync(envPath, "utf8")).not.toContain("sk-live");
	});

	it("refuses every write to a home marked editable: false", async () => {
		const dir = homeDir(LOCKED_SLUG);
		mkdirSync(dir, { recursive: true });
		cpSync(EXAMPLE_HOME, dir, { recursive: true });
		const lockedAgentYaml = [
			`name: ${LOCKED_SLUG}`,
			"description: Shipped read-only.",
			"systemPrompt: Locked prompt.",
			"editable: false",
			"",
		].join("\n");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(join(dir, "agent.yaml"), lockedAgentYaml, "utf8");

		// The read still works — the home is visible, just not writable.
		expect(await getHome(LOCKED_SLUG)).toMatchObject({
			agent: { editable: false },
		});

		const code = await errorCodeOf(() =>
			requireClient().command("drive_agent_home_put", {
				workspaceRoot,
				slug: LOCKED_SLUG,
				patch: { agent: { description: "Trying anyway." } },
			}),
		);
		expect(code).toBe("not_editable");

		await restartHub();
		expect(agentYamlOnDisk(LOCKED_SLUG)).toBe(lockedAgentYaml);
	});
});
