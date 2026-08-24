import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	rmdirSync,
	rmSync,
	unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	parseSubSessionId,
	parseTeamTaskSubSessionId,
} from "../session/models/session-graph";

export function nowIso(): string {
	return new Date().toISOString();
}

export function unlinkIfExists(path: string | null | undefined): void {
	if (!path || !existsSync(path)) {
		return;
	}
	try {
		unlinkSync(path);
	} catch {
		// Best effort cleanup.
	}
}

export interface SessionArtifactPaths {
	messagesPath: string;
}

const SAFE_SESSION_ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,511}$/;

function assertSafeSessionArtifactId(sessionId: string): string {
	if (
		!SAFE_SESSION_ARTIFACT_ID.test(sessionId) ||
		sessionId === "." ||
		sessionId === ".."
	) {
		throw new Error("session id must be one path-safe artifact segment");
	}
	return sessionId;
}

function isContainedPath(root: string, candidate: string): boolean {
	const relation = relative(root, candidate);
	return (
		relation === "" ||
		(!isAbsolute(relation) &&
			relation !== ".." &&
			!relation.startsWith(`..${sep}`))
	);
}

function childArtifactFileStem(sessionId: string): {
	rootSessionId: string;
	fileStem: string;
} {
	const teamTask = parseTeamTaskSubSessionId(sessionId);
	if (teamTask) {
		return {
			rootSessionId: teamTask.rootSessionId,
			fileStem: `${teamTask.agentId}__${teamTask.teamTaskId}`,
		};
	}

	const subagent = parseSubSessionId(sessionId);
	if (subagent) {
		return {
			rootSessionId: subagent.rootSessionId,
			fileStem: subagent.agentId,
		};
	}

	return {
		rootSessionId: sessionId,
		fileStem: sessionId,
	};
}

export class SessionArtifacts {
	constructor(private readonly ensureSessionsDir: () => string) {}

	public assertContainedPath(
		path: string,
		options: { rejectFinalSymlink?: boolean } = {},
	): string {
		const root = resolve(this.ensureSessionsDir());
		const candidate = resolve(path);
		if (!isContainedPath(root, candidate)) {
			throw new Error("session artifact path escaped the sessions directory");
		}
		const canonicalRoot = realpathSync(root);
		let probe = candidate;
		if (existsSync(probe) && lstatSync(probe).isSymbolicLink()) {
			if (options.rejectFinalSymlink) {
				throw new Error("session artifact directory cannot be a symbolic link");
			}
			probe = dirname(probe);
		} else {
			while (!existsSync(probe) && probe !== root) probe = dirname(probe);
		}
		const canonicalProbe = realpathSync(probe);
		if (!isContainedPath(canonicalRoot, canonicalProbe)) {
			throw new Error("session artifact path escaped through a symbolic link");
		}
		return candidate;
	}

	public sessionArtifactsDir(sessionId: string): string {
		const safeId = assertSafeSessionArtifactId(sessionId);
		return this.assertContainedPath(resolve(this.ensureSessionsDir(), safeId), {
			rejectFinalSymlink: true,
		});
	}

	public ensureSessionArtifactsDir(sessionId: string): string {
		const dir = this.sessionArtifactsDir(sessionId);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		return dir;
	}

	public sessionMessagesPath(sessionId: string): string {
		return join(
			this.sessionArtifactsDir(sessionId),
			`${sessionId}.messages.json`,
		);
	}

	public sessionCompactionPath(sessionId: string): string {
		return join(
			this.sessionArtifactsDir(sessionId),
			`${sessionId}.compaction.json`,
		);
	}

	public sessionManifestPath(sessionId: string, ensureDir = false): string {
		const base = ensureDir
			? this.ensureSessionArtifactsDir(sessionId)
			: this.sessionArtifactsDir(sessionId);
		return join(base, `${sessionId}.json`);
	}

	public removeSessionDirIfEmpty(sessionId: string): void {
		let dir = this.sessionArtifactsDir(sessionId);
		const sessionsDir = resolve(this.ensureSessionsDir());
		while (isContainedPath(sessionsDir, dir) && dir !== sessionsDir) {
			if (!existsSync(dir)) {
				dir = dirname(dir);
				continue;
			}
			try {
				if (readdirSync(dir).length > 0) {
					break;
				}
				rmdirSync(dir);
			} catch {
				// Best-effort cleanup.
				break;
			}
			dir = dirname(dir);
		}
	}

	public removeSessionDir(sessionId: string): void {
		this.removeDir(this.sessionArtifactsDir(sessionId));
	}

	public removeDir(dir: string): void {
		const containedDir = this.assertContainedPath(dir, {
			rejectFinalSymlink: true,
		});
		if (!existsSync(containedDir)) {
			return;
		}
		try {
			rmSync(containedDir, { recursive: true, force: true });
		} catch {
			// Best-effort cleanup.
		}
	}

	public subagentArtifactPaths(
		sessionId: string,
		subAgentId: string,
		activeTeamTaskSessionId?: string,
	): SessionArtifactPaths {
		void subAgentId;
		void activeTeamTaskSessionId;
		const { rootSessionId, fileStem } = childArtifactFileStem(sessionId);
		const dir = this.sessionArtifactsDir(rootSessionId);
		return {
			messagesPath: join(dir, `${fileStem}.messages.json`),
		};
	}
}
