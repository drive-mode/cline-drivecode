import { describe, expect, it, vi } from "vitest";
import { loadDirectorySources } from "./agentDirectoryLoad";

vi.mock("./requestDriveagentHome", () => ({
	requestDriveagentHomeList: vi.fn(),
}));

vi.mock("./requestDriveAgentProfiles", () => ({
	requestDriveAgentProfiles: vi.fn(),
}));

import { requestDriveagentHomeList } from "./requestDriveagentHome";
import { requestDriveAgentProfiles } from "./requestDriveAgentProfiles";

const listHomes = vi.mocked(requestDriveagentHomeList);
const listProfiles = vi.mocked(requestDriveAgentProfiles);

describe("loadDirectorySources", () => {
	it("announces when both hub lookups fail instead of an empty directory", async () => {
		listHomes.mockRejectedValueOnce(new Error("drive_agent_home_list timed out"));
		listProfiles.mockRejectedValueOnce(new Error("profiles timed out"));

		const result = await loadDirectorySources("/tmp/ws");

		expect(result.entries).toEqual([]);
		expect(result.error).toMatch(/timed out/);
	});

	it("still lists what arrived when only one source fails", async () => {
		listHomes.mockResolvedValueOnce([
			{
				slug: "pair-partner",
				displayName: "Pair",
				tier: "workspace",
			},
		]);
		listProfiles.mockRejectedValueOnce(new Error("profiles timed out"));

		const result = await loadDirectorySources("/tmp/ws");

		expect(result.entries.map((entry) => entry.displayName)).toEqual(["Pair"]);
		expect(result.error).toMatch(/profiles timed out/);
	});

	it("returns a quiet empty list when the hub answers with nothing", async () => {
		listHomes.mockResolvedValueOnce([]);
		listProfiles.mockResolvedValueOnce([]);

		const result = await loadDirectorySources("/tmp/ws");

		expect(result.entries).toEqual([]);
		expect(result.error).toBeNull();
	});
});
