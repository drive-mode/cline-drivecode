import { describe, expect, it } from "vitest";
import { isDriveplanManagedCard, runtimeBoardCardSchema } from "./api-contract";

describe("driveplan externalRef", () => {
	it("keeps externalRef on managed cards and forces autoReviewEnabled false", () => {
		const card = runtimeBoardCardSchema.parse({
			id: "c1",
			prompt: "Patch retry",
			startInPlanMode: false,
			autoReviewEnabled: true,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
			externalRef: {
				system: "driveplan",
				driveTaskId: "auth-retry-race",
				driveRunId: "run_auth_retry_v1",
				workItemId: "patch_retry",
			},
		});
		expect(card.externalRef?.system).toBe("driveplan");
		expect(card.autoReviewEnabled).toBe(false);
		expect(isDriveplanManagedCard(card)).toBe(true);
	});

	it("leaves unmanaged cards alone", () => {
		const card = runtimeBoardCardSchema.parse({
			id: "c2",
			prompt: "Normal task",
			startInPlanMode: false,
			autoReviewEnabled: true,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});
		expect(card.externalRef).toBeUndefined();
		expect(card.autoReviewEnabled).toBe(true);
		expect(isDriveplanManagedCard(card)).toBe(false);
	});
});
