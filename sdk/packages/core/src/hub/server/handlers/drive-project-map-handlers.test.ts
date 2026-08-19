import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { HubCommandEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_MAP_REGISTRY_PATH } from "../../project-map/load-project-map";
import { handleDriveProjectMapCommand } from "./drive-project-map-handlers";

function command(workspaceRoot?: string): HubCommandEnvelope {
	return {
		version: "v1",
		requestId: "project-map",
		clientId: "test",
		command: "drive_project_map_get",
		payload: workspaceRoot === undefined ? {} : { workspaceRoot },
	};
}

describe("handleDriveProjectMapCommand", () => {
	const roots: string[] = [];
	afterEach(async () => {
		for (const root of roots.splice(0)) {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("requires an explicit workspace scope", async () => {
		const reply = await handleDriveProjectMapCommand(command());
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("invalid_payload");
	});

	it("returns unavailable instead of guessing when the registry is absent", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-map-handler-"));
		roots.push(root);
		const reply = await handleDriveProjectMapCommand(command(root));
		expect(reply).toMatchObject({
			ok: true,
			payload: {
				snapshot: {
					availability: "unavailable",
					reason: "registry_missing",
				},
			},
		});
	});

	it("returns a validated read-only map", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-map-handler-"));
		roots.push(root);
		const registry = join(root, PROJECT_MAP_REGISTRY_PATH);
		await mkdir(dirname(registry), { recursive: true });
		await writeFile(
			registry,
			`claims:
  - id: drv-a
    status: planned
    title: A
    displayId: GP0
    lane: now
    dependsOn: []
    owner: Platform
    systems: [software]
    acceptance: A passes.
`,
		);
		const reply = await handleDriveProjectMapCommand(command(root));
		expect(reply).toMatchObject({
			ok: true,
			payload: {
				snapshot: {
					availability: "available",
					project: { items: [{ id: "drv-a", displayId: "GP0" }] },
				},
			},
		});
	});
});
