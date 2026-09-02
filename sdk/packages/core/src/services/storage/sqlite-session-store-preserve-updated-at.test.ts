import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionSource } from "../../types/common";
import type { SessionRecord } from "../../types/sessions";
import { SqliteSessionStore } from "./sqlite-session-store";

const WORKSPACE = resolve("/tmp/session-preserve-updated-at-workspace");

function session(sessionId: string): SessionRecord {
	return {
		sessionId,
		source: SessionSource.CLI,
		pid: process.pid,
		startedAt: "2026-08-14T09:00:00.000Z",
		status: "completed",
		interactive: true,
		provider: "test-provider",
		model: "test-model",
		cwd: WORKSPACE,
		workspaceRoot: WORKSPACE,
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		updatedAt: "2026-08-14T09:01:00.000Z",
	};
}

describe("SqliteSessionStore preserveUpdatedAt", () => {
	const cleanup: Array<() => void> = [];

	afterEach(() => {
		for (const dispose of cleanup.splice(0).reverse()) dispose();
	});

	function openStore(): SqliteSessionStore {
		const dataDir = mkdtempSync(join(tmpdir(), "session-preserve-updated-"));
		const store = new SqliteSessionStore({ sessionsDir: dataDir });
		cleanup.push(() => {
			store.close();
			rmSync(dataDir, { recursive: true, force: true });
		});
		return store;
	}

	it("keeps updated_at when an annotation asks it to", () => {
		const store = openStore();
		store.create(session("annotated"));
		const before = store.get("annotated")?.updatedAt;
		expect(before).toBeTruthy();
		const result = store.updatePersistedSession({
			sessionId: "annotated",
			metadata: { favorite: true },
			preserveUpdatedAt: true,
		});
		expect(result.updated).toBe(true);
		const row = store.get("annotated");
		expect(row?.metadata).toEqual({ favorite: true });
		expect(row?.updatedAt).toBe(before);
	});

	it("still stamps updated_at for ordinary updates", async () => {
		const store = openStore();
		store.create(session("touched"));
		const before = store.get("touched")?.updatedAt;
		await new Promise((resolve) => setTimeout(resolve, 5));
		store.updatePersistedSession({
			sessionId: "touched",
			metadata: { favorite: true },
		});
		const after = store.get("touched")?.updatedAt;
		expect(after).toBeTruthy();
		expect(after).not.toBe(before);
	});
});
