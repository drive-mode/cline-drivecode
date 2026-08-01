import { describe, expect, it } from "vitest";
import { splitSchemaPathTokens } from "./schema-path";

describe("splitSchemaPathTokens", () => {
	it("returns a single literal token for a path without params", () => {
		expect(splitSchemaPathTokens("/users/list")).toEqual([
			{ text: "/users/list", param: false },
		]);
	});

	it("marks each {param} segment and keeps literals in order", () => {
		expect(splitSchemaPathTokens("/users/{userId}/posts/{postId}")).toEqual([
			{ text: "/users/", param: false },
			{ text: "{userId}", param: true },
			{ text: "/posts/", param: false },
			{ text: "{postId}", param: true },
		]);
	});

	it("handles params at the start and end of the path", () => {
		expect(splitSchemaPathTokens("{version}/status/{id}")).toEqual([
			{ text: "{version}", param: true },
			{ text: "/status/", param: false },
			{ text: "{id}", param: true },
		]);
	});

	it("keeps HTML-looking input as inert literal text", () => {
		const hostile = "/x/{<img src=x onerror=alert(1)>}/y";
		expect(splitSchemaPathTokens(hostile)).toEqual([
			{ text: "/x/", param: false },
			{ text: "{<img src=x onerror=alert(1)>}", param: true },
			{ text: "/y", param: false },
		]);
	});

	it("returns no tokens for an empty path", () => {
		expect(splitSchemaPathTokens("")).toEqual([]);
	});
});
