/**
 * The end-to-end Drive Mode demo scenario.
 *
 * A human steers a fleet of four agents shipping one change. Every step below
 * is a real MCP tool call against the running writer — the same calls Cursor,
 * Claude Desktop or Claude Code make over stdio. Nothing is faked into the UI:
 * the viewer, the hub and the iOS client all render whatever the writer's
 * event log says, and that log is built only by these calls.
 *
 * The scenario is organised into chapters so a recorder can caption them and
 * so a reader can find the primitive they care about.
 */

import { inMinutes, rpc, sleep } from "./rpc.mjs";

const HUMAN = "drive:you";
const ATLAS = "agent:atlas";
const BEACON = "agent:beacon";
const CINDER = "agent:cinder";
const DELTA = "agent:delta";

const SESSION = "ses_presenter_audit";
const PROGRAM = "prog_presenter_audit";

/**
 * Pacing: shorter in CI/smoke runs, roomier when recording video.
 *
 * Read at call time rather than at import. Captured in a module-scope const it
 * would freeze whatever `DEMO_PACE_MS` happened to be when the module was
 * first imported — which is how `--pace` came to be silently ignored.
 */
const beat = (mult = 1) =>
	sleep(Number(process.env.DEMO_PACE_MS ?? 900) * mult);

let beatIndex = 0;

/** Publish a direction beat — the choreography layer the phone reads. */
async function direction(kind, title, caption, steps, accent = []) {
	await rpc("stage_publish_work", {
		packId: "direction",
		type: "work.direction.beat",
		actorId: ATLAS,
		payload: {
			programId: PROGRAM,
			beatIndex: beatIndex++,
			kind,
			title,
			directorId: ATLAS,
			caption,
			steps,
			accent,
			durationSec: 6,
		},
	});
}

/**
 * Chapters are exported individually so the recorder can drive them one at a
 * time and caption each, and so `--chapter` can replay just one in isolation.
 */
export const chapters = [
	{
		id: "lobby",
		title: "The room opens",
		blurb:
			"A human and four agents join. Profiles carry an appearance and a sanitized runtime badge — never a model id, endpoint or key.",
		async run() {
			await rpc("room_join", {
				id: HUMAN,
				kind: "human",
				displayName: "You",
				role: "host",
			});
			await beat();

			const fleet = [
				[ATLAS, "Atlas", "partner", "claude", "host", "#9F58FA"],
				[BEACON, "Beacon", "specialist", "codex", "managed", "#4C9AFF"],
				[CINDER, "Cinder", "specialist", "cline", "host", "#3FB950"],
				[DELTA, "Delta", "recorder", "cline", "device", "#D29922"],
			];
			for (const [id, name, role, family, location, ink] of fleet) {
				await rpc("room_join", { id, kind: "agent", displayName: name, role });
				await rpc("roster_set_profile", {
					participantId: id,
					displayName: name,
					ink,
					runtimeFamily: family,
					executionLocation: location,
					actorId: HUMAN,
				});
				await beat(0.5);
			}

			await rpc("conversation_publish", {
				actorId: HUMAN,
				text: "Morning. We're shipping the Presenter audit trail today.",
			});
			await beat();
		},
	},

	{
		id: "session",
		title: "A session is scheduled and started",
		blurb:
			"Sessions are typed lifecycle events, so a phone can show what's next and set a reminder without a second source of truth.",
		async run() {
			await rpc("mode_set", {
				subMode: "plan",
				driveActive: true,
				actorId: HUMAN,
			});
			await beat(0.5);

			await rpc("session_create", {
				sessionId: SESSION,
				organizerId: HUMAN,
				title: "Presenter audit trail",
				project: "cline-drivecode",
				participantIds: [HUMAN, ATLAS, BEACON, CINDER, DELTA],
				note: "Grant, transfer and revoke must all leave a reviewable trail.",
			});
			await beat(0.5);

			await rpc("session_schedule", {
				sessionId: SESSION,
				scheduledFor: inMinutes(2),
				actorId: HUMAN,
			});
			await beat(0.5);

			await rpc("session_start", {
				sessionId: SESSION,
				programId: PROGRAM,
				actorId: HUMAN,
			});
			await beat();
		},
	},

	{
		id: "presenter",
		title: "Presenter is granted",
		blurb:
			"Presenter is a temporary, exclusive, revocable title. The grant authorizes stage.present and nothing else — it never carries skill or prompt contents.",
		async run() {
			await rpc("title_grant", {
				grantId: "grant_atlas_1",
				agentId: ATLAS,
				scopeKind: "session",
				scopeRef: SESSION,
				expiresAt: inMinutes(30),
				actorId: HUMAN,
			});
			await beat(0.5);

			await rpc("stage_set_sharer", {
				participantId: ATLAS,
				kind: "agent",
				actorId: HUMAN,
			});
			await beat(0.5);

			await rpc("conversation_publish", {
				actorId: ATLAS,
				text: "I have the Spotlight. Laying out the plan before I touch anything.",
			});
			await beat();
		},
	},

	{
		id: "taskgraph",
		title: "The task graph",
		blurb:
			"The tasks pack carries identity, project, state and dependency edges — everything a fleet map needs, riding work.generic.",
		async run() {
			await rpc("pack_set", { packId: "tasks" });
			const tasks = [
				["T-1", "Define the audit event shape", []],
				["T-2", "Emit grant / transfer / revoke", ["T-1"]],
				["T-3", "Render the audit panel", ["T-2"]],
				["T-4", "Cover it with tests", ["T-2"]],
			];
			for (const [taskId, title, deps] of tasks) {
				await rpc("stage_publish_work", {
					packId: "tasks",
					type: "work.task.created",
					actorId: ATLAS,
					payload: {
						taskId,
						title,
						project: "cline-drivecode",
						state: "queued",
						deps,
					},
				});
				await beat(0.4);
			}

			await rpc("stage_publish_work", {
				packId: "tasks",
				type: "work.task.state",
				actorId: ATLAS,
				payload: {
					taskId: "T-1",
					state: "running",
					title: "Define the audit event shape",
				},
			});
			await beat(0.5);

			await direction(
				"plan",
				"Plan: four tasks, one dependency spine",
				"Atlas lays out the work before touching a file.",
				[
					"T-1  Define the audit event shape",
					"T-2  Emit grant / transfer / revoke",
					"T-3  Render the audit panel",
					"T-4  Cover it with tests",
				],
				[0],
			);
			await beat();
		},
	},

	{
		id: "coding",
		title: "Typed work lands on the Spotlight",
		blurb:
			"Edits, commands, tests and decisions are typed events — never a pixel stream. That is what makes the stage replayable and phone-sized.",
		async run() {
			await rpc("pack_set", { packId: "coding" });

			await rpc("stage_publish_work", {
				packId: "coding",
				type: "work.plan",
				actorId: ATLAS,
				payload: {
					title: "Audit every title transition",
					status: "in_progress",
					summary:
						"grant, transfer and revoke each append one reviewable record.",
				},
			});
			await beat(0.6);

			await rpc("stage_publish_work", {
				packId: "coding",
				type: "work.decision",
				actorId: ATLAS,
				payload: {
					title: "Where does the audit record live?",
					choice: "Append-only event log",
					options: [
						"Append-only event log",
						"Separate audit table",
						"Client-side ring buffer",
					],
					summary:
						"The log is already the resume cursor; a second store could disagree with it.",
				},
			});
			await beat(0.6);

			await direction(
				"decision",
				"Decision: the log is the audit trail",
				"One source of truth beats a second store that can drift.",
				[
					"Append-only event log",
					"Separate audit table",
					"Client-side ring buffer",
				],
				[0],
			);
			await beat(0.6);

			for (const [path, summary] of [
				[
					"sdk/packages/core/src/hub/clineDriveHost.ts",
					"append a title audit record on grant",
				],
				[
					"sdk/packages/core/src/hub/directorPolicy.ts",
					"carry the actor through revoke",
				],
				["sdk/packages/shared/src/drive/titles.ts", "type the audit record"],
			]) {
				await rpc("stage_publish_work", {
					packId: "coding",
					type: "work.edit",
					actorId: ATLAS,
					payload: { path, summary },
				});
				await beat(0.4);
			}

			await rpc("stage_publish_work", {
				packId: "tasks",
				type: "work.task.progress",
				actorId: ATLAS,
				payload: {
					taskId: "T-2",
					progress: 0.65,
					title: "Emit grant / transfer / revoke",
				},
			});
			await beat(0.5);

			await rpc("stage_publish_work", {
				packId: "coding",
				type: "work.command",
				actorId: ATLAS,
				payload: {
					command: "bun run build:sdk",
					exitCode: 0,
					summary: "8 packages rebuilt",
				},
			});
			await beat(0.6);

			await direction(
				"edit",
				"Three files, one seam",
				"Every transition routes through the host recipe.",
				[
					"clineDriveHost.ts   +34 −6",
					"directorPolicy.ts   +12 −2",
					"titles.ts           +19 −0",
				],
				[0],
			);
			await beat();
		},
	},

	{
		id: "interrupt",
		title: "The human interrupts",
		blurb:
			"Raise hand, then acknowledge with an intent. Steering is a first-class typed event, not a chat message the agent may or may not read.",
		async run() {
			await rpc("interrupt_raise", {
				participantId: HUMAN,
				raised: true,
				actorId: HUMAN,
			});
			await beat(1.2);

			await rpc("conversation_publish", {
				actorId: HUMAN,
				text: "Hold on — revoke has to clear the stage too, not just the grant.",
			});
			await beat(0.6);

			await rpc("interrupt_ack", {
				participantId: HUMAN,
				intent: "redirect",
				gist: "Revoke must clear the agent stage synchronously",
				turnInFlight: true,
				actorId: ATLAS,
			});
			await beat(0.5);

			await rpc("interrupt_raise", {
				participantId: HUMAN,
				raised: false,
				actorId: HUMAN,
			});
			await beat(0.5);

			await rpc("stage_publish_work", {
				packId: "coding",
				type: "work.edit",
				actorId: ATLAS,
				payload: {
					path: "sdk/packages/core/src/hub/clineDriveHost.ts",
					summary: "revoke now clears the agent stage before returning",
				},
			});
			await beat();
		},
	},

	{
		id: "handoff",
		title: "Presenter transfers, atomically",
		blurb:
			"Transfer is one atomic operation: Atlas loses the stage the instant Beacon gains it. Permissions are never unioned across grants.",
		async run() {
			await rpc("address_set", {
				mode: "agents",
				agentIds: [BEACON],
				actorId: HUMAN,
			});
			await beat(0.5);

			await rpc("conversation_publish", {
				actorId: HUMAN,
				text: "Beacon, take the Spotlight and review the diff.",
			});
			await beat(0.6);

			await rpc("title_transfer", {
				fromGrantId: "grant_atlas_1",
				toGrantId: "grant_beacon_1",
				toAgentId: BEACON,
				expiresAt: inMinutes(20),
				actorId: HUMAN,
			});
			await rpc("stage_set_sharer", {
				participantId: BEACON,
				kind: "agent",
				actorId: HUMAN,
			});
			await beat(0.8);

			await rpc("stage_publish_work", {
				packId: "coding",
				type: "work.decision",
				actorId: BEACON,
				payload: {
					title: "Is the revoke path synchronous?",
					choice: "Yes — verified against the fold",
					summary: "Stage clears in the same reduction as the revoke record.",
				},
			});
			await beat(0.6);

			await direction(
				"result",
				"Review: revoke clears the stage",
				"Beacon confirmed the fold order — no window where a revoked agent still presents.",
				["grant   → audited", "transfer → atomic", "revoke  → clears stage"],
				[2],
			);
			await beat();
		},
	},

	{
		id: "tests",
		title: "Verification",
		blurb:
			"Test results are typed too, so a red run is a first-class stage card rather than a line of scrollback.",
		async run() {
			await rpc("address_set", { mode: "everyone", actorId: HUMAN });
			await rpc("title_transfer", {
				fromGrantId: "grant_beacon_1",
				toGrantId: "grant_cinder_1",
				toAgentId: CINDER,
				expiresAt: inMinutes(20),
				actorId: HUMAN,
			});
			await rpc("stage_set_sharer", {
				participantId: CINDER,
				kind: "agent",
				actorId: HUMAN,
			});
			await beat(0.5);

			await rpc("stage_publish_work", {
				packId: "coding",
				type: "work.test",
				actorId: CINDER,
				payload: { label: "title grant appends an audit record", passed: true },
			});
			await beat(0.4);

			await rpc("stage_publish_work", {
				packId: "coding",
				type: "work.test",
				actorId: CINDER,
				payload: {
					label: "revoke clears the agent stage",
					passed: false,
					summary: "stage still held one card after revoke",
				},
			});
			await beat(0.9);

			await rpc("stage_publish_work", {
				packId: "coding",
				type: "work.edit",
				actorId: CINDER,
				payload: {
					path: "sdk/packages/core/src/hub/clineDriveHost.ts",
					summary: "clear cards, not just the sharer",
				},
			});
			await beat(0.5);

			await rpc("stage_publish_work", {
				packId: "coding",
				type: "work.test",
				actorId: CINDER,
				payload: {
					label: "revoke clears the agent stage",
					passed: true,
					summary: "green on re-run",
				},
			});
			await beat(0.5);

			await rpc("stage_publish_work", {
				packId: "coding",
				type: "work.command",
				actorId: CINDER,
				payload: {
					command: "bun test",
					exitCode: 0,
					summary: "19 pass, 0 fail",
				},
			});
			await beat(0.5);

			await rpc("stage_publish_work", {
				packId: "tasks",
				type: "work.task.state",
				actorId: CINDER,
				payload: { taskId: "T-4", state: "done", title: "Cover it with tests" },
			});
			await beat(0.5);

			await direction(
				"tests",
				"Green",
				"One red, one fix, one green — the whole loop stayed on the stage.",
				[
					"title grant appends an audit record",
					"revoke clears the agent stage",
					"bun test  19 pass  0 fail",
				],
				[2],
			);
			await beat();
		},
	},

	{
		id: "artifacts",
		title: "Artifacts and their lifespan",
		blurb:
			"Purpose decides lifespan: a replay is ephemeral with a TTL, a decision record is permanent until superseded. Archived work is moved, never deleted.",
		async run() {
			await rpc("pack_set", { packId: "artifacts" });
			await rpc("title_transfer", {
				fromGrantId: "grant_cinder_1",
				toGrantId: "grant_delta_1",
				toAgentId: DELTA,
				expiresAt: inMinutes(20),
				actorId: HUMAN,
			});
			await rpc("stage_set_sharer", {
				participantId: DELTA,
				kind: "agent",
				actorId: HUMAN,
			});
			await beat(0.5);

			await rpc("stage_publish_work", {
				packId: "artifacts",
				type: "work.artifact.created",
				actorId: DELTA,
				payload: {
					artifactId: "art_diff_1",
					title: "Presenter audit trail — diff",
					kind: "diff",
					life: { permanent: true },
					sizeKb: 14,
					repo: "cline-drivecode",
				},
			});
			await beat(0.5);

			await rpc("stage_publish_work", {
				packId: "artifacts",
				type: "work.artifact.created",
				actorId: DELTA,
				payload: {
					artifactId: "art_replay_1",
					title: "Session replay — presenter handoff",
					kind: "replay",
					life: { ttlDays: 7 },
					sizeKb: 96,
				},
			});
			await beat(0.5);

			await rpc("stage_publish_work", {
				packId: "artifacts",
				type: "work.artifact.superseded",
				actorId: DELTA,
				payload: {
					artifactId: "art_diff_1",
					supersededBy: "art_diff_2",
					title: "Presenter audit trail — diff (v2)",
				},
			});
			await beat(0.5);

			await rpc("stage_publish_work", {
				packId: "artifacts",
				type: "work.artifact.lifecycle",
				actorId: DELTA,
				payload: {
					artifactId: "art_replay_1",
					action: "archived",
					title: "Session replay — presenter handoff",
				},
			});
			await beat();
		},
	},

	{
		id: "ops",
		title: "A different pack, same stage",
		blurb:
			"The kernel never special-cases a pack. Swap the pack and an ops fleet publishes alerts and runbook steps onto the same Spotlight.",
		async run() {
			await rpc("pack_set", { packId: "demo-ops" });
			await rpc("room_invite", {
				inviterId: HUMAN,
				inviteeId: "agent:sentry",
				sessionId: SESSION,
				title: "On-call sweep",
				note: "Latency regression on the writer poll path.",
			});
			await beat(0.6);

			await rpc("stage_publish_work", {
				packId: "demo-ops",
				type: "work.ops.alert",
				actorId: BEACON,
				payload: {
					title: "p95 poll latency above budget",
					severity: "p3",
					service: "drivemode-writer",
					summary: "1.8s against a 1.5s budget on the tasks surface.",
				},
			});
			await beat(0.7);

			await rpc("stage_publish_work", {
				packId: "demo-ops",
				type: "work.ops.runbook_step",
				actorId: BEACON,
				payload: {
					title: "Confirm the adaptive cadence tier",
					step: "1 of 2",
					status: "done",
				},
			});
			await beat(0.5);

			await rpc("stage_publish_work", {
				packId: "demo-ops",
				type: "work.ops.runbook_step",
				actorId: BEACON,
				payload: {
					title: "Cap the working set eviction sweep",
					step: "2 of 2",
					status: "done",
				},
			});
			await beat();
		},
	},

	{
		id: "close",
		title: "Revoke and close",
		blurb:
			"Revoking the title ends authority synchronously and clears the agent's stage. The session ends with a replay artifact anyone can scrub.",
		async run() {
			await rpc("pack_set", { packId: "coding" });
			await rpc("title_revoke", {
				grantId: "grant_delta_1",
				reason: "revoked",
				actorId: HUMAN,
			});
			await beat(0.6);

			await rpc("stage_publish_work", {
				packId: "tasks",
				type: "work.task.state",
				actorId: ATLAS,
				payload: {
					taskId: "T-3",
					state: "done",
					title: "Render the audit panel",
				},
			});
			await beat(0.4);

			await rpc("conversation_publish", {
				actorId: HUMAN,
				text: "Good run. Ship it.",
			});
			await beat(0.5);

			await rpc("session_end", {
				sessionId: SESSION,
				outcome: "completed",
				replayArtifactId: "art_replay_1",
				actorId: HUMAN,
			});
			await beat();
		},
	},
];

/**
 * Which phone surface each chapter is really about.
 *
 * This belongs to the story, not the rig: the recorder presses the phone's tab
 * bar to bring the named surface up before the chapter runs, so a chapter about
 * artifacts is watched on the Artifacts surface. A scenario that omits an id
 * simply leaves the phone where it was.
 */
export const phoneSurface = {
	lobby: "agents",
	session: "activity",
	presenter: "spotlight",
	taskgraph: "work",
	coding: "spotlight",
	interrupt: "activity",
	handoff: "spotlight",
	tests: "spotlight",
	artifacts: "artifacts",
	ops: "spotlight",
	close: "activity",
};

export async function runAll({ onChapter } = {}) {
	for (const chapter of chapters) {
		if (onChapter) await onChapter(chapter);
		await chapter.run();
	}
}
