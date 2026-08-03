import { describe, expect, it } from "vitest";
import {
	intersectToolPolicies,
	resolveToolPolicy,
	type ToolPolicy,
} from "./tools";

describe("resolveToolPolicy", () => {
	it("treats the wildcard as a default the per-tool entry shadows", () => {
		const policies = {
			"*": { autoApprove: false },
			read_files: { autoApprove: true },
		};

		expect(resolveToolPolicy("read_files", policies)).toEqual({
			autoApprove: true,
		});
		expect(resolveToolPolicy("run_commands", policies)).toEqual({
			autoApprove: false,
		});
	});

	it("returns an empty policy when nothing is configured", () => {
		expect(resolveToolPolicy("read_files", undefined)).toEqual({});
		expect(resolveToolPolicy("read_files", {})).toEqual({});
	});

	it("merges the two fields independently", () => {
		const policies = {
			"*": { enabled: false, autoApprove: false },
			read_files: { enabled: true },
		};

		// autoApprove still comes from the wildcard; only enabled was shadowed.
		expect(resolveToolPolicy("read_files", policies)).toEqual({
			enabled: true,
			autoApprove: false,
		});
	});
});

describe("intersectToolPolicies", () => {
	/**
	 * The rows below are the delegation truth table. `eff` is the resolved
	 * effective boolean on each side; the result must be their AND. Both fields
	 * default to true, so an absent key is an allow — which is exactly why the
	 * intersection cannot be computed over raw records.
	 */
	const cases: Array<{
		name: string;
		parent: Record<string, ToolPolicy> | undefined;
		child: Record<string, ToolPolicy> | undefined;
		tool: string;
		expected: boolean;
	}> = [
		{
			name: "nothing constrains either side",
			parent: {},
			child: {},
			tool: "read_files",
			expected: true,
		},
		{
			name: "parent wildcard binds a tool neither side names",
			parent: { "*": { autoApprove: false } },
			child: {},
			tool: "run_commands",
			expected: false,
		},
		{
			name: "child per-tool cannot escalate past the parent wildcard",
			parent: { "*": { autoApprove: false } },
			child: { read_files: { autoApprove: true } },
			tool: "read_files",
			expected: false,
		},
		{
			name: "parent per-tool lifts its own wildcard, so the child keeps it",
			parent: {
				"*": { autoApprove: false },
				read_files: { autoApprove: true },
			},
			child: { read_files: { autoApprove: true } },
			tool: "read_files",
			expected: true,
		},
		{
			name: "child may narrow itself below what the parent allows",
			parent: {
				"*": { autoApprove: false },
				read_files: { autoApprove: true },
			},
			child: { read_files: { autoApprove: false } },
			tool: "read_files",
			expected: false,
		},
		{
			name: "parent per-tool lowers its own wildcard",
			parent: {
				"*": { autoApprove: true },
				run_commands: { autoApprove: false },
			},
			child: { "*": { autoApprove: true } },
			tool: "run_commands",
			expected: false,
		},
		{
			name: "child wildcard self-restricts",
			parent: {},
			child: { "*": { autoApprove: false } },
			tool: "read_files",
			expected: false,
		},
		{
			name: "child per-tool lifts the child wildcard, still within parent",
			parent: { "*": { autoApprove: true } },
			child: {
				"*": { autoApprove: false },
				read_files: { autoApprove: true },
			},
			tool: "read_files",
			expected: true,
		},
	];

	for (const testCase of cases) {
		it(testCase.name, () => {
			const capped = intersectToolPolicies(testCase.parent, testCase.child);
			expect(
				resolveToolPolicy(testCase.tool, capped).autoApprove !== false,
			).toBe(testCase.expected);
		});
	}

	it("always emits a wildcard so unnamed tools cannot escape the parent", () => {
		const capped = intersectToolPolicies(
			{ "*": { enabled: false } },
			{ read_files: { enabled: true } },
		);

		expect(capped?.["*"]).toEqual({ enabled: false, autoApprove: true });
		// A tool named by neither side still resolves to denied.
		expect(resolveToolPolicy("anything_at_all", capped).enabled).toBe(false);
	});

	it("spells both fields out on every entry", () => {
		const capped = intersectToolPolicies(
			{ "*": { autoApprove: false } },
			undefined,
		);

		// Omitting a field would mean allowed, and an omitted field also fails to
		// shadow the wildcard it sits under -- which would cap a tool the parent
		// had explicitly allowed.
		expect(capped?.["*"]).toEqual({ enabled: true, autoApprove: false });
	});

	it("keeps a parent's per-tool allowance above its own denying wildcard", () => {
		// Regression: with a per-tool entry of `{}` this resolved to denied,
		// because an empty object does not shadow the wildcard's false.
		const capped = intersectToolPolicies(
			{ "*": { autoApprove: false }, read_files: { autoApprove: true } },
			{ read_files: { autoApprove: true } },
		);

		expect(capped?.read_files).toEqual({ enabled: true, autoApprove: true });
		expect(resolveToolPolicy("read_files", capped).autoApprove).toBe(true);
	});

	it("caps enabled and autoApprove independently", () => {
		const capped = intersectToolPolicies(
			{ editor: { enabled: false, autoApprove: true } },
			{ editor: { enabled: true, autoApprove: false } },
		);

		expect(capped?.editor).toEqual({ enabled: false, autoApprove: false });
	});

	it("passes the child through untouched when there is no parent record", () => {
		const child = { read_files: { autoApprove: true } };
		expect(intersectToolPolicies(undefined, child)).toBe(child);
	});

	it("caps an unconstrained child down to the parent's posture", () => {
		// The delegation defect this exists to prevent: parent requires approval
		// for everything, child arrives with no policies at all.
		const capped = intersectToolPolicies({ "*": { autoApprove: false } }, {});

		expect(resolveToolPolicy("run_commands", capped).autoApprove).toBe(false);
		expect(resolveToolPolicy("editor", capped).autoApprove).toBe(false);
	});
});
