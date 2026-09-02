import { mkdtempSync, rmSync } from "node:fs";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearHubDiscovery,
	createHubWorkspaceScopeId,
	probeHubServer,
	probeHubVersion,
	readHubDiscovery,
	readSupersededHubDiscovery,
	resolveHubOwnerContext,
	writeHubDiscovery,
} from ".";

type EnvSnapshot = {
	CLINE_DATA_DIR: string | undefined;
	CLINE_HUB_DISCOVERY_PATH: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
		CLINE_HUB_DISCOVERY_PATH: process.env.CLINE_HUB_DISCOVERY_PATH,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.CLINE_DATA_DIR = snapshot.CLINE_DATA_DIR;
	process.env.CLINE_HUB_DISCOVERY_PATH = snapshot.CLINE_HUB_DISCOVERY_PATH;
}

describe("hub discovery", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
	});

	it("stores shared hub discovery under the locks directory by default", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_HUB_DISCOVERY_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveHubOwnerContext("shared").discoveryPath).toBe(
			join(
				"/tmp/cline-data",
				"locks",
				"hub",
				"owners",
				"hub-a4d26868017c.json",
			),
		);
	});

	it("honors an explicit hub discovery path override", () => {
		snapshot = captureEnv();
		process.env.CLINE_HUB_DISCOVERY_PATH = "/tmp/custom-hub-discovery.json";

		expect(resolveHubOwnerContext("shared").discoveryPath).toBe(
			"/tmp/custom-hub-discovery.json",
		);
	});

	it("writes and clears discovery records at the resolved location", async () => {
		snapshot = captureEnv();
		delete process.env.CLINE_HUB_DISCOVERY_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		const discoveryPath = resolveHubOwnerContext("shared").discoveryPath;
		const record = {
			hubId: "hub_123",
			protocolVersion: "v1",
			workspaceScopeId: "scope_123",
			authToken: "test-token",
			host: "127.0.0.1",
			port: 25463,
			url: "ws://127.0.0.1:25463/hub",
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		await mkdir(dirname(discoveryPath), { recursive: true });
		await writeFile(discoveryPath, "{}\n", "utf8");
		await chmod(discoveryPath, 0o644);
		await writeHubDiscovery(discoveryPath, record);
		await expect(readHubDiscovery(discoveryPath)).resolves.toMatchObject(
			record,
		);
		// Windows does not support Unix file permissions; chmod is a no-op there.
		if (process.platform !== "win32") {
			expect((await stat(discoveryPath)).mode & 0o777).toBe(0o600);
		}
		await clearHubDiscovery(discoveryPath);
		await expect(readHubDiscovery(discoveryPath)).resolves.toBeUndefined();
	});

	it("rejects discovery records without an auth token", async () => {
		snapshot = captureEnv();
		delete process.env.CLINE_HUB_DISCOVERY_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		const discoveryPath = resolveHubOwnerContext("missing-auth").discoveryPath;
		await mkdir(dirname(discoveryPath), { recursive: true });
		await writeFile(
			discoveryPath,
			`${JSON.stringify({
				hubId: "hub_123",
				protocolVersion: "v1",
				host: "127.0.0.1",
				port: 25463,
				url: "ws://127.0.0.1:25463/hub",
				startedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			})}\n`,
			"utf8",
		);

		await expect(readHubDiscovery(discoveryPath)).resolves.toBeUndefined();
	});

	it("returns only public health fields for unauthenticated probes", async () => {
		const fetchMock = async () =>
			({
				ok: true,
				json: async () => ({
					ok: true,
					protocolVersion: "v1",
					minClientProtocolVersion: "v1",
					maxClientProtocolVersion: "v1",
					coreVersion: "1.0.0",
					host: "127.0.0.1",
					port: 25463,
					url: "ws://127.0.0.1:25463/hub",
				}),
			}) as Response;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as typeof fetch;
		try {
			const record = await probeHubServer("ws://127.0.0.1:25463/hub");

			expect(record).toMatchObject({
				protocolVersion: "v1",
				host: "127.0.0.1",
				port: 25463,
				url: "ws://127.0.0.1:25463/hub",
			});
			expect(record?.hubId).toBeUndefined();
			expect(record?.startedAt).toBeUndefined();
			expect(record?.updatedAt).toBeUndefined();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("reads strict public capability metadata from the version endpoint", async () => {
		const request = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						protocolVersion: "v1",
						minClientProtocolVersion: "v1",
						maxClientProtocolVersion: "v1",
						capabilities: [
							"chat_projection.v1",
							"chat_lifecycle.v1",
							"chat_runtime.v1",
						],
						buildId: "not-returned",
					}),
					{ status: 200 },
				),
		);
		await expect(
			probeHubVersion("ws://127.0.0.1:25463/hub?secret=ignored", request),
		).resolves.toEqual({
			protocolVersion: "v1",
			minClientProtocolVersion: "v1",
			maxClientProtocolVersion: "v1",
			capabilities: [
				"chat_projection.v1",
				"chat_lifecycle.v1",
				"chat_runtime.v1",
			],
		});
		expect(request).toHaveBeenCalledWith("http://127.0.0.1:25463/version");
	});
});

describe("readSupersededHubDiscovery", () => {
	it("reads the record the postinstall shield set aside", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-hub-superseded-"));
		try {
			const discoveryPath = join(dir, "production.json");
			await writeFile(
				`${discoveryPath}.superseded`,
				JSON.stringify({
					url: "ws://127.0.0.1:25463/hub",
					authToken: "shielded-token",
					pid: 50174,
				}),
			);
			expect(readSupersededHubDiscovery(discoveryPath)).toEqual({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "shielded-token",
				pid: 50174,
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns undefined when nothing was set aside or the record has no url", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-hub-superseded-"));
		try {
			const discoveryPath = join(dir, "production.json");
			expect(readSupersededHubDiscovery(discoveryPath)).toBeUndefined();
			await writeFile(
				`${discoveryPath}.superseded`,
				JSON.stringify({ pid: 1 }),
			);
			expect(readSupersededHubDiscovery(discoveryPath)).toBeUndefined();
			await writeFile(`${discoveryPath}.superseded`, "not json");
			expect(readSupersededHubDiscovery(discoveryPath)).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("workspace scope identity", () => {
	it("is stable for one token and canonical workspace but pathless", () => {
		const workspace = mkdtempSync(join(tmpdir(), "hub-scope-"));
		try {
			const first = createHubWorkspaceScopeId("token-a", workspace);
			const second = createHubWorkspaceScopeId("token-a", workspace);
			const rotated = createHubWorkspaceScopeId("token-b", workspace);
			expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
			expect(first).toBe(second);
			expect(first).not.toBe(rotated);
			expect(first).not.toContain(workspace);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});
