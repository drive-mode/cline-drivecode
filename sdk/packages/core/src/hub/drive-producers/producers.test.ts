import { describe, expect, it } from "vitest";
import { producePlanCardShowArtifact } from "./producePlanCard";
import { produceCodeWalkthroughShowArtifact } from "./produceCodeWalkthrough";
import { produceBrowserSnapshotShowArtifact } from "./produceBrowserSnapshot";
import { produceChangeAnimationShowArtifact } from "./produceChangeAnimation";

describe("drive producers", () => {
	it("producePlanCard fills an SVG data URI", () => {
		const result = producePlanCardShowArtifact({
			ownerParticipantId: "agent-1",
			planTitle: "Ship slice 6",
			steps: ["Write producers", "Wire materialize", "Test"],
		});
		expect(result.item.uri).toMatch(/^data:image\/svg\+xml/);
		expect(result.item.artifactKind).toBe("doc.plan");
		expect(result.item.status).toBe("ready");
		expect(result.svg).toContain("Ship slice 6");
	});

	it("produceCodeWalkthrough fills an SVG data URI", () => {
		const result = produceCodeWalkthroughShowArtifact({
			ownerParticipantId: "agent-1",
			path: "src/foo.ts",
			startLine: 10,
			endLine: 20,
			snippet: "export const x = 1",
		});
		expect(result.item.uri).toMatch(/^data:image\/svg\+xml/);
		expect(result.item.caption).toContain("src/foo.ts:10-20");
		expect(result.svg).toContain("export const x = 1");
	});

	it("produceChangeAnimation keeps the recipe so the webview can animate it", () => {
		const result = produceChangeAnimationShowArtifact({
			ownerParticipantId: "agent-1",
			title: "Feed repaint · before and after",
			beforeLabel: "Before · every beat rebuilds",
			afterLabel: "After · fingerprint match → skip",
			signal: "sig ✓ unchanged",
			rows: ["message · partner", "message · you"],
			entering: ["message · partner (new)"],
		});
		expect(result.item.uri).toMatch(/^data:image\/svg\+xml/);
		expect(result.item.artifactKind).toBe("walkthrough.animation");
		expect(result.item.mediaClass).toBe("animation");
		expect(result.item.status).toBe("ready");
		expect(result.item.produce.tool).toBe("render_change_animation");
		expect(result.item.produce.args).toMatchObject({
			rows: ["message · partner", "message · you"],
			entering: ["message · partner (new)"],
			signal: "sig ✓ unchanged",
		});
		// The still stub carries the comparison as text for surfaces that
		// cannot animate.
		expect(result.svg).toContain("Before · every beat rebuilds");
		expect(result.svg).toContain("After · fingerprint match");
	});

	it("produceBrowserSnapshot fails closed without demoCapture", () => {
		const denied = produceBrowserSnapshotShowArtifact({
			ownerParticipantId: "agent-1",
			demoCapture: false,
			url: "http://localhost:3000",
		});
		expect(denied.ok).toBe(false);
		if (denied.ok) {
			return;
		}
		expect(denied.item.uri).toBeUndefined();
		expect(denied.item.status).toBe("planned");
		expect(denied.item.scoreReasons).toContain(
			"capability:demo_capture_unavailable",
		);

		const allowed = produceBrowserSnapshotShowArtifact({
			ownerParticipantId: "agent-1",
			demoCapture: true,
			url: "http://localhost:3000",
		});
		expect(allowed.ok).toBe(true);
		if (!allowed.ok) {
			return;
		}
		expect(allowed.item.uri).toMatch(/^data:image\/svg\+xml/);
	});
});
