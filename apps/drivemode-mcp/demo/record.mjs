/**
 * Records the end-to-end demo.
 *
 * Two segments, recorded as two Playwright contexts and joined afterwards:
 *
 *   1. "Two clients, one writer" — the reference viewer and the iPhone client
 *      side by side while the scenario plays. Captions name the chapter; the
 *      phone is switched to whichever surface that chapter is about.
 *   2. "The hub dashboard" — a tour of the Drive surfaces in the Cline hub.
 *
 * Nothing is scripted into the UIs. The recorder only makes MCP calls and
 * presses real controls; every value that appears is the clients folding the
 * writer's log.
 *
 * The scenario is a parameter, not a hardcoded import — `demo.mjs record
 * --scenario ./my-story.mjs` films a different story with the same rig. See
 * "Writing a new demo" in the README for the module contract.
 */

import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

import { Pointer } from "./pointer-driver.mjs";

const SIZE = { width: 1600, height: 900 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Progress and warnings, on the recorder's own stdout. */
const log = (message) => process.stdout.write(`  ! ${message}\n`);

/**
 * Confirm a URL serves the app we think it does.
 *
 * Vite takes whatever port is free, so "the viewer" and "the hub webview" trade
 * places between runs. A recording that quietly filmed the wrong app would look
 * fine and be worthless, so check the title before spending three minutes on it.
 */
async function expectApp(url, title, label) {
	let html;
	try {
		html = await (
			await fetch(url, { signal: AbortSignal.timeout(4000) })
		).text();
	} catch (err) {
		throw new Error(`${label}: nothing answered at ${url} (${err})`);
	}
	const found = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
	if (found !== title) {
		throw new Error(
			`${label}: ${url} serves "${found}", expected "${title}". ` +
				"Pass the URL that app actually printed — do not assume a port.",
		);
	}
}

async function recordScenario(ctxOpts) {
	const { OUT, VIEWER, STAGE, WRITER, chapters, phoneSurface } = ctxOpts;
	const browser = await chromium.launch();
	const ctx = await browser.newContext({
		viewport: SIZE,
		recordVideo: { dir: join(OUT, "raw-scenario"), size: SIZE },
	});
	const page = await ctx.newPage();

	const stageUrl = `${STAGE}?viewer=${encodeURIComponent(`${VIEWER}?writer=${WRITER}`)}`;
	// `networkidle` never fires here — the viewer holds an SSE stream open.
	await page.goto(stageUrl, { waitUntil: "load" });
	await sleep(4000);

	const pointer = new Pointer(page);
	const phone = page.frameLocator("#phone");
	/** Press a phone tab for real, with the tap drawn where it lands. */
	const tapTab = async (name) => {
		const tab = phone.locator(`.tab[data-surface="${name}"]`);
		const ok = await pointer.clickLocator(tab, { kind: "touch", settle: 900 });
		if (!ok) log(`could not reach the ${name} tab — is the device cut off?`);
	};

	await page.evaluate(() =>
		window.setChapter(
			"the setup",
			"One writer. Many clients.",
			"A browser viewer and an iPhone client, both folding the same append-only event log. The log is empty right now.",
		),
	);
	await sleep(4500);

	let n = 0;
	for (const chapter of chapters) {
		n += 1;
		await page.evaluate(
			([num, title, blurb]) => window.setChapter(num, title, blurb),
			[`chapter ${n} of ${chapters.length}`, chapter.title, chapter.blurb],
		);
		const surface = phoneSurface[chapter.id];
		if (surface) await tapTab(surface);
		await sleep(1200);
		await chapter.run();
		await sleep(2200);
	}

	// Close on the phone walking its own surfaces — the same log, five ways.
	await page.evaluate(() =>
		window.setChapter(
			"the phone",
			"Every surface, same log",
			"Spotlight, Work, Artifacts, Agents, Activity — all reconstructed from the events you just watched arrive.",
		),
	);
	// Back to the first surface by tapping, then walk the rest by swiping —
	// the tab bar and a horizontal swipe are the same navigation in the app,
	// and the recording should show both.
	await tapTab("spotlight");
	const deck = await phone.locator("main").boundingBox();
	if (deck) {
		const midY = deck.y + deck.height * 0.45;
		for (let i = 0; i < 4; i++) {
			await pointer.swipe(deck.x + deck.width - 34, midY, deck.x + 42, midY, {
				settle: 2100,
			});
		}
	}
	await pointer.hide();
	await sleep(900);

	await ctx.close();
	await browser.close();
}

async function recordHub(ctxOpts) {
	const { OUT, HUB } = ctxOpts;
	const browser = await chromium.launch();
	const ctx = await browser.newContext({
		viewport: SIZE,
		recordVideo: { dir: join(OUT, "raw-hub"), size: SIZE },
	});
	const page = await ctx.newPage();
	// The hub is not ours, so the overlay goes in as an init script rather than
	// a tag in its markup. It lives in a shadow root and takes no pointer
	// events, so it cannot affect what we are filming.
	await Pointer.inject(page);
	await page.goto(`${HUB}?demoShareScreen=1&demoPlans=1&demoSessions=1`, {
		waitUntil: "load",
	});
	await sleep(4000);

	const pointer = new Pointer(page);
	await pointer.mode("mouse");

	for (const nav of [
		"Rooms",
		"Artifacts",
		"Tasks",
		"Status Hub",
		"Analytics",
	]) {
		// The sidebar entries are <button>s inside <nav>, not links — scope to
		// the nav so a matching word elsewhere on the page cannot win.
		const link = page
			.locator("aside nav button")
			.filter({ hasText: new RegExp(`^\\s*${nav}\\s*$`) })
			.first();
		if (!(await link.count().catch(() => 0))) {
			log(`hub nav "${nav}" not present — skipping`);
			continue;
		}
		// Move the cursor to the nav item and press it, so the recording shows
		// what was clicked rather than a page that changes on its own.
		const clicked = await pointer
			.clickLocator(link, { settle: 2600 })
			.catch(() => false);
		if (!clicked) {
			log(`hub nav "${nav}" not reachable — skipping`);
			continue;
		}
		// A slow scroll makes the taller surfaces legible on video.
		await page.mouse.wheel(0, 320);
		await sleep(1900);
	}
	await pointer.hide();

	await ctx.close();
	await browser.close();
}

function collect(dir, name, out) {
	const files = readdirSync(dir).filter((f) => f.endsWith(".webm"));
	if (!files.length) throw new Error(`no video written to ${dir}`);
	const target = join(out, name);
	renameSync(join(dir, files[0]), target);
	rmSync(dir, { recursive: true, force: true });
	return target;
}

// ------------------------------------------------------------------ main

/**
 * Film the demo. Returns the WebM segments in play order.
 *
 * The stack must already be up — `demo.mjs` owns that, so the recorder never
 * has to guess a port. It still identity-checks what it is pointed at, because
 * the cost of getting that wrong is three minutes of footage of the wrong app.
 */
export async function recordDemo({
	out,
	viewer,
	stage,
	hub,
	writer,
	chapters,
	phoneSurface = {},
	onProgress = () => {},
}) {
	if (!chapters?.length)
		throw new Error("recordDemo: the scenario has no chapters");

	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });

	onProgress("checking the surfaces are the ones we think");
	await expectApp(viewer, "Drive Mode", "reference viewer");
	if (hub) await expectApp(hub, "Cline Drive", "hub dashboard");

	const ctxOpts = {
		OUT: out,
		VIEWER: viewer,
		STAGE: stage,
		HUB: hub,
		WRITER: writer,
		chapters,
		phoneSurface,
	};
	const segments = [];

	onProgress("recording segment 1 — two clients, one writer");
	await recordScenario(ctxOpts);
	segments.push(collect(join(out, "raw-scenario"), "01-clients.webm", out));

	if (hub) {
		onProgress("recording segment 2 — the hub dashboard");
		await recordHub(ctxOpts);
		segments.push(collect(join(out, "raw-hub"), "02-hub.webm", out));
	} else {
		onProgress("no hub URL — recording the clients segment only");
	}

	return segments;
}
