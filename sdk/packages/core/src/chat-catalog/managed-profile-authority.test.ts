import { describe, expect, it } from "vitest";
import {
	assertManagedProfileContinuity,
	MANAGED_PROFILE_AUTHORITY_METADATA_KEY,
	managedProfileAuthorityMetadata,
	normalizeManagedProfileAuthority,
	readManagedProfileAuthority,
} from "./managed-profile-authority";

const AUTHORITY = {
	profileId: "cline.chat.interactive.v1",
	profileRevision: 1,
	authorityClassId: "cline.chat.authority.interactive-owner.v1",
	policyEpoch: 3,
	connectionPolicyDigest: "a".repeat(64),
	executionPolicyDigest: "b".repeat(64),
	interactive: true,
	allowedModes: ["plan", "act"] as const,
};

describe("managed profile authority metadata", () => {
	it("normalizes and freezes the persisted authority stamp", () => {
		const normalized = normalizeManagedProfileAuthority(AUTHORITY);

		expect(normalized).toEqual({
			...AUTHORITY,
			allowedModes: ["act", "plan"],
		});
		expect(Object.isFrozen(normalized)).toBe(true);
		expect(Object.isFrozen(normalized.allowedModes)).toBe(true);
		expect(
			readManagedProfileAuthority(managedProfileAuthorityMetadata(AUTHORITY)),
		).toEqual(normalized);
	});

	it("fails closed for malformed or extended reserved metadata", () => {
		for (const value of [
			null,
			{ ...AUTHORITY, profileRevision: 0 },
			{ ...AUTHORITY, allowedModes: ["act", "act"] },
			{ ...AUTHORITY, unexpected: true },
		]) {
			expect(() =>
				readManagedProfileAuthority({
					[MANAGED_PROFILE_AUTHORITY_METADATA_KEY]: value,
				}),
			).toThrow(expect.objectContaining({ code: "unsupported_capability" }));
		}
	});

	it("requires exact profile, revision, class, epoch, policy, interactivity, and mode continuity", () => {
		const persisted = normalizeManagedProfileAuthority(AUTHORITY);
		expect(() =>
			assertManagedProfileContinuity({
				persisted,
				requested: normalizeManagedProfileAuthority({
					...AUTHORITY,
					policyEpoch: 4,
				}),
			}),
		).toThrow(expect.objectContaining({ code: "unsupported_capability" }));
		expect(() =>
			assertManagedProfileContinuity({
				persisted,
				requested: normalizeManagedProfileAuthority({
					...AUTHORITY,
					executionPolicyDigest: "c".repeat(64),
				}),
			}),
		).toThrow(expect.objectContaining({ code: "unsupported_capability" }));
		expect(() =>
			assertManagedProfileContinuity({ persisted, requested: undefined }),
		).toThrow(expect.objectContaining({ code: "unsupported_capability" }));
		expect(() =>
			assertManagedProfileContinuity({ persisted, requested: persisted }),
		).not.toThrow();
	});
});
