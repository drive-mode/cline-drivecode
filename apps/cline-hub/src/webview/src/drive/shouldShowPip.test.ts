import { describe, expect, it } from "vitest";
import { shouldShowPip } from "./shouldShowPip";

describe("shouldShowPip", () => {
	it.each([
		{
			name: "active off-route, not opted out",
			input: { active: true, onCallRoute: false, optedOut: false },
			want: true,
		},
		{
			name: "inactive",
			input: { active: false, onCallRoute: false, optedOut: false },
			want: false,
		},
		{
			name: "on Drive call route",
			input: { active: true, onCallRoute: true, optedOut: false },
			want: false,
		},
		{
			name: "opted out (minimise)",
			input: { active: true, onCallRoute: false, optedOut: true },
			want: false,
		},
		{
			name: "defaults optedOut to false",
			input: { active: true, onCallRoute: false },
			want: true,
		},
	])("$name → $want", ({ input, want }) => {
		expect(shouldShowPip(input)).toBe(want);
	});
});
