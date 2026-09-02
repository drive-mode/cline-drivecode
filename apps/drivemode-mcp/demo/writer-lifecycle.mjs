/**
 * Writer lifecycle for the demo harness.
 *
 * The writer is in-memory by design, so "reset the demo" means "restart the
 * writer". Reusing a live one silently stacks a second run on the first run's
 * log — revoked grants come back as inactive and the Presenter guard rejects
 * the handoff. Always start from a fresh process.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DISCOVERY = join(homedir(), ".drivemode", "writer.json");
const REPO = new URL("..", import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function healthy(url) {
	try {
		const res = await fetch(`${url}/health`, {
			signal: AbortSignal.timeout(1000),
		});
		return res.ok;
	} catch {
		return false;
	}
}

/** Stop whatever writer the discovery file points at, if it is still alive. */
export async function stopWriter() {
	let pid;
	try {
		pid = JSON.parse(readFileSync(DISCOVERY, "utf8")).pid;
	} catch {
		return;
	}
	try {
		process.kill(pid);
	} catch {
		return;
	}
	for (let i = 0; i < 20; i++) {
		await sleep(150);
		try {
			process.kill(pid, 0);
		} catch {
			return;
		}
	}
}

/** Start a writer on `port` and resolve once it answers /health. */
export async function startWriter(port = 4600) {
	await stopWriter();
	const child = spawn("bun", ["run", "--cwd", "apps/writer", "start"], {
		cwd: REPO,
		env: { ...process.env, DRIVEMODE_HTTP_PORT: String(port) },
		stdio: "ignore",
		detached: true,
	});
	child.unref();

	const url = `http://127.0.0.1:${port}`;
	for (let i = 0; i < 60; i++) {
		if (await healthy(url)) return { url, pid: child.pid };
		await sleep(250);
	}
	throw new Error(`writer did not come up on ${url}`);
}
