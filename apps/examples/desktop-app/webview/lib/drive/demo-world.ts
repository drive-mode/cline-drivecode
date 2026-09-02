/**
 * The labeled demo world — an in-memory `DriveDataSource`.
 *
 * Everything here is deterministic. The room is the hub webview's
 * "router-fix" fixture (You + Cline + Riley + Sam) folded through the same
 * `reduceRoom` kernel a live room uses, so every call op mutates it exactly
 * the way the hub would and the UI cannot tell the difference. A scripted
 * loop of beats keeps the Spotlight alive; `pause()` stills it.
 *
 * Nothing in this file is a prompt, tool allowlist, key, endpoint or model id.
 */

import {
	activePresenterGrant,
	artifactDirectoryTags,
	createEmptyRoomSnapshot,
	type DriveArtifactDirectoryEntry,
	type DriveRoomDirectoryEntry,
	filterArtifactDirectory,
	projectRoomDirectoryEntry,
	reduceRoom,
	sortRoomDirectory,
} from "@cline/drive";
import {
	DrivePlansDemoAnnotationsSource,
	DrivePlansDemoTeamsSource,
	DriveSessionsDemoRollupSource,
	STATUS_BOARD_DEMO_UPDATES,
} from "@cline/drivecode-demo";
import {
	type AgentProfile,
	type AgentTitleGrant,
	agentProfileId,
	createEmptyDriveRoomLiveState,
	type DriveEvent,
	type DriveRoomLiveState,
	type Participant,
	type RoomSnapshot,
	type ShowArtifactKind,
	type ShowBacklogItem,
	type StagePin,
	type StatusSummary,
	type StatusUpdate,
} from "@cline/shared";
import type {
	DriveCallOp,
	DriveCallReply,
	DriveCommandName,
	DriveCommandPayload,
	DriveHubEvent,
	DriveHubStatus,
	DriveRoomsListReply,
	DriveSessionRollupsReply,
	DriveSessionRollupsRequest,
	DriveStatusOp,
} from "./drive-client";
import {
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
} from "./drive-ids";
import type { DriveDataSource, DriveHubEventHandler } from "./drive-source";

export const DEMO_ROOM_ID = "router-fix";
export const DEMO_WORKSPACE_ROOT = "/workspace/router-fix";
export const DEMO_HUB_URL = "demo://drive/router-fix";
export const DEMO_CALL_SESSION_ID = "call-demo-router-fix";
export const DEMO_SCRIPT_ID = "script-router-fix";

export const DEMO_HUMAN_ID = DRIVE_PARTICIPANT_HUMAN;
export const DEMO_PARTNER_ID = DRIVE_PARTICIPANT_PARTNER;
export const DEMO_RILEY_ID = "agent:riley";
export const DEMO_SAM_ID = "agent:sam";

/** Beat cadence while the loop is running. */
export const DEMO_BEAT_INTERVAL_MS = 6_000;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export type DemoDriveSourceOptions = {
	/** Clock for every timestamp — inject a fixed one in tests. */
	now?: () => Date;
	beatIntervalMs?: number;
	/** Start the beat loop on creation (default true in a browser). */
	autoTick?: boolean;
	/** Start paused; `resume()` starts the loop. */
	paused?: boolean;
};

export interface DemoDriveSource extends DriveDataSource {
	readonly kind: "demo";
	readonly paused: boolean;
	readonly beatIndex: number;
	pause(): void;
	resume(): void;
	/** Advance one beat now, regardless of the timer. */
	tick(): void;
	/** Current room snapshot — for tests and the settings WIRE panel. */
	snapshot(): RoomSnapshot;
}

type DemoParticipantSeed = Participant & { kind: "agent" | "human" };

const DEMO_PARTICIPANTS: readonly DemoParticipantSeed[] = [
	{
		id: DEMO_HUMAN_ID,
		kind: "human",
		displayName: "You",
		role: "host",
		status: "idle",
	},
	{
		id: DEMO_PARTNER_ID,
		kind: "agent",
		displayName: "Cline",
		role: "partner",
		status: "working",
		ref: { kind: "builtin", id: "pair_partner" },
		capPreset: "standard",
		seatSources: [{ kind: "manual" }],
	},
	{
		id: DEMO_RILEY_ID,
		kind: "agent",
		displayName: "Riley",
		role: "specialist",
		status: "working",
		ref: { kind: "driveagent", slug: "riley" },
		capPreset: "standard",
		seatSources: [{ kind: "pack", packId: "router-fix-pack" }],
	},
	{
		id: DEMO_SAM_ID,
		kind: "agent",
		displayName: "Sam",
		role: "recorder",
		status: "idle",
		ref: { kind: "driveagent", slug: "sam" },
		capPreset: "readonly",
		seatSources: [{ kind: "pack", packId: "router-fix-pack" }],
	},
];

const DEMO_HUMAN_PIN: StagePin = {
	kind: "selection",
	label: "router.ts · scheduleRetry",
	ref: "Keep the guard in scheduleRetry only and add a test for the pending flag.",
};

type DemoBeat = {
	beatId: string;
	say: string;
	showItemId: string | null;
	/** Room event the beat lands on the log, folded through reduceRoom. */
	work?: (input: { at: string; id: string }) => DriveEvent;
	/** Human takes the Spotlight with a pin; agent otherwise. */
	humanSpotlight?: boolean;
};

const DEMO_BEATS: readonly DemoBeat[] = [
	{
		beatId: "beat-race",
		say: "Found the race. Watch the Spotlight — I will walk the pending-flag path.",
		showItemId: "show-retry-path",
	},
	{
		beatId: "beat-guard",
		say: "Guarding scheduleRetry so a second timeout cannot queue a duplicate retry.",
		showItemId: "show-retry-path",
		work: ({ at, id }) => ({
			schemaVersion: 1,
			type: "work.edit",
			track: "work",
			id,
			roomId: DEMO_ROOM_ID,
			at,
			actorId: DEMO_PARTNER_ID,
			path: "router.ts",
			summary: "Guard scheduleRetry when req.pending is already set.",
		}),
	},
	{
		beatId: "beat-tests",
		say: "Running the router unit tests before I touch anything else.",
		showItemId: "show-plan",
		work: ({ at, id }) => ({
			schemaVersion: 1,
			type: "work.command",
			track: "work",
			id,
			roomId: DEMO_ROOM_ID,
			at,
			actorId: DEMO_RILEY_ID,
			command: "bun -F @cline/core test:unit",
			failed: false,
			summary: "42 passed, 0 failed · 3.1s",
		}),
	},
	{
		beatId: "beat-green",
		say: "Retry once per timeout is green. Sam is writing the decision down.",
		showItemId: "show-review",
		work: ({ at, id }) => ({
			schemaVersion: 1,
			type: "work.test_result",
			track: "work",
			id,
			roomId: DEMO_ROOM_ID,
			at,
			actorId: DEMO_RILEY_ID,
			label: "retry once",
			passed: true,
			summary: "Router retries exactly once per timeout — green.",
		}),
	},
	{
		beatId: "beat-handoff",
		say: "Your turn — the Spotlight is yours. Pin what you want me to keep.",
		showItemId: null,
		humanSpotlight: true,
	},
	{
		beatId: "beat-commit",
		say: "Back to me. Explaining the race in the commit message, then landing it.",
		showItemId: "show-retry-path",
		work: ({ at, id }) => ({
			schemaVersion: 1,
			type: "work.decision",
			track: "work",
			id,
			roomId: DEMO_ROOM_ID,
			at,
			actorId: DEMO_SAM_ID,
			title: "Retry guard lives in scheduleRetry",
			choice: "Guard inside scheduleRetry, not at every call site.",
			summary: "One place owns the pending flag; callers never race it.",
		}),
	},
];

function svgDataUri(svg: string): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Bytes-free-ish stand-ins: tiny inline SVGs the hub would have rendered. */
const RETRY_PATH_SVG = svgDataUri(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 200" font-family="ui-sans-serif, system-ui" font-size="14"><rect width="480" height="200" fill="none"/><g fill="none" stroke="currentColor" stroke-width="1.5"><rect x="20" y="70" width="120" height="56" rx="8"/><rect x="180" y="70" width="120" height="56" rx="8"/><rect x="340" y="70" width="120" height="56" rx="8"/><path d="M140 98h40M300 98h40" marker-end="url(#a)"/><path d="M400 126v34H80v-34" stroke-dasharray="4 4"/></g><g fill="currentColor" text-anchor="middle"><text x="80" y="102">request</text><text x="240" y="102">scheduleRetry</text><text x="400" y="102">timeout</text><text x="240" y="178" font-size="12">req.pending guards the second timeout</text></g></svg>',
);

function showItem(input: {
	id: string;
	title: string;
	intent: string;
	artifactKind: ShowArtifactKind;
	mediaClass: ShowBacklogItem["mediaClass"];
	caption: string;
	tool: string;
	templateId: string;
	args: Record<string, unknown>;
	priority: number;
	status: ShowBacklogItem["status"];
	uri?: string;
	tags?: string[];
}): ShowBacklogItem {
	return {
		id: input.id,
		ownerParticipantId: DEMO_PARTNER_ID,
		title: input.title,
		intent: input.intent,
		artifactKind: input.artifactKind,
		mediaClass: input.mediaClass,
		...(input.uri ? { uri: input.uri } : {}),
		caption: input.caption,
		produce: {
			tool: input.tool,
			templateId: input.templateId,
			args: input.args,
		},
		priority: input.priority,
		status: input.status,
		scoreReasons: ["demo"],
		...(input.tags ? { tags: input.tags } : {}),
	};
}

const RETRY_PATH_MERMAID = `flowchart LR
  request --> scheduleRetry
  scheduleRetry --> timeout
  timeout -. "req.pending guard" .-> scheduleRetry`;

function demoShowBacklog(): ShowBacklogItem[] {
	return [
		showItem({
			id: "show-retry-path",
			title: "Retry path · pending flag",
			intent: "Explain the race before editing",
			artifactKind: "diagram.architecture",
			mediaClass: "still",
			caption: "One timeout, one retry. The pending flag is the guard.",
			tool: "render_mermaid",
			templateId: "arch.overview",
			args: { mermaidSource: RETRY_PATH_MERMAID },
			priority: 20,
			status: "ready",
			uri: RETRY_PATH_SVG,
			tags: ["router", "race"],
		}),
		showItem({
			id: "show-plan",
			title: "Router fix plan",
			intent: "Show the three steps",
			artifactKind: "doc.plan",
			mediaClass: "document",
			caption:
				"1. Guard scheduleRetry.\n2. Run router unit tests.\n3. Explain the race, then commit.",
			tool: "render_markdown",
			templateId: "doc.plan",
			args: {
				markdown:
					"1. Guard `scheduleRetry` when `req.pending` is set.\n2. Run the router unit tests.\n3. Explain the race in the commit, then land it.",
			},
			priority: 15,
			status: "ready",
			tags: ["plan"],
		}),
		showItem({
			id: "show-review",
			title: "Review · retry once",
			intent: "Prove it is green",
			artifactKind: "doc.review",
			mediaClass: "document",
			caption: "42 passed · retry fires exactly once per timeout.",
			tool: "render_markdown",
			templateId: "doc.review",
			args: {
				markdown:
					"**bun -F @cline/core test:unit** — 42 passed, 0 failed.\n\n`retry once` covers the pending-flag path.",
			},
			priority: 10,
			status: "planned",
			tags: ["review", "tests"],
		}),
	];
}

function artifactEntry(input: {
	showItemId: string;
	roomId: string;
	artifactKind: ShowArtifactKind;
	mediaClass: DriveArtifactDirectoryEntry["mediaClass"];
	title: string;
	ownerParticipantId: string;
	tool: string;
	templateId: string;
	args: Record<string, unknown>;
	tags: string[];
	status: DriveArtifactDirectoryEntry["status"];
	createdAt: string;
	updatedAt: string;
}): DriveArtifactDirectoryEntry {
	return {
		showItemId: input.showItemId,
		roomId: input.roomId,
		artifactKind: input.artifactKind,
		mediaClass: input.mediaClass,
		title: input.title,
		ownerParticipantId: input.ownerParticipantId,
		produce: {
			tool: input.tool,
			templateId: input.templateId,
			args: input.args,
		},
		tags: input.tags,
		status: input.status,
		createdAt: input.createdAt,
		updatedAt: input.updatedAt,
	};
}

function demoArtifacts(nowMs: number): DriveArtifactDirectoryEntry[] {
	const iso = (offsetMs: number) => new Date(nowMs - offsetMs).toISOString();
	return [
		artifactEntry({
			showItemId: "show-retry-path",
			roomId: DEMO_ROOM_ID,
			artifactKind: "diagram.architecture",
			mediaClass: "still",
			title: "Retry path · pending flag",
			ownerParticipantId: DEMO_PARTNER_ID,
			tool: "render_mermaid",
			templateId: "arch.overview",
			args: { mermaidSource: RETRY_PATH_MERMAID },
			tags: ["router", "race"],
			status: "showing",
			createdAt: iso(9 * MINUTE_MS),
			updatedAt: iso(1 * MINUTE_MS),
		}),
		artifactEntry({
			showItemId: "show-plan",
			roomId: DEMO_ROOM_ID,
			artifactKind: "doc.plan",
			mediaClass: "document",
			title: "Router fix plan",
			ownerParticipantId: DEMO_PARTNER_ID,
			tool: "render_markdown",
			templateId: "doc.plan",
			args: { markdown: "1. Guard scheduleRetry.\n2. Run tests.\n3. Commit." },
			tags: ["plan"],
			status: "ready",
			createdAt: iso(8 * MINUTE_MS),
			updatedAt: iso(8 * MINUTE_MS),
		}),
		artifactEntry({
			showItemId: "show-review",
			roomId: DEMO_ROOM_ID,
			artifactKind: "doc.review",
			mediaClass: "document",
			title: "Review · retry once",
			ownerParticipantId: DEMO_RILEY_ID,
			tool: "render_markdown",
			templateId: "doc.review",
			args: { markdown: "42 passed, 0 failed." },
			tags: ["review", "tests"],
			status: "planned",
			createdAt: iso(6 * MINUTE_MS),
			updatedAt: iso(6 * MINUTE_MS),
		}),
		artifactEntry({
			showItemId: "show-timeout-sequence",
			roomId: DEMO_ROOM_ID,
			artifactKind: "diagram.sequence",
			mediaClass: "still",
			title: "Timeout → retry sequence",
			ownerParticipantId: DEMO_PARTNER_ID,
			tool: "render_mermaid",
			templateId: "seq.flow",
			args: {
				mermaidSource:
					"sequenceDiagram\n  Caller->>Router: send(req)\n  Router->>Timer: schedule(timeout)\n  Timer-->>Router: timeout\n  Router->>Router: scheduleRetry (pending guard)",
			},
			tags: ["router", "sequence"],
			status: "shown",
			createdAt: iso(14 * MINUTE_MS),
			updatedAt: iso(12 * MINUTE_MS),
		}),
		artifactEntry({
			showItemId: "show-walkthrough-guard",
			roomId: DEMO_ROOM_ID,
			artifactKind: "walkthrough.code",
			mediaClass: "document",
			title: "Walkthrough · the guard in scheduleRetry",
			ownerParticipantId: DEMO_PARTNER_ID,
			tool: "render_code_walkthrough",
			templateId: "walk.code",
			args: { path: "router.ts", symbol: "scheduleRetry" },
			tags: ["router", "walkthrough"],
			status: "shown",
			createdAt: iso(11 * MINUTE_MS),
			updatedAt: iso(10 * MINUTE_MS),
		}),
		artifactEntry({
			showItemId: "show-auth-migration-map",
			roomId: "auth-migration",
			artifactKind: "diagram.data_flow",
			mediaClass: "still",
			title: "Auth schema migration · data flow",
			ownerParticipantId: DEMO_RILEY_ID,
			tool: "render_mermaid",
			templateId: "flow.data",
			args: {
				mermaidSource:
					"flowchart TD\n  users --> sessions\n  sessions --> tokens\n  tokens --> audit",
			},
			tags: ["auth", "migration"],
			status: "shown",
			createdAt: iso(3 * HOUR_MS),
			updatedAt: iso(3 * HOUR_MS),
		}),
		artifactEntry({
			showItemId: "show-docs-share",
			roomId: "docs-refresh",
			artifactKind: "share.structured",
			mediaClass: "structured",
			title: "README screenshot checklist",
			ownerParticipantId: DEMO_SAM_ID,
			tool: "share_structured",
			templateId: "share.list",
			args: { items: ["Lobby", "Call", "Status Hub"] },
			tags: ["docs"],
			status: "shown",
			createdAt: iso(26 * HOUR_MS),
			updatedAt: iso(25 * HOUR_MS),
		}),
	];
}

function presenterGrant(input: {
	id: string;
	agentId: string;
	grantedAt: string;
	durationMs: number;
}): AgentTitleGrant {
	const grantedMs = Date.parse(input.grantedAt);
	return {
		id: input.id,
		agentId: input.agentId,
		title: "presenter",
		definitionRef: "presenter@1",
		scope: { kind: "stage", ref: DEMO_ROOM_ID },
		skillBundleRefs: [],
		resourceGrantRefs: [],
		delegatedAgentIds: [],
		permissions: ["stage.present"],
		grantedAt: input.grantedAt,
		issuedAt: input.grantedAt,
		expiresAt: new Date(grantedMs + input.durationMs).toISOString(),
		exclusivityKey: `stage/${DEMO_ROOM_ID}`,
		grantedBy: "demo-host",
		policyRef: "director@demo",
	};
}

const DEMO_PROFILES: AgentProfile[] = [
	{
		id: "builtin.pair_partner",
		ref: { kind: "builtin", id: "pair_partner" },
		displayName: "Cline",
		nameInk: { kind: "palette", index: 5 },
		bodyInk: { kind: "token", token: "foreground" },
	},
	{
		id: "driveagent.riley",
		ref: { kind: "driveagent", slug: "riley" },
		displayName: "Riley",
		nameInk: { kind: "palette", index: 2 },
		bodyInk: { kind: "token", token: "muted" },
	},
	{
		id: "driveagent.sam",
		ref: { kind: "driveagent", slug: "sam" },
		displayName: "Sam",
		nameInk: { kind: "palette", index: 7 },
		bodyInk: { kind: "token", token: "muted" },
	},
];

const DEMO_HOMES = [
	{
		slug: "riley",
		tier: "workspace",
		displayName: "Riley",
		description: "Runs the tests and reads the failures back plainly.",
		skills: ["run-tests", "read-failures"],
		editable: true,
	},
	{
		slug: "sam",
		tier: "workspace",
		displayName: "Sam",
		description: "Keeps the decision log and writes the handoff.",
		skills: ["record-decisions", "write-handoff"],
		editable: true,
	},
	{
		slug: "scribe",
		tier: "user",
		displayName: "Scribe",
		description: "Summarizes what shipped for the Analytics digest.",
		skills: ["shipped-digest"],
		editable: false,
	},
] as const;

const DEMO_FACETS = {
	"runtime.profile": "local",
	"runtime.egressCeiling": "loopback-only",
	"providers.sttId": "local-stt",
	"providers.sttConfig": {},
	"providers.ttsId": "local-tts",
	"providers.ttsConfig": {},
	"tts.enabled": true,
	"tts.maxSpokenSentences": 2,
	"captions.enabled": true,
	"earcons.taskComplete": false,
	"earcons.approvalRequired": true,
	"earcons.join": true,
	"earcons.leave": true,
	"drive.defaults.pairAgent": { kind: "builtin", id: "pair_partner" },
} as const;

function summarize(
	updates: readonly StatusUpdate[],
	nowIso: string,
): StatusSummary {
	const byState: StatusSummary["byState"] = {
		queued: 0,
		running: 0,
		blocked: 0,
		done: 0,
		failed: 0,
		cancelled: 0,
	};
	const byAgent = new Map<string, StatusSummary["byAgent"][number]>();
	let lastUpdatedAt: string | null = null;
	for (const update of updates) {
		byState[update.state] += 1;
		const agentId = update.agentId ?? "unknown";
		const agent = byAgent.get(agentId) ?? {
			agentId,
			agentName: update.agentName,
			total: 0,
			blocked: 0,
			running: 0,
		};
		agent.total += 1;
		if (update.state === "blocked") {
			agent.blocked += 1;
		}
		if (update.state === "running") {
			agent.running += 1;
		}
		byAgent.set(agentId, agent);
		if (!lastUpdatedAt || update.createdAt > lastUpdatedAt) {
			lastUpdatedAt = update.createdAt;
		}
	}
	return {
		total: updates.length,
		byState,
		byAgent: [...byAgent.values()],
		lastUpdatedAt: lastUpdatedAt ?? nowIso,
	};
}

function demoError(code: string, message: string): Error {
	return new Error(`${code}: ${message}`);
}

function readString(
	payload: DriveCommandPayload,
	key: string,
): string | undefined {
	const value = payload[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function createDemoDriveSource(
	options: DemoDriveSourceOptions = {},
): DemoDriveSource {
	const now = options.now ?? (() => new Date());
	const nowIso = () => now().toISOString();
	const beatIntervalMs = options.beatIntervalMs ?? DEMO_BEAT_INTERVAL_MS;
	const handlers = new Set<DriveHubEventHandler>();

	let seq = 0;
	let eventCounter = 0;
	let beatIndex = 0;
	let paused = options.paused ?? false;
	let timer: ReturnType<typeof setInterval> | null = null;
	let disposed = false;
	const profiles = new Map(
		DEMO_PROFILES.map((profile) => [profile.id, profile]),
	);

	const bootMs = now().getTime();
	const createdAt = new Date(bootMs - 8 * MINUTE_MS).toISOString();
	let snapshot = createEmptyRoomSnapshot({
		roomId: DEMO_ROOM_ID,
		createdAt,
		subMode: "act",
	});
	const log: DriveEvent[] = [];
	let live: DriveRoomLiveState = {
		...createEmptyDriveRoomLiveState(DEMO_ROOM_ID),
		spotlightParticipantId: DEMO_PARTNER_ID,
		participantAudio: DEMO_PARTICIPANTS.map((participant) => ({
			participantId: participant.id,
			muted: participant.kind === "human",
			deafened: false,
		})),
		director: {
			...createEmptyDriveRoomLiveState(DEMO_ROOM_ID).director,
			showBacklog: demoShowBacklog(),
			activeScript: {
				scriptId: DEMO_SCRIPT_ID,
				ownerParticipantId: DEMO_PARTNER_ID,
				title: "Router fix walkthrough",
				stickyShowIds: ["show-retry-path"],
				beats: DEMO_BEATS.map((beat) => ({
					beatId: beat.beatId,
					say: beat.say,
					showItemId: beat.showItemId ?? "show-retry-path",
					sticky: { mode: beat.showItemId ? "hold" : "replace" },
					advance: beat.humanSpotlight ? "on_human" : "auto_after_say",
				})),
			},
			spotlightParticipantId: DEMO_PARTNER_ID,
			showPlannerMode: "heuristic",
		},
		seatedParticipantIds: DEMO_PARTICIPANTS.map(
			(participant) => participant.id,
		),
	};
	const artifacts = demoArtifacts(bootMs);

	const nextEventId = () => {
		eventCounter += 1;
		return `demo-evt-${String(eventCounter).padStart(4, "0")}`;
	};

	const emit = (event: DriveHubEvent) => {
		for (const handler of handlers) {
			handler(event);
		}
	};

	/** Append a room event the way the hub does: fold, bump seq, broadcast. */
	const commit = (
		event: DriveEvent,
		options?: { silent?: boolean },
	): boolean => {
		const folded = reduceRoom(snapshot, event);
		const applied = folded !== snapshot;
		snapshot = folded;
		log.push(event);
		seq += 1;
		live = {
			...live,
			seatedParticipantIds: snapshot.participants.map((p) => p.id),
			version: live.version + 1,
		};
		if (!options?.silent) {
			emit({
				event: "room.event",
				payload: { roomId: DEMO_ROOM_ID, event, seq },
				seq,
				timestamp: event.at,
			});
			emit({
				event: "room.snapshot",
				payload: { roomId: DEMO_ROOM_ID, snapshot, seq },
				seq,
				timestamp: event.at,
			});
		}
		return applied;
	};

	const publishLive = () => {
		emit({
			event: "drive.room.changed",
			payload: { room: live },
			timestamp: nowIso(),
		});
	};

	const reply = (extra: Partial<DriveCallReply> = {}): DriveCallReply => ({
		roomId: DEMO_ROOM_ID,
		snapshot,
		seq,
		callSessionId: DEMO_CALL_SESSION_ID,
		...extra,
	});

	// ── seed the room (silently: the first snapshot arrives via call_get_room)
	{
		let at = bootMs - 8 * MINUTE_MS;
		const stamp = () => {
			at += 20_000;
			return new Date(at).toISOString();
		};
		for (const participant of DEMO_PARTICIPANTS) {
			commit(
				{
					schemaVersion: 1,
					type: "control.join",
					track: "control",
					id: nextEventId(),
					roomId: DEMO_ROOM_ID,
					at: stamp(),
					actorId: participant.id,
					callSessionId: DEMO_CALL_SESSION_ID,
					participant,
				},
				{ silent: true },
			);
		}
		commit(
			{
				schemaVersion: 1,
				type: "control.mode",
				track: "control",
				id: nextEventId(),
				roomId: DEMO_ROOM_ID,
				at: stamp(),
				actorId: DEMO_HUMAN_ID,
				subMode: "act",
				driveActive: true,
			},
			{ silent: true },
		);
		commit(
			{
				schemaVersion: 1,
				type: "control.title_granted",
				track: "control",
				id: nextEventId(),
				roomId: DEMO_ROOM_ID,
				at: stamp(),
				actorId: "demo-host",
				grant: presenterGrant({
					id: "grant-demo-presenter-1",
					agentId: DEMO_PARTNER_ID,
					grantedAt: new Date(at).toISOString(),
					durationMs: 4 * HOUR_MS,
				}),
			},
			{ silent: true },
		);
		commit(
			{
				schemaVersion: 1,
				type: "control.stage",
				track: "control",
				id: nextEventId(),
				roomId: DEMO_ROOM_ID,
				at: stamp(),
				actorId: DEMO_PARTNER_ID,
				sharer: { kind: "agent", participantId: DEMO_PARTNER_ID },
				pin: null,
			},
			{ silent: true },
		);
		commit(
			{
				schemaVersion: 1,
				type: "work.edit",
				track: "work",
				id: nextEventId(),
				roomId: DEMO_ROOM_ID,
				at: stamp(),
				actorId: DEMO_PARTNER_ID,
				path: "router.ts",
				summary: "Guard scheduleRetry when req.pending is already set.",
			},
			{ silent: true },
		);
		commit(
			{
				schemaVersion: 1,
				type: "work.command",
				track: "work",
				id: nextEventId(),
				roomId: DEMO_ROOM_ID,
				at: stamp(),
				actorId: DEMO_RILEY_ID,
				command: "bun -F @cline/core test:unit",
				failed: false,
				summary: "unit tests",
			},
			{ silent: true },
		);
		commit(
			{
				schemaVersion: 1,
				type: "work.test_result",
				track: "work",
				id: nextEventId(),
				roomId: DEMO_ROOM_ID,
				at: stamp(),
				actorId: DEMO_RILEY_ID,
				label: "retry once",
				passed: true,
				summary: "Router retries exactly once per timeout — green.",
			},
			{ silent: true },
		);
		commit(
			{
				schemaVersion: 1,
				type: "conversation.narration",
				track: "conversation",
				id: nextEventId(),
				roomId: DEMO_ROOM_ID,
				at: stamp(),
				actorId: DEMO_PARTNER_ID,
				text: "Found the race. Watch the spotlight — I will walk the pending-flag path.",
			},
			{ silent: true },
		);
	}

	const presentShow = (item: ShowBacklogItem, caption: string) => {
		live = {
			...live,
			director: {
				...live.director,
				activeShowId: item.id,
				lastPresentedAt: nowIso(),
				showBacklog: live.director.showBacklog.map((entry) =>
					entry.id === item.id
						? { ...entry, status: "showing" }
						: entry.status === "showing"
							? { ...entry, status: "shown" }
							: entry,
				),
			},
			version: live.version + 1,
		};
		emit({
			event: "drive.show.presented",
			payload: {
				showItemId: item.id,
				ownerParticipantId: item.ownerParticipantId,
				uri: item.uri ?? RETRY_PATH_SVG,
				caption,
				title: item.title,
			},
			timestamp: nowIso(),
		});
	};

	const setSpotlight = (
		participantId: string,
		pin: StagePin | null,
		reason: string,
	) => {
		const participant = snapshot.participants.find(
			(p) => p.id === participantId,
		);
		if (!participant) {
			return;
		}
		const from = live.spotlightParticipantId;
		commit({
			schemaVersion: 1,
			type: "control.stage",
			track: "control",
			id: nextEventId(),
			roomId: DEMO_ROOM_ID,
			at: nowIso(),
			actorId: participantId,
			sharer: { kind: participant.kind, participantId },
			pin,
		});
		live = {
			...live,
			spotlightParticipantId: participantId,
			director: { ...live.director, spotlightParticipantId: participantId },
			version: live.version + 1,
		};
		emit({
			event: "drive.spotlight.changed",
			payload: { from, to: participantId, reason, via: "call_set_stage" },
			timestamp: nowIso(),
		});
	};

	const runBeat = () => {
		if (disposed) {
			return;
		}
		const beat = DEMO_BEATS[beatIndex % DEMO_BEATS.length];
		beatIndex += 1;
		const at = nowIso();
		if (beat.work) {
			commit(beat.work({ at, id: nextEventId() }));
		}
		if (beat.humanSpotlight) {
			setSpotlight(DEMO_HUMAN_ID, DEMO_HUMAN_PIN, "script");
		} else if (snapshot.stage.sharer?.participantId !== DEMO_PARTNER_ID) {
			setSpotlight(DEMO_PARTNER_ID, null, "script");
		}
		commit({
			schemaVersion: 1,
			type: "conversation.narration",
			track: "conversation",
			id: nextEventId(),
			roomId: DEMO_ROOM_ID,
			at,
			actorId: DEMO_PARTNER_ID,
			text: beat.say,
		});
		const item = beat.showItemId
			? live.director.showBacklog.find((entry) => entry.id === beat.showItemId)
			: undefined;
		if (item) {
			presentShow(item, beat.say);
		}
		live = {
			...live,
			director: { ...live.director, activeBeatId: beat.beatId },
			version: live.version + 1,
		};
		emit({
			event: "drive.script.beat",
			payload: {
				beatId: beat.beatId,
				say: beat.say,
				showItemId: beat.showItemId ?? null,
				stickyShowIds: live.director.stickyShowIds,
				activeScriptId: DEMO_SCRIPT_ID,
			},
			timestamp: at,
		});
		publishLive();
	};

	const startTimer = () => {
		if (timer || paused || disposed || typeof setInterval !== "function") {
			return;
		}
		timer = setInterval(runBeat, beatIntervalMs);
	};

	const stopTimer = () => {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	};

	if (options.autoTick ?? typeof window !== "undefined") {
		startTimer();
	}

	const handleCall = async (
		op: DriveCallOp,
		roomId: string,
		payload: DriveCommandPayload,
	): Promise<DriveCallReply> => {
		if (roomId !== DEMO_ROOM_ID) {
			throw demoError(
				"room_not_found",
				`Demo world only has room "${DEMO_ROOM_ID}".`,
			);
		}
		const at = nowIso();
		switch (op) {
			case "call_get_room":
				return reply();
			case "call_join": {
				const human =
					payload.human && typeof payload.human === "object"
						? (payload.human as { id?: string; displayName?: string })
						: undefined;
				const humanId = human?.id?.trim() || DEMO_HUMAN_ID;
				if (!snapshot.participants.some((p) => p.id === humanId)) {
					commit({
						schemaVersion: 1,
						type: "control.join",
						track: "control",
						id: nextEventId(),
						roomId: DEMO_ROOM_ID,
						at,
						actorId: humanId,
						callSessionId: DEMO_CALL_SESSION_ID,
						participant: {
							id: humanId,
							kind: "human",
							displayName: human?.displayName?.trim() || "You",
							role: "host",
							status: "idle",
						},
					});
				}
				for (const seed of DEMO_PARTICIPANTS) {
					if (
						seed.kind === "agent" &&
						!snapshot.participants.some((p) => p.id === seed.id)
					) {
						commit({
							schemaVersion: 1,
							type: "control.join",
							track: "control",
							id: nextEventId(),
							roomId: DEMO_ROOM_ID,
							at,
							actorId: seed.id,
							callSessionId: DEMO_CALL_SESSION_ID,
							participant: seed,
						});
					}
				}
				if (!snapshot.driveActive) {
					commit({
						schemaVersion: 1,
						type: "control.mode",
						track: "control",
						id: nextEventId(),
						roomId: DEMO_ROOM_ID,
						at,
						actorId: humanId,
						subMode: snapshot.subMode,
						driveActive: true,
					});
				}
				if (!activePresenterGrant(snapshot, at)) {
					commit({
						schemaVersion: 1,
						type: "control.title_granted",
						track: "control",
						id: nextEventId(),
						roomId: DEMO_ROOM_ID,
						at,
						actorId: "demo-host",
						grant: presenterGrant({
							id: `grant-demo-presenter-${seq + 1}`,
							agentId: DEMO_PARTNER_ID,
							grantedAt: at,
							durationMs: 4 * HOUR_MS,
						}),
					});
					setSpotlight(DEMO_PARTNER_ID, null, "join");
				}
				publishLive();
				resume();
				return reply({
					whileAwayNote:
						"While you were away: Riley ran the router unit tests (42 passed) and Sam logged the retry-guard decision.",
				});
			}
			case "call_leave": {
				const participantId =
					readString(payload, "participantId") ?? DEMO_HUMAN_ID;
				commit({
					schemaVersion: 1,
					type: "control.leave",
					track: "control",
					id: nextEventId(),
					roomId: DEMO_ROOM_ID,
					at,
					actorId: participantId,
					callSessionId: DEMO_CALL_SESSION_ID,
					participantId,
					reason: readString(payload, "reason") ?? "left",
				});
				publishLive();
				return reply();
			}
			case "call_end": {
				commit({
					schemaVersion: 1,
					type: "control.end",
					track: "control",
					id: nextEventId(),
					roomId: DEMO_ROOM_ID,
					at,
					actorId: readString(payload, "actorId") ?? DEMO_HUMAN_ID,
					callSessionId: DEMO_CALL_SESSION_ID,
					reason: readString(payload, "reason") ?? "ended",
				});
				pause();
				live = {
					...live,
					spotlightParticipantId: null,
					director: {
						...live.director,
						activeShowId: null,
						activeBeatId: null,
					},
					version: live.version + 1,
				};
				publishLive();
				return reply({
					ended: true,
					handoffNarration:
						"Stopping here. The retry guard is in scheduleRetry, tests are green, and the decision is logged for whoever picks this up next.",
				});
			}
			case "call_mute": {
				const participantId = readString(payload, "participantId");
				if (!participantId || typeof payload.muted !== "boolean") {
					throw demoError(
						"invalid_payload",
						"participantId and muted are required",
					);
				}
				commit({
					schemaVersion: 1,
					type: "control.mute",
					track: "control",
					id: nextEventId(),
					roomId: DEMO_ROOM_ID,
					at,
					actorId: participantId,
					participantId,
					muted: payload.muted,
				});
				live = {
					...live,
					participantAudio: live.participantAudio.map((flags) =>
						flags.participantId === participantId
							? { ...flags, muted: payload.muted === true }
							: flags,
					),
					version: live.version + 1,
				};
				publishLive();
				return reply();
			}
			case "call_raise_hand": {
				const participantId = readString(payload, "participantId");
				if (!participantId || typeof payload.raised !== "boolean") {
					throw demoError(
						"invalid_payload",
						"participantId and raised are required",
					);
				}
				commit({
					schemaVersion: 1,
					type: "control.raise_hand",
					track: "control",
					id: nextEventId(),
					roomId: DEMO_ROOM_ID,
					at,
					actorId: participantId,
					participantId,
					raised: payload.raised,
				});
				return reply();
			}
			case "call_rename_participant": {
				const participantId = readString(payload, "participantId");
				const displayName = readString(payload, "displayName");
				if (!participantId || !displayName) {
					throw demoError(
						"invalid_payload",
						"participantId and displayName are required",
					);
				}
				commit({
					schemaVersion: 1,
					type: "control.rename",
					track: "control",
					id: nextEventId(),
					roomId: DEMO_ROOM_ID,
					at,
					actorId: DEMO_HUMAN_ID,
					participantId,
					displayName,
				});
				return reply();
			}
			case "call_set_stage": {
				const sharer = payload.sharer as
					| { kind: "human" | "agent"; participantId: string }
					| null
					| undefined;
				const pin = (payload.pin as StagePin | null | undefined) ?? null;
				if (sharer === null) {
					commit({
						schemaVersion: 1,
						type: "control.stage",
						track: "control",
						id: nextEventId(),
						roomId: DEMO_ROOM_ID,
						at,
						actorId: DEMO_HUMAN_ID,
						sharer: null,
						pin: null,
					});
					return reply();
				}
				if (!sharer || typeof sharer.participantId !== "string") {
					throw demoError("invalid_payload", "sharer is required");
				}
				setSpotlight(sharer.participantId, pin, "human");
				publishLive();
				return reply();
			}
			case "call_set_address": {
				if (!payload.addressSet || typeof payload.addressSet !== "object") {
					throw demoError("invalid_payload", "addressSet is required");
				}
				commit({
					schemaVersion: 1,
					type: "control.address",
					track: "control",
					id: nextEventId(),
					roomId: DEMO_ROOM_ID,
					at,
					actorId: DEMO_HUMAN_ID,
					addressSet: payload.addressSet as RoomSnapshot["addressSet"],
				});
				return reply();
			}
			case "call_set_mode": {
				const subMode = readString(payload, "subMode");
				if (
					subMode !== "plan" &&
					subMode !== "act" &&
					subMode !== "ask" &&
					subMode !== "debug"
				) {
					throw demoError("invalid_payload", "subMode is required");
				}
				commit({
					schemaVersion: 1,
					type: "control.mode",
					track: "control",
					id: nextEventId(),
					roomId: DEMO_ROOM_ID,
					at,
					actorId: DEMO_HUMAN_ID,
					subMode,
					...(typeof payload.driveActive === "boolean"
						? { driveActive: payload.driveActive }
						: {}),
				});
				return reply();
			}
			case "call_seat": {
				const agent = payload.agent as
					| { id?: string; displayName?: string; role?: string }
					| undefined;
				if (!agent?.id || !agent.displayName) {
					throw demoError(
						"invalid_payload",
						"agent.id and agent.displayName are required",
					);
				}
				const role =
					agent.role === "partner" || agent.role === "recorder"
						? agent.role
						: "specialist";
				commit({
					schemaVersion: 1,
					type: "control.join",
					track: "control",
					id: nextEventId(),
					roomId: DEMO_ROOM_ID,
					at,
					actorId: DEMO_HUMAN_ID,
					callSessionId: DEMO_CALL_SESSION_ID,
					participant: {
						id: agent.id,
						kind: "agent",
						displayName: agent.displayName,
						role,
						status: "idle",
						seatSources: [{ kind: "manual" }],
					},
				});
				publishLive();
				return reply();
			}
			case "call_add_roster_pack":
			case "call_remove_roster_pack":
				throw demoError(
					"not_supported",
					"Roster packs are not part of the demo world.",
				);
			default: {
				const _exhaustive: never = op;
				throw demoError(
					"not_supported",
					`Unknown call op ${String(_exhaustive)}`,
				);
			}
		}
	};

	const handleCommand = async (
		command: DriveCommandName,
		payload: DriveCommandPayload,
	): Promise<Record<string, unknown>> => {
		const at = nowIso();
		switch (command) {
			case "drive.room.get":
				return { room: live };
			case "drive.presenter.status":
				return {
					presenter: activePresenterGrant(snapshot, at) ?? null,
					directorPolicy: null,
					snapshot,
				};
			case "drive.presenter.grant": {
				const agentId = readString(payload, "agentId");
				if (!agentId) {
					throw demoError("invalid_payload", "agentId is required");
				}
				const active = activePresenterGrant(snapshot, at);
				if (active && active.agentId !== agentId) {
					throw demoError(
						"presenter_exclusive",
						`${active.agentId} already holds Presenter — transfer instead.`,
					);
				}
				if (!active) {
					commit({
						schemaVersion: 1,
						type: "control.title_granted",
						track: "control",
						id: nextEventId(),
						roomId: DEMO_ROOM_ID,
						at,
						actorId: "demo-host",
						grant: presenterGrant({
							id: `grant-demo-presenter-${seq + 1}`,
							agentId,
							grantedAt: at,
							durationMs:
								typeof payload.durationMs === "number"
									? payload.durationMs
									: 4 * HOUR_MS,
						}),
					});
				}
				setSpotlight(agentId, null, "grant");
				publishLive();
				return {
					presenter: activePresenterGrant(snapshot, at) ?? null,
					snapshot,
					seq,
				};
			}
			case "drive.presenter.transfer": {
				const agentId = readString(payload, "agentId");
				if (!agentId) {
					throw demoError("invalid_payload", "agentId is required");
				}
				const active = activePresenterGrant(snapshot, at);
				if (!active) {
					throw demoError(
						"presenter_missing",
						"No active Presenter to transfer.",
					);
				}
				if (
					!snapshot.participants.some(
						(p) => p.id === agentId && p.kind === "agent",
					)
				) {
					throw demoError("not_seated", `${agentId} is not seated.`);
				}
				const toGrant = presenterGrant({
					id: `grant-demo-presenter-${seq + 1}`,
					agentId,
					grantedAt: at,
					durationMs:
						typeof payload.durationMs === "number"
							? payload.durationMs
							: 4 * HOUR_MS,
				});
				commit({
					schemaVersion: 1,
					type: "control.title_transferred",
					track: "control",
					id: nextEventId(),
					roomId: DEMO_ROOM_ID,
					at,
					actorId: "demo-host",
					title: "presenter",
					fromGrantId: active.id,
					toGrant: { ...toGrant, generation: (active.generation ?? 1) + 1 },
					transferredAt: at,
				});
				setSpotlight(agentId, null, "transfer");
				publishLive();
				return {
					presenter: activePresenterGrant(snapshot, at) ?? null,
					snapshot,
					seq,
				};
			}
			case "drive.presenter.revoke": {
				const active = activePresenterGrant(snapshot, at);
				if (!active) {
					throw demoError(
						"presenter_missing",
						"No active Presenter to revoke.",
					);
				}
				commit({
					schemaVersion: 1,
					type: "control.title_revoked",
					track: "control",
					id: nextEventId(),
					roomId: DEMO_ROOM_ID,
					at,
					actorId: "demo-host",
					grantId: active.id,
					revokedAt: at,
					reason: "revoked",
				});
				live = {
					...live,
					spotlightParticipantId: null,
					director: { ...live.director, spotlightParticipantId: null },
					version: live.version + 1,
				};
				emit({
					event: "drive.spotlight.changed",
					payload: {
						from: active.agentId,
						to: null,
						reason: "revoked",
						via: "presenter",
					},
					timestamp: at,
				});
				publishLive();
				return { presenter: null, snapshot, seq };
			}
			case "drive.spotlight.set": {
				const participantId = readString(payload, "participantId");
				if (!participantId) {
					throw demoError("invalid_payload", "participantId is required");
				}
				setSpotlight(
					participantId,
					null,
					readString(payload, "reason") ?? "human",
				);
				publishLive();
				return { room: live, snapshot };
			}
			case "drive.participant.mute.set": {
				const participantId = readString(payload, "participantId");
				if (!participantId || typeof payload.muted !== "boolean") {
					throw demoError(
						"invalid_payload",
						"participantId and muted are required",
					);
				}
				await handleCall("call_mute", DEMO_ROOM_ID, {
					participantId,
					muted: payload.muted,
				});
				return { room: live };
			}
			case "drive.participant.deafen.set": {
				const participantId = readString(payload, "participantId");
				if (!participantId || typeof payload.deafened !== "boolean") {
					throw demoError(
						"invalid_payload",
						"participantId and deafened are required",
					);
				}
				live = {
					...live,
					participantAudio: live.participantAudio.map((flags) =>
						flags.participantId === participantId
							? { ...flags, deafened: payload.deafened === true }
							: flags,
					),
					version: live.version + 1,
				};
				publishLive();
				return { room: live };
			}
			case "drive.show.present":
			case "drive.show.enqueue": {
				const item = payload.showItem as ShowBacklogItem | undefined;
				if (!item || typeof item.id !== "string") {
					throw demoError(
						"invalid_payload",
						"showItem must be a valid ShowBacklogItem",
					);
				}
				const exists = live.director.showBacklog.some(
					(entry) => entry.id === item.id,
				);
				live = {
					...live,
					director: {
						...live.director,
						showBacklog: exists
							? live.director.showBacklog.map((entry) =>
									entry.id === item.id ? { ...entry, ...item } : entry,
								)
							: [...live.director.showBacklog, item],
					},
					version: live.version + 1,
				};
				emit({
					event: "drive.show.planned",
					payload: {
						showItemId: item.id,
						ownerParticipantId: item.ownerParticipantId,
						status: item.status,
						title: item.title,
						priority: item.priority,
					},
					timestamp: at,
				});
				if (command === "drive.show.present" || payload.presentNow === true) {
					presentShow(item, item.caption);
				}
				publishLive();
				return { room: live };
			}
			case "drive.show.tick": {
				const next = [...live.director.showBacklog]
					.filter(
						(entry) => entry.status === "ready" || entry.status === "planned",
					)
					.sort((a, b) => b.priority - a.priority)[0];
				if (next) {
					presentShow(next, next.caption);
				}
				publishLive();
				return { room: live, presented: next ?? null };
			}
			case "drive.script.advance":
				runBeat();
				return { room: live };
			case "drive.planner.set": {
				const mode = readString(payload, "showPlannerMode");
				live = {
					...live,
					director: {
						...live.director,
						showPlannerMode: mode === "off" ? "off" : "heuristic",
					},
					version: live.version + 1,
				};
				publishLive();
				return { room: live };
			}
			case "drive.script.attach":
			case "drive.do.enqueue":
				return { room: live };
			case "drive.artifacts.list": {
				const roomId = readString(payload, "roomId");
				const tag = readString(payload, "tag");
				const kind = readString(payload, "kind") as
					| ShowArtifactKind
					| undefined;
				const scoped = roomId
					? artifacts.filter((entry) => entry.roomId === roomId)
					: artifacts;
				return {
					artifacts: filterArtifactDirectory(scoped, { kind, tag }),
					tags: artifactDirectoryTags(scoped),
				};
			}
			case "drive.fork.list":
				return { forks: [] };
			case "drive.fork.audit.get":
			case "drive.fork.retain.set":
			case "drive.fork.cancel":
				throw demoError(
					"not_supported",
					"Chat forks are not part of the demo world.",
				);
			default: {
				const _exhaustive: never = command;
				throw demoError(
					"not_supported",
					`Unknown command ${String(_exhaustive)}`,
				);
			}
		}
	};

	const handleStatus = async (
		op: DriveStatusOp,
		payload: DriveCommandPayload,
	): Promise<Record<string, unknown>> => {
		const updates = STATUS_BOARD_DEMO_UPDATES;
		switch (op) {
			case "board":
			case "query":
				return {
					updates,
					nextCursor: null,
					hasMore: false,
					total: updates.length,
					tagFacets: [],
					ftsAvailable: false,
				};
			case "summary":
				return { summary: summarize(updates, nowIso()) };
			case "current": {
				const subject = readString(payload, "subject");
				return {
					update: updates.find((update) => update.subject === subject) ?? null,
				};
			}
			case "subjects":
				return { subjects: updates.map((update) => update.subject) };
			case "tasks_snapshot":
				return {
					teams: await new DrivePlansDemoTeamsSource().loadTeams(),
					annotations:
						await new DrivePlansDemoAnnotationsSource().loadAnnotations(),
				};
			default: {
				const _exhaustive: never = op;
				throw demoError(
					"not_supported",
					`Unknown status op ${String(_exhaustive)}`,
				);
			}
		}
	};

	const rooms = (): DriveRoomsListReply => {
		const nowMs = now().getTime();
		const liveEntry = projectRoomDirectoryEntry({
			roomId: DEMO_ROOM_ID,
			events: log,
			liveSnapshot: snapshot,
		});
		const entries: DriveRoomDirectoryEntry[] = [
			liveEntry,
			{
				roomId: "auth-migration",
				status: "paused",
				createdAt: new Date(nowMs - 5 * HOUR_MS).toISOString(),
				updatedAt: new Date(nowMs - 3 * HOUR_MS).toISOString(),
				subMode: "plan",
				addressMode: "agents",
				participantNames: [],
				cardCount: 2,
				eventCount: 31,
			},
			{
				roomId: "docs-refresh",
				status: "ended",
				createdAt: new Date(nowMs - 27 * HOUR_MS).toISOString(),
				updatedAt: new Date(nowMs - 25 * HOUR_MS).toISOString(),
				subMode: "act",
				addressMode: "everyone",
				participantNames: [],
				cardCount: 3,
				eventCount: 58,
			},
		];
		return { rooms: sortRoomDirectory(entries) };
	};

	function pause(): void {
		paused = true;
		stopTimer();
	}

	function resume(): void {
		if (disposed) {
			return;
		}
		paused = false;
		startTimer();
	}

	const source: DemoDriveSource = {
		kind: "demo",
		get paused() {
			return paused;
		},
		get beatIndex() {
			return beatIndex;
		},
		pause,
		resume,
		tick: () => runBeat(),
		snapshot: () => snapshot,
		hubStatus: async (): Promise<DriveHubStatus> => ({
			connected: true,
			url: DEMO_HUB_URL,
			error: null,
			workspaceRoot: DEMO_WORKSPACE_ROOT,
		}),
		call: (op, roomId, payload = {}) => handleCall(op, roomId, payload),
		listRooms: async () => rooms(),
		command: <T>(
			command: DriveCommandName,
			payload: DriveCommandPayload = {},
		) => handleCommand(command, payload) as Promise<T>,
		status: <T>(op: DriveStatusOp, payload: DriveCommandPayload = {}) =>
			handleStatus(op, payload) as Promise<T>,
		bank: async <T>(op: string) => {
			if (op !== "get") {
				throw demoError("not_supported", "The demo bank is read-only.");
			}
			return {
				snapshot: {
					activePlanId: "plan-router-fix",
					openTaskIds: ["task-guard", "task-tests", "task-commit"],
					nowTaskId: "task-tests",
					nextTaskId: "task-commit",
					nowTitle: "running router unit tests",
					nextTitle: "explain the race, then commit",
					nowLastFailure: null,
				},
			} as T;
		},
		sessionRollups: async (
			request: DriveSessionRollupsRequest = {},
		): Promise<DriveSessionRollupsReply> => ({
			sessions: await new DriveSessionsDemoRollupSource().loadSessions(request),
		}),
		agentHome: async <T>(op: string, payload: DriveCommandPayload = {}) => {
			switch (op) {
				case "list":
					return { homes: DEMO_HOMES } as T;
				case "get": {
					const slug = readString(payload, "slug");
					const home = DEMO_HOMES.find((entry) => entry.slug === slug);
					if (!home) {
						throw demoError(
							"home_not_found",
							`No Driveagent home named "${slug ?? ""}".`,
						);
					}
					return {
						home: {
							slug: home.slug,
							agent: {
								name: home.displayName,
								description: home.description,
								editable: home.editable,
							},
						},
						compiled: {
							name: home.displayName,
							description: home.description,
							skills: [...home.skills],
						},
					} as T;
				}
				default:
					throw demoError("not_supported", "Demo agent homes are read-only.");
			}
		},
		agentProfiles: async <T>(op: string, payload: DriveCommandPayload = {}) => {
			if (op === "get") {
				return { profiles: [...profiles.values()] } as T;
			}
			// Mirrors the sidecar: the wire carries the profile without its id
			// (the id is the ref flattened), but a caller that sends one is fine.
			const draft = payload.profile as
				| (Omit<AgentProfile, "id"> & { id?: string })
				| undefined;
			if (!draft?.ref || !draft.nameInk || !draft.bodyInk) {
				throw demoError("invalid_payload", "profile is required");
			}
			const profile: AgentProfile = {
				...draft,
				id: typeof draft.id === "string" ? draft.id : agentProfileId(draft.ref),
			};
			profiles.set(profile.id, profile);
			emit({
				event: "drive.profile.changed",
				payload: { profile },
				timestamp: nowIso(),
			});
			return { profiles: [...profiles.values()] } as T;
		},
		config: async <T>(op: string, payload: DriveCommandPayload = {}) => {
			switch (op) {
				case "get":
					return { facets: DEMO_FACETS, profiles: [...profiles.values()] } as T;
				case "upsert_profile":
					return source.agentProfiles<T>("put", payload);
				default:
					throw demoError("not_supported", "Demo settings are read-only.");
			}
		},
		subscribe: (handler) => {
			handlers.add(handler);
			return () => {
				handlers.delete(handler);
			};
		},
		dispose: () => {
			disposed = true;
			stopTimer();
			handlers.clear();
		},
	};

	return source;
}
