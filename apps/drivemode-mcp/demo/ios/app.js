/**
 * The Drive iOS client surfaces, driven by the live writer.
 *
 * Polling mirrors `WriterClient.pollWire()`: one `events_since` call carrying
 * a strictly-after cursor, an adaptive cadence, and a resync-from-zero when
 * `latestSeq` goes backwards (a restarted writer). Events are keyed by id, so
 * a replay lands idempotently.
 */

import {
	activeGrant,
	applyEvent,
	displayName,
	emptyState,
	orderedArtifacts,
	orderedTasks,
	programBeats,
	relative,
} from "./fold.js";

const el = (id) => document.getElementById(id);
const esc = (s) =>
	String(s ?? "").replace(
		/[&<>"]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
	);

let state = emptyState();
let surface = "spotlight";
let beatCursor = 0;
let lastEventAt = Date.now();

/** Adaptive cadence, mirroring the Swift tiers. */
function cadenceMs() {
	if (state.activeSessionId) return 1000;
	if (surface === "work") return 1500;
	if (Date.now() - lastEventAt > 60_000) return 8000;
	return 3000;
}

async function poll() {
	try {
		const res = await fetch("/rpc", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				tool: "events_since",
				args: { sinceSeq: state.seq },
			}),
		});
		const { result } = await res.json();

		if (result.latestSeq < state.seq) {
			// The writer restarted with a fresh log — our strictly-after cursor
			// would never see it. Resync from the top.
			state = emptyState();
			beatCursor = 0;
			return;
		}
		for (const entry of result.events) applyEvent(state, entry.event);
		if (result.events.length) {
			lastEventAt = Date.now();
			beatCursor = Math.max(0, programBeats(state).length - 1);
		}
		state.seq = Math.max(state.seq, result.latestSeq);
		state.status = "live";
	} catch {
		state.status = "offline";
	}
	render();
}

// ---------------------------------------------------------------- surfaces

function avatar(id, size = 26) {
	const name = state.participants.get(id)?.displayName ?? displayName(id);
	const isHuman = state.participants.get(id)?.kind === "human";
	const ink = inkOf(id);
	const initials = name.slice(0, 1).toUpperCase();
	return `<span class="av ${isHuman ? "human" : "bot"}" style="--ink:${ink};width:${size}px;height:${size}px;font-size:${size * 0.42}px">${
		isHuman ? esc(initials) : botMark(ink, size)
	}</span>`;
}

/** The agent mark, converted from the hub icon — agents wear it, humans keep initials. */
function botMark(ink, size) {
	const s = Math.round(size * 0.58);
	return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
		<rect x="3" y="6" width="18" height="13" rx="5" fill="${ink}"/>
		<circle cx="9" cy="12.5" r="1.9" fill="#0A0A0A"/><circle cx="15" cy="12.5" r="1.9" fill="#0A0A0A"/>
		<rect x="11.1" y="1.8" width="1.8" height="4" rx="0.9" fill="${ink}"/>
	</svg>`;
}

function inkOf(id) {
	const map = {
		"agent:atlas": "#9F58FA",
		"agent:beacon": "#4C9AFF",
		"agent:cinder": "#3FB950",
		"agent:delta": "#D29922",
		"drive:you": "#E6EDF3",
	};
	return map[id] ?? "#8B949E";
}

function spotlight() {
	const beats = programBeats(state);
	const sharer = state.stageSharer?.participantId;
	const grant = activeGrant(state);

	if (!beats.length) {
		return `<div class="empty"><div class="empty-mark">◎</div>
			<div class="empty-title">Stage is quiet</div>
			<div class="empty-sub">Agents publish typed work; the director choreographs it into beats.</div></div>`;
	}

	const i = Math.min(beatCursor, beats.length - 1);
	const b = beats[i];

	return `
	<div class="stage">
		<div class="stage-head">
			<span class="kind kind-${b.kind}">${esc(b.kind)}</span>
			<span class="beat-count">beat ${i + 1} of ${beats.length}</span>
		</div>
		<h2 class="stage-title">${esc(b.title)}</h2>
		<div class="stage-steps">
			${b.steps
				.map(
					(s, idx) =>
						`<div class="step ${b.accent.includes(idx) ? "accent" : ""}">${esc(s)}</div>`,
				)
				.join("")}
		</div>
		<div class="stage-caption">
			${avatar(sharer ?? "agent:atlas", 22)}
			<span>${esc(b.caption)}</span>
		</div>
		<div class="rail">${beats
			.map(
				(_, idx) =>
					`<i class="${idx === i ? "on" : idx < i ? "past" : ""}"></i>`,
			)
			.join("")}</div>
	</div>
	<div class="presenter-strip">
		${
			grant
				? `${avatar(grant.agentId, 22)}<div><b>${esc(displayName(grant.agentId))}</b> holds Presenter
					<span class="muted">· ${esc(grant.scope?.kind ?? "session")} scope · expires ${new Date(grant.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>`
				: `<span class="muted">No active Presenter — the stage is unclaimed.</span>`
		}
	</div>
	<div class="note">The Spotlight never streams pixels. Every line above is a typed event the writer holds.</div>`;
}

function work() {
	const tasks = orderedTasks(state);
	if (!tasks.length)
		return `<div class="empty"><div class="empty-sub">No tasks yet.</div></div>`;
	return `<div class="list">${tasks
		.map(
			(t) => `
		<div class="row">
			<div class="row-top">
				<span class="state s-${t.state}">${esc(t.state)}</span>
				<span class="row-title">${esc(t.title)}</span>
			</div>
			<div class="row-meta">
				${avatar(`agent:${t.agentName.toLowerCase()}`, 18)}
				<span>${esc(t.agentName)}</span><span class="dot">·</span><span>${esc(t.room)}</span>
				${t.deps.length ? `<span class="dot">·</span><span class="deps">needs ${t.deps.map(esc).join(", ")}</span>` : ""}
			</div>
			${t.progress ? `<div class="bar"><i style="width:${Math.round(t.progress * 100)}%"></i></div>` : ""}
		</div>`,
		)
		.join("")}</div>`;
}

function artifacts() {
	const items = orderedArtifacts(state);
	if (!items.length)
		return `<div class="empty"><div class="empty-sub">No artifacts yet.</div></div>`;
	return `<div class="list">${items
		.map(
			(a) => `
		<div class="row">
			<div class="row-top">
				<span class="kind kind-${esc(a.kind)}">${esc(a.kind)}</span>
				<span class="row-title ${a.status === "superseded" ? "struck" : ""}">${esc(a.title)}</span>
			</div>
			<div class="row-meta">
				${avatar(`agent:${a.agentName.toLowerCase()}`, 18)}
				<span>${esc(a.agentName)}</span><span class="dot">·</span><span>${esc(a.repo)}</span>
				${a.sizeKB ? `<span class="dot">·</span><span>${a.sizeKB} KB</span>` : ""}
			</div>
			<div class="row-meta">
				<span class="life ${a.life.kind}">${
					a.life.kind === "permanent"
						? "keeps until superseded"
						: `files in ${a.life.daysLeft}d`
				}</span>
				${a.status !== "live" ? `<span class="status-chip">${esc(a.status)}</span>` : ""}
			</div>
		</div>`,
		)
		.join("")}</div>`;
}

function agents() {
	const people = [...state.participants.values()];
	return `<div class="list">${people
		.map((p) => {
			const st = state.actorStatus.get(p.id);
			const grant = [...state.grantsById.values()].find(
				(g) => g.agentId === p.id && g.state === "active",
			);
			return `
			<div class="row">
				<div class="row-top">
					${avatar(p.id, 30)}
					<div>
						<div class="row-title">${esc(p.displayName)}${grant ? ` <span class="title-chip">Presenter</span>` : ""}</div>
						<div class="row-meta"><span>${esc(p.role)}</span><span class="dot">·</span><span>${p.kind === "human" ? "human" : "agent"}</span></div>
					</div>
				</div>
				${st ? `<div class="status-line">${esc(st.line)}<span class="muted"> · ${esc(relative(st.at))}</span></div>` : ""}
			</div>`;
		})
		.join("")}
		<div class="note">Runtime badges would show an allowlisted model <i>family</i> and location only. Prompts, tool allowlists, endpoints, keys and model ids never cross to the phone.</div></div>`;
}

function activity() {
	const rows = [
		...state.titleLog.map((t) => ({
			at: t.at,
			text:
				t.kind === "granted"
					? `Presenter granted to ${displayName(t.agentId)}`
					: t.kind === "transferred"
						? `Presenter transferred to ${displayName(t.agentId)}`
						: `Presenter revoked (${t.reason ?? "revoked"})`,
			tag: "title",
		})),
		...state.feed.map((f) => ({
			at: f.at,
			text: f.text,
			tag: f.kind,
			actorId: f.actorId,
		})),
		...[...state.sessions.values()].map((s) => ({
			at: 0,
			text: `Session "${s.title}" — ${s.state}${s.outcome ? ` (${s.outcome})` : ""}`,
			tag: "session",
		})),
	].sort((a, b) => a.at - b.at);

	return `<div class="list">${rows
		.map(
			(r) => `<div class="ev">
				<span class="tag tag-${esc(r.tag)}">${esc(r.tag)}</span>
				<span>${r.actorId ? avatar(r.actorId, 18) : ""} ${esc(r.text)}</span>
			</div>`,
		)
		.join("")}</div>`;
}

const SURFACES = { spotlight, work, artifacts, agents, activity };

function render() {
	const grant = activeGrant(state);
	el("statusdot").className = `dot-${state.status}`;
	el("statustext").textContent =
		state.status === "live"
			? `live · seq ${state.seq}`
			: state.status === "offline"
				? "Reconnecting to your fleet"
				: "connecting";
	el("submode").textContent = state.driveActive ? state.subMode : "idle";
	el("body").innerHTML = SURFACES[surface]();
	el("presenter-pill").innerHTML = grant
		? `${avatar(grant.agentId, 18)} ${esc(displayName(grant.agentId))}`
		: `<span class="muted">unclaimed</span>`;
	for (const tab of document.querySelectorAll(".tab"))
		tab.classList.toggle("on", tab.dataset.surface === surface);
}

const SURFACE_ORDER = ["spotlight", "work", "artifacts", "agents", "activity"];

function show(next) {
	if (!SURFACE_ORDER.includes(next)) return;
	surface = next;
	render();
}

for (const tab of document.querySelectorAll(".tab")) {
	tab.addEventListener("click", () => show(tab.dataset.surface));
}

/**
 * Swipe between root surfaces, as the app does — the tab bar and a horizontal
 * swipe are the same navigation. (In the app this is root-surfaces-only; a
 * pushed view keeps edge-swipe-back for itself. Every surface here is a root
 * one, so they all swipe.)
 *
 * Threshold and the horizontal-intent check exist so a swipe cannot fire while
 * the user is really scrolling a long list vertically.
 */
const SWIPE_MIN_X = 55;
let swipeFrom = null;

const body = el("body");
body.addEventListener(
	"pointerdown",
	(event) => {
		swipeFrom = { x: event.clientX, y: event.clientY };
	},
	{ passive: true },
);
body.addEventListener(
	"pointerup",
	(event) => {
		if (!swipeFrom) return;
		const dx = event.clientX - swipeFrom.x;
		const dy = event.clientY - swipeFrom.y;
		swipeFrom = null;
		if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dx) <= Math.abs(dy)) return;
		const at = SURFACE_ORDER.indexOf(surface);
		// Swiping left moves forward, the way a paged tab view does.
		show(SURFACE_ORDER[at + (dx < 0 ? 1 : -1)] ?? surface);
	},
	{ passive: true },
);
body.addEventListener("pointercancel", () => {
	swipeFrom = null;
});

window.driveDemo = {
	go(next) {
		show(next);
	},
	surfaces: () => [...SURFACE_ORDER],
	current: () => surface,
	beat(i) {
		beatCursor = i;
		render();
	},
	beatCount: () => programBeats(state).length,
};

render();
(async function loop() {
	for (;;) {
		await poll();
		await new Promise((r) => setTimeout(r, cadenceMs()));
	}
})();
