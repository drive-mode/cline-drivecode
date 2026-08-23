import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionArtifacts } from "./session-artifacts";

describe("SessionArtifacts containment", () => {
	const cleanup: string[] = [];

	afterEach(() => {
		for (const path of cleanup.splice(0)) {
			rmSync(path, { recursive: true, force: true });
		}
	});

	function fixture() {
		const root = mkdtempSync(join(tmpdir(), "session-artifacts-root-"));
		const outside = mkdtempSync(join(tmpdir(), "session-artifacts-outside-"));
		cleanup.push(root, outside);
		const sessions = join(root, "sessions");
		mkdirSync(sessions);
		return {
			artifacts: new SessionArtifacts(() => sessions),
			outside,
			sessions,
		};
	}

	it("rejects traversal-shaped session IDs before resolving artifact paths", () => {
		const { artifacts } = fixture();
		for (const sessionId of ["../../outside", "nested/session", "..", "."]) {
			expect(() => artifacts.sessionArtifactsDir(sessionId)).toThrow(
				"path-safe artifact segment",
			);
		}
	});

	it("rejects session directory symlinks and external recursive deletion", () => {
		const { artifacts, outside, sessions } = fixture();
		mkdirSync(join(outside, "keep"));
		symlinkSync(outside, join(sessions, "session-link"));

		expect(() => artifacts.sessionArtifactsDir("session-link")).toThrow(
			"cannot be a symbolic link",
		);
		expect(() => artifacts.removeDir(outside)).toThrow(
			"escaped the sessions directory",
		);
		expect(existsSync(join(outside, "keep"))).toBe(true);
	});
});
