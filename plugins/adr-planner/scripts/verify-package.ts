import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const exactRuntimeVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function assertExactRuntimeDependencies(
	field: string,
	dependencies: Record<string, string> | undefined,
): void {
	for (const [name, version] of Object.entries(dependencies ?? {})) {
		if (!exactRuntimeVersion.test(version)) {
			throw new Error(
				`${field} dependency ${name} must use an exact version; received ${version}`,
			);
		}
	}
}

const packageRoot = join(import.meta.dir, "..");
const destination = await mkdtemp(join(tmpdir(), "adr-planner-pack-"));
const replayDestination = await mkdtemp(
	join(tmpdir(), "adr-planner-pack-replay-"),
);
const extractedDestination = await mkdtemp(
	join(tmpdir(), "adr-planner-pack-extracted-"),
);

async function run(command: string[], cwd: string): Promise<string> {
	const process = Bun.spawn(command, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await process.exited;
	const stdout = await new Response(process.stdout).text();
	const stderr = await new Response(process.stderr).text();
	if (exitCode !== 0) {
		throw new Error(stderr.trim() || stdout.trim() || `${command[0]} failed`);
	}
	return stdout;
}

try {
	await run(["bun", "pm", "pack", "--destination", destination], packageRoot);
	await run(
		["bun", "pm", "pack", "--destination", replayDestination],
		packageRoot,
	);
	const archives = (await readdir(destination)).filter((entry) =>
		entry.endsWith(".tgz"),
	);
	const replayArchives = (await readdir(replayDestination)).filter((entry) =>
		entry.endsWith(".tgz"),
	);
	if (archives.length !== 1 || replayArchives.length !== 1) {
		throw new Error(
			`Expected one archive per pack, found ${archives.length} and ${replayArchives.length}`,
		);
	}
	const archive = join(destination, archives[0] ?? "");
	const replayArchive = join(replayDestination, replayArchives[0] ?? "");
	const archiveDigest = createHash("sha256")
		.update(await readFile(archive))
		.digest("hex");
	const replayDigest = createHash("sha256")
		.update(await readFile(replayArchive))
		.digest("hex");
	if (archiveDigest !== replayDigest) {
		throw new Error(
			`Package archive is not byte-stable: ${archiveDigest} != ${replayDigest}`,
		);
	}
	const listing = await run(["tar", "-tzf", archive], packageRoot);
	const replayListing = await run(["tar", "-tzf", replayArchive], packageRoot);
	const files = listing
		.split("\n")
		.map((entry) => entry.trim())
		.filter(Boolean);
	const replayFiles = replayListing
		.split("\n")
		.map((entry) => entry.trim())
		.filter(Boolean);
	const normalizedInventory = `${files.toSorted().join("\n")}\n`;
	const replayInventory = `${replayFiles.toSorted().join("\n")}\n`;
	if (normalizedInventory !== replayInventory) {
		throw new Error("Package archive inventory is not stable across replay");
	}
	const inventoryDigest = createHash("sha256")
		.update(normalizedInventory)
		.digest("hex");

	for (const forbidden of [
		"baseline/",
		"reviews/",
		"held-out",
		"held_out",
		"/gold/",
		"/test/",
	]) {
		if (files.some((entry) => entry.toLowerCase().includes(forbidden))) {
			throw new Error(`Package archive contains forbidden path: ${forbidden}`);
		}
	}

	for (const required of [
		"package/package.json",
		"package/src/index.ts",
		"package/skills/adr-planner/SKILL.md",
	]) {
		if (!files.includes(required)) {
			throw new Error(`Package archive is missing ${required}`);
		}
	}

	await run(["tar", "-xzf", archive, "-C", extractedDestination], packageRoot);
	const manifest = JSON.parse(
		await readFile(
			join(extractedDestination, "package", "package.json"),
			"utf8",
		),
	) as {
		dependencies?: Record<string, string>;
		optionalDependencies?: Record<string, string>;
		private?: boolean;
		name?: string;
	};
	if (manifest.private !== true) {
		throw new Error("Development package must remain private");
	}
	assertExactRuntimeDependencies("runtime", manifest.dependencies);
	assertExactRuntimeDependencies(
		"optional runtime",
		manifest.optionalDependencies,
	);
	console.log(
		`verified ${manifest.name ?? basename(packageRoot)} archive (${files.length} entries, sha256 ${archiveDigest}, inventory ${inventoryDigest})`,
	);
} finally {
	await rm(destination, { recursive: true, force: true });
	await rm(replayDestination, { recursive: true, force: true });
	await rm(extractedDestination, { recursive: true, force: true });
}
