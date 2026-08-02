#!/usr/bin/env bun
// Canvas publisher — bundles any registered design canvas into single-file
// distributions with every asset (WOFF2 fonts, media) inlined as data: URIs.
//
//   bun build-artifact.mjs                      # every canvas in canvases.json
//   bun build-artifact.mjs --canvas drive-product-demo
//   bun build-artifact.mjs --all --out <dir>
//
// Two outputs per canvas:
//   <id>.standalone.html — full document; open from file:// or host anywhere,
//     zero requests leave the page.
//   <id>.artifact.html — the same content as a body fragment (no doctype /
//     html / head / body shell, no meta tags) for publishers that supply their
//     own document shell, e.g. Claude artifacts.
//
// Adding a canvas is a canvases.json entry, not a code change. The repo canvas
// stays the source of truth; rebuild after any canvas or asset change.
//
// MEDIA CONTRACT (preferred): a canvas that needs media inlined resolves URLs
// through a lookup that this builder populates —
//
//   const mediaUrl = (f) => (window.__CANVAS_MEDIA__ || {})[f] || BASE + f;
//
// The builder injects `window.__CANVAS_MEDIA__` and touches nothing else.
// `media.legacyAudioPatch` is the pre-contract fallback: an explicit,
// configured string substitution for canvases that build Audio URLs inline.
// Migrate a canvas to the contract and drop its legacyAudioPatch block.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (flag) => {
	const i = argv.indexOf(flag);
	return i > -1 ? argv[i + 1] : undefined;
};

const manifestPath = join(here, "canvases.json");
if (!existsSync(manifestPath)) fail(`missing manifest: ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const defaults = manifest.defaults || {};

const only = argOf("--canvas");
const ids = only ? [only] : Object.keys(manifest.canvases);
if (only && !manifest.canvases[only]) {
	fail(`unknown canvas "${only}" — registered: ${Object.keys(manifest.canvases).join(", ")}`);
}

const outDir = argOf("--out") || join(tmpdir(), defaults.outDir || "drive-canvas-dist");
mkdirSync(outDir, { recursive: true });

const b64 = (p) => readFileSync(p).toString("base64");
const mb = (n) => (n / 1048576).toFixed(2) + " MB";

function fail(msg) {
	console.error("build-artifact: " + msg);
	process.exit(1);
}

/** Inline every WOFF2 the canvas references out of its fonts directory. */
function inlineFonts(html, cfg, id) {
	const fontsDir = cfg.fontsDir || defaults.fontsDir;
	if (!fontsDir) return { html, bytes: 0, count: 0 };
	// match the manifest's own relative prefix so a canvas can live anywhere
	const prefix = fontsDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(`url\\("${prefix}/([^"]+)"\\)`, "g");
	let bytes = 0;
	let count = 0;
	const out = html.replace(re, (_, f) => {
		const p = resolve(here, fontsDir, f);
		if (!existsSync(p)) fail(`${id}: font referenced but missing on disk: ${p}`);
		bytes += readFileSync(p).length;
		count++;
		return `url("data:font/woff2;base64,${b64(p)}")`;
	});
	return { html: out, bytes, count };
}

/** Build the media map and hand it to the canvas (contract, then legacy). */
function inlineMedia(html, cfg, id) {
	const m = cfg.media;
	if (!m) return { html, count: 0 };
	const dir = resolve(here, m.dir);
	if (!existsSync(dir)) fail(`${id}: media dir missing: ${dir}`);
	const files = readdirSync(dir).filter((f) => f.endsWith(m.ext));
	if (!files.length) fail(`${id}: no ${m.ext} files in ${dir}`);
	const entries = files
		.map((f) => `  ${JSON.stringify(f)}: "data:${m.mime};base64,${b64(join(dir, f))}"`)
		.join(",\n");

	const usesContract = html.includes("__CANVAS_MEDIA__");
	if (usesContract) {
		const inject = `<script>window.__CANVAS_MEDIA__ = {\n${entries}\n};</script>\n`;
		const at = html.search(/<script\b/);
		if (at < 0) fail(`${id}: media contract present but no <script> to precede`);
		return { html: html.slice(0, at) + inject + html.slice(at), count: files.length };
	}

	const legacy = m.legacyAudioPatch;
	if (!legacy) fail(`${id}: media configured but canvas has no __CANVAS_MEDIA__ hook and no legacyAudioPatch`);
	if (!html.includes(legacy.baseDecl)) fail(`${id}: legacyAudioPatch.baseDecl not found — canvas changed, update canvases.json`);
	if (!html.includes(legacy.call)) fail(`${id}: legacyAudioPatch.call not found — canvas changed, update canvases.json`);
	let out = html.replace(
		legacy.baseDecl,
		`${legacy.baseDecl}\n  const ${legacy.mapName} = {\n${entries}\n  };`,
	);
	out = out.replace(legacy.call, legacy.replacement);
	return { html: out, count: files.length };
}

/** Let the page's own CSP admit the data: URIs we just inlined. */
function relaxCsp(html) {
	return html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/i, (_, a, csp, c) => {
		let out = csp;
		for (const d of ["font-src", "media-src", "img-src"]) {
			if (new RegExp(`${d}[^;]*`).test(out) && !new RegExp(`${d}[^;]*data:`).test(out)) {
				out = out.replace(new RegExp(`(${d}[^;]*)`), "$1 data:");
			}
		}
		return a + out + c;
	});
}

/** Strip the document shell for publishers that supply their own. */
function toFragment(html) {
	return html
		.replace(/^<!DOCTYPE html>\s*/i, "")
		.replace(/<html[^>]*>\s*/i, "")
		.replace(/<\/html>\s*$/i, "")
		.replace(/<head>\s*/i, "")
		.replace(/<\/head>\s*/i, "")
		.replace(/<body>\s*/i, "")
		.replace(/<\/body>\s*/i, "")
		.replace(/<meta [^>]*>\s*/gi, "");
}

let built = 0;
for (const id of ids) {
	const cfg = manifest.canvases[id];
	const src = join(here, cfg.file);
	if (!existsSync(src)) fail(`${id}: canvas file missing: ${src}`);
	let html = readFileSync(src, "utf8");

	const fonts = inlineFonts(html, cfg, id);
	html = fonts.html;
	const media = inlineMedia(html, cfg, id);
	html = media.html;

	const standalone = relaxCsp(html);
	const fragment = toFragment(standalone);
	writeFileSync(join(outDir, `${id}.standalone.html`), standalone);
	writeFileSync(join(outDir, `${id}.artifact.html`), fragment);
	built++;

	console.log(
		`${id}: standalone ${mb(standalone.length)} · fragment ${mb(fragment.length)} · ` +
			`${fonts.count} fonts (${mb(fonts.bytes)})${media.count ? ` · ${media.count} media` : ""}`,
	);
}
console.log(`built ${built} canvas${built === 1 ? "" : "es"} to ${outDir}`);
