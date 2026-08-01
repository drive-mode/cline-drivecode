// Regression smoke for drive-product-demo.html, run against the real canvas
// in headless Chrome. Checks:
//   1. every beat renders via __DRIVE_DEMO__.goTo(i) in light AND dark theme
//      at 1280x640 with zero page scroll and zero pageerrors;
//   2. every beat's cursor spec resolves against the DOM it is performed on
//      (the PREVIOUS beat's render, unless spec.when === "after"), lands
//      in-viewport, and every click target is a <button>; hover specs
//      (cursor or cursorAfter) resolve every path waypoint the same way;
//   3. voice registry integrity: CLIPS / CLIP_SEQS / SPEECH_CLIPS keys are
//      real beat ids and every referenced clip (plus inline beat input.clip)
//      exists in ../../assets/demos/voice/;
//   4. self-referential truth: the a3-walk debug session quotes the
//      canvas's REAL guard at its REAL line numbers, the a2-narration rg
//      terminal matches a live re-run of the same search, and the editor
//      excerpts shown for the canvas / for this script exist verbatim;
//   5. node identity: a beat that leaves the feed slice unchanged keeps
//      the same message node — the differential guard's own regression;
//   6. a ~15s autoplay smoke from beat 0: playback starts and beats
//      advance;
//   7. intro overlay: visible on fresh load, dismissed into playback by
//      #btn-play, dismissed into explore mode (not playing) by Esc;
//   8. network silence: across the whole run (loads, beat walk, autoplay)
//      no request ever leaves file:// — the canvas self-hosts its fonts
//      and pins itself with a CSP, so any http(s) request is a regression.
//   9. muted read-along pacing: with the voice toggle off, a narration
//      beat during autoplay holds at least words x 300ms instead of
//      racing its authored dwell (measured on a3-bug, the worst line);
//  10. CC stickiness: the strip toggle records a tri-state pref
//      ("drive-demo-cc") — user-opened captions survive beat advances,
//      pref "off" beats a scripted ccOpen, clearing the pref returns
//      scripted behavior;
//  11. Space activates focused buttons: keydown on a focused non-transport
//      button must NOT start playback (the button's native activation
//      runs instead); Space on the page background still drives transport;
//  12. caption slots reserve a fixed number of lines (no layout shift)
//      and never clamp words away: every beat's narration slot and
//      caption strip fit inside the reserve at 1280x640 AND 390x844;
//  13. contrast: the --dim text tier clears WCAG AA 4.5:1 against --bg
//      and --panel in both themes (computed from live tokens);
//  14) contain-fit: on every beat that floats a presented/held artifact
//      card over the workspace WHILE the deck is visible, the card has
//      no internal vertical overflow at 1280x640 and an SVG artifact's
//      rendered box stays inside the screen body (rescale, not crop);
//  15) large viewports: at 1920x1080 the app column caps at ~1440px and
//      the VS Code window fills >= 85% of the screen body it gets;
//  16) end packet: the a7-end-packet handoff panel hugs its content
//      (no more than 25% dead space) instead of sizing to the room;
//  17) maturity badges: PLANNED must not wear the amber live/voice hue
//      in either theme (probed against the retired amber styling);
//  18) takeover beat (a2-you-show): presenter bar reads "You are
//      presenting" (other sharers keep "is"), the pin holds the pre-fix
//      mock with both caption-jump spots rendered;
//  19) takeover choreography: during autoplay at a2-you-show the
//      simulated cursor really glides toward spot A then spot B across
//      the pinned mock (two samples ~1.6s apart) and wears the hover
//      ring on a waypoint;
//  20) reduced motion: the takeover mock degrades to the static
//      composition — no jump loop, both caption bars visible, the
//      "jumps A -> B" annotation shown.
//  21) interactive VS Code: the shared editor is operable — every tab /
//      explorer row / panel tab is a labelled <button>; the explorer
//      opens verify.js and the editor shows an excerpt VERBATIM from
//      this file (sampled against disk); FILE_BODIES stays honest
//      (canvas excerpt verbatim, PR_BODY.md matches the a10 write-up,
//      package.json parses); the beat's tab restores the scripted
//      editor; panel tabs swap bodies with TERMINAL keeping the beat's
//      terminal; one beat of navigation clears the whole view override;
//      and the a3-walk debug session survives an interaction round-trip.
//      The battery's LAST check compares every `bun verify.js`
//      success line the demo shows against this run's real beat/check
//      counts.
//  22) SyncCue — narration is the beat's clock: the engine surface
//      (__DRIVE_DEMO__.sayClock / bindSayDuration) exists, every beat's
//      `sync` entry has a sane fraction and a target that resolves at
//      its beat; at the reference beat (a3-test) under VOICED autoplay
//      the terminal OK line and TEST card are still veiled (.cued) at
//      ~0.5s, revealed by ~2.5s with the complete chime logged ~1.2s
//      AFTER beat entry (not at entry), and the say-hl accent applied
//      by ~4s; static entry shows the end state (everything revealed,
//      zero .cued remnants, accent on, no clock) and the accent does
//      not outlive its beat; with the voice toggle OFF the same cues
//      fire on the synthetic words x 350ms clock.
//
// Run from this directory. The empty package.json seed is load-bearing:
// without it `bun add` walks up and attaches the dep to docs/package.json.
//   echo '{}' > package.json && bun add puppeteer-core@23 && bun verify.js
// Deps are installed at run time only — never commit package.json, bun.lock,
// or node_modules/ from this directory.
// Chrome binary comes from CHROME_PATH, falling back to the platform default.

const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer-core");

const HERE = __dirname.replace(/\\/g, "/");
const CANVAS = HERE + "/drive-product-demo.html";
const VOICE_DIR = path.resolve(HERE, "../../assets/demos/voice").replace(/\\/g, "/");
const EXPECTED_BEATS = 47; // update when beats are intentionally added/removed

const CHROME = process.env.CHROME_PATH ||
  (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "google-chrome");

const failures = [];
let checks = 0;
function check(ok, msg) {
  checks++;
  if (!ok) failures.push(msg);
}

// Chrome's file:// loader breaks on Windows MAX_PATH-deep checkouts, so
// stage docs/drivecode in a short temp dir there; load in place elsewhere.
function stage() {
  const src = path.resolve(HERE, "../..");
  if (process.platform !== "win32") {
    return { root: src.replace(/\\/g, "/"), cleanup: function () {} };
  }
  const tmp = path.join(os.tmpdir(), "drive-verify").replace(/\\/g, "/");
  fs.rmSync(tmp, { recursive: true, force: true });
  // Skip the run-time deps installed next to this script.
  fs.cpSync(src, tmp, { recursive: true, filter: function (p) {
    return p.indexOf("node_modules") === -1;
  } });
  return { root: tmp, cleanup: function () { fs.rmSync(tmp, { recursive: true, force: true }); } };
}

// The three clip registries are IIFE-scoped (not on __DRIVE_DEMO__), so
// slice their object literals out of the source with a brace counter.
function objectLiteral(src, name) {
  const at = src.indexOf("const " + name + " = {");
  if (at === -1) return null;
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
      if (i >= src.length) return null;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

function checkRegistries(beats) {
  const html = fs.readFileSync(CANVAS, "utf8");
  const beatIds = new Set(beats.map(function (b) { return b.id; }));
  const voiceFiles = new Set(fs.readdirSync(VOICE_DIR));
  ["CLIPS", "CLIP_SEQS", "SPEECH_CLIPS"].forEach(function (name) {
    const block = objectLiteral(html, name);
    check(!!block, "registry " + name + " not found in canvas source");
    if (!block) return;
    for (const m of block.matchAll(/"([^"]+)"\s*:/g)) {
      check(beatIds.has(m[1]), name + ' key "' + m[1] + '" is not a beat id');
    }
    for (const m of block.matchAll(/"([^"]+\.mp3)"/g)) {
      check(voiceFiles.has(m[1]), name + " clip " + m[1] + " missing from assets/demos/voice/");
    }
  });
  beats.forEach(function (b) {
    if (b.inputClip) {
      check(voiceFiles.has(b.inputClip),
        "beat " + b.id + " input.clip " + b.inputClip + " missing from assets/demos/voice/");
    }
  });
}

// Runs in the page: for every consecutive beat pair whose feed slice is
// unchanged, the first message node must survive the re-render untouched.
// assert: same node before and after a beat
function nodeIdentityPairs() {
  const D = window.__DRIVE_DEMO__;
  function feedSlice(s) {
    const feedEmpty = s.surface === "chat" && !s.feedMessages.length;
    return JSON.stringify({ m: s.feedMessages, s: s.sinceYouLeft, e: feedEmpty });
  }
  const pairs = [];
  for (let i = 1; i < D.beatCount; i++) {
    if (feedSlice(D.seek(D.beats, i - 1)) !== feedSlice(D.seek(D.beats, i))) continue;
    D.goTo(i - 1);
    const before = document.querySelector("#feed .msg");
    if (!before) continue;
    D.goTo(i);
    const same = before === document.querySelector("#feed .msg");
    pairs.push({ beat: D.beats[i].id, same: same });
  }
  return pairs;
}

// Runs in the page: collect every claim the demo makes about its own
// source — the walk artifact's quoted lines, the rg terminal, the editor
// excerpts, and each terminal's claimed `bun verify.js` success line.
function sourceClaims() {
  const byId = {};
  window.__DRIVE_DEMO__.beats.forEach(function (b) { byId[b.id] = b; });
  function work(id) { return byId[id].patch.stage.work; }
  const walkBody = byId["a3-walk"].patch.stage.show.body;
  const okLines = [];
  window.__DRIVE_DEMO__.beats.forEach(function (b) {
    const w = b.patch && b.patch.stage && b.patch.stage.work;
    ((w && w.term) || []).forEach(function (l) {
      const m = /^OK: (\d+) beats, (\d+) checks$/.exec(l.t);
      if (m) okLines.push({ beat: b.id, beats: +m[1], checks: +m[2] });
    });
  });
  return {
    walk: {
      file: walkBody.file,
      range: walkBody.range,
      lines: walkBody.lines.map(function (l) { return { n: l.n, t: l.t }; }),
    },
    rg: work("a2-narration").term.map(function (l) { return l.t; }),
    guardEcho: work("a5-riley").code.map(function (l) { return l.t; }),
    verifyEcho: work("a5-sharer").code.map(function (l) { return l.t; })
      .concat([work("a5-sharer").typing]),
    okLines: okLines,
  };
}

async function main() {
  const staged = stage();
  const url = encodeURI("file://" + (staged.root[0] === "/" ? "" : "/") +
    staged.root + "/design/canvases/drive-product-demo.html");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
    defaultViewport: { width: 1280, height: 640 },
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", function (e) { pageErrors.push(String((e && e.message) || e)); });
    // 8) collected across the ENTIRE run; asserted just before the last check.
    const extRequests = [];
    page.on("request", function (r) {
      if (/^https?:/i.test(r.url())) extRequests.push(r.url());
    });
    await page.goto(url, { waitUntil: "load" });
    // A canvas broken badly enough to never install the hook (e.g. a JS
    // syntax error) should fail with the page's own errors, not a timeout.
    await page.waitForFunction("!!window.__DRIVE_DEMO__", { timeout: 15000 })
      .catch(function () {
        throw new Error("__DRIVE_DEMO__ hook never appeared" +
          (pageErrors.length ? " - pageerrors: " + pageErrors.join(" | ") : ""));
      });

    // 7) Intro overlay: orient the cold viewer, then get out of the way.
    // #btn-play dismisses into playback; Esc (on a fresh reload) dismisses
    // into explore mode. The rest of the battery runs on the reloaded page.
    function introState() {
      const el = document.getElementById("intro-overlay");
      const cs = el ? getComputedStyle(el) : null;
      return {
        present: !!el,
        visible: !!cs && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0,
        playing: document.getElementById("btn-play").classList.contains("on"),
      };
    }
    let intro = await page.evaluate(introState);
    check(intro.present && intro.visible, "intro overlay not visible on fresh load");
    await page.click("#btn-play");
    await new Promise(function (res) { setTimeout(res, 500); });
    intro = await page.evaluate(introState);
    check(!intro.visible, "intro overlay still visible after clicking #btn-play");
    check(intro.playing, "intro overlay: #btn-play click did not start playback");
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction("!!window.__DRIVE_DEMO__", { timeout: 15000 });
    intro = await page.evaluate(introState);
    check(intro.present && intro.visible, "intro overlay not visible on fresh reload");
    await page.keyboard.press("Escape");
    await new Promise(function (res) { setTimeout(res, 500); });
    intro = await page.evaluate(introState);
    check(!intro.visible, "intro overlay still visible after Esc");
    check(!intro.playing, "Esc dismissal must leave explore mode, not start playback");

    const beatCount = await page.evaluate(function () { return window.__DRIVE_DEMO__.beatCount; });
    check(beatCount === EXPECTED_BEATS,
      "beat count " + beatCount + " != " + EXPECTED_BEATS + " (update EXPECTED_BEATS if intentional)");
    const beats = await page.evaluate(function () {
      return window.__DRIVE_DEMO__.beats.map(function (b) {
        return { id: b.id, cursor: b.cursor || null, cursorAfter: b.cursorAfter || null,
          inputClip: (b.input && b.input.clip) || null };
      });
    });

    // 1) Every beat, both themes: renders with zero page scroll.
    for (const theme of ["light", "dark"]) {
      await page.evaluate(function (t) {
        document.documentElement.classList.toggle("dark", t === "dark");
      }, theme);
      for (let i = 0; i < beatCount; i++) {
        const r = await page.evaluate(function (i) {
          window.__DRIVE_DEMO__.goTo(i);
          const d = document.documentElement;
          return { sh: d.scrollHeight, sw: d.scrollWidth, ih: innerHeight, iw: innerWidth };
        }, i);
        check(r.sh <= r.ih, theme + " beat " + i + " (" + beats[i].id + "): vertical overflow " + r.sh + " > " + r.ih);
        check(r.sw <= r.iw, theme + " beat " + i + " (" + beats[i].id + "): horizontal overflow " + r.sw + " > " + r.iw);
      }
    }
    await page.evaluate(function () { document.documentElement.classList.remove("dark"); });

    // 2) Cursor specs resolve against the DOM they run on; clicks hit
    // <button>s. Hover specs are swept separately below.
    for (let i = 0; i < beatCount; i++) {
      const spec = beats[i].cursor;
      if (!spec || spec.action === "none" || spec.action === "hover") continue;
      const ctx = spec.when === "after" ? i : Math.max(0, i - 1);
      // The player performs the spec after the previous beat's dwell
      // (>= 1.2s), so layout transitions (drawer flex-basis .35s, rail
      // width .3s) have finished; let them finish here too.
      await page.evaluate(function (ctx) { window.__DRIVE_DEMO__.goTo(ctx); }, ctx);
      await new Promise(function (res) { setTimeout(res, 450); });
      const r = await page.evaluate(function (spec) {
        const el = document.querySelector(spec.target);
        if (!el) return { err: "no match" };
        if (!el.getClientRects().length) return { err: "not rendered" };
        const rect = el.getBoundingClientRect();
        const px = rect.left + rect.width / 2 + ((spec.offset && spec.offset.dx) || 0);
        const py = rect.top + rect.height / 2 + ((spec.offset && spec.offset.dy) || 0);
        if (px < 0 || py < 0 || px > innerWidth || py > innerHeight) return { err: "off-viewport" };
        return { tag: el.tagName };
      }, spec);
      check(!r.err, "beat " + i + " (" + beats[i].id + ") cursor " + spec.target +
        " against beat " + ctx + " DOM: " + r.err);
      if (!r.err && spec.action === "click") {
        check(r.tag === "BUTTON", "beat " + i + " (" + beats[i].id + ") click target " +
          spec.target + " is <" + r.tag.toLowerCase() + ">, not <button>");
      }
    }

    // 2b) Hover specs (cursor or cursorAfter): every path waypoint must
    // resolve, render, and land in-viewport against the DOM the spec
    // performs on (when === "after" -> the beat's OWN render). Mirrors
    // the click-target sweep; hover targets need not be <button>s.
    for (let i = 0; i < beatCount; i++) {
      for (const spec of [beats[i].cursor, beats[i].cursorAfter]) {
        if (!spec || spec.action !== "hover") continue;
        const ctx = spec.when === "after" ? i : Math.max(0, i - 1);
        await page.evaluate(function (ctx) { window.__DRIVE_DEMO__.goTo(ctx); }, ctx);
        await new Promise(function (res) { setTimeout(res, 450); });
        for (const sel of spec.path || []) {
          const r = await page.evaluate(function (sel) {
            const el = document.querySelector(sel);
            if (!el) return { err: "no match" };
            if (!el.getClientRects().length) return { err: "not rendered" };
            const rect = el.getBoundingClientRect();
            const px = rect.left + rect.width / 2;
            const py = rect.top + rect.height / 2;
            if (px < 0 || py < 0 || px > innerWidth || py > innerHeight) return { err: "off-viewport" };
            return {};
          }, sel);
          check(!r.err, "beat " + i + " (" + beats[i].id + ") hover waypoint " + sel +
            " against beat " + ctx + " DOM: " + r.err);
        }
      }
    }

    // 3) Clip registries.
    checkRegistries(beats);

    // 4) Self-referential truth: line-number and source claims stay live.
    const claims = await page.evaluate(sourceClaims);
    const src = fs.readFileSync(CANVAS, "utf8").split(/\r?\n/);
    function located(t) {
      const at = src.indexOf(t);
      return at < 0 ? "text is nowhere in the file" : "actually line " + (at + 1);
    }
    check(claims.walk.file === path.basename(CANVAS),
      "walk artifact names " + claims.walk.file + ", not " + path.basename(CANVAS));
    claims.walk.lines.forEach(function (l) {
      check(src[l.n - 1] === l.t,
        "walk line number drifted: claimed " + l.n + " for " + JSON.stringify(l.t) +
        " - " + located(l.t));
    });
    const wFirst = claims.walk.lines[0];
    const wLast = claims.walk.lines[claims.walk.lines.length - 1];
    check(claims.walk.range === "L" + wFirst.n + "–L" + wLast.n,
      "walk range " + claims.walk.range + " != quoted lines L" + wFirst.n + "-L" + wLast.n);
    const rgPat = /^ {6}\w+\.innerHTML = "";$/;
    const rgActual = src
      .map(function (t, i) { return rgPat.test(t) ? i + 1 + ":" + t : null; })
      .filter(Boolean);
    check(JSON.stringify(rgActual) === JSON.stringify(claims.rg.slice(1)),
      "a2-narration rg terminal drifted: screen shows " + JSON.stringify(claims.rg.slice(1)) +
      ", live search finds " + JSON.stringify(rgActual));
    claims.guardEcho.forEach(function (t) {
      check(src.indexOf(t) >= 0,
        "a5-riley editor line is not verbatim in the canvas: " + JSON.stringify(t));
    });
    const verifySrc = fs.readFileSync(__filename, "utf8");
    claims.verifyEcho.forEach(function (t) {
      check(verifySrc.indexOf("\n" + t) >= 0,
        "a5-sharer editor line is not verbatim in verify.js: " + JSON.stringify(t));
    });

    // 5) Node identity: the differential guard's own regression.
    const pairs = await page.evaluate(nodeIdentityPairs);
    check(pairs.length > 0, "node identity: no beat pair leaves the feed slice unchanged");
    pairs.forEach(function (p) {
      check(p.same,
        "node identity: feed re-mounted entering " + p.beat + " though its slice did not change");
    });

    // 6) Autoplay smoke: ~15s from beat 0.
    await page.evaluate(function () { window.__DRIVE_DEMO__.goTo(0); });
    await page.click("#btn-play");
    await new Promise(function (res) { setTimeout(res, 15000); });
    const auto = await page.evaluate(function () {
      return {
        idx: window.__DRIVE_DEMO__.getIndex ? window.__DRIVE_DEMO__.getIndex() : -1,
        playing: document.getElementById("btn-play").classList.contains("on"),
      };
    });
    check(auto.playing, "autoplay: player not in playing state after 15s");
    check(auto.idx > 0, "autoplay: still on beat " + auto.idx + " after 15s - beats not advancing");

    // 9) Muted read-along pacing: a3-bug (the worst line) must hold for a
    // readable span, not its authored dwell. The poll starts before Play
    // so the enter/leave timestamps bracket the whole beat.
    const mutedIdx = beats.findIndex(function (b) { return b.id === "a3-bug"; });
    check(mutedIdx > 0, "muted pacing: beat a3-bug not found");
    await page.evaluate(function (i) { window.__DRIVE_DEMO__.goTo(i); }, mutedIdx - 1);
    const voiceWasOn = await page.$eval("#btn-voice", function (el) {
      return el.getAttribute("aria-pressed") === "true";
    });
    if (voiceWasOn) await page.click("#btn-voice");
    const holdP = page.evaluate(function (idx) {
      return new Promise(function (res) {
        const D = window.__DRIVE_DEMO__;
        let t0 = 0;
        const iv = setInterval(function () {
          const i = D.getIndex();
          if (!t0 && i === idx) t0 = performance.now();
          else if (t0 && i !== idx) { clearInterval(iv); res(performance.now() - t0); }
        }, 40);
        setTimeout(function () { clearInterval(iv); res(-1); }, 40000);
      });
    }, mutedIdx);
    await page.click("#btn-play");
    const holdMs = await holdP;
    const mutedWords = await page.evaluate(function (i) {
      return window.__DRIVE_DEMO__.pacing.spokenWords[i];
    }, mutedIdx);
    check(mutedWords > 20, "muted pacing: a3-bug spokenWords " + mutedWords + " - expected a long line");
    check(holdMs >= mutedWords * 300,
      "muted pacing: a3-bug held " + Math.round(holdMs) + "ms < " + (mutedWords * 300) +
      "ms (words " + mutedWords + " x 300)");
    await page.evaluate(function () { window.__DRIVE_DEMO__.goTo(0); }); // pause
    if (voiceWasOn) await page.click("#btn-voice"); // restore the toggle

    // 10) CC stickiness: the pref survives beat advances and overrides the
    // script in both directions; clearing it returns scripted behavior.
    function ccState() {
      let stored = null;
      try { stored = localStorage.getItem("drive-demo-cc"); } catch (e) { /* ignore */ }
      return {
        open: document.querySelector(".feed-main").classList.contains("cc-open"),
        pressed: document.getElementById("strip-cc").getAttribute("aria-pressed"),
        stored: stored,
      };
    }
    // #strip-cc is only clickable while the call strip shows (inCall &&
    // driveOn), so pick a consecutive in-call scripted-closed pair for the
    // click legs, plus the first scripted-open beat.
    const ccIdx = await page.evaluate(function () {
      const D = window.__DRIVE_DEMO__;
      let open = -1;
      let closedPair = -1;
      for (let i = 0; i + 1 < D.beatCount; i++) {
        const s = D.seek(D.beats, i);
        if (open < 0 && s.ccOpen) open = i;
        if (closedPair < 0 && s.inCall && s.driveOn && !s.ccOpen) {
          const n = D.seek(D.beats, i + 1);
          if (n.inCall && n.driveOn && !n.ccOpen) closedPair = i;
        }
      }
      return { open: open, closedPair: closedPair };
    });
    check(ccIdx.open >= 0, "CC stickiness: no beat scripts ccOpen");
    check(ccIdx.closedPair >= 0, "CC stickiness: no consecutive in-call scripted-closed beat pair");
    await page.evaluate(function (i) {
      window.__DRIVE_DEMO__.cc.setPref(null);
      window.__DRIVE_DEMO__.goTo(i);
    }, ccIdx.closedPair);
    let cc = await page.evaluate(ccState);
    check(!cc.open && cc.pressed === "false",
      "CC stickiness: scripted-closed beat should start with the panel closed");
    await page.click("#strip-cc");
    cc = await page.evaluate(ccState);
    check(cc.open && cc.pressed === "true" && cc.stored === "on",
      "CC stickiness: click should open the panel and store pref 'on' - got " + JSON.stringify(cc));
    await page.evaluate(function (i) { window.__DRIVE_DEMO__.goTo(i + 1); }, ccIdx.closedPair);
    cc = await page.evaluate(ccState);
    check(cc.open && cc.pressed === "true",
      "CC stickiness: user-opened panel must survive a beat advance - got " + JSON.stringify(cc));
    await page.click("#strip-cc");
    cc = await page.evaluate(ccState);
    check(!cc.open && cc.pressed === "false" && cc.stored === "off",
      "CC stickiness: click on an open panel should close it and store 'off' - got " + JSON.stringify(cc));
    await page.evaluate(function (i) { window.__DRIVE_DEMO__.goTo(i); }, ccIdx.open);
    cc = await page.evaluate(ccState);
    check(!cc.open, "CC stickiness: pref 'off' must beat the scripted ccOpen beat");
    await page.evaluate(function (i) {
      window.__DRIVE_DEMO__.cc.setPref(null);
      window.__DRIVE_DEMO__.goTo(i);
    }, ccIdx.open);
    cc = await page.evaluate(ccState);
    check(cc.open && cc.stored === null,
      "CC stickiness: clearing the pref must return scripted behavior (open) - got " + JSON.stringify(cc));
    await page.evaluate(function (i) { window.__DRIVE_DEMO__.goTo(i); }, ccIdx.closedPair);
    cc = await page.evaluate(ccState);
    check(!cc.open, "CC stickiness: cleared pref, scripted-closed beat must close the panel");

    // 11) Space must activate a focused button, not hijack the transport.
    const themeBefore = await page.evaluate(function () {
      return document.documentElement.classList.contains("dark");
    });
    await page.focus("#btn-theme");
    await page.keyboard.press("Space");
    await new Promise(function (res) { setTimeout(res, 200); });
    const sp = await page.evaluate(function () {
      return {
        dark: document.documentElement.classList.contains("dark"),
        playing: document.getElementById("btn-play").classList.contains("on"),
      };
    });
    check(!sp.playing, "Space on a focused button must not start playback");
    check(sp.dark !== themeBefore, "Space on #btn-theme must activate the button (theme did not toggle)");
    await page.keyboard.press("Space"); // still focused - toggle the theme back
    await page.evaluate(function () {
      if (document.activeElement) document.activeElement.blur();
    });
    await page.keyboard.press("Space");
    await new Promise(function (res) { setTimeout(res, 200); });
    const spBg = await page.evaluate(function () {
      return document.getElementById("btn-play").classList.contains("on");
    });
    check(spBg, "Space on the page background must still drive the transport");
    await page.evaluate(function () { window.__DRIVE_DEMO__.goTo(0); }); // pause

    // 12) Caption slots: fixed reserve, wrapped, and no beat's text is
    // clamped away (content height fits the reserved height) at the
    // laptop floor AND on a phone. scrollHeight reports the full flowed
    // text, so a hidden third/fifth line shows up as sh > h.
    async function walkCaptions(label) {
      const rows = await page.evaluate(function () {
        const D = window.__DRIVE_DEMO__;
        const out = [];
        for (let i = 0; i < D.beatCount; i++) {
          D.goTo(i);
          const slot = document.querySelector("#spotlight .screen .caption-slot");
          const strip = document.querySelector(".caption .text");
          // Skip the slot when the call surface is hidden (other surfaces
          // display:none it - heights read 0 there, not a real measure).
          const slotShown = slot && slot.getClientRects().length > 0;
          out.push({
            id: D.beats[i].id,
            slot: slotShown ? { h: slot.clientHeight, sh: slot.scrollHeight,
              ws: getComputedStyle(slot).whiteSpace } : null,
            strip: { h: strip.clientHeight, sh: strip.scrollHeight,
              ws: getComputedStyle(strip).whiteSpace },
          });
        }
        return out;
      });
      const slotHeights = new Set();
      const stripHeights = new Set();
      rows.forEach(function (r) {
        if (r.slot) {
          slotHeights.add(r.slot.h);
          check(r.slot.ws === "normal", label + " " + r.id + ": narration slot must wrap (white-space " + r.slot.ws + ")");
          check(r.slot.sh <= r.slot.h + 1,
            label + " " + r.id + ": narration clamped away - content " + r.slot.sh + "px > reserve " + r.slot.h + "px");
        }
        stripHeights.add(r.strip.h);
        check(r.strip.ws === "normal", label + " " + r.id + ": caption strip must wrap (white-space " + r.strip.ws + ")");
        check(r.strip.sh <= r.strip.h + 1,
          label + " " + r.id + ": caption clamped away - content " + r.strip.sh + "px > reserve " + r.strip.h + "px");
      });
      check(slotHeights.size === 1,
        label + ": narration slot height must be one fixed reserve, saw " + JSON.stringify([...slotHeights]));
      check(stripHeights.size === 1,
        label + ": caption strip height must be one fixed reserve, saw " + JSON.stringify([...stripHeights]));
    }
    await walkCaptions("captions@1280x640");
    await page.setViewport({ width: 390, height: 844 });
    await new Promise(function (res) { setTimeout(res, 300); });
    await walkCaptions("captions@390x844");
    await page.setViewport({ width: 1280, height: 640 });
    await new Promise(function (res) { setTimeout(res, 300); });
    await page.evaluate(function () { window.__DRIVE_DEMO__.goTo(0); });

    // 13) Contrast: --dim over --bg and --panel clears WCAG AA in both
    // themes, computed from the live tokens (alpha composited first).
    const themeTokens = await page.evaluate(function () {
      function grab() {
        const cs = getComputedStyle(document.documentElement);
        return {
          dim: cs.getPropertyValue("--dim").trim(),
          bg: cs.getPropertyValue("--bg").trim(),
          panel: cs.getPropertyValue("--panel").trim(),
        };
      }
      const light = grab();
      document.documentElement.classList.add("dark");
      const dark = grab();
      document.documentElement.classList.remove("dark");
      return { light: light, dark: dark };
    });
    function parseColor(s) {
      let m = /^#([0-9a-f]{6})$/i.exec(s);
      if (m) {
        return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16),
          b: parseInt(m[1].slice(4, 6), 16), a: 1 };
      }
      m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
      if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
      return null;
    }
    function luminance(c) {
      function lin(v) {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      }
      return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    }
    function contrast(fg, bg) {
      const c = { r: fg.a * fg.r + (1 - fg.a) * bg.r, g: fg.a * fg.g + (1 - fg.a) * bg.g,
        b: fg.a * fg.b + (1 - fg.a) * bg.b, a: 1 };
      const l1 = luminance(c);
      const l2 = luminance(bg);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }
    ["light", "dark"].forEach(function (theme) {
      const t = themeTokens[theme];
      const dim = parseColor(t.dim);
      check(!!dim, theme + " --dim did not parse: " + JSON.stringify(t.dim));
      ["bg", "panel"].forEach(function (surface) {
        const s = parseColor(t[surface]);
        check(!!s, theme + " --" + surface + " did not parse: " + JSON.stringify(t[surface]));
        if (!dim || !s) return;
        const ratio = contrast(dim, s);
        check(ratio >= 4.5,
          theme + " --dim on --" + surface + " is " + ratio.toFixed(2) + ":1, below WCAG AA 4.5:1");
      });
    });

    // 14) Contain-fit: sticky-hold floats an artifact card over the
    // workspace while the deck compresses the screen — the card must
    // shrink-and-rescale, never crop, at the 1280x640 floor.
    const fitRows = await page.evaluate(function () {
      const D = window.__DRIVE_DEMO__;
      const out = [];
      for (let i = 0; i < D.beatCount; i++) {
        D.goTo(i);
        const card = document.querySelector("#spotlight .stage-overlay .ov-card");
        const deck = document.querySelector("#spotlight .cards");
        if (!card || !card.getClientRects().length) continue;
        if (!deck || !deck.getClientRects().length) continue;
        const body = document.querySelector("#spotlight .screen-body");
        const svg = card.querySelector(".stage-diagram svg");
        const br = body.getBoundingClientRect();
        const sr = svg ? svg.getBoundingClientRect() : null;
        out.push({
          id: D.beats[i].id,
          sh: card.scrollHeight,
          ch: card.clientHeight,
          svgIn: sr === null ? null :
            sr.top >= br.top - 1 && sr.bottom <= br.bottom + 1 &&
            sr.left >= br.left - 1 && sr.right <= br.right + 1,
        });
      }
      return out;
    });
    check(fitRows.length >= 3,
      "contain-fit: expected at least 3 held-card+deck beats (a3-edit/command/test), saw " + fitRows.length);
    fitRows.forEach(function (r) {
      check(r.sh <= r.ch + 1,
        "contain-fit " + r.id + ": overlay card overflows vertically - content " + r.sh + "px > box " + r.ch + "px");
      if (r.svgIn !== null) {
        check(r.svgIn, "contain-fit " + r.id + ": artifact SVG spills outside the screen body");
      }
    });

    // 15) Large viewports: the monitor illusion — the app column caps at
    // ~1440px and the VS Code window fills the screen body it gets.
    await page.setViewport({ width: 1920, height: 1080 });
    await new Promise(function (res) { setTimeout(res, 300); });
    const wsIdx = beats.findIndex(function (b) { return b.id === "a5-sharer"; });
    check(wsIdx > 0, "large viewport: workspace beat a5-sharer not found");
    const big = await page.evaluate(function (i) {
      window.__DRIVE_DEMO__.goTo(i);
      const main = document.querySelector(".main-body");
      const body = document.querySelector("#spotlight .screen-body");
      const vsc = document.querySelector("#spotlight .vsc");
      return {
        main: main.getBoundingClientRect().width,
        body: body ? body.clientWidth : 0,
        vsc: vsc ? vsc.getBoundingClientRect().width : 0,
      };
    }, wsIdx);
    check(big.main <= 1441,
      "large viewport: main column is " + Math.round(big.main) + "px wide, expected <= 1440");
    check(big.vsc >= big.body * 0.85,
      "large viewport: .vsc " + Math.round(big.vsc) + "px < 85% of screen body " + Math.round(big.body) + "px");
    await page.setViewport({ width: 1280, height: 640 });
    await new Promise(function (res) { setTimeout(res, 300); });

    // 16) End packet: the handoff panel hugs its content, centered over
    // the dimmed room — not a room-sized sheet of dead space.
    const packetIdx = beats.findIndex(function (b) { return b.id === "a7-end-packet"; });
    check(packetIdx > 0, "end packet: beat a7-end-packet not found");
    const pk = await page.evaluate(function (i) {
      window.__DRIVE_DEMO__.goTo(i);
      const panel = document.querySelector("#handoff .handoff-panel");
      if (!panel || !panel.getClientRects().length) return null;
      const cs = getComputedStyle(panel);
      let top = Infinity;
      let bottom = -Infinity;
      Array.prototype.forEach.call(panel.children, function (c) {
        const r = c.getBoundingClientRect();
        if (!r.height) return;
        top = Math.min(top, r.top);
        bottom = Math.max(bottom, r.bottom);
      });
      const content = (bottom > top ? bottom - top : 0) +
        parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      return { h: panel.getBoundingClientRect().height, content: content };
    }, packetIdx);
    check(!!pk, "end packet: .handoff-panel not rendered at a7-end-packet");
    if (pk) {
      check(pk.h <= pk.content * 1.25,
        "end packet: panel " + Math.round(pk.h) + "px vs content " + Math.round(pk.content) +
        "px - more than 25% dead space");
    }

    // 17) Maturity badges: PLANNED must not wear the amber live hue in
    // either theme — the probe reproduces the retired amber styling.
    for (const theme of ["light", "dark"]) {
      await page.evaluate(function (t) {
        document.documentElement.classList.toggle("dark", t === "dark");
      }, theme);
      const badge = await page.evaluate(function () {
        const el = document.querySelector(".badge.planned");
        if (!el) return null;
        const probe = document.createElement("span");
        probe.style.cssText =
          "position:absolute;color:var(--live-t);" +
          "border:0.8px solid color-mix(in srgb, var(--live) 45%, transparent);" +
          "background:color-mix(in srgb, var(--live) 12%, transparent);";
        document.body.appendChild(probe);
        const pc = getComputedStyle(probe);
        const bc = getComputedStyle(el);
        const out = {
          color: [bc.color, pc.color],
          border: [bc.borderTopColor, pc.borderTopColor],
          bg: [bc.backgroundColor, pc.backgroundColor],
        };
        probe.remove();
        return out;
      });
      check(!!badge, theme + " badge: no .badge.planned in the DOM");
      if (badge) {
        check(badge.color[0] !== badge.color[1], theme + " badge: PLANNED text is still the amber live tint");
        check(badge.border[0] !== badge.border[1], theme + " badge: PLANNED border is still the amber live mix");
        check(badge.bg[0] !== badge.bg[1], theme + " badge: PLANNED background is still the amber live mix");
      }
    }
    await page.evaluate(function () { document.documentElement.classList.remove("dark"); });

    // 18) Takeover beat: sharer is You, the pin holds the pre-fix mock
    // with both caption-jump spots, and the presenter bar's grammar is
    // right in both persons.
    const showIdx = beats.findIndex(function (b) { return b.id === "a2-you-show"; });
    check(showIdx > 0, "takeover: beat a2-you-show not found");
    const takeover = await page.evaluate(function (i) {
      const D = window.__DRIVE_DEMO__;
      D.goTo(i);
      const s = D.seek(D.beats, i);
      const bar = document.querySelector("#spotlight .presenter-bar");
      const pin = document.querySelector("#spotlight .screen-pin");
      const mock = document.querySelector("#spotlight .pin-jump");
      function spot(sel) {
        const el = document.querySelector(sel);
        if (!el || !el.getClientRects().length) return null;
        return { cap: !!el.querySelector(".pj-cap") };
      }
      return {
        sharer: s.stage.sharer,
        pin: !!(pin && pin.getClientRects().length),
        mock: !!(mock && mock.getClientRects().length),
        bar: bar ? bar.textContent : "",
        a: spot("#pin-jump-a"),
        b: spot("#pin-jump-b"),
      };
    }, showIdx);
    check(takeover.sharer === "You", "takeover: sharer is " + JSON.stringify(takeover.sharer) + ", not You");
    check(takeover.pin, "takeover: human pin not rendered at a2-you-show");
    check(takeover.mock, "takeover: pre-fix mock (.pin-jump) not rendered inside the pin");
    check(/You\s*are presenting/.test(takeover.bar),
      "takeover: presenter bar must read 'You are presenting' - got " + JSON.stringify(takeover.bar));
    check(!!takeover.a && takeover.a.cap,
      "takeover: jump spot A (#pin-jump-a) missing, hidden, or lacking its caption bar");
    check(!!takeover.b && takeover.b.cap,
      "takeover: jump spot B (#pin-jump-b) missing, hidden, or lacking its caption bar");
    const rileyIdx = beats.findIndex(function (b) { return b.id === "a5-sharer"; });
    const rileyBar = await page.evaluate(function (i) {
      window.__DRIVE_DEMO__.goTo(i);
      const bar = document.querySelector("#spotlight .presenter-bar");
      return bar ? bar.textContent : "";
    }, rileyIdx);
    check(/Riley\s*is presenting/.test(rileyBar),
      "takeover: a third-person sharer must keep 'is presenting' - got " + JSON.stringify(rileyBar));

    // 19) Takeover choreography: replaying the beat under autoplay, the
    // simulated cursor performs the hover pass — sampled twice, it must
    // really move toward the waypoints and wear the hover ring. Sample 1
    // (~1s) falls in the spot-A dwell, sample 2 (~2.6s) in the spot-B
    // dwell; the beat advances no earlier than its 4.2s dwell.
    await page.evaluate(function (i) { window.__DRIVE_DEMO__.goTo(i); }, showIdx);
    const spots = await page.evaluate(function () {
      function c(sel) {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      return { a: c("#pin-jump-a"), b: c("#pin-jump-b") };
    });
    await page.click("#btn-play"); // play re-enters the current beat with choreography
    function cursorSample() {
      const t = getComputedStyle(document.getElementById("demo-cursor")).transform;
      const m = t === "none" ? { e: -9999, f: -9999 } : new DOMMatrixReadOnly(t);
      function ring(sel) {
        const el = document.querySelector(sel);
        return !!(el && el.classList.contains("demo-hovered"));
      }
      return { x: m.e, y: m.f, ringA: ring("#pin-jump-a"), ringB: ring("#pin-jump-b") };
    }
    await new Promise(function (res) { setTimeout(res, 1000); });
    const s1 = await page.evaluate(cursorSample);
    await new Promise(function (res) { setTimeout(res, 1600); });
    const s2 = await page.evaluate(cursorSample);
    await page.evaluate(function () { window.__DRIVE_DEMO__.goTo(0); }); // pause
    function dist(p, q) { return Math.hypot(p.x - q.x, p.y - q.y); }
    check(dist(s1, s2) > 40,
      "takeover autoplay: cursor barely moved between samples (" + Math.round(dist(s1, s2)) + "px)");
    check(dist(s2, spots.b) < dist(s1, spots.b),
      "takeover autoplay: cursor did not move toward spot B (" +
      Math.round(dist(s1, spots.b)) + "px -> " + Math.round(dist(s2, spots.b)) + "px)");
    check(dist(s1, spots.a) < 60 || dist(s2, spots.b) < 60,
      "takeover autoplay: neither sample landed on a waypoint (A@" +
      Math.round(dist(s1, spots.a)) + "px, B@" + Math.round(dist(s2, spots.b)) + "px)");
    check(s1.ringA || s1.ringB || s2.ringA || s2.ringB,
      "takeover autoplay: hover ring (.demo-hovered) never seen on a waypoint");

    // 20) Reduced motion: the takeover mock is a static composition —
    // no caption-jump loop, both caption bars visible, the annotation
    // labeling the jump instead of motion.
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction("!!window.__DRIVE_DEMO__", { timeout: 15000 });
    const rm = await page.evaluate(function (i) {
      window.__DRIVE_DEMO__.goTo(i);
      const capA = document.querySelector("#pin-jump-a .pj-cap");
      const capB = document.querySelector("#pin-jump-b .pj-cap");
      const arrow = document.querySelector(".pin-jump .pj-arrow");
      function anim(el) { return el ? getComputedStyle(el).animationName : "missing"; }
      return {
        animA: anim(capA),
        animB: anim(capB),
        opA: capA ? getComputedStyle(capA).opacity : "0",
        opB: capB ? getComputedStyle(capB).opacity : "0",
        arrow: arrow ? getComputedStyle(arrow).display : "missing",
      };
    }, showIdx);
    check(rm.animA === "none" && rm.animB === "none",
      "reduced motion: caption-jump loop still runs (animation " + rm.animA + " / " + rm.animB + ")");
    check(rm.opA === "1" && rm.opB === "1",
      "reduced motion: both caption bars must be visible (opacity " + rm.opA + " / " + rm.opB + ")");
    check(rm.arrow === "block",
      "reduced motion: 'jumps A -> B' annotation not shown (display " + rm.arrow + ")");
    await page.emulateMediaFeatures([]);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction("!!window.__DRIVE_DEMO__", { timeout: 15000 });

    // 21) Interactive VS Code: the shared editor is a real surface. At a
    // workspace beat the explorer opens verify.js (this file, verbatim),
    // panel tabs swap bodies, the beat's tab restores the scripted
    // editor, and beat navigation clears the override — script wins.
    const ivIdx = beats.findIndex(function (b) { return b.id === "a5-riley"; });
    check(ivIdx > 0, "interactive: beat a5-riley not found");
    await page.evaluate(function (i) { window.__DRIVE_DEMO__.goTo(i); }, ivIdx);
    await new Promise(function (res) { setTimeout(res, 300); });
    // Every interactive element of the window is a labelled <button>.
    const ivButtons = await page.evaluate(function () {
      const els = document.querySelectorAll(
        "#spotlight .vsc-tab, #spotlight .vsc-row, #spotlight .vsc-panel-head [data-panel]");
      return Array.prototype.map.call(els, function (el) {
        return { tag: el.tagName, label: el.getAttribute("aria-label") || "" };
      });
    });
    check(ivButtons.length >= 9,
      "interactive: expected >= 9 operable controls at a5-riley, saw " + ivButtons.length);
    ivButtons.forEach(function (b) {
      check(b.tag === "BUTTON" && b.label.length > 0,
        "interactive: <" + b.tag.toLowerCase() + "> control is not a labelled button");
    });
    // FILE_BODIES truth: user-openable file contents are honest.
    const bodies = await page.evaluate(function () {
      const out = {};
      const B = window.__DRIVE_DEMO__.vsc.bodies;
      Object.keys(B).forEach(function (k) {
        out[k] = B[k].code.map(function (l) { return l.t; });
      });
      return out;
    });
    const verifyLines = verifySrc.split(/\r?\n/);
    check((bodies["verify.js"] || []).length >= 20,
      "interactive: verify.js excerpt should be a real stretch (~25 lines), got " +
      (bodies["verify.js"] || []).length);
    (bodies["verify.js"] || []).forEach(function (t) {
      if (!t) return; // blank separator carries no claim
      check(verifyLines.indexOf(t) >= 0,
        "interactive: verify.js excerpt line is not verbatim in verify.js: " + JSON.stringify(t));
    });
    (bodies["drive-product-demo.html"] || []).forEach(function (t) {
      if (!t) return;
      check(src.indexOf(t) >= 0,
        "interactive: canvas excerpt line is not verbatim in the canvas: " + JSON.stringify(t));
    });
    const ivPr = await page.evaluate(function () {
      const byId = {};
      window.__DRIVE_DEMO__.beats.forEach(function (b) { byId[b.id] = b; });
      return byId["a10-explore"].patch.stage.work.code.map(function (l) { return l.t; });
    });
    check(JSON.stringify(bodies["PR_BODY.md"]) === JSON.stringify(ivPr),
      "interactive: PR_BODY.md body must match the a10-explore write-up - got " +
      JSON.stringify(bodies["PR_BODY.md"]));
    let ivPkgOk = true;
    try { JSON.parse((bodies["package.json"] || []).join("\n")); } catch (e) { ivPkgOk = false; }
    check(ivPkgOk, "interactive: package.json body must parse as JSON");
    // Explorer click opens verify.js: excerpt in the editor, breadcrumb
    // and status bar follow, and the on-screen line matches disk.
    await page.click('#spotlight .vsc-row[data-open="verify.js"]');
    const ivOpen = await page.evaluate(function () {
      function txt(sel) {
        const el = document.querySelector(sel);
        return el ? el.textContent : "";
      }
      return {
        tab: txt("#spotlight .vsc-tab.on"),
        first: txt("#spotlight .vsc-code .ws-cl .tx"),
        crumbs: txt("#spotlight .vsc-crumbs"),
        status: txt("#spotlight .vsc-status"),
      };
    });
    check(ivOpen.tab.indexOf("verify.js") >= 0,
      "interactive: verify.js tab not active after the explorer click - " + JSON.stringify(ivOpen.tab));
    check(ivOpen.first === (bodies["verify.js"] || [""])[0],
      "interactive: editor does not open on the excerpt's first line - " + JSON.stringify(ivOpen.first));
    check(verifyLines[0] === ivOpen.first,
      "interactive: sampled editor line must match verify.js on disk (line 1) - " + JSON.stringify(ivOpen.first));
    check(ivOpen.crumbs.indexOf("verify.js") >= 0,
      "interactive: breadcrumb did not follow the opened file - " + JSON.stringify(ivOpen.crumbs));
    check(ivOpen.status.indexOf("JavaScript") >= 0,
      "interactive: status bar language did not follow the opened file - " + JSON.stringify(ivOpen.status));
    // Panel tabs swap bodies; TERMINAL keeps the beat's terminal.
    function panelText() {
      return document.querySelector("#spotlight .vsc-term").textContent;
    }
    await page.click('#spotlight .vsc-panel-head [data-panel="problems"]');
    let ivPanel = await page.evaluate(panelText);
    check(ivPanel.indexOf("0 problems") >= 0,
      "interactive: PROBLEMS body missing its empty state - " + JSON.stringify(ivPanel));
    await page.click('#spotlight .vsc-panel-head [data-panel="output"]');
    ivPanel = await page.evaluate(panelText);
    check(ivPanel.indexOf("repaint skipped") >= 0,
      "interactive: OUTPUT body missing the render log - " + JSON.stringify(ivPanel));
    await page.click('#spotlight .vsc-panel-head [data-panel="terminal"]');
    ivPanel = await page.evaluate(panelText);
    check(ivPanel.indexOf("bun verify.js") >= 0,
      "interactive: TERMINAL did not keep the beat's terminal - " + JSON.stringify(ivPanel));
    // The beat's own tab restores the scripted editor…
    await page.click('#spotlight .vsc-tab[data-file="drive-product-demo.html"]');
    const ivBack = await page.evaluate(function (i) {
      const el = document.querySelector("#spotlight .vsc-code .ws-cl .tx");
      return {
        first: el ? el.textContent : "",
        beatFirst: window.__DRIVE_DEMO__.beats[i].patch.stage.work.code[0].t,
      };
    }, ivIdx);
    check(ivBack.first === ivBack.beatFirst,
      "interactive: beat tab did not restore the scripted editor - " + JSON.stringify(ivBack.first));
    // …and one beat of navigation clears the override wholesale: the next
    // beat's scripted file (Riley's verify.js editor) is active, not the
    // user-opened excerpt.
    await page.click('#spotlight .vsc-row[data-open="verify.js"]'); // leave an override behind
    await page.evaluate(function (i) { window.__DRIVE_DEMO__.goTo(i + 1); }, ivIdx);
    const ivNext = await page.evaluate(function (i) {
      const el = document.querySelector("#spotlight .vsc-code .ws-cl .tx");
      return {
        first: el ? el.textContent : "",
        beatFirst: window.__DRIVE_DEMO__.beats[i + 1].patch.stage.work.code[0].t,
        view: window.__DRIVE_DEMO__.vsc.getView(),
      };
    }, ivIdx);
    check(ivNext.first === ivNext.beatFirst,
      "interactive: beat advance must restore the scripted editor - " + JSON.stringify(ivNext.first));
    check(ivNext.view.file === null && ivNext.view.tabs.length === 0 && ivNext.view.panel === null,
      "interactive: view override must clear on beat navigation - " + JSON.stringify(ivNext.view));
    // The a3-walk debug session survives an interaction round-trip.
    const ivWalkIdx = beats.findIndex(function (b) { return b.id === "a3-walk"; });
    await page.evaluate(function (i) { window.__DRIVE_DEMO__.goTo(i); }, ivWalkIdx);
    await new Promise(function (res) { setTimeout(res, 300); });
    function dbgState() {
      const first = document.querySelector("#spotlight .vsc-code .ws-cl .tx");
      return {
        dbg: !!document.querySelector("#spotlight .vsc-debug"),
        bp: !!document.querySelector("#spotlight .ws-cl.dbg-bp"),
        ghost: !!document.querySelector("#spotlight .dbg-ghost"),
        first: first ? first.textContent : "",
      };
    }
    let ivDbg = await page.evaluate(dbgState);
    check(ivDbg.dbg && ivDbg.bp && ivDbg.ghost,
      "interactive: a3-walk debug session not rendered before the round-trip");
    await page.click('#spotlight .vsc-row[data-open="verify.js"]');
    ivDbg = await page.evaluate(dbgState);
    check(!ivDbg.dbg && ivDbg.first === (bodies["verify.js"] || [""])[0],
      "interactive: opening verify.js mid-walk should show the plain excerpt - " + JSON.stringify(ivDbg));
    await page.click('#spotlight .vsc-tab[data-file="drive-product-demo.html"]');
    ivDbg = await page.evaluate(dbgState);
    check(ivDbg.dbg && ivDbg.bp && ivDbg.ghost,
      "interactive: returning to the walk file must restore the debug session intact");
    await page.evaluate(function () { window.__DRIVE_DEMO__.goTo(0); });

    // 22) SyncCue: narration is the beat's clock.
    // 22a) Engine surface + every sync entry resolves at its beat.
    const scSurface = await page.evaluate(function () {
      const D = window.__DRIVE_DEMO__;
      return {
        accessor: typeof D.sayClock === "function",
        atRest: typeof D.sayClock === "function" ? D.sayClock() === null : false,
        bind: typeof D.bindSayDuration === "function",
      };
    });
    check(scSurface.accessor, "synccue: __DRIVE_DEMO__.sayClock accessor missing");
    check(scSurface.atRest, "synccue: sayClock must be null outside autoplay");
    check(scSurface.bind, "synccue: __DRIVE_DEMO__.bindSayDuration missing");
    const syncEntries = await page.evaluate(function () {
      const out = [];
      window.__DRIVE_DEMO__.beats.forEach(function (b, i) {
        (b.sync || []).forEach(function (c, j) { out.push({ i: i, id: b.id, j: j, c: c }); });
      });
      return out;
    });
    check(syncEntries.length >= 6,
      "synccue: expected sync entries on a3-test + a9-gates + a9-approved, saw " + syncEntries.length);
    for (const s of syncEntries) {
      check(s.c.at > 0 && s.c.at <= 1,
        "synccue " + s.id + "[" + s.j + "]: fraction " + s.c.at + " outside (0,1]");
      if (s.c.cue === "chime") {
        check(s.c.kind === "complete" || s.c.kind === "attention",
          "synccue " + s.id + "[" + s.j + "]: unknown chime kind " + JSON.stringify(s.c.kind));
        continue;
      }
      check(s.c.cue === "reveal" || s.c.cue === "class",
        "synccue " + s.id + "[" + s.j + "]: unknown cue " + JSON.stringify(s.c.cue));
      if (s.c.cue === "class") {
        check(typeof s.c.cls === "string" && s.c.cls.length > 0,
          "synccue " + s.id + "[" + s.j + "]: class cue without cls");
      }
      const r = await page.evaluate(function (s) {
        window.__DRIVE_DEMO__.goTo(s.i);
        const el = document.querySelector(s.c.target);
        if (!el) return { err: "no match" };
        if (!el.getClientRects().length) return { err: "not rendered" };
        return {};
      }, s);
      check(!r.err,
        "synccue " + s.id + "[" + s.j + "] target " + s.c.target + " at its beat: " + r.err);
    }

    // 22b) Reference beat under voiced autoplay: the green lands ON the
    // word — veiled at ~0.5s, revealed by ~2.5s, chime ~1.2s after
    // entry (0.19 x the 6.12s clip), accent by ~4s.
    const scIdx = beats.findIndex(function (b) { return b.id === "a3-test"; });
    check(scIdx > 0, "synccue: beat a3-test not found");
    await page.evaluate(function (i) { window.__DRIVE_DEMO__.goTo(i); }, scIdx - 1);
    const scRun = page.evaluate(function (idx) {
      return new Promise(function (res) {
        const D = window.__DRIVE_DEMO__;
        const iv = setInterval(function () {
          if (D.getIndex() !== idx) return;
          clearInterval(iv);
          const entry = performance.now();
          function snap() {
            const ok = document.querySelector("#spotlight .vsc-term .ws-tl.ok");
            const card = document.querySelector("#spotlight .card.test");
            return {
              okThere: !!ok,
              okCued: !!(ok && ok.classList.contains("cued")),
              cardThere: !!card,
              cardCued: !!(card && card.classList.contains("cued")),
              hl: !!(card && card.classList.contains("say-hl")),
              chimes: D.chime.log
                .filter(function (c) { return c.beatId === "a3-test" && c.at >= entry; })
                .map(function (c) { return { kind: c.kind, dt: Math.round(c.at - entry) }; }),
              clock: D.sayClock(),
            };
          }
          const out = { entered: true };
          setTimeout(function () { out.early = snap(); }, 500);
          setTimeout(function () { out.mid = snap(); }, 2500);
          setTimeout(function () { out.late = snap(); res(out); }, 4000);
        }, 40);
        setTimeout(function () { clearInterval(iv); res({ entered: false }); }, 30000);
      });
    }, scIdx);
    await page.click("#btn-play");
    const sc = await scRun;
    check(sc.entered, "synccue autoplay: never reached a3-test");
    if (sc.entered) {
      check(sc.early.okThere && sc.early.okCued,
        "synccue autoplay @0.5s: terminal OK line should still be veiled - " + JSON.stringify(sc.early));
      check(sc.early.cardThere && sc.early.cardCued,
        "synccue autoplay @0.5s: TEST card should still be veiled - " + JSON.stringify(sc.early));
      check(!sc.early.hl, "synccue autoplay @0.5s: say-hl must not be applied yet");
      check(sc.early.chimes.length === 0,
        "synccue autoplay @0.5s: chime fired at beat entry - " + JSON.stringify(sc.early.chimes));
      check(!!sc.early.clock && sc.early.clock.beatId === "a3-test" && sc.early.clock.durationMs > 3000,
        "synccue autoplay: sayClock missing or implausible - " + JSON.stringify(sc.early.clock));
      check(sc.mid.okThere && !sc.mid.okCued,
        "synccue autoplay @2.5s: terminal OK line still veiled - " + JSON.stringify(sc.mid));
      check(sc.mid.cardThere && !sc.mid.cardCued,
        "synccue autoplay @2.5s: TEST card still veiled - " + JSON.stringify(sc.mid));
      check(sc.mid.chimes.length === 1 && sc.mid.chimes[0].kind === "complete" &&
        sc.mid.chimes[0].dt > 700 && sc.mid.chimes[0].dt < 2600,
        "synccue autoplay: complete chime should land ~1.2s after entry - " + JSON.stringify(sc.mid.chimes));
      check(sc.late.hl,
        "synccue autoplay @4s: say-hl accent not applied - " + JSON.stringify(sc.late));
    }
    await page.evaluate(function () { window.__DRIVE_DEMO__.goTo(0); }); // pause

    // 22c) Static entry: the end state — everything revealed, zero
    // .cued remnants, the accent applied, no live clock — and the
    // accent does not outlive its beat.
    const scStatic = await page.evaluate(function (i) {
      window.__DRIVE_DEMO__.goTo(i);
      const ok = document.querySelector("#spotlight .vsc-term .ws-tl.ok");
      const card = document.querySelector("#spotlight .card.test");
      return {
        cued: document.querySelectorAll("#spotlight .cued").length,
        okShown: !!ok && !ok.classList.contains("cued"),
        hl: !!card && card.classList.contains("say-hl"),
        clock: window.__DRIVE_DEMO__.sayClock(),
      };
    }, scIdx);
    check(scStatic.cued === 0,
      "synccue static: " + scStatic.cued + " .cued remnant(s) after direct goTo to a3-test");
    check(scStatic.okShown, "synccue static: terminal OK line must be revealed on static entry");
    check(scStatic.hl, "synccue static: end state must include the say-hl accent");
    check(scStatic.clock === null, "synccue static: sayClock must be null on static entry");
    const scNext = await page.evaluate(function (i) {
      window.__DRIVE_DEMO__.goTo(i + 1);
      const card = document.querySelector("#spotlight .card.test");
      return { there: !!card, hl: !!(card && card.classList.contains("say-hl")) };
    }, scIdx);
    check(scNext.there && !scNext.hl,
      "synccue: the say-hl accent must not outlive its beat - " + JSON.stringify(scNext));

    // 22d) Muted run: the same cues fire on the synthetic read-along
    // clock (words x 350ms), sampled after fraction x clock + margin.
    await page.evaluate(function (i) { window.__DRIVE_DEMO__.goTo(i); }, scIdx - 1);
    const scVoiceWasOn = await page.$eval("#btn-voice", function (el) {
      return el.getAttribute("aria-pressed") === "true";
    });
    if (scVoiceWasOn) await page.click("#btn-voice");
    const scMutedP = page.evaluate(function (idx) {
      return new Promise(function (res) {
        const D = window.__DRIVE_DEMO__;
        const clockMs = D.pacing.spokenWords[idx] * D.pacing.wordMs;
        const sampleAt = clockMs * 0.19 + 700;
        const iv = setInterval(function () {
          if (D.getIndex() !== idx) return;
          clearInterval(iv);
          const entry = performance.now();
          setTimeout(function () {
            const ok = document.querySelector("#spotlight .vsc-term .ws-tl.ok");
            const card = document.querySelector("#spotlight .card.test");
            res({
              entered: true,
              expectMs: clockMs,
              clock: D.sayClock(),
              okShown: !!ok && !ok.classList.contains("cued"),
              cardShown: !!card && !card.classList.contains("cued"),
              chimes: D.chime.log.filter(function (c) {
                return c.beatId === "a3-test" && c.at >= entry;
              }).length,
            });
          }, sampleAt);
        }, 40);
        setTimeout(function () { clearInterval(iv); res({ entered: false }); }, 30000);
      });
    }, scIdx);
    await page.click("#btn-play");
    const scm = await scMutedP;
    check(scm.entered, "synccue muted: never reached a3-test");
    if (scm.entered) {
      check(!!scm.clock && scm.clock.durationMs === scm.expectMs,
        "synccue muted: sayClock should be the synthetic words x 350 clock (" +
        scm.expectMs + "ms) - got " + JSON.stringify(scm.clock));
      check(scm.okShown, "synccue muted: terminal OK line not revealed on the synthetic clock");
      check(scm.cardShown, "synccue muted: TEST card not revealed on the synthetic clock");
      check(scm.chimes >= 1, "synccue muted: chime fire not logged on the synthetic clock");
    }
    await page.evaluate(function () { window.__DRIVE_DEMO__.goTo(0); }); // pause
    if (scVoiceWasOn) await page.click("#btn-voice"); // restore the toggle

    check(pageErrors.length === 0, "pageerrors: " + pageErrors.join(" | "));

    // 8) Network silence: nothing in the whole run may leave file://.
    check(extRequests.length === 0,
      "network silence: external request(s) attempted: " +
      extRequests.slice(0, 5).join(", ") +
      (extRequests.length > 5 ? " (+" + (extRequests.length - 5) + " more)" : ""));

    // MUST stay the battery's LAST check: the demo's terminals claim this
    // battery's own success line, so the claimed count is compared against
    // the final total with this check included.
    const total = checks + 1;
    const okBad = claims.okLines.filter(function (c) {
      return c.beats !== beatCount || c.checks !== total;
    });
    check(claims.okLines.length > 0 && okBad.length === 0,
      "the demo's 'bun verify.js' terminals must show this battery's real success line 'OK: " +
      beatCount + " beats, " + total + " checks' - found " + JSON.stringify(claims.okLines));

    if (failures.length) {
      console.error("FAIL: " + failures.length + " of " + checks + " checks");
      failures.forEach(function (f) { console.error("  - " + f); });
      process.exitCode = 1;
    } else {
      console.log("OK: " + beatCount + " beats, " + checks + " checks");
    }
  } finally {
    await browser.close();
    staged.cleanup();
  }
}

main().catch(function (e) {
  console.error("verify.js crashed: " + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
