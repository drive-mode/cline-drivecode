import { describe, expect, it } from "bun:test";
import {
	canonicalizeJson,
	canonicalJson,
	digestCanonicalJson,
} from "../src/core";

describe("canonical JSON", () => {
	it("sorts object keys recursively and preserves array order", () => {
		const left = { z: 1, nested: { b: true, a: "x" }, array: [3, 2, 1] };
		const right = { array: [3, 2, 1], nested: { a: "x", b: true }, z: 1 };

		expect(canonicalJson(left)).toBe(canonicalJson(right));
		expect(canonicalJson(left)).toBe(
			'{"array":[3,2,1],"nested":{"a":"x","b":true},"z":1}\n',
		);
		expect(digestCanonicalJson(left)).toBe(digestCanonicalJson(right));
	});

	it("normalizes negative zero", () => {
		expect(canonicalizeJson({ value: -0 })).toEqual({ value: 0 });
	});

	it("rejects non-finite, non-JSON, and circular values", () => {
		expect(() => canonicalJson({ value: Number.NaN })).toThrow(
			"Non-finite number",
		);
		expect(() => canonicalJson({ value: undefined })).toThrow("Non-JSON value");
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(() => canonicalJson(circular)).toThrow("Circular reference");
	});

	it("is byte stable across ten replays", () => {
		const input = { b: [{ z: 2, a: 1 }], a: "stable" };
		const outputs = Array.from({ length: 10 }, () => canonicalJson(input));
		expect(new Set(outputs).size).toBe(1);
	});
});
