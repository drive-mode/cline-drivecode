# hosted-preview · `cline.drivemode.ai`

**Status:** plan (2026-08-02)
**Goal:** put the Drive-mode experience on the open web at
`cline.drivemode.ai`, on a domain we own, without turning the beta into a
hosted service.
**Infrastructure repo:** [`drive-mode/site`](https://github.com/drive-mode/site)
**Constrained by:** [ADR-0016](../../adr/ADR-0016-distribution-and-positioning.md)
(public **self-hosted** beta), [ADR-0021](../../adr/ADR-0021-drive-credential-onboarding.md)
(credentials), [reference/privacy.md](../../../../reference/privacy.md).
**Supersedes the domain question in** [drive-web](../drive-web/README.md) —
`drive.cline.bot` is Cline's domain; `cline.drivemode.ai` is ours.

## The line that must not blur

ADR-0016 decided the beta is **public but self-hosted**: clone and run, the
hub stays a local single-writer daemon, multi-human rooms are a non-goal.
Hosting a *page* does not change that. Hosting a *hub* would.

Four things could live at this hostname. Three are safe today; the fourth is a
different product.

| Tier | What | Backend | ADR-0016 |
|---|---|---|---|
| 1 | Landing page — what Drive is, install, the hero GIF | none | fine |
| 2 | The 47-beat demo canvas, self-contained | none | fine |
| 3 | **drive-web prototype** — the real webview on a mock transport | none | fine |
| 4 | A real hosted hub — other people's agents and keys | daemon + auth + multi-tenancy | **contradicts it** |

**Tier 4 is out of scope for this plan** and would need ADR-0016 superseded,
not extended. It also inherits every finding in ADR-0021: the provider catalog
currently broadcasts plaintext API keys to connected peers, and `roomSecret`
rides in the URL query string. Those are tolerable on `127.0.0.1`. They are
not tolerable when the socket is someone else's browser and the keys are
someone else's money. Anyone proposing tier 4 should read ADR-0021 first.

Tiers 1–3 ship a **credential-free** site: nothing to sign into, nothing to
spend, nothing to leak.

## What the site repo already is

`drive-mode/site` is a hand-authored static site — no bundler, no forms, no
third-party JS. `dist/` is the deploy artifact. Live at `drivemode.ai` via
Cloudflare Pages:

```bash
npx wrangler pages deploy dist --project-name=drivemode --branch=main
```

There is **no tracked CI workflow**; deploys are manual `wrangler`. It already
links to Cline Drive and notes it is "moving to `drive-mode` shortly".

## Two infrastructure findings that change the plan

Both come from the shipped `dist/_headers`, and both would have bitten us
after launch rather than before.

### 1. The microphone is disabled site-wide

```
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Correct for a static marketing page. **Fatal for Drive**, whose differentiator
is voice — STT needs `microphone=(self)`. Inheriting the parent policy would
ship a Drive preview whose defining feature is silently blocked by a header,
with a failure that looks like a bug in our code.

So `cline.drivemode.ai` needs its **own** `_headers`, not the parent's. And it
should grant `microphone=(self)` *only* — camera and geolocation stay denied,
because Drive has no use for either and a preview site should ask for the
minimum.

**Hub note (2026-08-07):** local hub HTML responses already send
`Permissions-Policy: microphone=(self)` (`apps/cline-hub/src/server/http.ts`).
The public preview site must still set its own `_headers` — hub headers do not
travel with the static deploy.

### 2. HSTS is preloaded with `includeSubDomains`

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

This already covers `cline.drivemode.ai` in browsers that have the preload
list — **before the subdomain exists**. There is no HTTP fallback and no
grace period: the first request must be valid HTTPS or the site is simply
unreachable. Cloudflare Pages handles the certificate, but the DNS record and
the Pages custom domain must be in place together; a half-configured subdomain
fails closed rather than degrading.

## Which repo owns what

The split follows the existing grain rather than inventing one.

**`drive-mode/site`** owns the **infrastructure**: the Pages project, the DNS
record, the subdomain's `_headers`, and the deploy workflow. It is already the
home of "how drivemode.ai is served", and a second hostname belongs beside the
first.

**`hhalperin/cline-drivecode`** owns the **artifact**: the demo canvas build
(`build-artifact.mjs` already emits single-file distributions) and, later, the
drive-web bundle. The product repo builds the product.

**The handshake** is a published build artifact, not a vendored `dist/`.
Committing built output into `site` would couple the repos, put a bundle in
git forever, and make "which commit is live" ambiguous — the thing the canvas
registry was built to avoid.

A separate Pages project (`drivemode-cline`) rather than a path on the
existing one, because the two have different CSP needs and different release
cadences, and a bad Drive deploy must not be able to take down `drivemode.ai`.

## Phases

| # | Phase | Ships | Gate |
|---|---|---|---|
| 1 | Hostname + tier 1 | DNS, Pages project, subdomain `_headers`, landing page | `https://cline.drivemode.ai` serves over valid TLS; mic policy verified as `self` |
| 2 | Tier 2 — the demo | `build-artifact.mjs` output published | the 47-beat demo plays on a phone with no console errors |
| 3 | Release path | CI in cline-drivecode builds; site deploys | a merge to `main` can reach the site without a laptop |
| 4 | Tier 3 — prototype | drive-web bundle ([drive-web plan](../drive-web/README.md)) | the real webview runs with no daemon |

Phase 1 is deliberately small: prove the hostname, the certificate and the
headers before anything depends on them. The demo canvas is already
network-silent with its own CSP, so phase 2 is mostly publishing.

## Retiring the demo canvas — decided, gated, not yet

**Decision (owner, 2026-08-02):** once the MVP is confirmed working, the demo
canvas is no longer needed as the marketing artifact. **It is not removed
until that confirmation lands and we have agreed the alignment** — the
marketing artifact keeps earning its place until something demonstrably better
replaces it.

So the canvas and the prototype overlap for a while, and that overlap is the
dangerous part. **Two things claiming to show the product is precisely how the
canvas and the app drifted apart**: the canvas gave the stage 370 px at
1280×640 while the shipped app gave it 9 px, for weeks, because nobody was
comparing them. Repeating that with a *public* artifact would be worse.

### The retirement gate

Retire only when all of these hold. Each is checkable, so this is not a
judgement call later:

1. **The MVP is confirmed working** — the two gates that still need a human:
   a credentialed call, and hearing the audio
   ([MVP-beta.md](../../delivery/MVP-beta.md)).
2. **The prototype covers what the canvas sells.** Every beat the canvas uses
   for marketing has a real equivalent in the prototype — not "roughly the
   same idea", the actual moment.
3. **The prototype is at least as good on a phone.** The canvas is already
   responsive to ~360 px; the replacement cannot regress that.
4. **Someone who has never seen Drive understands it from the prototype
   alone**, with no narration script carrying them.
5. **We have agreed the alignment** — which artifact is canonical for which
   audience, and what the landing page points at.

### While both exist

The canvas stays the **design source of truth** (its maturity badges are
audited, its battery asserts truth invariants) and the prototype is the
**product**. Where they disagree, one of them is wrong and it must be
resolved, not tolerated — that is the whole lesson of the 9 px stage.

Worth building during the overlap: a **parity check** that fails when a
surface the canvas badges `SHIPPED` has no counterpart in the prototype. The
canvas already has `verify.js` asserting its self-referential claims against
reality; extending that habit to canvas-vs-app is the cheapest possible
insurance against a second silent divergence.

**Nothing about the canvas is deleted at retirement** — it stays in the repo
as the design record and the regression battery. What ends is its role as the
thing we point the public at.

## Constraints the artifact must keep

- **Network-silent.** The canvas battery already asserts zero external
  requests, and the site's no-third-party-JS posture matches. Keep both.
- **Self-hosted fonts.** Already true on both sides.
- **CSP.** The canvas carries a per-canvas meta CSP; the drive-web bundle will
  need a real one, and a Vite bundle is a bigger surface than a hand-authored
  page. Do not relax the parent site's posture to make a bundler convenient.
- **No telemetry by default.** `privacy.md` says events carry metadata only
  and captions never persist. A hosted preview must not quietly add analytics
  — if we want traffic numbers, that is a decision to make out loud.

## Open questions

1. **Does the preview say it is a preview?** Tier 3 is the real UI with a mock
   transport. Impressive, and dishonest if a visitor believes they are talking
   to a live agent. Recommendation: quiet but unambiguous.
2. **Where does the repo move land?** The site README already says Cline Drive
   is "moving to `drive-mode` shortly". If `cline-drivecode` moves org, every
   link and the CI deploy credentials move with it — worth sequencing against
   this plan rather than in parallel.
3. **`cline.drivemode.ai` vs `drive.cline.bot`.** This plan assumes the former,
   which we own. If the product is ever positioned as an official Cline
   surface, that is a conversation with Cline, not a DNS change.
4. ~~Does the demo canvas stay the marketing artifact once tier 3 exists?~~
   **Answered** — see [Retiring the demo canvas](#retiring-the-demo-canvas--decided-gated-not-yet).
   It is replaced once the MVP is confirmed and we have agreed the alignment,
   and not before.
