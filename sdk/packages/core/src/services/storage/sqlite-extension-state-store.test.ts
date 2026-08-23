import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentExtensionCommandInvocationContext } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteExtensionStateStore } from "./sqlite-extension-state-store";

const roots: string[] = [];

function invocation(
	root: string,
	overrides: Partial<AgentExtensionCommandInvocationContext> = {},
): AgentExtensionCommandInvocationContext {
	return {
		invocationId: "invoke-1",
		invokedAt: "2026-08-14T00:00:00.000Z",
		workspaceRoot: root,
		task: { sessionId: "session-1" },
		actor: { kind: "human", id: "local-user" },
		source: { kind: "interactive" },
		...overrides,
	};
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("SqliteExtensionStateStore", () => {
	it("shares canonical state across independent store instances", () => {
		const root = mkdtempSync(join(tmpdir(), "extension-state-"));
		roots.push(root);
		const first = new SqliteExtensionStateStore({ dataDir: root });
		const second = new SqliteExtensionStateStore({ dataDir: root });

		const result = first.applyMutation({
			expectedRevision: 0,
			extensionId: "adr-planner",
			invocation: invocation(root),
			mutation: {
				operation: "replace",
				key: "planning-session",
				value: { z: true, a: false },
			},
		});

		expect(result.applied).toBe(true);
		expect(
			second.snapshot({
				workspaceRoot: root,
				sessionId: "session-1",
				extensionId: "adr-planner",
			}),
		).toEqual(result.snapshot);
		expect(result.snapshot.entries["planning-session"]?.value).toEqual({
			a: false,
			z: true,
		});
		first.close();
		second.close();
	});

	it("isolates workspace, session, and extension scopes", () => {
		const root = mkdtempSync(join(tmpdir(), "extension-state-"));
		roots.push(root);
		const store = new SqliteExtensionStateStore({ dataDir: root });
		store.applyMutation({
			expectedRevision: 0,
			extensionId: "adr-planner",
			invocation: invocation(root),
			mutation: { operation: "replace", key: "facts", value: { prod: true } },
		});

		for (const scope of [
			{
				workspaceRoot: join(root, "other"),
				sessionId: "session-1",
				extensionId: "adr-planner",
			},
			{
				workspaceRoot: root,
				sessionId: "session-2",
				extensionId: "adr-planner",
			},
			{
				workspaceRoot: root,
				sessionId: "session-1",
				extensionId: "other-plugin",
			},
		]) {
			expect(store.snapshot(scope).entries).toEqual({});
		}
		store.close();
	});

	it("rejects missing task identity and non-human provenance", () => {
		const root = mkdtempSync(join(tmpdir(), "extension-state-"));
		roots.push(root);
		const store = new SqliteExtensionStateStore({ dataDir: root });
		const mutation = { operation: "replace" as const, key: "facts", value: {} };

		expect(() =>
			store.applyMutation({
				expectedRevision: 0,
				extensionId: "adr-planner",
				invocation: invocation(root, { task: {} }),
				mutation,
			}),
		).toThrow("session id");
		expect(() =>
			store.applyMutation({
				expectedRevision: 0,
				extensionId: "adr-planner",
				invocation: invocation(root, { actor: { kind: "model" } }),
				mutation,
			}),
		).toThrow("human invocation");
		store.close();
	});

	it("is idempotent for equal replay and increments revision for replace and clear", () => {
		const root = mkdtempSync(join(tmpdir(), "extension-state-"));
		roots.push(root);
		const store = new SqliteExtensionStateStore({ dataDir: root });
		const base = {
			extensionId: "adr-planner",
			expectedRevision: 0,
			invocation: invocation(root),
			mutation: {
				operation: "replace" as const,
				key: "facts",
				value: { b: 2, a: 1 },
			},
		};

		expect(store.applyMutation(base).snapshot.revision).toBe(1);
		const replay = store.applyMutation({
			...base,
			expectedRevision: 1,
			invocation: invocation(root, { invocationId: "invoke-2" }),
			mutation: { ...base.mutation, value: { a: 1, b: 2 } },
		});
		expect(replay.applied).toBe(false);
		expect(replay.snapshot.revision).toBe(1);
		expect(
			store.applyMutation({
				...base,
				expectedRevision: 1,
				invocation: invocation(root, { invocationId: "invoke-clear-1" }),
				mutation: { operation: "clear", key: "facts" },
			}).snapshot,
		).toMatchObject({ revision: 2, entries: {} });
		expect(
			store.applyMutation({
				...base,
				expectedRevision: 2,
				invocation: invocation(root, { invocationId: "invoke-clear-2" }),
				mutation: { operation: "clear", key: "facts" },
			}),
		).toMatchObject({ applied: false, snapshot: { revision: 2 } });
		store.close();
	});

	it("rejects non-JSON and over-limit values before mutation", () => {
		const root = mkdtempSync(join(tmpdir(), "extension-state-"));
		roots.push(root);
		const store = new SqliteExtensionStateStore({ dataDir: root });
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		for (const value of [
			cyclic,
			{ fn: () => true },
			{ huge: "x".repeat(17_000) },
		]) {
			expect(() =>
				store.applyMutation({
					expectedRevision: 0,
					extensionId: "adr-planner",
					invocation: invocation(root),
					mutation: { operation: "replace", key: "facts", value },
				}),
			).toThrow();
		}
		expect(
			store.snapshot({
				workspaceRoot: root,
				sessionId: "session-1",
				extensionId: "adr-planner",
			}),
		).toMatchObject({ revision: 0, entries: {} });
		store.close();
	});

	it("rejects stale concurrent writes and binds invocation replay to one mutation", () => {
		const root = mkdtempSync(join(tmpdir(), "extension-state-"));
		roots.push(root);
		const store = new SqliteExtensionStateStore({ dataDir: root });
		const firstInput = {
			extensionId: "adr-planner",
			expectedRevision: 0,
			invocation: invocation(root),
			mutation: {
				operation: "replace" as const,
				key: "facts",
				value: { a: true },
			},
		};
		expect(store.applyMutation(firstInput).snapshot.revision).toBe(1);
		expect(store.applyMutation(firstInput)).toMatchObject({
			applied: false,
			snapshot: { revision: 1 },
		});
		expect(() =>
			store.applyMutation({
				...firstInput,
				mutation: { ...firstInput.mutation, value: { a: false } },
			}),
		).toThrow("replayed with a different mutation");
		expect(() =>
			store.applyMutation({
				...firstInput,
				invocation: invocation(root, { invocationId: "invoke-stale" }),
				mutation: { ...firstInput.mutation, value: { b: true } },
			}),
		).toThrow("changed while the command was running");
		store.close();
	});
});
