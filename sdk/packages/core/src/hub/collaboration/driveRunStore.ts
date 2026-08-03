/**
 * Persist DriveRun + WorkLease beside the task bank (`.drive/bank/`).
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DriveRun, WorkLease } from "@cline/shared";
import { parseDriveRun, parseWorkLease } from "@cline/shared";

function runsDir(workspaceRoot: string): string {
	return join(workspaceRoot, ".drive", "bank", "runs");
}

function leasesDir(workspaceRoot: string): string {
	return join(workspaceRoot, ".drive", "bank", "leases");
}

function projectionsDir(workspaceRoot: string): string {
	return join(workspaceRoot, ".drive", "bank", "projections");
}

async function ensureDir(path: string): Promise<void> {
	await mkdir(path, { recursive: true });
}

export async function putDriveRun(
	workspaceRoot: string,
	run: DriveRun,
): Promise<void> {
	const dir = runsDir(workspaceRoot);
	await ensureDir(dir);
	await writeFile(
		join(dir, `${run.id}.json`),
		`${JSON.stringify(run, null, 2)}\n`,
		"utf8",
	);
}

export async function getDriveRun(
	workspaceRoot: string,
	runId: string,
): Promise<DriveRun | null> {
	try {
		const raw = await readFile(join(runsDir(workspaceRoot), `${runId}.json`), "utf8");
		return parseDriveRun(JSON.parse(raw));
	} catch {
		return null;
	}
}

export async function listDriveRuns(workspaceRoot: string): Promise<DriveRun[]> {
	try {
		const dir = runsDir(workspaceRoot);
		const names = await readdir(dir);
		const runs: DriveRun[] = [];
		for (const name of names) {
			if (!name.endsWith(".json")) {
				continue;
			}
			const run = await getDriveRun(workspaceRoot, name.slice(0, -5));
			if (run) {
				runs.push(run);
			}
		}
		return runs;
	} catch {
		return [];
	}
}

export async function putWorkLease(
	workspaceRoot: string,
	lease: WorkLease,
): Promise<void> {
	const dir = leasesDir(workspaceRoot);
	await ensureDir(dir);
	await writeFile(
		join(dir, `${lease.id}.json`),
		`${JSON.stringify(lease, null, 2)}\n`,
		"utf8",
	);
}

export async function listWorkLeasesForRun(
	workspaceRoot: string,
	driveRunId: string,
): Promise<WorkLease[]> {
	try {
		const dir = leasesDir(workspaceRoot);
		const names = await readdir(dir);
		const leases: WorkLease[] = [];
		for (const name of names) {
			if (!name.endsWith(".json")) {
				continue;
			}
			try {
				const raw = await readFile(join(dir, name), "utf8");
				const lease = parseWorkLease(JSON.parse(raw));
				if (lease.driveRunId === driveRunId) {
					leases.push(lease);
				}
			} catch {
				// skip corrupt
			}
		}
		return leases;
	} catch {
		return [];
	}
}

export async function putProjectionArtifact(
	workspaceRoot: string,
	runId: string,
	projection: unknown,
): Promise<string> {
	const dir = projectionsDir(workspaceRoot);
	await ensureDir(dir);
	const path = join(dir, `${runId}.json`);
	await writeFile(path, `${JSON.stringify(projection, null, 2)}\n`, "utf8");
	return path;
}
