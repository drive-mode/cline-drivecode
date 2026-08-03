import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Deep import on purpose: this suite drives the *real* hub handler behind the
 * bridge rather than a stub of it, so the destroyer test below exercises the
 * actual sanitize → save → re-read sequence. `@cline/core/*` is aliased to
 * source by `apps/cline-hub/vitest.config.ts`.
 */
import { handleDriveHomeCommand } from "@cline/core/hub/server/handlers/drive-home-handlers";
import type {
	HubCommandEnvelope,
	HubCommandName,
	HubReplyEnvelope,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	handleDriveAgentHomePutWebviewCommand,
	handleDriveAgentHomeWebviewCommand,
} from "./drive-agent-home";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

function peer(): BrowserPeer {
	return { id: "peer-1" } as unknown as BrowserPeer;
}

function ctx(overrides?: {
	uiClient?: HubContext["uiClient"];
	send?: HubContext["send"];
}): { context: HubContext; sent: unknown[] } {
	const sent: unknown[] = [];
	const context = {
		uiClient: overrides?.uiClient,
		send:
			overrides?.send ??
			((_peer: BrowserPeer, message: unknown) => {
				sent.push(message);
			}),
	} as unknown as HubContext;
	return { context, sent };
}

const sampleHome = {
	slug: "pair-partner",
	agent: {
		name: "pair-partner",
		description: "Default Drive pair partner.",
		tools: ["read_file"],
		skills: ["drive-persona"],
		systemPrompt: "SECRET PROMPT MUST NOT LEAK",
	},
	permissions: {
		presetIntent: "standard" as const,
		approvalHooks: ["highImpact"],
		notes: "Intent only.",
	},
	env: { values: {}, secretRefs: [] },
};

const sampleCompiled = {
	name: "pair-partner",
	slug: "pair-partner",
	description: "Default Drive pair partner.",
	tools: ["read_file"],
	skills: ["drive-persona"],
	systemPrompt: "SECRET PROMPT MUST NOT LEAK",
};

describe("handleDriveAgentHomeWebviewCommand", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("errors when hub is disconnected", async () => {
		const { context, sent } = ctx({ uiClient: undefined });
		await handleDriveAgentHomeWebviewCommand(context, peer(), {
			type: "drive_agent_home_get",
			workspaceRoot: "/tmp/ws",
			slug: "pair-partner",
			requestId: "req-1",
		});
		expect(sent).toEqual([
			{
				type: "drive_agent_home_error",
				text: "Hub is not connected.",
				code: "hub_disconnected",
				requestId: "req-1",
			},
		]);
	});

	it("errors when workspaceRoot or slug is empty", async () => {
		const command = vi.fn();
		const { context, sent } = ctx({
			uiClient: { command } as unknown as HubContext["uiClient"],
		});
		await handleDriveAgentHomeWebviewCommand(context, peer(), {
			type: "drive_agent_home_get",
			workspaceRoot: "  ",
			slug: "pair-partner",
			requestId: "req-root",
		});
		expect(sent[0]).toMatchObject({
			type: "drive_agent_home_error",
			code: "invalid_payload",
			requestId: "req-root",
		});
		expect(command).not.toHaveBeenCalled();

		sent.length = 0;
		await handleDriveAgentHomeWebviewCommand(context, peer(), {
			type: "drive_agent_home_get",
			workspaceRoot: "/tmp/ws",
			slug: "",
			requestId: "req-slug",
		});
		expect(sent[0]).toMatchObject({
			type: "drive_agent_home_error",
			code: "invalid_payload",
			requestId: "req-slug",
		});
	});

	it("forwards drive_agent_home_get and strips prompt fields", async () => {
		const command = vi.fn().mockResolvedValue({
			ok: true,
			payload: { home: sampleHome, compiled: sampleCompiled },
		});
		const { context, sent } = ctx({
			uiClient: { command } as unknown as HubContext["uiClient"],
		});
		await handleDriveAgentHomeWebviewCommand(context, peer(), {
			type: "drive_agent_home_get",
			workspaceRoot: "/tmp/ws",
			slug: "pair-partner",
			requestId: "req-ok",
		});
		expect(command).toHaveBeenCalledWith("drive_agent_home_get", {
			workspaceRoot: "/tmp/ws",
			slug: "pair-partner",
		});
		expect(sent).toHaveLength(1);
		const message = sent[0] as {
			type: string;
			home: { agent: Record<string, unknown> };
			compiled: Record<string, unknown>;
		};
		expect(message.type).toBe("drive_agent_home");
		expect(message.home.agent.systemPrompt).toBeUndefined();
		expect(message.compiled.systemPrompt).toBeUndefined();
		expect(message.compiled.description).toBe("Default Drive pair partner.");
		expect(message.home.agent.tools).toEqual(["read_file"]);
	});

	it("maps hub command failure to drive_agent_home_error", async () => {
		const command = vi.fn().mockResolvedValue({
			ok: false,
			error: { code: "unknown_agent", message: "missing home" },
		});
		const { context, sent } = ctx({
			uiClient: { command } as unknown as HubContext["uiClient"],
		});
		await handleDriveAgentHomeWebviewCommand(context, peer(), {
			type: "drive_agent_home_get",
			workspaceRoot: "/tmp/ws",
			slug: "missing",
			requestId: "req-err",
		});
		expect(sent).toEqual([
			{
				type: "drive_agent_home_error",
				text: "missing home",
				code: "unknown_agent",
				requestId: "req-err",
			},
		]);
	});
});

const EXAMPLE_HOME = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../docs/drivecode/plans/cline-drivemode/examples/driveagent-pair-partner",
);

/**
 * The sanitize → edit → save loop against real files.
 *
 * The bridge is wired to the real hub handler here rather than a stub, so the
 * projection under test is the one the browser actually receives and the save
 * lands on the same bytes the loader will read next. Every assertion is on
 * `agent.yaml` re-read from disk: a reply that echoes a prompt it never wrote
 * satisfies a check on the frame and fails on the user's next reload.
 */
describe("Driveagent home sanitize/save round trip on real files", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		for (const dir of dirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	/** A uiClient that runs the production hub handler in-process. */
	function hubBackedCtx(): { context: HubContext; sent: unknown[] } {
		const sent: unknown[] = [];
		const command = (
			name: HubCommandName,
			payload: Record<string, unknown>,
		): Promise<HubReplyEnvelope> =>
			handleDriveHomeCommand(
				{ clients: new Map() } as never,
				{
					version: "v1",
					requestId: "req_bridge",
					clientId: "test",
					command: name,
					payload,
				} as HubCommandEnvelope,
			);
		const context = {
			uiClient: { command },
			send: (_peer: BrowserPeer, message: unknown) => {
				sent.push(message);
			},
		} as unknown as HubContext;
		return { context, sent };
	}

	async function seededRoot(): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), "drive-home-bridge-"));
		dirs.push(root);
		const dest = join(root, ".driveagent", "pair-partner");
		await mkdir(dirname(dest), { recursive: true });
		await cp(EXAMPLE_HOME, dest, { recursive: true });
		return root;
	}

	function agentYamlPath(root: string, slug = "pair-partner"): string {
		return join(root, ".driveagent", slug, "agent.yaml");
	}

	/**
	 * The literal prompt block from the example home. Asserted as raw bytes
	 * rather than a parsed field, because the failure this guards against is a
	 * file whose prompt is gone — and a parser is the wrong instrument for
	 * checking that something is still physically there.
	 */
	const PROMPT_LINES = [
		"You are the Drive pair partner. Narrate decision points. Prefer the stage for edits and commands.",
		"Respect address set and room mode overlays.",
	];

	type SanitizedHomeFrame = {
		type: string;
		home: {
			slug: string;
			agent: Record<string, unknown>;
			permissions: Record<string, unknown>;
		};
	};

	async function readSanitizedHome(
		root: string,
		slug = "pair-partner",
	): Promise<SanitizedHomeFrame> {
		const { context, sent } = hubBackedCtx();
		await handleDriveAgentHomeWebviewCommand(context, peer(), {
			type: "drive_agent_home_get",
			workspaceRoot: root,
			slug,
			requestId: "req-read",
		});
		const frame = sent[0] as SanitizedHomeFrame;
		expect(frame.type).toBe("drive_agent_home");
		return frame;
	}

	async function save(
		root: string,
		patch: unknown,
		slug = "pair-partner",
	): Promise<Record<string, unknown>> {
		const { context, sent } = hubBackedCtx();
		await handleDriveAgentHomePutWebviewCommand(context, peer(), {
			type: "drive_agent_home_put",
			workspaceRoot: root,
			slug,
			patch,
			requestId: "req-save",
		});
		return sent[0] as Record<string, unknown>;
	}

	it("preserves the prompt when the sanitized read is saved back unmodified", async () => {
		const root = await seededRoot();
		const before = await readFile(agentYamlPath(root), "utf8");
		for (const line of PROMPT_LINES) {
			expect(before).toContain(line);
		}

		const frame = await readSanitizedHome(root);
		// The projection genuinely lacks the prompt — otherwise this test would
		// be proving nothing about the merge.
		expect(frame.home.agent.systemPrompt).toBeUndefined();
		expect(frame.home.agent.promptPath).toBeUndefined();

		// What a naive editor sends: the home section, straight back.
		const reply = await save(root, {
			slug: frame.home.slug,
			agent: frame.home.agent,
			permissions: frame.home.permissions,
		});
		expect(reply.type).toBe("drive_agent_home_saved");

		const after = await readFile(agentYamlPath(root), "utf8");
		for (const line of PROMPT_LINES) {
			expect(after).toContain(line);
		}

		// And the home still loads — the failure mode is an unloadable agent,
		// not merely a missing string. `readSanitizedHome` goes through the real
		// loader, which enforces `systemPrompt || promptPath`.
		const rereadFrame = await readSanitizedHome(root);
		expect(rereadFrame.type).toBe("drive_agent_home");
	});

	it("persists an actually-changed field and keeps the file loadable", async () => {
		const root = await seededRoot();

		const reply = await save(root, {
			agent: { description: "Edited through the sheet." },
			permissions: { presetIntent: "readonly" },
		});
		expect(reply.type).toBe("drive_agent_home_saved");

		const after = await readFile(agentYamlPath(root), "utf8");
		expect(after).toContain("Edited through the sheet.");
		for (const line of PROMPT_LINES) {
			expect(after).toContain(line);
		}

		const frame = await readSanitizedHome(root);
		expect(frame.home.agent.description).toBe("Edited through the sheet.");
		expect(frame.home.permissions.presetIntent).toBe("readonly");
	});

	it("refuses a payload naming a stripped field before it reaches the hub", async () => {
		const root = await seededRoot();
		const before = await readFile(agentYamlPath(root), "utf8");
		const command = vi.fn();
		const { context, sent } = ctx({
			uiClient: { command } as unknown as HubContext["uiClient"],
		});

		await handleDriveAgentHomePutWebviewCommand(context, peer(), {
			type: "drive_agent_home_put",
			workspaceRoot: root,
			slug: "pair-partner",
			patch: { agent: { systemPrompt: "overwritten" } },
			requestId: "req-hidden",
		});

		expect(sent[0]).toMatchObject({
			type: "drive_agent_home_error",
			code: "hidden_field_write",
		});
		expect(command).not.toHaveBeenCalled();
		expect(await readFile(agentYamlPath(root), "utf8")).toBe(before);
	});

	it("refuses a plaintext secret before it reaches the hub", async () => {
		const root = await seededRoot();
		const envPath = join(root, ".driveagent", "pair-partner", "env.yaml");
		const before = await readFile(envPath, "utf8");
		const command = vi.fn();
		const { context, sent } = ctx({
			uiClient: { command } as unknown as HubContext["uiClient"],
		});

		await handleDriveAgentHomePutWebviewCommand(context, peer(), {
			type: "drive_agent_home_put",
			workspaceRoot: root,
			slug: "pair-partner",
			patch: { env: { values: { apiKey: "sk-live-not-a-real-credential" } } },
			requestId: "req-secret",
		});

		expect(sent[0]).toMatchObject({
			type: "drive_agent_home_error",
			code: "plaintext_secret",
		});
		expect(command).not.toHaveBeenCalled();
		expect(await readFile(envPath, "utf8")).toBe(before);
	});

	/**
	 * The error channel is the other way a prompt can escape.
	 *
	 * A hub failure that quotes the file — a YAML parse error carries a code
	 * frame of the offending source line — must not be forwarded verbatim, or a
	 * malformed home leaks through `drive_agent_home_error` exactly what
	 * `sanitizeHome` removed from `drive_agent_home`.
	 */
	it("does not relay a hub error that quotes the file", async () => {
		const leak =
			"systemPrompt: |\n  You are the Drive pair partner. Narrate decision points.";
		for (const code of ["invalid_home", "drive_agent_home_command_failed"]) {
			const command = vi.fn().mockResolvedValue({
				ok: false,
				error: { code, message: `refusing to write: ${leak}` },
			});
			const { context, sent } = ctx({
				uiClient: { command } as unknown as HubContext["uiClient"],
			});

			await handleDriveAgentHomePutWebviewCommand(context, peer(), {
				type: "drive_agent_home_put",
				workspaceRoot: "/tmp/ws",
				slug: "pair-partner",
				patch: { agent: { description: "x" } },
				requestId: "req-leak",
			});

			const frame = sent[0] as { text: string; code?: string };
			expect(frame.code).toBe(code);
			expect(frame.text).not.toContain("Narrate decision points");
			expect(frame.text).not.toContain("systemPrompt");
		}
	});

	it("still relays a refusal that only describes the payload", async () => {
		const root = await seededRoot();
		const reply = (await save(root, {
			agent: { description: "  " },
		})) as { text: string; code?: string };
		expect(reply.code).toBe("invalid_patch");
		// Actionable, and about the caller's own payload rather than the file.
		expect(reply.text).toContain("agent.description");
	});

	it("refuses a save to a home marked editable: false", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-home-bridge-locked-"));
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

		const reply = await save(
			root,
			{ agent: { description: "Trying anyway." } },
			"locked-agent",
		);
		expect(reply).toMatchObject({
			type: "drive_agent_home_error",
			code: "not_editable",
		});
		expect(await readFile(join(dir, "agent.yaml"), "utf8")).toBe(before);
	});

	it("does not leak the prompt back through the save reply", async () => {
		const root = await seededRoot();
		const reply = await save(root, {
			agent: { description: "Reply must stay sanitized." },
		});
		expect(JSON.stringify(reply)).not.toMatch(/Narrate decision points/);
	});
});
