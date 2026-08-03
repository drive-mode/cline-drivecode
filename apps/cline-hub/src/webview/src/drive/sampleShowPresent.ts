import type { ShowBacklogItem } from "@cline/shared";
import { postToHost } from "../vscode";
import {
	DRIVE_DEFAULT_ROOM_ID,
	DRIVE_PARTICIPANT_PARTNER,
} from "./types";

/** Deterministic sample diagram for Slice 1 present-trigger smoke (no LLM).
 * Convention-stable names from `.claude/diagram-conventions.md`. */
export const SAMPLE_ARCHITECTURE_MERMAID = `flowchart LR
  HubDaemon --> ShowBacklog
  ShowBacklog --> MermaidProduce
  MermaidProduce --> StickyStagePane`;

export const SAMPLE_ARCHITECTURE_SHOW_ID = "show-sample-arch-overview";

/**
 * Build a valid ShowBacklogItem for "Present sample diagram" (Sample / dev).
 * Includes mermaidSource so hub materializeShowItem can fill uri.
 */
export function buildSampleArchitectureShowItem(input?: {
	ownerParticipantId?: string;
	id?: string;
	priority?: number;
}): ShowBacklogItem {
	return {
		id: input?.id ?? SAMPLE_ARCHITECTURE_SHOW_ID,
		ownerParticipantId:
			input?.ownerParticipantId ?? DRIVE_PARTICIPANT_PARTNER,
		title: "Architecture overview",
		intent: "Explain system layout before coding",
		artifactKind: "diagram.architecture",
		mediaClass: "still",
		caption: "Sample / dev — architecture overview",
		produce: {
			tool: "render_mermaid",
			templateId: "arch.overview",
			args: { mermaidSource: SAMPLE_ARCHITECTURE_MERMAID },
		},
		priority: input?.priority ?? 10,
		status: "ready",
		scoreReasons: ["sample_dev"],
	};
}

export const SAMPLE_ANIMATION_SHOW_ID = "show-sample-change-animation";

/**
 * Sample `walkthrough.animation` (Sample / dev). Carries the before/after
 * recipe so hub `materializeShowItem` fills `uri` and the webview re-renders
 * the motion from the same args.
 */
export function buildSampleChangeAnimationShowItem(input?: {
	ownerParticipantId?: string;
	id?: string;
	priority?: number;
}): ShowBacklogItem {
	return {
		id: input?.id ?? SAMPLE_ANIMATION_SHOW_ID,
		ownerParticipantId:
			input?.ownerParticipantId ?? DRIVE_PARTICIPANT_PARTNER,
		title: "Feed repaint · before and after",
		intent: "Explain a change with motion",
		artifactKind: "walkthrough.animation",
		mediaClass: "animation",
		caption: "Sample / dev — every-beat rebuild vs fingerprint skip",
		produce: {
			tool: "render_change_animation",
			templateId: "anim.change",
			args: {
				beforeLabel: "Before · every beat rebuilds",
				afterLabel: "After · fingerprint match → skip",
				beforeCaption: "everything re-animates — that's the flash",
				afterCaption: "nothing re-mounts — only new items animate",
				signal: "sig ✓ unchanged",
				rows: ["message · partner", "message · you", "message · partner"],
				entering: ["message · partner (new)"],
			},
		},
		priority: input?.priority ?? 10,
		status: "ready",
		scoreReasons: ["sample_dev"],
	};
}

export const SAMPLE_CAPTURE_SHOW_ID = "show-sample-capture";

/**
 * Sample `capture.screenshot` (Sample / dev).
 *
 * `produce.args.url` is the metadata the event log carries; `uri` is the
 * out-of-band reference the card fetches its pixels from. No bytes travel on
 * either — which is exactly the constraint the capture card exists to honour.
 * The reference is a hub-served asset so the sample needs no capture
 * capability (`demoCapture` is off by default).
 */
export function buildSampleCaptureShowItem(input?: {
	ownerParticipantId?: string;
	id?: string;
	priority?: number;
}): ShowBacklogItem {
	return {
		id: input?.id ?? SAMPLE_CAPTURE_SHOW_ID,
		ownerParticipantId:
			input?.ownerParticipantId ?? DRIVE_PARTICIPANT_PARTNER,
		title: "Hub webview · smooth playback",
		intent: "Show running UI proof",
		artifactKind: "capture.screenshot",
		mediaClass: "still",
		uri: "/cline-drive-logo.svg",
		caption: "Sample / dev — capture metadata; pixels load from the reference",
		produce: {
			tool: "drive_browser_snapshot",
			templateId: "capture.shot",
			args: { url: "http://127.0.0.1:8787/drive" },
		},
		priority: input?.priority ?? 10,
		status: "ready",
		scoreReasons: ["sample_dev"],
	};
}

/** Post drive.show.present for the sample architecture diagram. */
export function presentSampleArchitectureShow(roomId?: string | null): void {
	postToHost({
		type: "driveCommand",
		command: "drive.show.present",
		payload: {
			roomId: roomId?.trim() || DRIVE_DEFAULT_ROOM_ID,
			showItem: buildSampleArchitectureShowItem(),
		},
	});
}

/** Post drive.show.present for the sample before/after animation. */
export function presentSampleChangeAnimationShow(roomId?: string | null): void {
	postToHost({
		type: "driveCommand",
		command: "drive.show.present",
		payload: {
			roomId: roomId?.trim() || DRIVE_DEFAULT_ROOM_ID,
			showItem: buildSampleChangeAnimationShowItem(),
		},
	});
}

/** Post drive.show.present for the sample capture card. */
export function presentSampleCaptureShow(roomId?: string | null): void {
	postToHost({
		type: "driveCommand",
		command: "drive.show.present",
		payload: {
			roomId: roomId?.trim() || DRIVE_DEFAULT_ROOM_ID,
			showItem: buildSampleCaptureShowItem(),
		},
	});
}

/** Enqueue sample architecture show without presenting (slice 2). */
export function enqueueSampleArchitectureShow(roomId?: string | null): void {
	postToHost({
		type: "driveCommand",
		command: "drive.show.enqueue",
		payload: {
			roomId: roomId?.trim() || DRIVE_DEFAULT_ROOM_ID,
			showItem: buildSampleArchitectureShowItem({
				id: `${SAMPLE_ARCHITECTURE_SHOW_ID}-queued`,
				priority: 10,
			}),
		},
	});
}

/** Run show director tick to present top ranked backlog item. */
export function tickShowDirector(roomId?: string | null): void {
	postToHost({
		type: "driveCommand",
		command: "drive.show.tick",
		payload: {
			roomId: roomId?.trim() || DRIVE_DEFAULT_ROOM_ID,
		},
	});
}

const SAMPLE_SCRIPT_SHOW_A = "show-sample-script-a";
const SAMPLE_SCRIPT_SHOW_B = "show-sample-script-b";

/** Two-beat hold script for Sample / dev (same sticky URI, changing say). */
export function attachSampleHoldScript(roomId?: string | null): void {
	const showA = buildSampleArchitectureShowItem({
		id: SAMPLE_SCRIPT_SHOW_A,
		priority: 20,
	});
	const showB = buildSampleArchitectureShowItem({
		id: SAMPLE_SCRIPT_SHOW_B,
		priority: 10,
	});
	postToHost({
		type: "driveCommand",
		command: "drive.script.attach",
		payload: {
			roomId: roomId?.trim() || DRIVE_DEFAULT_ROOM_ID,
			showItems: [showA, showB],
			script: {
				scriptId: "sample-hold-script",
				ownerParticipantId: DRIVE_PARTICIPANT_PARTNER,
				title: "Sample hold script",
				stickyShowIds: [SAMPLE_SCRIPT_SHOW_A],
				beats: [
					{
						beatId: "beat-1",
						say: "Beat 1 — here is the architecture overview.",
						showItemId: SAMPLE_SCRIPT_SHOW_A,
						sticky: { mode: "hold" },
						advance: "on_human",
					},
					{
						beatId: "beat-2",
						say: "Beat 2 — still on the same sticky diagram.",
						showItemId: SAMPLE_SCRIPT_SHOW_A,
						sticky: { mode: "hold" },
						advance: "on_human",
					},
				],
			},
		},
	});
}

export function advanceSampleScript(roomId?: string | null): void {
	postToHost({
		type: "driveCommand",
		command: "drive.script.advance",
		payload: {
			roomId: roomId?.trim() || DRIVE_DEFAULT_ROOM_ID,
		},
	});
}

export function setShowPlannerMode(
	mode: "off" | "heuristic",
	roomId?: string | null,
): void {
	postToHost({
		type: "driveCommand",
		command: "drive.planner.set",
		payload: {
			roomId: roomId?.trim() || DRIVE_DEFAULT_ROOM_ID,
			showPlannerMode: mode,
		},
	});
}
