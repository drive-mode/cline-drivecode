import { describe, expect, it } from "vitest";
import { canSeatAdditionalAgent } from "./cliDriveRoom";

describe("canSeatAdditionalAgent", () => {
	it("fails closed when teamOpt is off", () => {
		expect(
			canSeatAdditionalAgent({ teamOpt: false, isolationAvailable: true }),
		).toBe(false);
	});

	it("fails closed when teamOpt is on without isolation", () => {
		expect(
			canSeatAdditionalAgent({ teamOpt: true, isolationAvailable: false }),
		).toBe(false);
	});

	it("allows multi-seat only with teamOpt and isolation", () => {
		expect(
			canSeatAdditionalAgent({ teamOpt: true, isolationAvailable: true }),
		).toBe(true);
	});
});
