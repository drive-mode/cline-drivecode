#!/usr/bin/env bun
// Builds single-file distributions of drive-product-demo.html with every
// asset (WOFF2 fonts, voice MP3s) inlined as data: URIs:
//
//   bun build-artifact.mjs [--out <dir>]
//
// Outputs (default <os-tmp>/drive-demo-dist):
//   drive-product-demo.standalone.html — full document; open from file:// or
//     host anywhere; zero requests leave the page.
//   drive-product-demo.artifact.html — same content as a body fragment
//     (no doctype/html/head/body shell, no meta tags) for publishers that
//     wrap fragments in their own document shell, e.g. Claude artifacts.
//
// The repo canvas stays the source of truth; rebuild after any canvas or
// voice-clip change and republish.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outIx = process.argv.indexOf("--out");
const outDir = outIx > -1 ? process.argv[outIx + 1] : join(tmpdir(), "drive-demo-dist");
mkdirSync(outDir, { recursive: true });

const b64 = (p) => readFileSync(p).toString("base64");
let html = readFileSync(join(here, "drive-product-demo.html"), "utf8");

// fonts -> data URIs
const fontsDir = join(here, "../../assets/fonts");
let fontBytes = 0;
html = html.replace(/url\("\.\.\/\.\.\/assets\/fonts\/([^"]+)"\)/g, (_, f) => {
  const p = join(fontsDir, f);
  fontBytes += readFileSync(p).length;
  return `url("data:font/woff2;base64,${b64(p)}")`;
});
if (fontBytes === 0) throw new Error("no font urls replaced — canvas layout changed?");

// voice clips -> VOICE_DATA map + patched resolver
const voiceDir = join(here, "../../assets/demos/voice");
const clips = readdirSync(voiceDir).filter((f) => f.endsWith(".mp3"));
if (!clips.length) throw new Error("no mp3s found in assets/demos/voice");
const voiceMap = clips
  .map((f) => `  ${JSON.stringify(f)}: "data:audio/mpeg;base64,${b64(join(voiceDir, f))}"`)
  .join(",\n");
const baseDecl = 'const CLIP_BASE = "../../assets/demos/voice/";';
if (!html.includes(baseDecl)) throw new Error("CLIP_BASE declaration not found");
html = html.replace(baseDecl, `${baseDecl}\n  const VOICE_DATA = {\n${voiceMap}\n  };`);
const audioCall = "new Audio(CLIP_BASE + file)";
if (!html.includes(audioCall)) throw new Error("Audio(CLIP_BASE + file) call not found");
html = html.replace(audioCall, "new Audio(VOICE_DATA[file] || CLIP_BASE + file)");

// standalone: allow data: in the page's own CSP
const standalone = html.replace(
  /(<meta http-equiv="Content-Security-Policy" content="[^"]*)"/,
  (_, csp) => csp.replace("font-src 'self' file:", "font-src 'self' file: data:").replace("media-src 'self' file:", "media-src 'self' file: data:") + '"',
);
writeFileSync(join(outDir, "drive-product-demo.standalone.html"), standalone);

// artifact fragment: shed the document shell and meta tags; keep <title>
const fragment = standalone
  .replace(/^<!DOCTYPE html>\s*/i, "")
  .replace(/<html[^>]*>\s*/i, "")
  .replace(/<\/html>\s*$/i, "")
  .replace(/<head>\s*/i, "")
  .replace(/<\/head>\s*/i, "")
  .replace(/<body>\s*/i, "")
  .replace(/<\/body>\s*/i, "")
  .replace(/<meta [^>]*>\s*/gi, "");
writeFileSync(join(outDir, "drive-product-demo.artifact.html"), fragment);

const mb = (n) => (n / 1048576).toFixed(2) + " MB";
console.log(
  `built to ${outDir}\n` +
    `  standalone: ${mb(standalone.length)}  fragment: ${mb(fragment.length)}\n` +
    `  inlined: ${clips.length} voice clips, ${mb(fontBytes)} of fonts`,
);
