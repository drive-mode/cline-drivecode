#!/usr/bin/env bun
/**
 * One-shot seed: Phase 0–4 TASK-GRAPH (+ meta hygiene cards) into ~/.cline/kanban
 * for the cline-drivecode workspace. Board state is not committed to git.
 *
 * Usage: bun scripts/seed-drive-kanban.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const REPO = resolve(import.meta.dir, "..");
const NEST = "docs/drivecode/plans/cline-drivemode";
const FEATURE = (name) => `${NEST}/features/${name}.md`;
const TASK_GRAPH = `${NEST}/delivery/TASK-GRAPH.md`;
const ADR_BOARD = `${NEST}/adr/ADR-0000-status-board.md`;

const now = Date.now();
const shortId = () => randomUUID().replaceAll("-", "").slice(0, 5);

function card(key, title, prompt, { startInPlanMode = false } = {}) {
	return {
		key,
		id: shortId(),
		title,
		prompt,
		startInPlanMode,
		autoReviewEnabled: false,
		baseRef: "main",
		createdAt: now,
		updatedAt: now,
	};
}

function drvPrompt(phase, name, extra = "") {
	const path = FEATURE(name);
	return [
		`Implement ${name} for Drive mode Phase ${phase}.`,
		`Read acceptance criteria and agent tasks in: ${path}`,
		`Phase contract: ${TASK_GRAPH}`,
		`Constraints: ADR/DEC board ${ADR_BOARD}; hub single-writer with discovery (no hard-coded bind); no second daemon on :7891; Bun only.`,
		`Do not start until linked dependency cards are Done.`,
		extra,
	]
		.filter(Boolean)
		.join("\n");
}

function gatePrompt(phase, body) {
	return [
		`Phase ${phase} gate — verify the gate checklist from ${TASK_GRAPH}.`,
		body,
		`Record results; leave evidence in the card session. Do not start later-phase work until this gate is Done.`,
	].join("\n");
}

/** @type {Array<{key:string,id:string,title:string,prompt:string,startInPlanMode:boolean,autoReviewEnabled:boolean,baseRef:string,createdAt:number,updatedAt:number}>} */
const cards = [];

// Meta (completed in this rename/hygiene effort — seeded Done)
cards.push(
	card(
		"META-ADR",
		"Meta · ARD→ADR rename + CI",
		`Rename Architecture Decision Records from ARD to ADR across cline-drivecode: folder ard/→adr/, files ADR-NNNN-slug.md, CI check-drivecode-structure, glossary/STRUCTURE/AGENTS, code comment citations. Verify with bun run check:drivecode-docs and bun run test:drivecode-docs.`,
	),
	card(
		"META-HYGIENE",
		"Meta · Nest terminology hygiene",
		`Same effort as ADR rename: fix DRV-ADR stale docs/adr paths, TASK-GRAPH relatives, port discovery wording (preferred default + discovery; keep no-:7891), drive-wireframes link text, share-and-router ADR links, skill/glossary prose.`,
	),
);

// Phase 0
const p0 = [
	"DRV-ADR",
	"DRV-EVENTS",
	"DRV-KERNEL",
	"DRV-HOOK-POLICY",
	"DRV-PRIVACY",
	"DRV-PLATFORM-CONFIG",
	"DRV-DRIVEAGENT-HOME",
	"DRV-GATES",
];
for (const name of p0) {
	cards.push(
		card(`P0-${name}`, `P0 · ${name}`, drvPrompt(0, name, name === "DRV-GATES" ? "Phase 0 scope: taxonomy enums only (UI later)." : name === "DRV-DRIVEAGENT-HOME" ? "Phase 0 scope: compile fixture / schemas stubs, not full UI." : "")),
	);
}
cards.push(
	card(
		"P0-GATE",
		"P0 · Gate",
		gatePrompt(
			0,
			`From sdk/: bun install --frozen-lockfile && bun run build:sdk && bun run types with @cline/drive. bun -F @cline/shared test, bun -F @cline/drive test, bun -F @cline/core test:unit. ADR/DEC board linked. Host port + conformance stub. Facet catalog merge/tombstones/schemaVersion.`,
		),
	),
);

// Phase 1
const p1 = [
	"DRV-ROOM-MVP",
	"DRV-DRIVE-TAB",
	"DRV-ROSTER",
	"DRV-AGENT-PROFILE",
	"DRV-PARTICIPANT-SHEET",
	"DRV-DRIVEAGENT-HOME",
	"DRV-TOGGLE",
	"DRV-PERSONA-CHIP",
	"DRV-NARRATION",
	"DRV-MODE-OVERLAY",
	"DRV-TASK-BANK",
	"DRV-LEAVE-END",
	"DRV-PARTNER-MVP",
	"DRV-GATES",
	"DRV-SDLC-GUIDE",
];
for (const name of p1) {
	const note =
		name === "DRV-TASK-BANK"
			? "Phase 1 scope: loop policy + bank store."
			: name === "DRV-GATES"
				? "Phase 1 scope: taxonomy + events."
				: name === "DRV-SDLC-GUIDE"
					? "Phase 1 scope: discovery + teach-while-doing; stage cards deepen in phase 2."
					: name === "DRV-DRIVEAGENT-HOME"
						? "Phase 1 scope: load home into session / profile depth as listed in TASK-GRAPH."
						: "";
	cards.push(card(`P1-${name}`, `P1 · ${name}`, drvPrompt(1, name, note)));
}
cards.push(
	card(
		"P1-GATE",
		"P1 · Gate",
		gatePrompt(
			1,
			`bun -F @cline/core test:unit and bun -F @cline/cline-hub test. Live smoke-phase1 on hub webview: enter Drive, narrate, posture, leave/re-enter, end. Roster human+partner; no :7891; success metrics M1–M8.`,
		),
	),
);

// Phase 2
const p2 = [
	"DRV-STAGE",
	"DRV-SHARE",
	"DRV-SHOW-BACKLOG",
	"DRV-TRANSCRIPT",
	"DRV-ADDRESS",
	"DRV-ROSTER-PACK",
	"DRV-CALL-STRIP",
	"DRV-NOWNEXT",
	"DRV-TASK-BANK",
	"DRV-STEER-QUEUE",
	"DRV-INTERRUPT",
	"DRV-PIP",
	"DRV-SKILL-PORT",
	"DRV-AGENT-GRAPH",
	"DRV-RECRUIT",
	"DRV-GATES",
	"DRV-SDLC-GUIDE",
];
for (const name of p2) {
	const note =
		name === "DRV-TASK-BANK"
			? "Phase 2 scope: events + cursor + plan editor."
			: name === "DRV-GATES"
				? "Phase 2 scope: feed-card UI."
				: name === "DRV-SDLC-GUIDE"
					? "Phase 2 scope: requirements/decision/coverage/checklist stage cards."
					: name === "DRV-SHOW-BACKLOG"
						? "Also see initiatives/show-backlog-director/ slices."
						: "";
	cards.push(card(`P2-${name}`, `P2 · ${name}`, drvPrompt(2, name, note)));
}
cards.push(
	card(
		"P2-GATE",
		"P2 · Gate",
		gatePrompt(
			2,
			`Unit suites green (cline-hub, core, drive, shared). Live smoke: stage track, user share, address, transcript focus, steer, interrupt, PiP. Recruit fixtures; SDLC W-41→W-44; metrics M9–M11 and M15–M16.`,
		),
	),
);

// Phase 3
for (const name of ["DRV-MIC", "DRV-TTS", "DRV-CAPTIONS"]) {
	cards.push(
		card(
			`P3-${name}`,
			`P3 · ${name}`,
			drvPrompt(3, name, name === "DRV-CAPTIONS" ? "May include gated learn resolve UI under DRV-AGENT-GRAPH / ADR-0004." : ""),
		),
	);
}
cards.push(
	card(
		"P3-GATE",
		"P3 · Gate",
		gatePrompt(
			3,
			`bun -F @cline/cline-hub test and bun -F @cline/core test:unit including mute + caption residue. Live smoke voice; smoke-voice-local.md + smoke-voice-cloud.md; privacy checklist; Local profile never constructs Web Speech (ADR-0009).`,
		),
	),
);

// Phase 4
for (const name of ["DRV-CLI-PARITY", "DRV-ISOLATION", "DRV-TEAM-OPT"]) {
	cards.push(card(`P4-${name}`, `P4 · ${name}`, drvPrompt(4, name)));
}
cards.push(
	card(
		"P4-GATE",
		"P4 · Gate",
		gatePrompt(
			4,
			`bun -F @cline/cli test:unit. TUI smoke matches hub room. Team flag off: roster cap. Flag on: isolation + specialist; without isolation second seat fails closed.`,
		),
	),
);

const byKey = Object.fromEntries(cards.map((c) => [c.key, c]));

/** Edges: dependent waits on prerequisite → fromTaskId=dependent, toTaskId=prerequisite */
const depPairs = [];
function link(dependentKey, prerequisiteKey) {
	depPairs.push([dependentKey, prerequisiteKey]);
}

// Meta → P0 features; P0 chain; P0 gate
link("META-HYGIENE", "META-ADR");
for (const name of p0) link(`P0-${name}`, "META-HYGIENE");
link("P0-DRV-EVENTS", "P0-DRV-ADR");
link("P0-DRV-KERNEL", "P0-DRV-EVENTS");
link("P0-DRV-HOOK-POLICY", "P0-DRV-KERNEL");
link("P0-DRV-PRIVACY", "P0-DRV-HOOK-POLICY");
link("P0-DRV-PLATFORM-CONFIG", "P0-DRV-PRIVACY");
link("P0-DRV-DRIVEAGENT-HOME", "P0-DRV-PLATFORM-CONFIG");
link("P0-DRV-GATES", "P0-DRV-DRIVEAGENT-HOME");
for (const name of p0) link("P0-GATE", `P0-${name}`);

// P1 depends on P0 gate; sketch deps; P1 gate
for (const name of p1) link(`P1-${name}`, "P0-GATE");
link("P1-DRV-DRIVE-TAB", "P1-DRV-ROOM-MVP");
link("P1-DRV-ROSTER", "P1-DRV-DRIVE-TAB");
link("P1-DRV-AGENT-PROFILE", "P1-DRV-ROSTER");
link("P1-DRV-PARTICIPANT-SHEET", "P1-DRV-AGENT-PROFILE");
link("P1-DRV-DRIVEAGENT-HOME", "P1-DRV-PARTICIPANT-SHEET");
link("P1-DRV-TOGGLE", "P1-DRV-ROOM-MVP");
link("P1-DRV-PERSONA-CHIP", "P1-DRV-TOGGLE");
link("P1-DRV-NARRATION", "P1-DRV-PERSONA-CHIP");
link("P1-DRV-MODE-OVERLAY", "P1-DRV-NARRATION");
link("P1-DRV-LEAVE-END", "P1-DRV-MODE-OVERLAY");
link("P1-DRV-PARTNER-MVP", "P1-DRV-LEAVE-END");
link("P1-DRV-TASK-BANK", "P1-DRV-ROOM-MVP");
link("P1-DRV-GATES", "P1-DRV-ROOM-MVP");
link("P1-DRV-SDLC-GUIDE", "P1-DRV-GATES");
for (const name of p1) link("P1-GATE", `P1-${name}`);

// P2
for (const name of p2) link(`P2-${name}`, "P1-GATE");
link("P2-DRV-SHARE", "P2-DRV-STAGE");
link("P2-DRV-TRANSCRIPT", "P2-DRV-SHARE");
link("P2-DRV-ADDRESS", "P2-DRV-TRANSCRIPT");
link("P2-DRV-ROSTER-PACK", "P2-DRV-ADDRESS");
link("P2-DRV-CALL-STRIP", "P2-DRV-ROSTER-PACK");
link("P2-DRV-NOWNEXT", "P2-DRV-CALL-STRIP");
link("P2-DRV-STEER-QUEUE", "P2-DRV-NOWNEXT");
link("P2-DRV-INTERRUPT", "P2-DRV-STEER-QUEUE");
link("P2-DRV-SKILL-PORT", "P2-DRV-INTERRUPT");
link("P2-DRV-TASK-BANK", "P2-DRV-NOWNEXT");
link("P2-DRV-PIP", "P2-DRV-CALL-STRIP");
link("P2-DRV-SHOW-BACKLOG", "P2-DRV-STAGE");
link("P2-DRV-AGENT-GRAPH", "P2-DRV-ADDRESS");
link("P2-DRV-RECRUIT", "P2-DRV-AGENT-GRAPH");
link("P2-DRV-GATES", "P2-DRV-TRANSCRIPT");
link("P2-DRV-SDLC-GUIDE", "P2-DRV-GATES");
for (const name of p2) link("P2-GATE", `P2-${name}`);

// P3
for (const name of ["DRV-MIC", "DRV-TTS", "DRV-CAPTIONS"]) link(`P3-${name}`, "P2-GATE");
link("P3-DRV-TTS", "P3-DRV-MIC");
link("P3-DRV-CAPTIONS", "P3-DRV-TTS");
for (const name of ["DRV-MIC", "DRV-TTS", "DRV-CAPTIONS"]) link("P3-GATE", `P3-${name}`);

// P4
for (const name of ["DRV-CLI-PARITY", "DRV-ISOLATION", "DRV-TEAM-OPT"]) link(`P4-${name}`, "P3-GATE");
link("P4-DRV-ISOLATION", "P4-DRV-CLI-PARITY");
link("P4-DRV-TEAM-OPT", "P4-DRV-ISOLATION");
for (const name of ["DRV-CLI-PARITY", "DRV-ISOLATION", "DRV-TEAM-OPT"]) link("P4-GATE", `P4-${name}`);

const dependencies = depPairs.map(([depKey, preKey], i) => ({
	id: `dep${String(i).padStart(3, "0")}`,
	fromTaskId: byKey[depKey].id,
	toTaskId: byKey[preKey].id,
	createdAt: now,
}));

const metaIds = new Set([byKey["META-ADR"].id, byKey["META-HYGIENE"].id]);
const backlogCards = cards
	.filter((c) => !metaIds.has(c.id))
	.map(({ key: _k, ...rest }) => rest);
const doneCards = cards
	.filter((c) => metaIds.has(c.id))
	.map(({ key: _k, ...rest }) => rest);

const board = {
	columns: [
		{ id: "backlog", title: "Backlog", cards: backlogCards },
		{ id: "in_progress", title: "In Progress", cards: [] },
		{ id: "review", title: "Review", cards: [] },
		{ id: "trash", title: "Done", cards: doneCards },
	],
	dependencies,
};

const home = join(homedir(), ".cline", "kanban", "workspaces");
const workspaceId = toWorkspaceIdBase(REPO);
const wsDir = join(home, workspaceId);
await mkdir(wsDir, { recursive: true });

const indexPath = join(home, "index.json");
let index = { version: 1, entries: {}, repoPathToId: {} };
try {
	index = JSON.parse(await readFile(indexPath, "utf8"));
} catch {
	/* fresh */
}
const repoPath = REPO.replace(/\\/g, "/");
// Prefer existing mapping for this repo if present
let wid = index.repoPathToId?.[repoPath] || index.repoPathToId?.[REPO];
if (!wid) {
	wid = workspaceId;
	if (index.entries[wid] && index.entries[wid].repoPath !== repoPath && index.entries[wid].repoPath !== REPO) {
		wid = `${workspaceId}-${randomUUID().slice(0, 4)}`;
	}
}
index.entries = index.entries || {};
index.repoPathToId = index.repoPathToId || {};
index.version = 1;
index.entries[wid] = { workspaceId: wid, repoPath: REPO };
index.repoPathToId[REPO] = wid;
// Also map forward-slash form for Unix-style consumers
index.repoPathToId[repoPath] = wid;

const finalDir = join(home, wid);
await mkdir(finalDir, { recursive: true });
await writeFile(join(finalDir, "board.json"), JSON.stringify(board, null, 2));
await writeFile(join(finalDir, "sessions.json"), JSON.stringify({}, null, 2));
await writeFile(
	join(finalDir, "meta.json"),
	JSON.stringify({ revision: 1, updatedAt: now }, null, 2),
);
await writeFile(indexPath, JSON.stringify(index, null, 2));

console.log(
	JSON.stringify(
		{
			ok: true,
			workspaceId: wid,
			repoPath: REPO,
			backlog: backlogCards.length,
			done: doneCards.length,
			dependencies: dependencies.length,
			boardPath: join(finalDir, "board.json"),
		},
		null,
		2,
	),
);

function toWorkspaceIdBase(repoPath) {
	const folderName = basename(repoPath.trim().replace(/[\\/]+$/g, "")) || "project";
	const normalized = folderName
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || "project";
}
