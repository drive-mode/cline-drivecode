/**
 * Self-hosted beta preflight.
 *
 * `doctor` answers "what is running and how do I kill it". Preflight answers
 * the question before that one — "why will this not work at all" — for someone
 * who just cloned the fork and has never run it.
 *
 * Deliberately imports only node builtins and the root toolchain manifest, so
 * `bun apps/cli/src/commands/preflight.ts` runs on a fresh clone *before*
 * `bun install`, which is exactly when "wrong Bun" and "nothing installed yet"
 * are worth hearing. `cline doctor preflight` runs the same checks after.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import rootPackage from "../../../../package.json" with { type: "json" };

export type PreflightStatus = "ok" | "warn" | "fail";

export type PreflightCheck = {
	/** Stable id so a bug report can quote one line. */
	readonly id: string;
	readonly status: PreflightStatus;
	/** What was found. Present tense, no advice. */
	readonly detail: string;
	/** What to do about it. Omitted when there is nothing to do. */
	readonly fix?: string;
};

export type PreflightReport = {
	readonly checks: readonly PreflightCheck[];
	/** False when any check failed. Warnings do not fail the report. */
	readonly ok: boolean;
};

/** Bun pinned by `packageManager` / `engines.bun`; CI installs exactly this. */
export const PINNED_BUN_VERSION = rootPackage.engines.bun;
/** `engines.node` is `>=22`. */
export const MINIMUM_NODE_MAJOR = Number(
	/^>=(\d+)/.exec(rootPackage.engines.node)?.[1],
);

/** Hub daemon (WebSocket single writer) — `CLINE_HUB_PORT` in shared/rpc. */
export const HUB_DAEMON_PORT = 25463;
/** Same daemon under `CLINE_BUILD_ENV=development` (what `bun run cli` uses). */
export const HUB_DAEMON_DEV_PORT = 25466;
/** Hub dashboard HTTP server — the URL a tester actually opens. */
export const HUB_DASHBOARD_PORT = 8787;

/**
 * API-key env vars worth naming. Not the full provider list (~25 in
 * `@cline/llms`) — just the ones the install docs suggest, so "no provider"
 * has a concrete answer rather than a shrug.
 */
export const PROVIDER_API_KEY_ENV_VARS = [
	"CLINE_API_KEY",
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"OPENROUTER_API_KEY",
] as const;

type Semver = { major: number; minor: number; patch: number };

function parseSemver(raw: string | undefined): Semver | undefined {
	const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec((raw ?? "").trim());
	if (!match) {
		return undefined;
	}
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
	};
}

/** Negative when `a < b`, 0 when equal, positive when `a > b`. */
export function compareSemver(a: Semver, b: Semver): number {
	return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function checkBunVersion(input: {
	actual: string | undefined;
	pinned?: string;
}): PreflightCheck {
	const pinned = input.pinned ?? PINNED_BUN_VERSION;
	const actual = parseSemver(input.actual);
	const expected = parseSemver(pinned);
	if (!actual || !expected) {
		return {
			id: "bun",
			status: "fail",
			detail: "Bun was not detected.",
			fix: `Install Bun ${pinned} or newer: https://bun.sh`,
		};
	}
	if (compareSemver(actual, expected) < 0) {
		return {
			id: "bun",
			status: "fail",
			detail: `Bun ${input.actual} is older than the pinned ${pinned}.`,
			fix: "Run `bun upgrade`. The lockfile is written by the pinned version.",
		};
	}
	return {
		id: "bun",
		status: "ok",
		detail: `Bun ${input.actual} (pinned ${pinned}).`,
	};
}

export function checkNodeVersion(input: {
	actual: string | undefined;
	minimumMajor?: number;
}): PreflightCheck {
	const minimumMajor = input.minimumMajor ?? MINIMUM_NODE_MAJOR;
	const actual = parseSemver(input.actual);
	if (!actual) {
		return {
			id: "node",
			status: "warn",
			detail: "Node was not detected.",
			fix: `Bun runs the hub, but the toolchain declares Node >=${minimumMajor}.`,
		};
	}
	if (actual.major < minimumMajor) {
		return {
			id: "node",
			status: "fail",
			detail: `Node ${input.actual} is older than the required >=${minimumMajor}.`,
			fix: `Install Node ${minimumMajor} or newer (see .nvmrc).`,
		};
	}
	return {
		id: "node",
		status: "ok",
		detail: `Node ${input.actual} (requires >=${minimumMajor}).`,
	};
}

/** True when `root` looks like a cline-drivecode checkout, not some other cwd. */
export function isRepoRoot(root: string): boolean {
	try {
		const manifest = JSON.parse(
			readFileSync(join(root, "package.json"), "utf8"),
		) as { name?: unknown };
		return manifest.name === "@cline/packages";
	} catch {
		return false;
	}
}

/**
 * Nearest checkout root at or above `start`, or undefined.
 *
 * Both entry points land somewhere inside the tree rather than on it —
 * `bun run cli` sets cwd to `apps/cli`, and a tester may run preflight from a
 * package directory — so walking up is what makes the build checks reachable.
 */
export function findRepoRoot(start: string): string | undefined {
	let current = resolve(start);
	for (;;) {
		if (isRepoRoot(current)) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) {
			return undefined;
		}
		current = parent;
	}
}

export function checkDependenciesInstalled(root: string): PreflightCheck {
	if (existsSync(join(root, "node_modules"))) {
		return {
			id: "install",
			status: "ok",
			detail: "node_modules is present.",
		};
	}
	return {
		id: "install",
		status: "fail",
		detail: "node_modules is missing.",
		fix: "Run `bun install --frozen-lockfile`.",
	};
}

/** Workspace packages resolve each other through `dist/`, never `src/`. */
export const SDK_BUILD_ARTIFACTS = [
	"sdk/packages/shared/dist/index.js",
	"sdk/packages/core/dist/index.js",
	"sdk/packages/drive/dist/index.js",
] as const;

export function checkSdkBuild(root: string): PreflightCheck {
	const missing = SDK_BUILD_ARTIFACTS.filter(
		(relative) => !existsSync(join(root, relative)),
	);
	if (missing.length === 0) {
		return {
			id: "build:sdk",
			status: "ok",
			detail: "SDK packages are built.",
		};
	}
	return {
		id: "build:sdk",
		status: "fail",
		detail: `SDK build output is missing: ${missing.join(", ")}.`,
		fix: "Run `bun run build:sdk`. Without it, imports fail with ERR_MODULE_NOT_FOUND.",
	};
}

export const HUB_WEBVIEW_INDEX = "apps/cline-hub/dist/webview/index.html";

export function checkHubWebviewBuild(root: string): PreflightCheck {
	if (existsSync(join(root, HUB_WEBVIEW_INDEX))) {
		return {
			id: "build:webview",
			status: "ok",
			detail: "Hub webview is built.",
		};
	}
	return {
		id: "build:webview",
		status: "warn",
		detail: "Hub webview is not built.",
		fix: "Only needed for `bun -F @cline/cline-hub start` and `cline dashboard`; `dev` serves it from Vite. Build with `bun -F @cline/cline-hub build:webview`.",
	};
}

/** Resolves when nothing holds `port` on `host`. */
export async function isPortFree(host: string, port: number): Promise<boolean> {
	return await new Promise<boolean>((resolveFree) => {
		const probe = net.createServer();
		probe.unref();
		probe.once("error", () => resolveFree(false));
		probe.listen(port, host, () => {
			probe.close(() => resolveFree(true));
		});
	});
}

export function describePort(input: {
	id: string;
	label: string;
	port: number;
	free: boolean;
	/** The user pinned this port, so there is no free-port fallback. */
	explicit: boolean;
	envVar: string;
}): PreflightCheck {
	if (input.free) {
		return {
			id: input.id,
			status: "ok",
			detail: `${input.label} port ${input.port} is free.`,
		};
	}
	if (input.explicit) {
		return {
			id: input.id,
			status: "fail",
			detail: `${input.label} port ${input.port} is in use and ${input.envVar} pins it.`,
			fix: `Free the port, or point ${input.envVar} somewhere else. An explicit port fails closed instead of relocating.`,
		};
	}
	return {
		id: input.id,
		status: "warn",
		detail: `${input.label} port ${input.port} is in use.`,
		fix: "A free port is chosen automatically. If that is another Cline checkout's hub, both share one daemon; run `cline doctor` to see which.",
	};
}

function envPort(value: string | undefined): number | undefined {
	const port = Number.parseInt((value ?? "").trim(), 10);
	return Number.isInteger(port) && port >= 1 && port <= 65_535
		? port
		: undefined;
}

async function collectPortChecks(
	env: NodeJS.ProcessEnv,
): Promise<PreflightCheck[]> {
	const host = env.CLINE_HUB_HOST?.trim() || "127.0.0.1";
	const daemonPort = envPort(env.CLINE_HUB_PORT);
	const dashboardPort = envPort(env.CLINE_HUB_DASHBOARD_PORT);
	const targets = [
		{
			id: "port:hub",
			label: "Hub daemon",
			port: daemonPort ?? HUB_DAEMON_PORT,
			explicit: daemonPort !== undefined,
			envVar: "CLINE_HUB_PORT",
		},
		// `bun run cli` sets CLINE_BUILD_ENV=development and lands on a second
		// daemon port — but only when CLINE_HUB_PORT is unset, since an
		// explicit port wins over the build env. Probing it otherwise would
		// warn about a port nothing is going to use.
		...(daemonPort === undefined
			? [
					{
						id: "port:hub-dev",
						label: "Hub daemon (development build env)",
						port: HUB_DAEMON_DEV_PORT,
						explicit: false,
						envVar: "CLINE_HUB_PORT",
					},
				]
			: []),
		{
			id: "port:dashboard",
			label: "Hub dashboard",
			port: dashboardPort ?? HUB_DASHBOARD_PORT,
			explicit: dashboardPort !== undefined,
			envVar: "CLINE_HUB_DASHBOARD_PORT",
		},
	];
	// The dev daemon port only matters when it is not already the pinned one.
	const unique = targets.filter(
		(target, index) =>
			targets.findIndex((other) => other.port === target.port) === index,
	);
	return await Promise.all(
		unique.map(async (target) =>
			describePort({
				...target,
				free: await isPortFree(host, target.port),
			}),
		),
	);
}

/** Mirrors `resolveProviderSettingsPath()` without importing `@cline/shared`. */
export function resolveProviderSettingsPathForPreflight(
	env: NodeJS.ProcessEnv,
	home: string,
): string {
	const explicit = env.CLINE_PROVIDER_SETTINGS_PATH?.trim();
	if (explicit) {
		return explicit;
	}
	const dataDir =
		env.CLINE_DATA_DIR?.trim() ||
		join(env.CLINE_DIR?.trim() || join(home, ".cline"), "data");
	return join(dataDir, "settings", "providers.json");
}

export function checkProvider(input: {
	settingsPath: string;
	settingsExists: boolean;
	envVarsSet: readonly string[];
}): PreflightCheck {
	if (input.settingsExists) {
		return {
			id: "provider",
			status: "ok",
			detail: `Provider settings found at ${input.settingsPath}.`,
		};
	}
	if (input.envVarsSet.length > 0) {
		return {
			id: "provider",
			status: "warn",
			detail: `No provider settings file; ${input.envVarsSet.join(", ")} is set in this shell.`,
			fix: "An API key alone does not select a provider. Pick one in the hub under Settings -> Providers, or run `bun run cli auth`.",
		};
	}
	return {
		id: "provider",
		status: "warn",
		detail: "No LLM provider is configured.",
		fix: `Run \`bun run cli auth\`, or set one of ${PROVIDER_API_KEY_ENV_VARS.join(", ")} and pick the provider in the hub. The demo route /drive?demoShareScreen=1 needs no credentials.`,
	};
}

/**
 * The installed Node, not Bun's emulated one.
 *
 * Under Bun `process.versions.node` reports whatever Node API level Bun claims
 * (24.x today), which says nothing about whether Node is installed — so asking
 * the binary is the only way to check `engines.node` honestly.
 */
export function detectNodeVersion(): string | undefined {
	if (!process.versions.bun) {
		return process.versions.node;
	}
	const result = spawnSync("node", ["--version"], { encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : undefined;
}

export type RunPreflightOptions = {
	/** Checkout to inspect. Defaults to the current working directory. */
	readonly cwd?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly home?: string;
	readonly bunVersion?: string;
	readonly nodeVersion?: string;
};

export async function runPreflight(
	options: RunPreflightOptions = {},
): Promise<PreflightReport> {
	const env = options.env ?? process.env;
	const home = options.home ?? homedir();
	const start = resolve(options.cwd ?? process.cwd());
	const root = findRepoRoot(start);
	const checks: PreflightCheck[] = [
		checkBunVersion({ actual: options.bunVersion ?? process.versions.bun }),
		checkNodeVersion({ actual: options.nodeVersion ?? detectNodeVersion() }),
	];

	if (root) {
		checks.push(
			checkDependenciesInstalled(root),
			checkSdkBuild(root),
			checkHubWebviewBuild(root),
		);
	} else {
		checks.push({
			id: "checkout",
			status: "warn",
			detail: `${start} is not inside a cline-drivecode checkout.`,
			fix: "Run preflight from the repo to also check install and build output.",
		});
	}

	checks.push(...(await collectPortChecks(env)));

	const settingsPath = resolveProviderSettingsPathForPreflight(env, home);
	checks.push(
		checkProvider({
			settingsPath,
			settingsExists: existsSync(settingsPath),
			envVarsSet: PROVIDER_API_KEY_ENV_VARS.filter((name) => env[name]?.trim()),
		}),
	);

	return {
		checks,
		ok: checks.every((check) => check.status !== "fail"),
	};
}

const STATUS_LABEL: Record<PreflightStatus, string> = {
	ok: "ok  ",
	warn: "warn",
	fail: "FAIL",
};

/** ASCII only — the Windows console codec rejects box-drawing and arrows. */
export function formatPreflightReport(report: PreflightReport): string {
	const lines = report.checks.map((check) => {
		const head = `[${STATUS_LABEL[check.status]}] ${check.id}: ${check.detail}`;
		return check.fix ? `${head}\n         ${check.fix}` : head;
	});
	lines.push(
		"",
		report.ok
			? "Preflight passed. Warnings above are things to know, not blockers."
			: "Preflight failed. Fix the FAIL lines before starting the hub.",
	);
	return lines.join("\n");
}

if (import.meta.main) {
	// `bun apps/cli/src/commands/preflight.ts` on a fresh clone. Start from this
	// file rather than the cwd so it works when invoked from anywhere.
	const report = await runPreflight({ cwd: import.meta.dirname });
	process.stdout.write(`${formatPreflightReport(report)}\n`);
	process.exitCode = report.ok ? 0 : 1;
}
