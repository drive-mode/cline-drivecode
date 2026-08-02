import { describe, expect, it } from "vitest";
import {
	getShowTemplate,
	KIT_MERMAID_ARCH_CLINE_DRIVE,
	mediaClassForArtifactKind,
	SHOW_TEMPLATE_KIT,
	showItemFromTemplate,
} from "./showTemplates.js";
import { validateMermaidSource } from "./validateMermaidSource.js";

describe("SHOW_TEMPLATE_KIT", () => {
	it("includes architecture and walkthrough templates", () => {
		expect(SHOW_TEMPLATE_KIT.length).toBeGreaterThanOrEqual(5);
		expect(getShowTemplate("arch.overview")?.artifactKind).toBe(
			"diagram.architecture",
		);
		expect(getShowTemplate("walk.code")?.artifactKind).toBe(
			"walkthrough.code",
		);
	});

	it("builds a ready show item linked to a Do id", () => {
		const item = showItemFromTemplate({
			templateId: "arch.overview",
			ownerParticipantId: "agent-1",
			linkedDoItemId: "do-42",
		});
		expect(item).toMatchObject({
			artifactKind: "diagram.architecture",
			mediaClass: "still",
			status: "ready",
			linkedDoItemId: "do-42",
			produce: { tool: "render_mermaid", templateId: "arch.overview" },
		});
		expect(typeof item?.produce.args.mermaidSource).toBe("string");
		expect(String(item?.produce.args.mermaidSource)).toContain("HubDaemon");
		expect(mediaClassForArtifactKind("work.card")).toBe("work");
	});
});

describe("arch.cline-drive template", () => {
	it("is registered as a render_mermaid architecture template", () => {
		const template = getShowTemplate("arch.cline-drive");
		expect(template).toMatchObject({
			artifactKind: "diagram.architecture",
			produceTool: "render_mermaid",
		});
		expect(template?.defaultArgs.mermaidSource).toBe(
			KIT_MERMAID_ARCH_CLINE_DRIVE,
		);
		expect(SHOW_TEMPLATE_KIT).toContain(template);
	});

	it("carries parse-valid mermaid so present cannot fail closed", () => {
		expect(validateMermaidSource(KIT_MERMAID_ARCH_CLINE_DRIVE)).toEqual({
			ok: true,
		});
		const item = showItemFromTemplate({
			templateId: "arch.cline-drive",
			ownerParticipantId: "agent-1",
			linkedDoItemId: "do-7",
		});
		expect(item).toMatchObject({
			artifactKind: "diagram.architecture",
			mediaClass: "still",
			status: "ready",
			produce: { tool: "render_mermaid", templateId: "arch.cline-drive" },
		});
		expect(
			validateMermaidSource(String(item?.produce.args.mermaidSource)),
		).toEqual({ ok: true });
	});

	it("names the real topology, not a plausible-looking one", () => {
		// Each of these is asserted somewhere in code or an accepted ADR:
		// the single-writer port, the two ADR-0013 state lanes on the work
		// path, the director path, and the two surfaces that consume it.
		for (const token of [
			"HubDaemon :25463 · single writer",
			"call_* ops",
			"event log · durable",
			"rooms · reduceRoom fold",
			"DriveLive · director",
			"Show backlog · rank · produce",
			"Hub webview · room snapshot",
			// Spotlight S2 moved the presented artifact into the ScreenFrame and
			// dropped StickyStagePane from Chat.tsx — naming the pane here would
			// point the diagram at a surface no live call renders.
			"Spotlight · ScreenFrame",
			"call_record_work",
			"RoomSnapshot",
			"drive.show.presented",
		]) {
			expect(KIT_MERMAID_ARCH_CLINE_DRIVE).toContain(token);
		}
		// The banned second-daemon port must never appear on a stage diagram.
		expect(KIT_MERMAID_ARCH_CLINE_DRIVE).not.toContain(":7891");
	});

	it("fits the 640x360 produce card that stages the source as text", () => {
		// produceMermaidShowArtifact stages mermaidSource as text in a 592x280
		// <pre> at 12px monospace: 20 lines of 14px, ~91 chars before pre-wrap
		// folds a line and costs a row. Past that the topology is clipped off
		// the presented artifact, so the diagram has to live in that budget.
		const lines = KIT_MERMAID_ARCH_CLINE_DRIVE.split("\n");
		expect(lines.length).toBeLessThanOrEqual(20);
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(88);
		}
	});
});
