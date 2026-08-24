export interface SessionWriterFenceCredential {
	leaseToken: string;
	revision: number;
	writerGeneration: number;
	expiresAt: string;
}

export type SessionManagedArtifactKind = "messages" | "compaction" | "manifest";

export interface SessionManagedArtifactHead {
	sessionId: string;
	commitSequence: number;
	leaseRevision: number;
	writerGeneration: number;
	messagesPath?: string;
	compactionPath?: string;
	manifestPath?: string;
	managedAt: string;
	updatedAt: string;
}

export class SessionWriterFenceRejectedError extends Error {
	readonly code = "session_writer_fence_rejected";

	constructor(
		readonly sessionId: string,
		message = "catalog-managed session write was rejected",
	) {
		super(`${message}: ${sessionId}`);
		this.name = "SessionWriterFenceRejectedError";
	}
}

export function isSessionWriterFenceRejectedError(
	error: unknown,
): error is SessionWriterFenceRejectedError {
	return (
		error instanceof SessionWriterFenceRejectedError ||
		(typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "session_writer_fence_rejected")
	);
}
