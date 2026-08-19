import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import { parseDriveagentAgentYaml } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import {
	getDriveRoomStore,
	JsonlRoomEventLog,
	resetDriveRoomStoreForTests,
} from "../../collaboration";
import type { HubTransportContext } from "./context";
import { handleDriveHomeCommand } from "./drive-home-handlers";

const EXAMPLE_HOME = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../../../../docs/drivecode/plans/cline-drivemode/examples/driveagent-pair-partner",
);

function command(
	name: HubCommandEnvelope["command"],
	payload?: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		requestId: "req_home",
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

async function seedPairPartnerHome(workspaceRoot: string): Promise<void> {
	const dest = join(workspaceRoot, ".driveagent", "pair-partner");
	await mkdir(dirname(dest), { recursive: true });
	await cp(EXAMPLE_HOME, dest, { recursive: true });
}

describe("handleDriveHomeCommand", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		resetDriveRoomStoreForTests();
		for (const dir of dirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("requires workspaceRoot and slug", async () => {
		const missingRoot = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_get", { slug: "pair-partner" }),
		);
		expect(missingRoot.ok).toBe(false);
		expect(missingRoot.error?.code).toBe("invalid_payload");

		const missingSlug = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_get", { workspaceRoot: "/tmp" }),
		);
		expect(missingSlug.ok).toBe(false);
		expect(missingSlug.error?.code).toBe("invalid_payload");
	});

	it("returns unknown_agent when the home is missing", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-home-hub-"));
		dirs.push(root);

		const reply = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_get", {
				workspaceRoot: root,
				slug: "missing-agent",
			}),
		);
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("unknown_agent");
	});

	it("loads and compiles the pair-partner example home", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-home-hub-"));
		dirs.push(root);
		await seedPairPartnerHome(root);

		const reply = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_get", {
				workspaceRoot: root,
				slug: "pair-partner",
			}),
		);
		expect(reply.ok).toBe(true);
		expect(reply.payload?.home).toMatchObject({
			slug: "pair-partner",
			agent: { name: "pair-partner" },
			permissions: { presetIntent: "standard" },
		});
		expect(reply.payload?.compiled).toMatchObject({
			slug: "pair-partner",
			name: "pair-partner",
			tools: ["read_file", "write_file", "execute_command", "list_files"],
			skills: ["drive-persona", "drive-modes"],
		});
		expect(
			(reply.payload?.compiled as { systemPrompt?: string }).systemPrompt,
		).toMatch(/pair partner/i);
	});

	it("prefers workspace home over user home when both exist", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-home-hub-ws-"));
		dirs.push(root);

		const wsDir = join(root, ".driveagent", "pair-partner");
		await mkdir(wsDir, { recursive: true });
		await writeFile(
			join(wsDir, "agent.yaml"),
			[
				"name: pair-partner",
				"description: Workspace override pair partner.",
				"systemPrompt: Workspace-tier pair partner prompt.",
				"",
			].join("\n"),
			"utf8",
		);
		await writeFile(
			join(wsDir, "permissions.yaml"),
			"presetIntent: readonly\n",
			"utf8",
		);
		await writeFile(
			join(wsDir, "env.yaml"),
			"values: {}\nsecretRefs: []\n",
			"utf8",
		);

		const reply = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_get", {
				workspaceRoot: root,
				slug: "pair-partner",
			}),
		);
		expect(reply.ok).toBe(true);
		expect(reply.payload?.home).toMatchObject({
			permissions: { presetIntent: "readonly" },
		});
		expect(
			(reply.payload?.compiled as { systemPrompt?: string }).systemPrompt,
		).toMatch(/Workspace-tier/i);
	});

	/**
	 * Get/list share put's bound-root gate: a page-supplied workspaceRoot must
	 * not read another checkout's `.driveagent/` once the hub is bound.
	 */
	it("refuses get and list for a workspaceRoot outside the bound workspace", async () => {
		const mine = await mkdtemp(join(tmpdir(), "drive-home-bound-"));
		const theirs = await mkdtemp(join(tmpdir(), "drive-home-foreign-"));
		dirs.push(mine, theirs);
		await seedPairPartnerHome(mine);
		await seedPairPartnerHome(theirs);
		getDriveRoomStore().attachEventLog(new JsonlRoomEventLog(mine));

		const getForeign = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_get", {
				workspaceRoot: theirs,
				slug: "pair-partner",
			}),
		);
		expect(getForeign.ok).toBe(false);
		expect(getForeign.error?.code).toBe("workspace_not_bound");

		const listForeign = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_list", { workspaceRoot: theirs }),
		);
		expect(listForeign.ok).toBe(false);
		expect(listForeign.error?.code).toBe("workspace_not_bound");

		const getMine = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_get", {
				workspaceRoot: mine,
				slug: "pair-partner",
			}),
		);
		expect(getMine.ok).toBe(true);

		const listMine = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_list", { workspaceRoot: mine }),
		);
		expect(listMine.ok).toBe(true);
		expect(listMine.payload?.homes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ slug: "pair-partner" }),
			]),
		);

		resetDriveRoomStoreForTests();
	});
});

/**
 * The put lane's contract is about bytes on disk, so every assertion below
 * re-reads `agent.yaml` and re-parses it through the schema the loader uses.
 * A reply that reports a prompt it never wrote passes a check on
 * `reply.payload` and fails on the user's next reload.
 */
describe("handleDriveHomeCommand — drive_agent_home_put", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		// The room store is process-global; a bound root left behind would make
		// the next file's writes look out of bounds.
		resetDriveRoomStoreForTests();
		for (const dir of dirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	async function seededRoot(): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), "drive-home-put-"));
		dirs.push(root);
		await seedPairPartnerHome(root);
		return root;
	}

	function agentYamlPath(root: string): string {
		return join(root, ".driveagent", "pair-partner", "agent.yaml");
	}

	async function readAgentFromDisk(root: string): Promise<{
		systemPrompt?: string;
		description: string;
		tools?: string[];
		skills?: string[];
	}> {
		const text = await readFile(agentYamlPath(root), "utf8");
		return parseDriveagentAgentYaml(YAML.parse(text));
	}

	async function put(
		root: string,
		patch: unknown,
		slug = "pair-partner",
	): Promise<Awaited<ReturnType<typeof handleDriveHomeCommand>>> {
		return handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_put", {
				workspaceRoot: root,
				slug,
				patch,
			}),
		);
	}

	/**
	 * `workspaceRoot` reaches this handler from a browser page. Left unpinned it
	 * names any directory on the host holding a `.driveagent/<slug>/`, so a
	 * config editor becomes a writer for other people's checkouts. Bound to a
	 * workspace, the hub writes that one and no other — the same anchor
	 * `drive_artifacts_list` uses to keep a read inside the workspace.
	 */
	it("refuses a workspaceRoot outside the workspace the hub is bound to", async () => {
		const mine = await seededRoot();
		const theirs = await seededRoot();
		getDriveRoomStore().attachEventLog(new JsonlRoomEventLog(mine));
		const before = await readFile(agentYamlPath(theirs), "utf8");

		const reply = await put(theirs, {
			agent: { description: "Reaching into another checkout." },
		});
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("workspace_not_bound");
		expect(await readFile(agentYamlPath(theirs), "utf8")).toBe(before);

		// The bound workspace itself still writes, so the gate is a boundary
		// rather than a blanket refusal.
		expect(
			(await put(mine, { agent: { description: "Mine to edit." } })).ok,
		).toBe(true);
	});

	it("requires workspaceRoot, slug, and a patch object", async () => {
		const root = await seededRoot();
		expect(
			(
				await handleDriveHomeCommand(
					ctx(),
					command("drive_agent_home_put", { slug: "pair-partner", patch: {} }),
				)
			).error?.code,
		).toBe("invalid_payload");
		expect(
			(
				await handleDriveHomeCommand(
					ctx(),
					command("drive_agent_home_put", { workspaceRoot: root, patch: {} }),
				)
			).error?.code,
		).toBe("invalid_payload");
		expect((await put(root, undefined)).error?.code).toBe("invalid_payload");
		expect((await put(root, ["not", "an", "object"])).error?.code).toBe(
			"invalid_payload",
		);
	});

	it("keeps the prompt when the payload the read path produced is sent back", async () => {
		const root = await seededRoot();
		const before = await readAgentFromDisk(root);
		expect(before.systemPrompt).toMatch(/pair partner/i);

		// Exactly the fields `sanitizeHome` leaves in place — no systemPrompt,
		// no promptPath, no providerId, no modelId.
		const roundTripped = {
			slug: "pair-partner",
			agent: {
				name: "pair-partner",
				description: before.description,
				tools: before.tools,
				skills: before.skills,
			},
			permissions: {
				presetIntent: "standard",
				approvalHooks: ["highImpact"],
				notes: "Intent only. Hub policy owns enforcement.",
			},
		};

		// The alternative this whole lane exists to avoid: writing the payload
		// out as the file. It does not merely drop the prompt — the result no
		// longer satisfies the schema, so the agent stops loading at all.
		expect(() => parseDriveagentAgentYaml(roundTripped.agent)).toThrow(
			/systemPrompt or promptPath/,
		);

		const reply = await put(root, roundTripped);

		// The write must be accepted, not refused — a refusal would preserve the
		// prompt for the wrong reason and hide the bug this test exists to catch.
		expect(reply.ok).toBe(true);
		const after = await readAgentFromDisk(root);
		expect(after.systemPrompt).toBe(before.systemPrompt);
		expect(after.description).toBe(before.description);

		// And it changed nothing at all: a save with no edits in it must not
		// rewrite the file, or every visit to the sheet produces a diff.
		expect(reply.payload?.changedFiles).toEqual([]);
	});

	it("persists a changed field and leaves the file loadable", async () => {
		const root = await seededRoot();
		const before = await readAgentFromDisk(root);

		const reply = await put(root, {
			agent: { description: "Reviewed pair partner.", tools: ["read_file"] },
			permissions: { presetIntent: "readonly" },
		});
		expect(reply.ok).toBe(true);

		const after = await readAgentFromDisk(root);
		expect(after.description).toBe("Reviewed pair partner.");
		expect(after.tools).toEqual(["read_file"]);
		expect(after.systemPrompt).toBe(before.systemPrompt);

		// Re-read through the real load path: the file must still resolve, not
		// merely still parse as YAML.
		const reread = await handleDriveHomeCommand(
			ctx(),
			command("drive_agent_home_get", {
				workspaceRoot: root,
				slug: "pair-partner",
			}),
		);
		expect(reread.ok).toBe(true);
		expect(reread.payload?.compiled).toMatchObject({
			description: "Reviewed pair partner.",
			tools: ["read_file"],
		});
		expect(reread.payload?.compiled).toMatchObject({
			systemPrompt: before.systemPrompt,
		});
	});

	it("refuses a payload that names a stripped field, leaving disk untouched", async () => {
		const root = await seededRoot();
		const before = await readFile(agentYamlPath(root), "utf8");

		const reply = await put(root, {
			agent: { description: "New.", systemPrompt: "overwritten" },
		});
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("hidden_field_write");
		expect(await readFile(agentYamlPath(root), "utf8")).toBe(before);
	});

	it("refuses a write to a home marked editable: false", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-home-put-locked-"));
		dirs.push(root);
		const dir = join(root, ".driveagent", "locked-agent");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "agent.yaml"),
			[
				"name: locked-agent",
				"description: Shipped read-only.",
				"systemPrompt: Locked prompt.",
				"editable: false",
				"",
			].join("\n"),
			"utf8",
		);
		await writeFile(
			join(dir, "permissions.yaml"),
			"presetIntent: readonly\n",
			"utf8",
		);
		await writeFile(
			join(dir, "env.yaml"),
			"values: {}\nsecretRefs: []\n",
			"utf8",
		);
		const before = await readFile(join(dir, "agent.yaml"), "utf8");

		const reply = await put(
			root,
			{ agent: { description: "Trying anyway." } },
			"locked-agent",
		);
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("not_editable");
		expect(await readFile(join(dir, "agent.yaml"), "utf8")).toBe(before);
	});

	it("refuses a plaintext secret and writes nothing", async () => {
		const root = await seededRoot();
		const envPath = join(root, ".driveagent", "pair-partner", "env.yaml");
		const before = await readFile(envPath, "utf8");

		const reply = await put(root, {
			env: { values: { apiKey: "sk-live-not-a-real-credential" } },
		});
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("plaintext_secret");
		expect(await readFile(envPath, "utf8")).toBe(before);
		expect(await readFile(envPath, "utf8")).not.toContain("sk-live");
	});

	it("returns unknown_agent for a home that does not exist", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-home-put-missing-"));
		dirs.push(root);
		const reply = await put(root, { agent: { description: "x" } }, "nope");
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("unknown_agent");
	});
});
