import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import { SessionSource } from "../../types/common";
import {
	CatalogSessionReservationConflictError,
	CoreSessionService,
} from "./session-service";

const WORKSPACE = resolve("/tmp/catalog-session-reservation-workspace");

describe("catalog session reservation", () => {
	const cleanup: Array<() => void> = [];

	afterEach(() => {
		for (const dispose of cleanup.splice(0).reverse()) dispose();
	});

	it("creates an inert idempotent row and rejects changed intent", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "catalog-reservation-"));
		const store = new SqliteSessionStore({ sessionsDir: dataDir });
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: join(dataDir, "artifacts"),
		});
		cleanup.push(() => {
			store.close();
			rmSync(dataDir, { recursive: true, force: true });
		});
		const input = {
			sessionId: "reserved-root",
			source: SessionSource.CLI,
			pid: 123,
			startedAt: "2026-08-14T12:00:00.000Z",
			interactive: true,
			provider: "test-provider",
			model: "test-model",
			cwd: WORKSPACE,
			workspaceRoot: WORKSPACE,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			metadata: { operationId: "operation-1" },
		};

		expect(sessions.reserveCatalogRootSession(input)).toEqual({
			created: true,
			sessionId: "reserved-root",
		});
		expect(store.get("reserved-root")).toMatchObject({
			status: "idle",
			messagesPath: undefined,
			metadata: { operationId: "operation-1" },
		});
		expect(sessions.reserveCatalogRootSession(input)).toEqual({
			created: false,
			sessionId: "reserved-root",
		});
		expect(() =>
			sessions.reserveCatalogRootSession({
				...input,
				provider: "changed-provider",
			}),
		).toThrow(CatalogSessionReservationConflictError);
	});

	it("deletes only an unmaterialized and unenrolled reservation", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "catalog-reservation-"));
		const store = new SqliteSessionStore({ sessionsDir: dataDir });
		const sessions = new CoreSessionService(store);
		cleanup.push(() => {
			store.close();
			rmSync(dataDir, { recursive: true, force: true });
		});
		sessions.reserveCatalogRootSession({
			sessionId: "reserved-root",
			source: SessionSource.CLI,
			pid: 123,
			startedAt: "2026-08-14T12:00:00.000Z",
			interactive: true,
			provider: "test-provider",
			model: "test-model",
			cwd: WORKSPACE,
			workspaceRoot: WORKSPACE,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
		});

		expect(sessions.deleteCatalogRootReservation("reserved-root")).toBe(true);
		expect(store.get("reserved-root")).toBeUndefined();
		expect(sessions.deleteCatalogRootReservation("reserved-root")).toBe(false);
	});
});
