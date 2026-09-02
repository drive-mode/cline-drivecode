#!/usr/bin/env node
/**
 * One entry point for making Drive Mode demos.
 *
 *   node demo/demo.mjs doctor      what is missing before you can record
 *   node demo/demo.mjs up          start the stack, in order, verified
 *   node demo/demo.mjs status      what is actually running right now
 *   node demo/demo.mjs play        run the scenario against the live stack
 *   node demo/demo.mjs record      up (if needed) → film → encode → MP4
 *   node demo/demo.mjs down        stop everything this started
 *
 * Options:
 *   --scenario <path>   a different story (default ./scenario.mjs)
 *   --chapter <id>      play/record only up to and including this chapter
 *   --out <dir>         where recordings land
 *   --pace <ms>         beat length; lower is faster
 *   --no-hub            skip the hub dashboard segment
 *
 * The point of this file is that the demo is reproducible without remembering
 * any of the traps: the start order, the pinned ports, the identity checks, the
 * clean writer. Those live in `stack.mjs` and are applied the same way every
 * time.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	CLINE,
	down,
	PORTS,
	REPO,
	startFreshWriter,
	status,
	up,
	urls,
} from "./stack.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ args

const argv = process.argv.slice(2);
const command = argv[0] ?? "help";
const flag = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

// Set before anything can import a scenario: a story module may read this at
// module scope, and `loadScenario()` runs before the command body. Applied
// once here so `play` honours --pace too, not just `record`.
if (flag("pace")) process.env.DEMO_PACE_MS = flag("pace");

const say = (msg) => process.stdout.write(`· ${msg}\n`);
const warn = (msg) => process.stdout.write(`  ! ${msg}\n`);

async function loadScenario() {
	const raw = flag("scenario", "./scenario.mjs");
	const path = isAbsolute(raw) ? raw : resolve(HERE, raw);
	if (!existsSync(path)) throw new Error(`no scenario at ${path}`);
	const mod = await import(path);
	if (!Array.isArray(mod.chapters) || mod.chapters.length === 0) {
		throw new Error(`${path} exports no chapters — see "Writing a new demo"`);
	}
	return { path, chapters: mod.chapters, phoneSurface: mod.phoneSurface ?? {} };
}

/** Trim the chapter list to a prefix, since chapters build on each other. */
function through(chapters, id) {
	if (!id) return chapters;
	const at = chapters.findIndex((c) => c.id === id);
	if (at === -1) {
		throw new Error(
			`unknown chapter "${id}" — have: ${chapters.map((c) => c.id).join(", ")}`,
		);
	}
	return chapters.slice(0, at + 1);
}

// ------------------------------------------------------------------ doctor

function which(binary) {
	return spawnSync("sh", ["-c", `command -v ${binary}`], {
		encoding: "utf8",
	}).stdout.trim();
}

async function doctor() {
	const checks = [];
	const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, fix });

	add(
		"bun",
		Boolean(which("bun")),
		which("bun") || "not on PATH",
		"install Bun 1.3+",
	);
	add("node", Boolean(which("node")), process.version, "install Node >= 22");

	// Playwright: needed to drive and film the browsers.
	let playwright = false;
	try {
		await import("playwright");
		playwright = true;
	} catch {}
	add(
		"playwright",
		playwright,
		playwright ? "importable" : "not resolvable from demo/",
		"npm i -g playwright && npx playwright install chromium",
	);

	// ffmpeg: Playwright bundles a VP8-only build that cannot write MP4.
	const ffmpeg = which("ffmpeg");
	const h264 = ffmpeg
		? spawnSync(
				"sh",
				["-c", "ffmpeg -hide_banner -encoders 2>/dev/null | grep -c libx264"],
				{
					encoding: "utf8",
				},
			).stdout.trim() !== "0"
		: false;
	add(
		"ffmpeg (with libx264)",
		h264,
		ffmpeg ? (h264 ? ffmpeg : `${ffmpeg} — no libx264`) : "not on PATH",
		"install a full ffmpeg; Playwright's bundled one is VP8-only",
	);

	// The writer resolves the kernel through the built workspace packages.
	const kernel = join(CLINE, "sdk", "packages", "drive", "dist");
	add(
		"@cline/drive build",
		existsSync(kernel),
		existsSync(kernel) ? kernel : `missing at ${kernel}`,
		"bun run build:sdk (monorepo root)",
	);

	add(
		"workspace deps",
		existsSync(join(CLINE, "node_modules")),
		existsSync(join(CLINE, "node_modules")) ? "installed" : "no node_modules",
		"bun install --frozen-lockfile (monorepo root)",
	);

	const hub = existsSync(join(CLINE, "apps", "cline-hub"));
	add(
		"hub dashboard (optional)",
		hub,
		hub ? CLINE : `no sibling clone at ${CLINE}`,
		"clone drive-mode/cline-drivecode as a sibling, or record with --no-hub",
	);

	for (const c of checks) {
		process.stdout.write(
			`${c.ok ? "  ok " : "  -- "}${c.name.padEnd(24)} ${c.detail}\n`,
		);
		if (!c.ok) process.stdout.write(`     fix: ${c.fix}\n`);
	}

	// The hub is optional; everything else is not.
	const blocking = checks.filter((c) => !c.ok && !c.name.includes("optional"));
	if (blocking.length) {
		process.stdout.write(`\n${blocking.length} blocking problem(s).\n`);
		process.exitCode = 1;
	} else {
		process.stdout.write("\nready to record.\n");
	}
}

// ------------------------------------------------------------------ encode

function encode(segments, out) {
	const target = join(out, "drive-mode-demo.mp4");
	const inputs = segments.flatMap((s) => ["-i", s]);
	const filter = `${segments.map((_, i) => `[${i}:v]`).join("")}concat=n=${segments.length}:v=1:a=0[v]`;
	const res = spawnSync(
		"ffmpeg",
		[
			"-y",
			"-loglevel",
			"error",
			...inputs,
			"-filter_complex",
			filter,
			"-map",
			"[v]",
			"-c:v",
			"libx264",
			"-preset",
			"slow",
			"-crf",
			"21",
			"-pix_fmt",
			"yuv420p",
			"-movflags",
			"+faststart",
			target,
		],
		{ stdio: "inherit" },
	);
	if (res.status !== 0) throw new Error("ffmpeg failed to join the segments");
	return target;
}

// ------------------------------------------------------------------ commands

/**
 * Bring the stack up if it is not already, then hand back a writer with an
 * empty log.
 *
 * The reset is the point: the writer is in-memory and the scenario reuses fixed
 * grant ids, so replaying onto a writer that already holds a run makes the
 * Presenter guard reject the handoff — correctly. Restarting it costs under a
 * second and makes `play` and `record` repeatable instead of once-per-boot.
 */
async function ensureUp({ hub, freshWriter = true }) {
	const rows = await status();
	const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
	const needed = ["writer", "viewer", "surfaces"];
	if (needed.every((n) => byName[n]?.ok) && (!hub || byName.hub?.ok)) {
		say("stack already up");
		if (freshWriter) await startFreshWriter({ log: say });
		return urls();
	}
	// A cold `up` already starts a clean writer.
	return up({ log: say, hub });
}

const commands = {
	async doctor() {
		await doctor();
	},

	async up() {
		const live = await up({ log: say, hub: !has("no-hub") });
		process.stdout.write("\n");
		for (const [name, url] of Object.entries(live)) {
			process.stdout.write(`  ${name.padEnd(9)} ${url ?? "(not running)"}\n`);
		}
		process.stdout.write(
			`\nPoint the viewer at the writer with ?writer=${live.writer}\n`,
		);
	},

	async status() {
		for (const row of await status()) {
			process.stdout.write(
				`  ${row.ok ? "ok " : "-- "}${row.name.padEnd(9)} ${(row.url ?? "").padEnd(34)} ${row.detail}\n`,
			);
		}
	},

	async play() {
		const { chapters } = await loadScenario();
		const list = through(chapters, flag("chapter"));
		await ensureUp({ hub: false, freshWriter: !has("keep-writer") });
		for (const chapter of list) {
			process.stdout.write(`▶ ${chapter.id.padEnd(11)} ${chapter.title}\n`);
			await chapter.run();
		}
		process.stdout.write("✓ scenario complete\n");
	},

	async record() {
		const { path, chapters, phoneSurface } = await loadScenario();
		const list = through(chapters, flag("chapter"));
		const wantHub = !has("no-hub");
		const out = flag("out", "/tmp/drivemode-demo/recording");

		// Imported here, not at the top: record.mjs pulls in Playwright, and
		// `doctor` exists precisely to tell you when Playwright is missing. A
		// static import makes the diagnostic crash on the thing it diagnoses.
		const { recordDemo } = await import("./record.mjs");

		say(`scenario ${path} (${list.length} chapters)`);
		const live = await ensureUp({
			hub: wantHub,
			freshWriter: !has("keep-writer"),
		});
		if (wantHub && !live.hub)
			warn("no hub — recording the clients segment only");

		const segments = await recordDemo({
			out,
			viewer: live.viewer,
			stage: live.stage,
			hub: wantHub ? live.hub : null,
			writer: live.writer,
			chapters: list,
			phoneSurface,
			onProgress: say,
		});

		say("encoding");
		const mp4 = encode(segments, out);
		process.stdout.write(`\n✓ ${mp4}\n`);
	},

	async down() {
		await down({ log: say });
		process.stdout.write("stack down\n");
	},

	help() {
		process.stdout.write(
			[
				"node demo/demo.mjs <command> [options]",
				"",
				"  doctor    what is missing before you can record",
				"  up        start the stack, in order, verified",
				"  status    what is actually running right now",
				"  play      run the scenario against the live stack",
				"  record    up (if needed) → film → encode → MP4",
				"  down      stop everything this started",
				"",
				"  --scenario <path>   a different story (default ./scenario.mjs)",
				"  --chapter <id>      stop after this chapter",
				"  --out <dir>         where recordings land",
				"  --pace <ms>         beat length; lower is faster",
				"  --no-hub            skip the hub dashboard segment",
				"  --keep-writer       replay onto the running writer instead of a clean one",
				"",
				`  ports: writer ${PORTS.writer} · viewer ${PORTS.viewer} · surfaces ${PORTS.surfaces}`,
				"",
			].join("\n"),
		);
	},
};

const run = commands[command] ?? commands.help;
try {
	await run();
} catch (err) {
	process.stderr.write(`\n✗ ${err.message}\n`);
	process.exitCode = 1;
}
