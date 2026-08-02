import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	checkBunVersion,
	checkDependenciesInstalled,
	checkHubWebviewBuild,
	checkNodeVersion,
	checkProvider,
	checkSdkBuild,
	describePort,
	formatPreflightReport,
	HUB_WEBVIEW_INDEX,
	isPortFree,
	isRepoRoot,
	PINNED_BUN_VERSION,
	resolveProviderSettingsPathForPreflight,
	runPreflight,
	SDK_BUILD_ARTIFACTS,
} from "./preflight";

const tempRoots: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "cline-preflight-"));
	tempRoots.push(dir);
	return dir;
}

function touch(root: string, relative: string): void {
	const full = path.join(root, relative);
	mkdirSync(path.dirname(full), { recursive: true });
	writeFileSync(full, "", "utf8");
}

function makeRepoRoot(): string {
	const root = makeTempDir();
	writeFileSync(
		path.join(root, "package.json"),
		JSON.stringify({ name: "@cline/packages" }),
		"utf8",
	);
	return root;
}

afterEach(() => {
	while (tempRoots.length > 0) {
		const dir = tempRoots.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe("checkBunVersion", () => {
	it("passes on the pinned version", () => {
		expect(checkBunVersion({ actual: PINNED_BUN_VERSION }).status).toBe("ok");
	});

	it("passes on a newer version", () => {
		expect(checkBunVersion({ actual: "1.4.0" }).status).toBe("ok");
	});

	it("fails below the pinned version", () => {
		const check = checkBunVersion({ actual: "1.2.9" });
		expect(check.status).toBe("fail");
		expect(check.fix).toContain("bun upgrade");
	});

	it("fails when Bun is absent", () => {
		expect(checkBunVersion({ actual: undefined }).status).toBe("fail");
	});
});

describe("checkNodeVersion", () => {
	it("passes on the required major", () => {
		expect(checkNodeVersion({ actual: "v22.14.0" }).status).toBe("ok");
	});

	it("fails below the required major", () => {
		expect(checkNodeVersion({ actual: "v20.11.0" }).status).toBe("fail");
	});

	it("warns rather than fails when Node is absent, because Bun runs the hub", () => {
		expect(checkNodeVersion({ actual: undefined }).status).toBe("warn");
	});
});

describe("checkout and build checks", () => {
	it("recognises a cline-drivecode checkout by package name", () => {
		expect(isRepoRoot(makeRepoRoot())).toBe(true);
		expect(isRepoRoot(makeTempDir())).toBe(false);
	});

	it("fails when node_modules is missing", () => {
		const root = makeTempDir();
		expect(checkDependenciesInstalled(root).status).toBe("fail");
		mkdirSync(path.join(root, "node_modules"));
		expect(checkDependenciesInstalled(root).status).toBe("ok");
	});

	it("names the SDK dist files that are missing", () => {
		const root = makeTempDir();
		const check = checkSdkBuild(root);
		expect(check.status).toBe("fail");
		expect(check.detail).toContain("sdk/packages/core/dist/index.js");
		expect(check.fix).toContain("build:sdk");
		for (const artifact of SDK_BUILD_ARTIFACTS) {
			touch(root, artifact);
		}
		expect(checkSdkBuild(root).status).toBe("ok");
	});

	it("only warns about the webview build, which `dev` does not need", () => {
		const root = makeTempDir();
		expect(checkHubWebviewBuild(root).status).toBe("warn");
		touch(root, HUB_WEBVIEW_INDEX);
		expect(checkHubWebviewBuild(root).status).toBe("ok");
	});
});

describe("port checks", () => {
	it("reports a bound port as taken", async () => {
		const server = net.createServer();
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => resolve());
		});
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("expected a TCP address");
		}
		try {
			expect(await isPortFree("127.0.0.1", address.port)).toBe(false);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
		expect(await isPortFree("127.0.0.1", address.port)).toBe(true);
	});

	it("fails a busy port only when the env var pins it", () => {
		const base = {
			id: "port:hub",
			label: "Hub daemon",
			port: 25463,
			envVar: "CLINE_HUB_PORT",
		};
		expect(describePort({ ...base, free: true, explicit: false }).status).toBe(
			"ok",
		);
		expect(describePort({ ...base, free: false, explicit: false }).status).toBe(
			"warn",
		);
		expect(describePort({ ...base, free: false, explicit: true }).status).toBe(
			"fail",
		);
	});
});

describe("provider check", () => {
	it("resolves the default provider settings path from home", () => {
		expect(resolveProviderSettingsPathForPreflight({}, "/home/dev")).toBe(
			path.join("/home/dev", ".cline", "data", "settings", "providers.json"),
		);
	});

	it("honours CLINE_DIR and an explicit settings path", () => {
		expect(
			resolveProviderSettingsPathForPreflight(
				{ CLINE_DIR: "/tmp/cline" },
				"/home/dev",
			),
		).toBe(path.join("/tmp/cline", "data", "settings", "providers.json"));
		expect(
			resolveProviderSettingsPathForPreflight(
				{ CLINE_PROVIDER_SETTINGS_PATH: "/tmp/p.json" },
				"/home/dev",
			),
		).toBe("/tmp/p.json");
	});

	it("warns that an API key alone does not select a provider", () => {
		const check = checkProvider({
			settingsPath: "/tmp/providers.json",
			settingsExists: false,
			envVarsSet: ["ANTHROPIC_API_KEY"],
		});
		expect(check.status).toBe("warn");
		expect(check.fix).toContain("does not select a provider");
	});

	it("never fails the report, because the demo route needs no credentials", () => {
		expect(
			checkProvider({
				settingsPath: "/tmp/providers.json",
				settingsExists: false,
				envVarsSet: [],
			}).status,
		).toBe("warn");
	});
});

describe("runPreflight", () => {
	it("fails when the checkout is not built", async () => {
		const root = makeRepoRoot();
		const report = await runPreflight({
			cwd: root,
			env: {},
			home: makeTempDir(),
			bunVersion: PINNED_BUN_VERSION,
			nodeVersion: "22.14.0",
		});
		expect(report.ok).toBe(false);
		expect(report.checks.find((c) => c.id === "install")?.status).toBe("fail");
		expect(report.checks.find((c) => c.id === "build:sdk")?.status).toBe(
			"fail",
		);
	});

	it("walks up to the checkout root, so `bun run cli` (cwd apps/cli) still checks the build", async () => {
		const root = makeRepoRoot();
		mkdirSync(path.join(root, "node_modules"));
		for (const artifact of SDK_BUILD_ARTIFACTS) {
			touch(root, artifact);
		}
		const report = await runPreflight({
			cwd: path.join(root, "apps", "cli"),
			env: {},
			home: makeTempDir(),
			bunVersion: PINNED_BUN_VERSION,
			nodeVersion: "22.14.0",
		});
		expect(report.checks.find((c) => c.id === "build:sdk")?.status).toBe("ok");
		expect(report.checks.some((c) => c.id === "checkout")).toBe(false);
	});

	it("skips the development daemon port when CLINE_HUB_PORT pins one", async () => {
		const withoutPin = await runPreflight({
			cwd: makeTempDir(),
			env: {},
			home: makeTempDir(),
			bunVersion: PINNED_BUN_VERSION,
			nodeVersion: "22.14.0",
		});
		expect(withoutPin.checks.some((c) => c.id === "port:hub-dev")).toBe(true);

		const withPin = await runPreflight({
			cwd: makeTempDir(),
			env: { CLINE_HUB_PORT: "25999" },
			home: makeTempDir(),
			bunVersion: PINNED_BUN_VERSION,
			nodeVersion: "22.14.0",
		});
		expect(withPin.checks.some((c) => c.id === "port:hub-dev")).toBe(false);
	});

	it("warns instead of failing when run outside any checkout", async () => {
		const report = await runPreflight({
			cwd: makeTempDir(),
			env: {},
			home: makeTempDir(),
			bunVersion: PINNED_BUN_VERSION,
			nodeVersion: "22.14.0",
		});
		expect(report.checks.find((c) => c.id === "checkout")?.status).toBe("warn");
		expect(report.checks.some((c) => c.id === "build:sdk")).toBe(false);
	});

	it("renders an ASCII-only report", () => {
		const text = formatPreflightReport({
			ok: false,
			checks: [
				{
					id: "bun",
					status: "fail",
					detail: "Bun was not detected.",
					fix: "x",
				},
				{ id: "node", status: "ok", detail: "Node 22." },
			],
		});
		// biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the absence of non-ASCII output
		expect(/^[\x00-\x7F]*$/.test(text)).toBe(true);
		expect(text).toContain("Preflight failed");
	});
});
