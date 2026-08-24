import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: prepare-smoke-fixture.ts <workspace>");

await mkdir(join(root, ".github", "workflows"), { recursive: true });
await mkdir(join(root, "src"), { recursive: true });
await mkdir(join(root, "ignored"), { recursive: true });
await mkdir(join(root, "secrets-prod"), { recursive: true });
await mkdir(join(root, "private-evaluator-v2"), { recursive: true });
await writeFile(join(root, ".gitignore"), "ignored/\n");
await writeFile(
	join(root, "package.json"),
	JSON.stringify({
		name: "smoke-private-package-canary",
		bin: "./private-cli-canary.js",
		exports: "./private-export-canary.js",
		dependencies: {
			react: "private-react-version-canary",
			express: "private-express-version-canary",
		},
		scripts: { deploy: "private-script-canary" },
	}),
);
await writeFile(join(root, "Dockerfile"), "raw-docker-canary");
await writeFile(
	join(root, ".github", "workflows", "ci.yml"),
	"raw-workflow-canary",
);
await writeFile(join(root, "src", "private.ts"), "raw-source-canary");
await writeFile(
	join(root, "ignored", "package.json"),
	'{"dependencies":{"express":"ignored-manifest-canary"}}',
);
await writeFile(
	join(root, "secrets-prod", "package.json"),
	'{"dependencies":{"express":"secret-manifest-canary"}}',
);
await writeFile(
	join(root, "private-evaluator-v2", "package.json"),
	'{"dependencies":{"express":"evaluator-manifest-canary"}}',
);

for (const args of [
	["init", "-q"],
	[
		"add",
		"-f",
		".gitignore",
		"secrets-prod/package.json",
		"private-evaluator-v2/package.json",
	],
]) {
	const process = Bun.spawn(["git", "-C", root, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if ((await process.exited) !== 0) {
		throw new Error(await new Response(process.stderr).text());
	}
}
