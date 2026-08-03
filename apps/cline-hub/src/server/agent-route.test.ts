/**
 * `/agents?id=` must be servable, not just routable (DRV-AGENT-PROFILE).
 *
 * There are two route lists and updating only one fails silently: `viewFromPath`
 * in App.tsx returns "home" on no match, and `isWebviewRoute` here 403s a deep
 * link or a reload. A previous surface shipped broken exactly that way.
 *
 * This file lives on the server side of the boundary because it is the server
 * list it asserts; the webview's own parsing is covered in
 * `webview/src/drive/agentProfileRoute.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { agentProfilePath } from "../webview/src/drive/agentProfileRoute";
import { isWebviewRoute } from "./http";

function pathnameOf(url: string): string {
	return new URL(url, "http://localhost").pathname;
}

describe("the agents route serves its detail form", () => {
	it("serves `/agents` and therefore `/agents?id=…`", () => {
		// `isWebviewRoute` takes a pathname, so the query string is already
		// invisible to it — pinned rather than assumed.
		expect(isWebviewRoute("/agents")).toBe(true);
		expect(
			isWebviewRoute(pathnameOf(agentProfilePath("driveagent.pair-partner"))),
		).toBe(true);
		expect(
			isWebviewRoute(pathnameOf(agentProfilePath("builtin.pair_partner"))),
		).toBe(true);
	});

	it("would 403 a path-param shape, which is why detail is a query param", () => {
		// Stated so a later move to `/agents/<id>` has to face this test and
		// update both lists, instead of discovering the 403 on a reload.
		expect(isWebviewRoute("/agents/driveagent.pair-partner")).toBe(false);
	});
});
