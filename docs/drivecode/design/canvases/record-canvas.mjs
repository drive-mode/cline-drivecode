#!/usr/bin/env bun
// Canvas recorder — plays a registered canvas and cuts a GIF from it.
//
//   bun record-canvas.mjs --canvas drive-product-demo
//   bun record-canvas.mjs --canvas drive-product-demo --out ./dist --keep-frames
//   bun record-canvas.mjs --canvas drive-product-demo --max-seconds 40   # quick check
//
// The cut is declared in canvases.json by BEAT ID, never by frame number:
//
//   "capture": { "cut": [{ "from": "a2-message", "to": "a3-test", "step": 2 }] }
//
// Frame numbers rot the moment a beat's pacing changes — which happens every
// time narration is re-recorded. Beat ids survive re-timing, so the same config
// keeps producing the same story after the demo is re-cut.
//
// Requires: puppeteer-core (installed on demand), system Chrome, ffmpeg.

import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync, writeFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : undefined; };
const fail = (m) => { console.error("record-canvas: " + m); process.exit(1); };

const manifest = JSON.parse(readFileSync(join(here, "canvases.json"), "utf8"));
const id = argOf("--canvas") || "drive-product-demo";
const cfg = manifest.canvases[id];
if (!cfg) fail(`unknown canvas "${id}" — registered: ${Object.keys(manifest.canvases).join(", ")}`);
const cap = cfg.capture;
if (!cap) fail(`${id} has no "capture" block in canvases.json — nothing to record`);

const outDir = argOf("--out") || join(tmpdir(), "drive-canvas-rec", id);
const framesDir = join(outDir, "frames");
mkdirSync(framesDir, { recursive: true });
const maxSeconds = Number(argOf("--max-seconds") || cap.maxSeconds || 240);

const CHROME = process.env.CHROME_PATH ||
	(process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "google-chrome");

// Windows MAX_PATH breaks Chrome's file:// loads under deep paths, so serve the
// canvas from a short staging copy rather than wherever the repo happens to sit.
let pageUrl = "file:///" + join(here, cfg.file).replace(/\\/g, "/");
let staged = null;
if (process.platform === "win32") {
	staged = join(tmpdir(), "canvas-rec-src");
	rmSync(staged, { recursive: true, force: true });
	cpSync(join(here, "../.."), join(staged, "drivecode"), { recursive: true });
	pageUrl = "file:///" + join(staged, "drivecode/design/canvases", cfg.file).replace(/\\/g, "/");
}

const puppeteer = await import("puppeteer-core").catch(() =>
	fail("puppeteer-core not installed — run: echo '{}' > package.json && bun add puppeteer-core@23 (then delete both before committing)"));

const browser = await puppeteer.default.launch({
	executablePath: CHROME,
	headless: true,
	args: ["--force-color-profile=srgb", "--hide-scrollbars", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: cap.width || 1280, height: cap.height || 720, deviceScaleFactor: 1 });
await page.goto(pageUrl, { waitUntil: "networkidle0", timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200)); // fonts settle

const captions = await page.evaluate(() => {
	const D = window.__DRIVE_DEMO__;
	if (!D) return null;
	try { localStorage.clear(); } catch (e) {}
	document.documentElement.classList.remove("dark");
	D.goTo(0);
	document.getElementById("btn-play").click();
	return D.beats.map((b) => ({ id: b.id, caption: (b.caption || "").trim() }));
});
if (!captions) fail(`${id} exposes no __DRIVE_DEMO__ hook — recorder needs it to map frames to beats`);

// Frame -> beat id. Captions can repeat, so resolve forward from the last known
// beat: autoplay only ever moves forward.
const intervalMs = cap.intervalMs || 250;
const beatOf = (capText, lastIdx) => {
	for (let i = Math.max(0, lastIdx); i < captions.length; i++) if (captions[i].caption === capText) return i;
	return lastIdx;
};
const rankOf = (beatId) => captions.findIndex((c) => c.id === beatId);

const t0 = Date.now();
const frameBeats = [];
let i = 0, lastIdx = 0, playing = true;
while (playing && Date.now() - t0 < maxSeconds * 1000) {
	const s = await page.evaluate(() => {
		const cap = document.getElementById("caption");
		const clock = typeof window.__DRIVE_DEMO__.sayClock === "function" ? window.__DRIVE_DEMO__.sayClock() : window.__DRIVE_DEMO__.sayClock;
		return {
			cap: cap ? cap.textContent.trim() : "",
			beatId: clock && clock.beatId ? clock.beatId : null,
			on: document.getElementById("btn-play").classList.contains("on"),
		};
	});
	playing = s.on;
	// Prefer the SayClock's own beat id when the canvas exposes one; fall back to
	// matching the caption strip forward from the last known beat.
	lastIdx = s.beatId && rankOf(s.beatId) >= lastIdx ? rankOf(s.beatId) : beatOf(s.cap, lastIdx);
	await page.screenshot({ path: join(framesDir, `f${String(i).padStart(4, "0")}.png`) });
	frameBeats.push(captions[lastIdx].id);
	i++;
	const wait = t0 + i * intervalMs - Date.now();
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
await browser.close();
if (staged) rmSync(staged, { recursive: true, force: true });
writeFileSync(join(outDir, "beatmap.json"), JSON.stringify(frameBeats));
console.log(`captured ${i} frames over ${Math.round((Date.now() - t0) / 1000)}s`);

// Select frames by beat-id ranges.
const order = captions.map((c) => c.id);
const rank = (b) => order.indexOf(b);
const files = readdirSync(framesDir).filter((f) => f.endsWith(".png")).sort();
let picked = [];
if (!cap.cut || !cap.cut.length) {
	picked = files.filter((_, ix) => ix % (cap.step || 1) === 0);
} else {
	for (const seg of cap.cut) {
		const lo = rank(seg.from), hi = rank(seg.to ?? seg.from);
		if (lo < 0 || hi < 0) { console.warn(`  ! cut range ${seg.from}..${seg.to} — unknown beat id, skipped`); continue; }
		const inSeg = files.filter((_, ix) => { const r = rank(frameBeats[ix]); return r >= lo && r <= hi; });
		if (!inSeg.length) { console.warn(`  ! cut range ${seg.from}..${seg.to} matched no frames`); continue; }
		picked.push(...inSeg.filter((_, ix) => ix % (seg.step || cap.step || 1) === 0));
	}
}
if (!picked.length) fail("no frames selected — check the capture.cut ranges");

// Assemble with ffmpeg palettegen (better colour than a fixed palette).
const listFile = join(outDir, "frames.txt");
const holdS = ((cap.frameMs || 110) / 1000).toFixed(4);
writeFileSync(listFile, picked.map((f) => `file '${join(framesDir, f).replace(/\\/g, "/")}'\nduration ${holdS}`).join("\n") + "\n");
const gifPath = join(outDir, `${id}.gif`);
const w = cap.gifWidth || 820;
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile,
	"-filter_complex", `scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
	"-loop", "0", gifPath]);

if (!argv.includes("--keep-frames")) rmSync(framesDir, { recursive: true, force: true });
const mb = (readFileSync(gifPath).length / 1048576).toFixed(2);
console.log(`${gifPath} — ${mb} MB, ${picked.length} frames, ${(picked.length * (cap.frameMs || 110) / 1000).toFixed(1)}s`);
