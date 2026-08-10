import { describe, expect, it } from "vitest";

import {
	buildDeepLinkTarget,
	parseProtocolUrl,
	resolveDeepLinkRoute,
} from "../src/deep-links.js";

function routeFor(url: string) {
	const parsed = parseProtocolUrl(url);
	if (!parsed) return null;
	return resolveDeepLinkRoute(parsed);
}

describe("resolveDeepLinkRoute", () => {
	it("classifies the OAuth callback", () => {
		const route = routeFor("kanban://oauth/callback?code=abc&state=xyz");

		expect(route?.kind).toBe("oauth-callback");
		expect(
			(route as { searchParams: URLSearchParams }).searchParams.get("code"),
		).toBe("abc");
	});

	it("classifies a project link", () => {
		expect(routeFor("kanban://project/my-app")).toEqual({
			kind: "project",
			projectId: "my-app",
		});
	});

	it("classifies a task link", () => {
		expect(routeFor("kanban://project/my-app/task/t-42")).toEqual({
			kind: "task",
			projectId: "my-app",
			taskId: "t-42",
		});
	});

	it("decodes percent-encoded ids", () => {
		// Project ids are filesystem paths in practice, so slashes and spaces
		// arrive encoded.
		expect(routeFor("kanban://project/my%20app%2Fweb")).toEqual({
			kind: "project",
			projectId: "my app/web",
		});
	});

	it.each([
		["an unknown top-level route", "kanban://settings/general"],
		["a project link with no id", "kanban://project"],
		["a task link with no task id", "kanban://project/my-app/task"],
		["a misspelled task segment", "kanban://project/my-app/tasks/t-1"],
		["extra trailing segments", "kanban://project/my-app/task/t-1/extra"],
		["a whitespace-only id", "kanban://project/%20%20"],
		["a bare scheme", "kanban://"],
	])("returns null for %s", (_label, url) => {
		expect(routeFor(url)).toBeNull();
	});

	it("returns null for a foreign scheme", () => {
		expect(parseProtocolUrl("https://example.com/project/my-app")).toBeNull();
	});
});

describe("buildDeepLinkTarget", () => {
	it("maps a project route to its pathname", () => {
		expect(buildDeepLinkTarget({ kind: "project", projectId: "my-app" })).toEqual({
			projectId: "my-app",
			pathname: "/my-app",
			search: "",
		});
	});

	it("maps a task route to the project path plus a task query", () => {
		// Mirrors the web UI's own addressing (`/<projectId>?task=<id>`); the
		// two must agree or a deep link lands on the board instead of the task.
		expect(
			buildDeepLinkTarget({ kind: "task", projectId: "my-app", taskId: "t-42" }),
		).toEqual({
			projectId: "my-app",
			pathname: "/my-app",
			search: "?task=t-42",
		});
	});

	it("encodes ids that would otherwise change the URL's shape", () => {
		const target = buildDeepLinkTarget({
			kind: "task",
			projectId: "my app/web",
			taskId: "a&b=c",
		});

		expect(target?.pathname).toBe("/my%20app%2Fweb");
		expect(target?.search).toBe("?task=a%26b%3Dc");
	});

	it("round-trips through parse for ids needing encoding", () => {
		const route = routeFor("kanban://project/my%20app%2Fweb/task/a%26b");

		expect(buildDeepLinkTarget(route!)).toEqual({
			projectId: "my app/web",
			pathname: "/my%20app%2Fweb",
			search: "?task=a%26b",
		});
	});

	it("returns null for the OAuth callback", () => {
		// OAuth is relayed to the runtime's HTTP endpoint, never navigated to.
		expect(
			buildDeepLinkTarget({
				kind: "oauth-callback",
				searchParams: new URLSearchParams(),
			}),
		).toBeNull();
	});
});
