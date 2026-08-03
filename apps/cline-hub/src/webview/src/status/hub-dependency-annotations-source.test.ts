import { describe, expect, it } from "vitest";
import { HubDependencyAnnotationsSource } from "./hub-dependency-annotations-source";

describe("HubDependencyAnnotationsSource", () => {
	/**
	 * The whole point of the adapter. Plan membership and minted ids exist
	 * nowhere in the team runtime, so anything other than `null` here would be
	 * the hub inventing structure — which is what the rail would then draw.
	 */
	it("has nothing to annotate with", async () => {
		await expect(
			new HubDependencyAnnotationsSource().loadAnnotations(),
		).resolves.toBeNull();
	});
});
