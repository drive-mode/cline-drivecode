/**
 * The demo stack: start it, verify it, stop it.
 *
 * Four processes have to come up in a particular order and be confirmed to be
 * the apps we think they are. Every rule encoded here was learned by getting it
 * wrong once:
 *
 * - The hub starts FIRST. It announces its webview port before binding it, so
 *   if something else wins that bind the hub keeps proxying the port it
 *   announced and serves the other app's bundle inside its own shell — right
 *   title, right chrome, wrong app.
 * - The viewer gets a pinned port well away from 5173 for the same reason.
 * - The writer is restarted, never reused. It is in-memory, so a second
 *   scenario run on a live writer replays spent grant ids and the Presenter
 *   guard correctly rejects them.
 * - Both browser surfaces are identity-checked by page title before anything
 *   is recorded. A three-minute recording of the wrong app looks fine.
 * - A service that is already healthy is adopted, not started again. Bringing
 *   up a partially-live stack used to spawn a second copy of whatever was
 *   already running, overwriting its recorded pid and orphaning the original —
 *   so `down` could no longer stop it.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startWriter, stopWriter } from "./writer-lifecycle.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..");
const STATE = join(HERE, ".stack.json");

/** The sibling Cline clone that serves the hub dashboard. Optional. */
// This app lives in the cline-drivecode monorepo: the Cline hub, the kernel
// and the shared node_modules are two levels up.
export const CLINE = resolve(REPO, "..", "..");

export const PORTS = {
	writer: Number(process.env.DEMO_WRITER_PORT ?? 4600),
	viewer: Number(process.env.DEMO_VIEWER_PORT ?? 5199),
	surfaces: Number(process.env.DEMO_PORT ?? 8080),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Page titles are how a surface proves it is the app we think it is. */
const PHONE_TITLE = "Drive — iOS client (web recreation)";

// ------------------------------------------------------------------ state

function readState() {
	try {
		return JSON.parse(readFileSync(STATE, "utf8"));
	} catch {
		return { services: {} };
	}
}

function writeState(state) {
	writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
}

function remember(name, info) {
	const state = readState();
	state.services[name] = info;
	writeState(state);
}

// ------------------------------------------------------------------ probes

export async function fetchTitle(url, timeoutMs = 4000) {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
		const html = await res.text();
		return html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() ?? null;
	} catch {
		return null;
	}
}

/**
 * Wait until `url` serves a page whose title is `title`.
 *
 * Checking the title rather than "does the port answer" is the whole point: a
 * port answering with the wrong app is the failure this guards against.
 */
async function waitForApp(url, title, label, timeoutMs = 90_000) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		last = await fetchTitle(url, 2000);
		if (last === title) return;
		await sleep(1000);
	}
	throw new Error(
		last === null
			? `${label}: nothing answered at ${url} within ${timeoutMs / 1000}s`
			: `${label}: ${url} serves "${last}", expected "${title}"`,
	);
}

/** Wait for a line to appear in a child's captured output. */
async function waitForLine(getOutput, pattern, label, timeoutMs = 120_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const match = getOutput().match(pattern);
		if (match) return match;
		await sleep(500);
	}
	throw new Error(`${label}: never printed ${pattern}`);
}

// ------------------------------------------------------------------ spawn

/** Start a long-lived child, capturing its output for the port probes. */
function launch(name, command, args, options = {}) {
	const child = spawn(command, args, {
		cwd: options.cwd ?? REPO,
		env: { ...process.env, ...options.env },
		stdio: ["ignore", "pipe", "pipe"],
		detached: true,
	});
	let output = "";
	child.stdout.on("data", (b) => {
		output += b.toString();
	});
	child.stderr.on("data", (b) => {
		output += b.toString();
	});
	// Unref the child *and* its pipes. `child.unref()` alone is not enough:
	// the two open stdio streams are themselves handles on the event loop, so
	// the CLI would print every URL and then hang forever instead of exiting.
	child.stdout.unref();
	child.stderr.unref();
	child.unref();
	remember(name, { pid: child.pid, startedAt: new Date().toISOString() });
	return { child, getOutput: () => output };
}

// ------------------------------------------------------------------ services

/**
 * The hub dashboard, from the sibling Cline clone. Optional: without it the
 * demo still records the viewer and the phone, just not the hub segment.
 */
export async function startHub({ log = () => {} } = {}) {
	if (!existsSync(join(CLINE, "apps", "cline-hub"))) {
		log(`no hub at ${CLINE} — skipping (the hub segment needs it)`);
		return null;
	}
	const running = urls()?.hub;
	if (running && (await fetchTitle(running, 2000)) === "Cline Drive") {
		log(`hub already running at ${running}`);
		return running;
	}
	log("starting the hub (first, so its webview wins port 5173)");
	const { getOutput } = launch(
		"hub",
		"bun",
		["run", "--cwd", "apps/cline-hub", "dev"],
		{
			cwd: CLINE,
		},
	);
	const match = await waitForLine(
		getOutput,
		/dashboard listening:\s*(http:\/\/\S+?)\/?\s/,
		"hub",
	);
	const url = `${match[1].replace(/\/$/, "")}/`;
	await waitForApp(url, "Cline Drive", "hub dashboard");
	log(`hub ready at ${url}`);
	return url;
}

/** The reference viewer, on a pinned port so it cannot race the hub. */
export async function startViewer({ log = () => {} } = {}) {
	const port = PORTS.viewer;
	const url = `http://127.0.0.1:${port}/`;
	if ((await fetchTitle(url, 2000)) === "Drive Mode") {
		log(`viewer already running at ${url}`);
		return url;
	}
	log(`starting the reference viewer on ${port} (pinned)`);
	launch("viewer", "bun", [
		"run",
		"--cwd",
		"apps/viewer",
		"dev",
		"--",
		"--port",
		String(port),
		"--strictPort",
	]);
	await waitForApp(url, "Drive Mode", "reference viewer");
	log(`viewer ready at ${url}`);
	return url;
}

/** The static host for the stage + phone, with its same-origin /rpc proxy. */
export async function startSurfaces({ writerUrl, log = () => {} } = {}) {
	const port = PORTS.surfaces;
	const url = `http://127.0.0.1:${port}/`;
	if ((await fetchTitle(`${url}ios/`, 2000)) === PHONE_TITLE) {
		log(`surfaces already running at ${url}`);
		return url;
	}
	log(`starting the demo surfaces on ${port}`);
	launch("surfaces", "node", ["demo/serve.mjs"], {
		env: { DEMO_PORT: String(port), DRIVEMODE_WRITER_URL: writerUrl },
	});
	await waitForApp(`${url}ios/`, PHONE_TITLE, "demo surfaces");
	log(`surfaces ready at ${url}`);
	return url;
}

/** A writer with an empty log, every time. */
export async function startFreshWriter({ log = () => {} } = {}) {
	log("starting a clean writer");
	const { url } = await startWriter(PORTS.writer);
	remember("writer", { url, startedAt: new Date().toISOString() });
	log(`writer ready at ${url}`);
	return url;
}

// ------------------------------------------------------------------ up/down

export async function up({ log = () => {}, hub = true } = {}) {
	const hubUrl = hub ? await startHub({ log }) : null;
	const viewerUrl = await startViewer({ log });
	const writerUrl = await startFreshWriter({ log });
	const surfacesUrl = await startSurfaces({ writerUrl, log });

	const urls = {
		writer: writerUrl,
		viewer: viewerUrl,
		surfaces: surfacesUrl,
		stage: `${surfacesUrl}stage/`,
		phone: `${surfacesUrl}ios/`,
		hub: hubUrl,
	};
	const state = readState();
	state.urls = urls;
	writeState(state);
	return urls;
}

export function urls() {
	return readState().urls ?? null;
}

export async function down({ log = () => {} } = {}) {
	const state = readState();
	for (const [name, info] of Object.entries(state.services ?? {})) {
		if (!info?.pid) continue;
		try {
			// Kill the whole group: `bun run` spawns the real server as a child,
			// and killing only the wrapper orphans the process holding the port.
			process.kill(-info.pid, "SIGTERM");
			log(`stopped ${name}`);
		} catch {
			try {
				process.kill(info.pid, "SIGTERM");
				log(`stopped ${name}`);
			} catch {
				log(`${name} was not running`);
			}
		}
	}
	await stopWriter();
	rmSync(STATE, { force: true });
}

/** What is actually up right now, checked rather than remembered. */
export async function status() {
	const known = urls();
	const rows = [];
	const check = async (name, url, title) => {
		if (!url) {
			rows.push({ name, url: null, ok: false, detail: "not started" });
			return;
		}
		if (!title) {
			const res = await fetch(url, { signal: AbortSignal.timeout(2500) }).catch(
				() => null,
			);
			rows.push({
				name,
				url,
				ok: Boolean(res?.ok),
				detail: res ? `HTTP ${res.status}` : "no answer",
			});
			return;
		}
		const found = await fetchTitle(url, 2500);
		rows.push({
			name,
			url,
			ok: found === title,
			detail: found === null ? "no answer" : `title "${found}"`,
		});
	};

	await check(
		"writer",
		known?.writer
			? `${known.writer}/health`
			: `http://127.0.0.1:${PORTS.writer}/health`,
		null,
	);
	await check(
		"viewer",
		known?.viewer ?? `http://127.0.0.1:${PORTS.viewer}/`,
		"Drive Mode",
	);
	await check(
		"surfaces",
		known?.phone ?? `http://127.0.0.1:${PORTS.surfaces}/ios/`,
		"Drive — iOS client (web recreation)",
	);
	await check("hub", known?.hub ?? null, "Cline Drive");
	return rows;
}
