import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	SAMPLE_ARCHITECTURE_MERMAID,
	SAMPLE_ARCHITECTURE_SHOW_ID,
	buildSampleArchitectureShowItem,
	buildSampleCaptureShowItem,
	buildSampleChangeAnimationShowItem,
	presentSampleArchitectureShow,
} from "./sampleShowPresent";

vi.mock("../vscode", () => ({
	postToHost: vi.fn(),
}));

describe("sampleShowPresent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("builds a mermaid ShowBacklogItem with materializable args", () => {
		const item = buildSampleArchitectureShowItem();
		expect(item.id).toBe(SAMPLE_ARCHITECTURE_SHOW_ID);
		expect(item.produce.tool).toBe("render_mermaid");
		expect(item.produce.args.mermaidSource).toBe(SAMPLE_ARCHITECTURE_MERMAID);
		expect(item.artifactKind).toBe("diagram.architecture");
		expect(item.caption).toMatch(/Sample \/ dev/);
	});

	it("posts drive.show.present with roomId and showItem", async () => {
		const { postToHost } = await import("../vscode");
		presentSampleArchitectureShow("room-a");
		expect(postToHost).toHaveBeenCalledWith({
			type: "driveCommand",
			command: "drive.show.present",
			payload: {
				roomId: "room-a",
				showItem: buildSampleArchitectureShowItem(),
			},
		});
	});

	it("falls back to default room id when roomId is empty", async () => {
		const { postToHost } = await import("../vscode");
		presentSampleArchitectureShow(null);
		expect(postToHost).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({ roomId: "default" }),
			}),
		);
	});

	it("enqueues and ticks via drive commands", async () => {
		const { postToHost } = await import("../vscode");
		const {
			enqueueSampleArchitectureShow,
			tickShowDirector,
		} = await import("./sampleShowPresent");
		enqueueSampleArchitectureShow("room-b");
		expect(postToHost).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "drive.show.enqueue",
				payload: expect.objectContaining({ roomId: "room-b" }),
			}),
		);
		tickShowDirector("room-b");
		expect(postToHost).toHaveBeenCalledWith({
			type: "driveCommand",
			command: "drive.show.tick",
			payload: { roomId: "room-b" },
		});
	});

	it("builds a walkthrough.animation the hub can materialize", () => {
		const item = buildSampleChangeAnimationShowItem();
		expect(item.artifactKind).toBe("walkthrough.animation");
		expect(item.mediaClass).toBe("animation");
		expect(item.produce.tool).toBe("render_change_animation");
		expect(item.produce.args.rows).toHaveLength(3);
		expect(item.produce.args.entering).toHaveLength(1);
		// No uri: the hub produces the still stub, the webview the motion.
		expect(item.uri).toBeUndefined();
	});

	it("builds a capture whose bytes stay behind an out-of-band reference", () => {
		const item = buildSampleCaptureShowItem();
		expect(item.artifactKind).toBe("capture.screenshot");
		expect(item.produce.tool).toBe("drive_browser_snapshot");
		expect(item.produce.args.url).toBe("http://127.0.0.1:8787/drive");
		// The reference is a URL the browser fetches, never inline bytes.
		expect(item.uri).toBe("/cline-drive-logo.svg");
		expect(item.uri?.startsWith("data:")).toBe(false);
	});

	it("presents both new sample kinds via drive.show.present", async () => {
		const { postToHost } = await import("../vscode");
		const { presentSampleChangeAnimationShow, presentSampleCaptureShow } =
			await import("./sampleShowPresent");
		presentSampleChangeAnimationShow("room-c");
		expect(postToHost).toHaveBeenCalledWith({
			type: "driveCommand",
			command: "drive.show.present",
			payload: {
				roomId: "room-c",
				showItem: buildSampleChangeAnimationShowItem(),
			},
		});
		presentSampleCaptureShow("room-c");
		expect(postToHost).toHaveBeenCalledWith({
			type: "driveCommand",
			command: "drive.show.present",
			payload: { roomId: "room-c", showItem: buildSampleCaptureShowItem() },
		});
	});
});
