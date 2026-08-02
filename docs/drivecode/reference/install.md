# Install · self-hosted beta

Back to [reference README](README.md). Decision: [ADR-0016](../plans/cline-drivemode/adr/ADR-0016-distribution-and-positioning.md).

Drive is **public but self-hosted**. There is no hosted service and no
installer: you clone `hhalperin/cline-drivecode`, run it on your own machine,
and everything stays on localhost. This page is the long form of the
[README quickstart](../../../README.md#quickstart) — read that first if you
just want the five commands.

## Prerequisites

| Need | Version | Why |
|---|---|---|
| [Bun](https://bun.sh) | 1.3.13 or newer | Package manager and runtime. Pinned by `packageManager` in `package.json`; CI installs exactly 1.3.13 |
| [Node](https://nodejs.org) | 22 or newer | `engines.node`, `.nvmrc`. Bun runs the hub, but the toolchain expects Node present |
| Git | any recent | `core.longpaths=true` on Windows — see below |
| A browser | Chrome or Edge for voice | Firefox and Safari run Drive, but the default speech-to-text is the Chromium Web Speech API |
| An LLM provider key | one of them | Only for a real call. The scripted demo route needs nothing |

You do **not** need Docker, a database, or any account. `jq` is not used
anywhere in this guide.

## 1. Clone

```bash
git clone https://github.com/hhalperin/cline-drivecode.git
cd cline-drivecode
```

The clone is around 150 MB of git history. `evals/cline-bench` is a submodule
and is **not** needed — do not pass `--recurse-submodules`.

## 2. Install and build

```bash
bun install --frozen-lockfile
bun run build:sdk
```

`build:sdk` is **not** optional. The workspace packages resolve each other
through `dist/`, so without it the hub and the tests fail with
`ERR_MODULE_NOT_FOUND`. Expect a few minutes on a cold cache.

## 3. Preflight

```bash
bun run preflight
```

Checks Bun and Node against the pinned toolchain, whether dependencies and
build output exist, whether the hub ports are already held, and whether a
provider is configured. Every line is `ok`, `warn` (something to know) or
`FAIL` (fix this first); warnings do not block, and the command exits non-zero
only on a `FAIL`.

It deliberately imports nothing from the workspace, so you can also run it
**before** install — on a fresh clone it reports the install and build steps as
`FAIL`, which is the checklist rather than a problem. After install the same
checks are available as `bun run cli doctor preflight`.

## 4. Start the hub

```bash
bun run --cwd apps/cline-hub dev
```

Two URLs are printed. Open the **dashboard** one:

```
[cline-hub:dev] Vite webview: http://127.0.0.1:5173        <- not this one
Cline Hub dashboard listening: http://127.0.0.1:8787/      <- this one
hub endpoint: ws://127.0.0.1:25463/hub
```

Ports are chosen automatically when the preferred one is busy, so read them
from your own terminal rather than assuming 8787. Three ports are in play:

| Port | What | If busy |
|---|---|---|
| 8787 | Hub dashboard (HTTP, the page you open) | Next free port, unless `CLINE_HUB_DASHBOARD_PORT` pins it — then it fails closed |
| 25463 | Hub daemon (WebSocket, single writer) | An existing healthy daemon is reused; a stale one is retired. `cline doctor fix` clears wedged ones |
| 5173 | Vite dev server for the webview | Next free port |

`dev` starts the daemon for you. You never need `cline hub start`.

## 5. Configure a provider

Drive is bring-your-own-key. Setting an API key env var is not enough on its
own — it does not select a provider — so do one of:

```bash
bun run cli auth --provider anthropic --apikey <key> --modelid <model>
```

which writes `~/.cline/data/settings/providers.json` (the same file the hub
reads), or open **Settings -> Providers** in the dashboard and pick a provider
and model there.

To look around first without a key, open
`http://127.0.0.1:8787/drive?demoShareScreen=1` — the scripted share-screen
demo runs with no credentials at all.

## 6. Start a Drive call

1. Click **Connect** in the dashboard.
2. Open **Drive** in the sidebar.
3. **Start a Drive call**. The app navigates to the chat surface with the call
   chrome around it — that is expected; the call is not a separate page.
4. Type or speak a task. The Spotlight shows what the agent produces.
5. **Drive Settings** inside the call chooses the local / cloud / hybrid
   profile and the speech providers.

Voice notes: the mic is muted by default and text-to-speech is off by default
(`tts.enabled`). Turn them on in Drive Settings. Read
[privacy.md](privacy.md) before you turn the mic on — the default speech-to-text
backend sends audio to your browser vendor.

## Windows notes

Windows is the maintainer's primary platform. Real gotchas:

- **Long paths.** Git fails to clone with `fatal: '$GIT_DIR' too big` when the
  target path is deep. Run `git config --global core.longpaths true` and clone
  somewhere short (`C:\dev\cline-drivecode`, not a nested temp directory).
- **`cline doctor` shows no PIDs.** Its process listing shells out to `pgrep`
  and `lsof` and returns nothing on Windows. `bun run cli doctor preflight`
  probes ports by binding, so it does report a held port. To find the owner:
  `Get-NetTCPConnection -LocalPort 25463 -State Listen`.
- **Two test failures are expected** — see below.
- Use PowerShell or Git Bash; both work. The commands here are POSIX, so
  in PowerShell set env vars with `$env:NAME = "value"` rather than inline.

## Running the checks

```bash
bun -F @cline/cline-hub test          # hub suite
bun -F @cline/cline-hub typecheck     # excludes src/webview
bun run check:links                   # docs links
bun run check:drivecode-docs          # docs structure
```

Two failures are **pre-existing on Windows** and pass on CI's Linux. They are
not caused by your checkout:

| Test | Why |
|---|---|
| `apps/cline-hub/src/server/drive-plan-improve.test.ts` | asserts a POSIX path separator |
| `apps/cli/src/commands/doctor.test.ts` — "kills stale code sidecar processes" | the process listing it asserts on is a no-op on `win32` |

Two more things worth knowing before you file a bug. The hub typecheck
**excludes `src/webview/**`** — for that, run:

```bash
cd apps/cline-hub/src/webview && bun tsc -b --force
```

And the linter has a standing baseline: `bun run lint` reports around 108
warnings and 61 infos repo-wide with no errors, and the stricter
`bun biome check --diagnostic-level=error` reports several hundred
pre-existing formatting diagnostics. Neither is caused by your checkout.

## When something is wrong

1. `bun run cli doctor preflight` — prerequisites.
2. `bun run cli doctor` — what is running.
3. `bun run cli doctor fix` — stop stale daemons, sidecars and connectors.
4. Still stuck: [beta support](../plans/cline-drivemode/ops/beta-support.md).

## Uninstalling

Stop the hub, then delete what it wrote:

| Path | What |
|---|---|
| the clone | source |
| `<workspace>/.cline/drive/` | rooms, task-bank history, Drive config. Gitignored. Created the first time you join a call |
| `~/.cline/data/` | session / status / cron databases, hub logs, and `settings/providers.json` — **your API keys live here** |

`bun run cli doctor fix` first, or a running daemon will rewrite parts of
`~/.cline/data` after you delete them.
