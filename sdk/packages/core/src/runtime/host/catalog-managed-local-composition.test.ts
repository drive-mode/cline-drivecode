import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClineCore } from "../../ClineCore";
import { getClineCoreCatalogLifecycleEventSource } from "../../chat-catalog/cline-core-event-source-registry";
import { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import { CoreSessionService } from "../../session/services/session-service";
import {
	createRuntimeHost,
	getCatalogManagedLocalRuntimeComposition,
} from "./host";

const WORKSPACE = resolve("/tmp/catalog-managed-composition-workspace");

describe("catalog-managed local runtime composition", () => {
	const cleanup: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		for (const dispose of cleanup.splice(0).reverse()) await dispose();
	});

	it("eagerly composes catalog and sessions over one SQLite database", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "catalog-managed-composition-"));
		const store = new SqliteSessionStore({
			sessionsDir: dataDir,
			tenantId: "composition-tenant",
		});
		store.init();
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: join(dataDir, "artifacts"),
		});
		const host = await createRuntimeHost({
			backendMode: "local",
			sessionService: sessions,
			chatLifecycle: {
				workspaceRoot: WORKSPACE,
				principalId: "local-human",
			},
		});
		const composition = getCatalogManagedLocalRuntimeComposition(host);
		cleanup.push(async () => {
			await host.dispose();
			composition?.dispose();
			store.close();
			rmSync(dataDir, { recursive: true, force: true });
		});

		expect(composition?.workspaceRoot).toBe(WORKSPACE);
		const retainedEventSource = composition?.eventSource;
		expect(store.sessionDbPath()).toBe(join(dataDir, "sessions.db"));
		expect(
			store.queryOne<{ version: number }>(
				`SELECT version FROM chat_catalog_schema WHERE singleton = 1`,
			),
		).toEqual({ version: 5 });
		expect(composition?.eventSource.currentSequence()).toBe(0);
		expect(
			store.queryOne<{ tenant_id: string }>(
				`SELECT tenant_id FROM database_tenant WHERE singleton = 1`,
			),
		).toEqual({ tenant_id: "composition-tenant" });

		await expect(
			host.startSession({
				config: {
					sessionId: "unissued-writer",
					providerId: "test-provider",
					modelId: "test-model",
					cwd: WORKSPACE,
					workspaceRoot: WORKSPACE,
					systemPrompt: "test",
					mode: "act",
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
				writerLease: {
					leaseToken: "not-issued-by-catalog",
					revision: 1,
					writerGeneration: 1,
					expiresAt: "2099-01-01T00:00:00.000Z",
				},
			}),
		).rejects.toThrow("Writer lease fence rejected");
		composition?.dispose();
		expect(() => retainedEventSource?.currentSequence()).toThrow(
			"catalog lifecycle event source is unavailable",
		);
	});

	it("exposes the managed facade through ClineCore.create without generic fallback", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "catalog-managed-core-"));
		const store = new SqliteSessionStore({ sessionsDir: dataDir });
		store.init();
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: join(dataDir, "artifacts"),
		});
		const core = await ClineCore.create({
			backendMode: "local",
			sessionService: sessions,
			chatLifecycle: {
				workspaceRoot: WORKSPACE,
				dataDir,
				principalId: "local-human",
			},
		});
		cleanup.push(async () => {
			await core.dispose();
			store.close();
			rmSync(dataDir, { recursive: true, force: true });
		});

		expect(core.chatLifecycle).toBeDefined();
		expect(
			getClineCoreCatalogLifecycleEventSource(core)?.currentSequence(),
		).toBe(0);
		await expect(
			core.start({
				config: {
					providerId: "test-provider",
					modelId: "test-model",
					cwd: WORKSPACE,
					workspaceRoot: WORKSPACE,
					systemPrompt: "test",
					mode: "act",
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
			}),
		).rejects.toThrow("core.chatLifecycle");

		const sessionId = "managed-composition-rekey";
		const started = await core.chatLifecycle.startRoot({
			operationId: "managed-composition-start",
			sessionId,
			startInput: {
				config: {
					providerId: "test-provider",
					modelId: "test-model",
					cwd: WORKSPACE,
					workspaceRoot: WORKSPACE,
					systemPrompt: "test",
					mode: "act",
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
				interactive: true,
			},
		});
		const rekeyed = await core.rekeyManagedSessionAuthority({
			operationId: "managed-composition-rekey",
			sessionId,
			expectedWriterGeneration: started.writerGeneration,
		});
		expect(rekeyed).toMatchObject({
			sessionId,
			leaseRevision: started.leaseRevision + 1,
			writerGeneration: started.writerGeneration + 1,
		});
		expect(JSON.stringify(rekeyed)).not.toContain("leaseToken");
		expect(
			store.queryOne<{
				lease_revision: number;
				writer_generation: number;
			}>(
				`SELECT lease_revision, writer_generation
				 FROM session_writer_heads WHERE session_id = ?`,
				[sessionId],
			),
		).toEqual({
			lease_revision: rekeyed.leaseRevision,
			writer_generation: rekeyed.writerGeneration,
		});
		await core.chatLifecycle.stop({
			operationId: "managed-composition-stop",
			sessionId,
		});
		expect(
			store.queryOne<{ version: number }>(
				`SELECT version FROM chat_catalog_schema WHERE singleton = 1`,
			),
		).toEqual({ version: 5 });
	});
});
