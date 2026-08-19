import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	PROJECT_MAP_REGISTRY_PATH,
	readProjectMapSnapshot,
} from "./load-project-map";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

async function rootWithRegistry(yaml: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "project-map-"));
	roots.push(root);
	const registry = join(root, PROJECT_MAP_REGISTRY_PATH);
	await mkdir(dirname(registry), { recursive: true });
	await writeFile(registry, yaml);
	return root;
}

const validRegistry = `claims:
  - id: drv-a
    status: active_partial
    title: Foundation
    displayId: GP0
    lane: now
    dependsOn: []
    owner: Platform
    systems: [data, software]
    acceptance: Contract passes.
  - id: drv-b
    status: planned
    title: Release
    displayId: GP9
    lane: release
    dependsOn: [drv-a]
    owner: Release
    systems: [people, processes]
    acceptance: Release gate passes.
`;

describe("readProjectMapSnapshot", () => {
	it("compiles only public project-map fields in stable display order", async () => {
		const root = await rootWithRegistry(validRegistry);
		const snapshot = await readProjectMapSnapshot(root);
		expect(snapshot).toMatchObject({
			availability: "available",
			project: {
				id: "drive-golden-path",
				items: [
					{ id: "drv-a", displayId: "GP0" },
					{ id: "drv-b", displayId: "GP9", laneId: "release" },
				],
			},
		});
		expect(JSON.stringify(snapshot)).not.toContain(root);
		expect(JSON.stringify(snapshot)).not.toContain("claims-registry.yaml");
	});

	it("returns honest unavailable reasons", async () => {
		await expect(readProjectMapSnapshot(" ")).resolves.toEqual({
			availability: "unavailable",
			reason: "workspace_unset",
		});
		const root = await mkdtemp(join(tmpdir(), "project-map-missing-"));
		roots.push(root);
		await expect(readProjectMapSnapshot(root)).resolves.toEqual({
			availability: "unavailable",
			reason: "registry_missing",
		});
		const invalid = await rootWithRegistry("claims: [nope");
		await expect(readProjectMapSnapshot(invalid)).resolves.toEqual({
			availability: "unavailable",
			reason: "registry_invalid",
		});
	});

	it("refuses a registry symlink that escapes the workspace", async () => {
		const outside = await rootWithRegistry(validRegistry);
		const root = await mkdtemp(join(tmpdir(), "project-map-boundary-"));
		roots.push(root);
		const candidate = join(root, PROJECT_MAP_REGISTRY_PATH);
		await mkdir(dirname(candidate), { recursive: true });
		await symlink(join(outside, PROJECT_MAP_REGISTRY_PATH), candidate);
		await expect(readProjectMapSnapshot(root)).resolves.toEqual({
			availability: "unavailable",
			reason: "registry_unreadable",
		});
	});

	it("rejects dependency cycles and later-lane prerequisites", async () => {
		const root = await rootWithRegistry(`claims:
  - id: drv-a
    status: planned
    title: A
    displayId: GP0
    lane: now
    dependsOn: [drv-b]
    owner: A
    systems: [software]
    acceptance: A passes.
  - id: drv-b
    status: planned
    title: B
    displayId: GP1
    lane: next
    dependsOn: [drv-a]
    owner: B
    systems: [software]
    acceptance: B passes.
`);
		await expect(readProjectMapSnapshot(root)).resolves.toEqual({
			availability: "unavailable",
			reason: "registry_invalid",
		});
	});
});
