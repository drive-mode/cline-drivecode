# 26 · The request-latency playbook, tested against a loopback hub

**Date:** 2026-08-04 · **Status:** analysis, no decision
**Scope:** a widely-circulated six-fix API latency ladder, checked fix by fix
against Drive's actual hot path.
**Companions:** [12-performance](12-performance.md) (the probes, now measured),
[24-scale-and-context](24-scale-and-context.md) (numbers that govern nothing),
[ADR-0013](../adr/ADR-0013-state-partition.md) (three-lane state),
[ADR-0005](../adr/ADR-0005-status-hub.md) (SQLite status log).
**Canvas:** [request-latency-ladder.html](../../../design/canvases/request-latency-ladder.html)

## Why this document exists

A six-step latency ladder circulates as a deck: `GET /api/orders` goes from
2,400 ms to 90 ms, then to 2 ms on repeat, via six fixes applied in order —
edge-cache the GET, pool the connection, index the filter, collapse the N+1,
parallelise independent calls, cache the read path.

The arithmetic is exact (540+150+900+600+210 = 2,400; 6+0+2+12+70 = 90), the
ordering is pedagogically sound, and it is a genuinely good teaching artifact.
It has been rebuilt as a design canvas for that reason.

It is also, applied to this codebase, mostly a category error — and saying why
is more useful than adopting it.

## Thesis

**Five of the six fixes address costs a loopback hub does not pay. The sixth,
Drive already implemented — and measurement shows it currently buys 1.2×, not
the order of magnitude the deck implies.**

The deck describes a tiered web service: browser → edge → app server →
connection pool → SQL database → downstream services. Drive's hot path is a
single-writer daemon on `127.0.0.1` that a local client speaks to over one
persistent WebSocket, folding an append-only event log in memory
([ADR-0013](../adr/ADR-0013-state-partition.md)). Almost none of the deck's
cost centres exist there.

## Fix by fix

| # | Deck fix | Transfers? | Why |
|---|---|---|---|
| 1 | Serve cacheable GETs from the edge | **No** (hub) / **already** (site) | The hub is loopback: there is no wide-area RTT to shorten. The public surface that *does* have one — `drivemode.ai` — is already static on Cloudflare Pages, and [hosted-preview](../initiatives/hosted-preview/README.md) tiers 1–3 are all credential-free static pages. |
| 2 | Borrow from a connection pool | **No** | Drive holds one persistent WebSocket, not per-request connections. The connect cost is paid once: **+0.2 MB**, measured ([12-performance](12-performance.md)). There is no per-request handshake to amortise. |
| 3 | Index what you filter on | **Largely already** | The SQLite stores are indexed where they are filtered — `idx_team_events_name_ts` and `idx_team_runs_status` (`sdk/packages/core/src/services/storage/sqlite-team-store.ts:191,235`), and nine indices in the cron store (`sdk/packages/core/src/cron/store/cron-schema.ts:96-110`). |
| 4 | One JOIN, not one query per row | **No** | Read paths are in-memory folds over the event log (`reduceRoom`), not per-row queries against a relational store. There is no ORM to produce the N+1 shape. |
| 5 | Call independent services at once | **Partly, already** | This is the one structural idea that maps. It is also already the scheduler's design: "one physical execution lane per teammate while independent teammates retain team-wide parallelism" ([12-performance](12-performance.md), PR #32). The remaining candidates are provider-bound — LLM, STT, TTS — not internal. |
| 6 | Cache the read path | **Already — and measured** | Three caches shipped: the mermaid SVG content-hash cache, the voice stack memoized by topology fingerprint, and director spotlight hysteresis. See below. |

## The one that transferred, measured

Fix 6 is the deck's climax — "every repeat: 2 ms". Drive implemented the
equivalent before this document existed. So it is the one place where the ladder
can actually be scored rather than reasoned about, and
[12-performance](12-performance.md)'s probes now score it:

| | median | p95 |
|---|---|---|
| `produceMermaidShowArtifact` cold | 0.0076 ms | 0.052 ms |
| `produceMermaidShowArtifact` warm (cache hit) | 0.0062 ms | 0.030 ms |

**1.2×.** Not because caching is the wrong idea, but because of what the cache
elides. The function hashes the source, then base64-encodes the SVG into a data
URI and rebuilds the `ShowBacklogItem` *unconditionally*; the cache
short-circuits only `buildStubSvg` — and that is a deterministic stub wrapper,
because core deliberately carries no mermaid runtime
(`sdk/packages/core/src/hub/drive-producers/produceMermaid.ts:34`). The real
renderer is anticipated, not shipped (`showTemplates.ts:59`).

The cache is correctly placed for a cost that does not exist yet. That is a
defensible engineering choice and a misleading line item: "content-hash SVG
cache" under *Implemented so far* reads like a win that measurement does not
currently support.

This is the deck's real lesson, and it is not one of its six slides. **The
ladder's power comes from the profile that produced it, not from the fixes.**
Six numbers were measured first; the fixes followed. Drive has the reverse — three
caches shipped, and until now, five `TBD` probes.

## What to actually do

Nothing on the deck's list, in the deck's order. In rough priority:

1. **Re-run the mermaid probe when a real renderer lands.** It is the one place
   where a shipped optimization has a measurable ratio, and that ratio is
   currently the argument against trusting the "Implemented so far" list.
2. **Audit the three unindexed team tables.** `team_tasks`, `team_outcomes` and
   `team_outcome_fragments` (`sqlite-team-store.ts:203,239,251`) carry no
   secondary index while their siblings do. Whether they need one depends on
   query shape and row count, and **neither is measured** — so this is an audit
   item, not a defect. Fix 3 pointed at a real file, which is more than the
   slide could do.
3. **Leave the rest alone.** Ranking 100 shows costs ~24 µs. Optimizing that
   would be exactly the "micro-guess" [12-performance](12-performance.md)'s goal
   statement rules out.

## Where this document is weak

- It scores the deck against the *hub*. Drive also has a webview bundle where
  fix 1 is straightforwardly relevant — [ADR-0024](../adr/ADR-0024-drive-web-runtime.md)
  notes 6.5 MB of JS with mermaid at ~1.5 MB. A serving-and-payload version of
  this analysis would reach different conclusions, and is not attempted here.
- Probe 5 (webview `messages[]` growth) is unmeasured for want of a credential,
  and it is the probe most likely to expose a real long-horizon cost. Judging the
  deck "does not transfer" while the most transfer-prone probe is blank is a
  limit worth stating.
- The 1.2× finding is a micro-benchmark in one process. It shows the cache does
  not currently pay; it does not show it never will.
