/**
 * Plays the demo scenario against a running writer.
 *
 * Chapters are not independent: each one acts on room state the earlier ones
 * built. `tests` transfers the Presenter title away from a grant that `handoff`
 * created, `handoff` transfers one that `presenter` created, and every work
 * event needs a roster that `lobby` joined. So `--chapter <id>` replays *from
 * the start through* that chapter rather than trying to run it alone — running
 * it alone fails on the first call that references a grant or participant that
 * does not exist yet.
 *
 * Start from a fresh writer (`writer-lifecycle.mjs`). Replaying onto a writer
 * that already holds a completed run reuses spent grant ids, and the Presenter
 * guard correctly rejects them.
 */

import { chapters } from "./scenario.mjs";

const args = process.argv.slice(2);

if (args.includes("--list")) {
	for (const chapter of chapters) {
		process.stdout.write(`${chapter.id.padEnd(11)} ${chapter.title}\n`);
	}
	process.exit(0);
}

const through = args.includes("--chapter")
	? args[args.indexOf("--chapter") + 1]
	: null;

if (through && !chapters.some((c) => c.id === through)) {
	process.stderr.write(
		`unknown chapter "${through}" — run with --list to see the eleven ids\n`,
	);
	process.exit(1);
}

for (const chapter of chapters) {
	process.stdout.write(`▶ ${chapter.id.padEnd(11)} ${chapter.title}\n`);
	await chapter.run();
	if (chapter.id === through) {
		process.stdout.write(`■ stopped after "${through}"\n`);
		process.exit(0);
	}
}

process.stdout.write("✓ scenario complete\n");
