/**
 * The wire fold, mirrored from drive-ios `Sources/WriterClient.swift`.
 *
 * This is a deliberate 1:1 port of `apply(wireEvent:)` and its helpers: the
 * same event names, the same guards, the same TTL arithmetic, the same
 * working-set caps. The point of the demo is to show the phone rendering the
 * writer's real log, so the fold has to agree with the Swift one — if it
 * drifts, the demo stops being evidence of anything.
 *
 * Not ported: the intent/preheat engine, notification scheduling and the
 * eviction of shipped work, none of which are visible on the surfaces below.
 */

const TASK_CAP = 60;
const ARTIFACT_CAP = 40;
const EVENT_TITLE_CAP = 80;

const FALLBACK_INK = ["#9F58FA", "#4C9AFF", "#3FB950", "#D29922", "#F53969"];

/**
 * Agent ink is a *local* palette, exactly as `WriterClient.agentColors` is in
 * Swift. Appearance deliberately does not ride the wire — the roster profile
 * carries it for hosts that want it, but a client must render a stranger it
 * has never seen, so identity colour is derived, never awaited.
 */
const AGENT_INK = {
	"agent:atlas": "#9F58FA",
	"agent:beacon": "#4C9AFF",
	"agent:cinder": "#3FB950",
	"agent:delta": "#D29922",
	"drive:you": "#E6EDF3",
};

const BEAT_KIND = {
	plan: "plan",
	diagram: "diagram",
	edit: "edit",
	run: "command",
	tests: "test",
	decision: "decision",
	result: "metric",
};

/**
 * The stage is only ever held by an agent that holds an active Presenter
 * grant, so when a grant ends the stage goes with it. The writer never emits a
 * `control.stage` for this — the kernel's `reduceRoom` clears the sharer as
 * part of folding the title event, and a client that waits for an explicit
 * stage event will keep showing a revoked agent presenting.
 */
function reconcileStageSharer(state) {
	const sharer = state.stageSharer;
	if (sharer?.kind !== "agent") return;
	for (const grant of state.grantsById.values()) {
		if (grant.agentId === sharer.participantId && grant.state === "active")
			return;
	}
	state.stageSharer = null;
}

export function emptyState() {
	return {
		seq: 0,
		status: "connecting",
		participants: new Map(),
		ink: new Map(),
		runtime: new Map(),
		actorStatus: new Map(),
		eventTitles: new Map(),
		eventOrder: [],
		tasks: new Map(),
		taskOrder: [],
		artifacts: new Map(),
		artifactOrder: [],
		beats: new Map(),
		activeProgramId: null,
		grantsById: new Map(),
		titleLog: [],
		sessions: new Map(),
		activeSessionId: null,
		feed: [],
		stageSharer: null,
		raisedHands: new Set(),
		subMode: "plan",
		driveActive: false,
		addressSet: { mode: "everyone" },
	};
}

export function displayName(id) {
	if (!id) return "Agent";
	const tail = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
	return tail.charAt(0).toUpperCase() + tail.slice(1);
}

function inkFor(state, id) {
	if (AGENT_INK[id]) return AGENT_INK[id];
	if (state.ink.has(id)) return state.ink.get(id);
	let hash = 0;
	for (let i = 0; i < String(id).length; i++)
		hash = (hash * 31 + String(id).charCodeAt(i)) | 0;
	return FALLBACK_INK[Math.abs(hash) % FALLBACK_INK.length];
}

export function relative(at, now = Date.now()) {
	const secs = Math.max(0, Math.floor((now - at) / 1000));
	if (secs < 60) return `${secs}s ago`;
	if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
	return `${Math.floor(secs / 3600)}h ago`;
}

/**
 * Fold one wire event into `state`. Mirrors the Swift switch, including the
 * "unknown types are ignored" default — a client must tolerate a writer that
 * has learned a new event type.
 */
export function applyEvent(state, event) {
	const at = event.at ? Date.parse(event.at) : Date.now();
	const actorId = event.actorId ?? "coder";

	switch (event.type) {
		case "control.join": {
			const p = event.participant;
			if (!p) return;
			state.participants.set(p.id, {
				id: p.id,
				kind: p.kind ?? "agent",
				displayName: p.displayName ?? displayName(p.id),
				role: p.role ?? "partner",
				joinedAt: at,
			});
			return;
		}
		case "control.rename": {
			// Profile updates carry appearance + a sanitized runtime badge only.
			const id = event.participantId ?? actorId;
			const p = state.participants.get(id);
			if (p && event.displayName) p.displayName = event.displayName;
			return;
		}
		case "control.leave": {
			state.participants.delete(event.participantId);
			return;
		}
		case "control.title_granted": {
			const g = event.grant;
			if (!g) return;
			state.grantsById.set(g.id, { ...g, state: "active" });
			state.titleLog.push({
				at,
				kind: "granted",
				agentId: g.agentId,
				grantId: g.id,
			});
			return;
		}
		case "control.title_transferred": {
			const g = event.toGrant;
			if (event.fromGrantId) {
				const prev = state.grantsById.get(event.fromGrantId);
				if (prev) prev.state = "transferred";
			}
			if (g) state.grantsById.set(g.id, { ...g, state: "active" });
			state.titleLog.push({
				at,
				kind: "transferred",
				agentId: g?.agentId,
				grantId: g?.id,
				fromGrantId: event.fromGrantId,
			});
			reconcileStageSharer(state);
			return;
		}
		case "control.title_revoked": {
			const prev = state.grantsById.get(event.grantId);
			if (prev) prev.state = "revoked";
			state.titleLog.push({
				at,
				kind: "revoked",
				grantId: event.grantId,
				reason: event.reason,
			});
			reconcileStageSharer(state);
			return;
		}
		case "control.stage": {
			state.stageSharer = event.sharer ?? null;
			return;
		}
		case "control.mode": {
			if (event.subMode) state.subMode = event.subMode;
			if (typeof event.driveActive === "boolean")
				state.driveActive = event.driveActive;
			return;
		}
		case "control.address": {
			if (event.addressSet) state.addressSet = event.addressSet;
			return;
		}
		case "control.raise_hand": {
			if (event.raised) state.raisedHands.add(event.participantId);
			else state.raisedHands.delete(event.participantId);
			return;
		}
		case "control.interrupt_ack": {
			state.feed.push({
				at,
				actorId,
				kind: "interrupt",
				text: `Interrupt acknowledged — ${event.action ?? "steer"}`,
				intent: event.revise ?? event.action,
			});
			return;
		}
		case "control.invite": {
			state.feed.push({
				at,
				actorId: event.inviterId ?? actorId,
				kind: "invite",
				text: `Invited ${displayName(event.inviteeId)}${event.title ? ` — ${event.title}` : ""}`,
			});
			return;
		}
		case "conversation.message":
		case "conversation.narration": {
			state.feed.push({
				at,
				actorId,
				kind: event.type === "conversation.narration" ? "narration" : "message",
				text: event.text ?? "",
			});
			return;
		}
		case "control.session_created": {
			state.sessions.set(event.sessionId, {
				id: event.sessionId,
				title: event.title ?? "Session",
				project: event.project ?? "",
				participantIds: event.participantIds ?? [],
				note: event.note,
				state: "created",
			});
			return;
		}
		case "control.session_scheduled": {
			const s = state.sessions.get(event.sessionId);
			if (s) {
				s.scheduledFor = event.scheduledFor;
				s.state = "scheduled";
			}
			return;
		}
		case "control.session_started": {
			const s = state.sessions.get(event.sessionId);
			if (s) s.state = "live";
			state.activeSessionId = event.sessionId;
			state.activeProgramId = event.programId ?? state.activeProgramId;
			return;
		}
		case "control.session_ended": {
			const s = state.sessions.get(event.sessionId);
			if (s) {
				s.state = "ended";
				s.outcome = event.outcome;
				s.replayArtifactId = event.replayArtifactId;
			}
			if (state.activeSessionId === event.sessionId)
				state.activeSessionId = null;
			return;
		}
		case "work.generic":
		case "work.edit":
		case "work.command":
		case "work.test_result":
		case "work.plan_step":
		case "work.decision":
			break;
		default:
			return;
	}

	// --- work events ---------------------------------------------------
	// `work.generic` nests the pack payload under `payload`; the native work
	// types (edit, command, test_result, plan_step, decision) carry their
	// fields at the top level. One accessor covers both.
	const payload = event.payload ?? event;
	const kind = event.kind ?? event.type;

	const line =
		payload.title ??
		payload.summary ??
		payload.path ??
		payload.command ??
		payload.label;
	if (line) {
		state.actorStatus.set(actorId, { line, at });
		if (event.id) {
			if (!state.eventTitles.has(event.id)) state.eventOrder.push(event.id);
			state.eventTitles.set(
				event.id,
				payload.summary ? `${line} — ${payload.summary}` : line,
			);
			if (state.eventTitles.size > EVENT_TITLE_CAP) {
				const victim = state.eventOrder.shift();
				state.eventTitles.delete(victim);
			}
		}
	}

	switch (kind) {
		case "work.task.created": {
			const { taskId, title, project } = payload;
			if (!taskId || !title || !project) return;
			if (!state.tasks.has(taskId)) state.taskOrder.push(taskId);
			state.tasks.set(taskId, {
				id: taskId,
				title,
				room: project,
				agentName: displayName(actorId),
				agentColor: inkFor(state, actorId),
				state: payload.state ?? "queued",
				deps: payload.deps ?? [],
				progress: 0,
				at,
			});
			while (state.taskOrder.length > TASK_CAP)
				state.tasks.delete(state.taskOrder.shift());
			return;
		}
		case "work.task.progress": {
			const t = state.tasks.get(payload.taskId);
			if (t && typeof payload.progress === "number") {
				t.progress = payload.progress;
				t.at = at;
			}
			return;
		}
		case "work.task.state": {
			const t = state.tasks.get(payload.taskId);
			if (t && payload.state) {
				t.state = payload.state;
				if (payload.summary) t.detail = payload.summary;
				t.at = at;
			}
			return;
		}
		case "work.artifact.created": {
			const { artifactId, title } = payload;
			if (!artifactId || !title || !payload.kind) return;
			// TTLs run on a real clock: days left = ttl − age, floored at 0.
			const ttl = payload.life?.ttlDays;
			const life =
				typeof ttl === "number"
					? {
							kind: "ephemeral",
							daysLeft: Math.max(
								0,
								ttl - Math.floor((Date.now() - at) / 86_400_000),
							),
						}
					: { kind: "permanent" };
			if (!state.artifacts.has(artifactId))
				state.artifactOrder.push(artifactId);
			state.artifacts.set(artifactId, {
				id: artifactId,
				title,
				kind: payload.kind,
				repo: payload.repo ?? "drive-mode",
				agentName: displayName(actorId),
				agentColor: inkFor(state, actorId),
				sizeKB: payload.sizeKb ?? 0,
				meta: payload.summary ?? payload.kind,
				life,
				at,
				status: "live",
			});
			while (state.artifactOrder.length > ARTIFACT_CAP)
				state.artifacts.delete(state.artifactOrder.shift());
			return;
		}
		case "work.artifact.superseded": {
			const a = state.artifacts.get(payload.artifactId);
			if (a) {
				a.status = "superseded";
				a.supersededBy = payload.supersededBy;
			}
			return;
		}
		case "work.artifact.lifecycle": {
			const a = state.artifacts.get(payload.artifactId);
			if (a) a.status = payload.action;
			return;
		}
		case "work.direction.beat": {
			const { beatIndex, title } = payload;
			if (typeof beatIndex !== "number" || !title || !payload.kind) return;
			const programId = payload.programId ?? "legacy";
			const directorId = payload.directorId ?? actorId;
			state.beats.set(`${programId}#${beatIndex}`, {
				id: beatIndex,
				programId,
				kind: BEAT_KIND[payload.kind] ?? "plan",
				title,
				director: displayName(directorId),
				directorColor: inkFor(state, directorId),
				caption: payload.caption ?? title,
				steps: payload.steps ?? [],
				accent: payload.accent ?? [],
				at,
			});
			if (!state.activeProgramId) state.activeProgramId = programId;
			return;
		}
		default:
			return;
	}
}

/** Beats of the active program, in index order — the room's replayable program. */
export function programBeats(state) {
	return [...state.beats.values()]
		.filter(
			(b) => !state.activeProgramId || b.programId === state.activeProgramId,
		)
		.sort((a, b) => a.id - b.id);
}

export function orderedTasks(state) {
	return state.taskOrder.map((id) => state.tasks.get(id)).filter(Boolean);
}

export function orderedArtifacts(state) {
	return state.artifactOrder
		.map((id) => state.artifacts.get(id))
		.filter(Boolean);
}

export function activeGrant(state) {
	for (const g of state.grantsById.values()) if (g.state === "active") return g;
	return null;
}
