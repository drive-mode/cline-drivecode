import { randomUUID } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type * as LlmsProviders from "@cline/llms";
import type { BasicLogger } from "@cline/shared";
import { ensureHookLogDir } from "@cline/shared/storage";
import { nowIso, SessionArtifacts } from "../../services/session-artifacts";
import {
	buildMessagesFilePayload,
	resolveMessagesFileContext,
	writeEmptyMessagesFile,
} from "../../services/session-data";
import type {
	SessionMessagesArtifactUploader,
	SessionPersistenceAdapter,
	StoredMessageWithMetadata,
} from "../../types/session";
import {
	parseSessionCompactionState,
	type SessionCompactionState,
	SessionCompactionStateSchema,
} from "../models/session-compaction";
import {
	type SessionManifest,
	SessionManifestSchema,
} from "../models/session-manifest";
import {
	isMatchingSessionManualCompactionSummary,
	type SessionManualCompactionBeginResult,
	SessionManualCompactionOperationIntegrityError,
	type SessionManualCompactionOperationReceipt,
	summarizeSessionManualCompactionState,
} from "../models/session-manual-compaction-operation";
import {
	type SessionWriterFenceCredential,
	SessionWriterFenceRejectedError,
} from "../writer-fence";
import { writeFileAtomic } from "./atomic-file";

function isNotFoundError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

export class SessionManifestStore {
	readonly artifacts: SessionArtifacts;

	constructor(
		private readonly adapter: SessionPersistenceAdapter,
		private readonly messagesArtifactUploader?: SessionMessagesArtifactUploader,
		private readonly logger?: BasicLogger,
	) {
		this.artifacts = new SessionArtifacts(() => this.ensureSessionsDir());
	}

	ensureSessionsDir(): string {
		return this.adapter.ensureSessionsDir();
	}

	async initializeMessagesFile(
		sessionId: string,
		path: string,
		startedAt: string,
		writerFence?: SessionWriterFenceCredential,
	): Promise<string> {
		const managed = await this.adapter.isCatalogManaged(sessionId);
		if (!managed) {
			if (writerFence) {
				throw new SessionWriterFenceRejectedError(
					sessionId,
					"session is not enrolled in managed persistence",
				);
			}
			writeEmptyMessagesFile(
				path,
				startedAt,
				resolveMessagesFileContext(sessionId),
			);
			return path;
		}
		if (!writerFence) {
			throw new SessionWriterFenceRejectedError(
				sessionId,
				"managed transcript initialization requires writer authority",
			);
		}
		const payload = buildMessagesFilePayload({
			updatedAt: startedAt,
			context: resolveMessagesFileContext(sessionId),
			messages: [],
		});
		const candidatePath = `${path}.g${writerFence.writerGeneration}.${randomUUID()}.json`;
		await writeFileAtomic(
			candidatePath,
			`${JSON.stringify(payload, null, 2)}\n`,
		);
		try {
			await this.adapter.commitCatalogManagedArtifact({
				sessionId,
				kind: "messages",
				path: candidatePath,
				writerFence,
			});
			return candidatePath;
		} catch (error) {
			await rm(candidatePath, { force: true }).catch(() => undefined);
			throw error;
		}
	}

	async writeSessionManifest(
		manifestPath: string,
		manifest: SessionManifest,
		writerFence?: SessionWriterFenceCredential,
	): Promise<void> {
		const sessionId = manifest.session_id;
		const contents = `${JSON.stringify(
			SessionManifestSchema.parse(manifest),
			null,
			2,
		)}\n`;
		const managed = await this.adapter.isCatalogManaged(sessionId);
		if (managed) {
			if (!writerFence) {
				throw new SessionWriterFenceRejectedError(
					sessionId,
					"managed manifest write requires writer authority",
				);
			}
			const candidatePath = `${manifestPath}.g${writerFence.writerGeneration}.${randomUUID()}.json`;
			await writeFileAtomic(candidatePath, contents);
			try {
				await this.adapter.commitCatalogManagedArtifact({
					sessionId,
					kind: "manifest",
					path: candidatePath,
					writerFence,
				});
			} catch (error) {
				await rm(candidatePath, { force: true }).catch(() => undefined);
				throw error;
			}
			return;
		}
		if (writerFence) {
			throw new SessionWriterFenceRejectedError(
				sessionId,
				"session is not enrolled in managed persistence",
			);
		}
		await writeFileAtomic(manifestPath, contents);
	}

	async readSessionManifest(
		sessionId: string,
	): Promise<SessionManifest | undefined> {
		const head = await this.adapter.getCatalogManagedArtifactHead(sessionId);
		const managedPath = head?.manifestPath;
		if (!managedPath) return this.readManifestFile(sessionId).manifest;
		try {
			return SessionManifestSchema.parse(
				JSON.parse(await readFile(managedPath, "utf8")) as SessionManifest,
			);
		} catch {
			return undefined;
		}
	}

	/**
	 * Asynchronously read only the manifest `metadata.title`.
	 *
	 * The session-listing hot path needs nothing from the manifest except the
	 * title, but the manifest JSON can be large (it embeds metadata and prompt
	 * text). This reads the file off the event-loop thread and pulls the title
	 * out of the parsed JSON directly, skipping the full `SessionManifestSchema`
	 * (Zod) validation that `readSessionManifest` performs. On any error (missing
	 * file, malformed JSON, non-string title) it resolves to `undefined` so
	 * callers fall back to the row metadata/prompt title.
	 */
	async readSessionManifestTitle(
		sessionId: string,
	): Promise<string | undefined> {
		const manifestPath = this.artifacts.sessionManifestPath(sessionId, false);
		let raw: string;
		try {
			raw = await readFile(manifestPath, "utf8");
		} catch {
			return undefined;
		}
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				return undefined;
			}
			const metadata = (parsed as { metadata?: unknown }).metadata;
			if (
				!metadata ||
				typeof metadata !== "object" ||
				Array.isArray(metadata)
			) {
				return undefined;
			}
			const title = (metadata as { title?: unknown }).title;
			return typeof title === "string" ? title : undefined;
		} catch {
			return undefined;
		}
	}

	readManifestFile(sessionId: string): {
		path: string;
		manifest?: SessionManifest;
	} {
		const manifestPath = this.artifacts.sessionManifestPath(sessionId, false);
		if (!existsSync(manifestPath)) {
			return { path: manifestPath };
		}
		try {
			return {
				path: manifestPath,
				manifest: SessionManifestSchema.parse(
					JSON.parse(readFileSync(manifestPath, "utf8")) as SessionManifest,
				),
			};
		} catch {
			return { path: manifestPath };
		}
	}

	async resolveArtifactPath(
		sessionId: string,
		kind: "messagesPath",
		fallback: (id: string) => string,
	): Promise<string> {
		const row = await this.adapter.getSession(sessionId);
		const value = row?.[kind];
		return typeof value === "string" && value.trim().length > 0
			? value
			: fallback(sessionId);
	}

	async persistSessionMessages(
		sessionId: string,
		messages: LlmsProviders.Message[],
		systemPrompt?: string,
		writerFence?: SessionWriterFenceCredential,
	): Promise<void> {
		let path = await this.resolveArtifactPath(sessionId, "messagesPath", (id) =>
			this.artifacts.sessionMessagesPath(id),
		);
		const payload = buildMessagesFilePayload({
			updatedAt: nowIso(),
			context: resolveMessagesFileContext(sessionId),
			messages: messages as StoredMessageWithMetadata[],
			systemPrompt,
		});
		const contents = `${JSON.stringify(payload, null, 2)}\n`;
		const managed = await this.adapter.isCatalogManaged(sessionId);
		if (managed) {
			if (!writerFence) {
				throw new SessionWriterFenceRejectedError(
					sessionId,
					"managed transcript write requires writer authority",
				);
			}
			const candidatePath = `${path}.g${writerFence.writerGeneration}.${randomUUID()}.json`;
			await writeFileAtomic(candidatePath, contents);
			try {
				await this.adapter.commitCatalogManagedArtifact({
					sessionId,
					kind: "messages",
					path: candidatePath,
					writerFence,
				});
				path = candidatePath;
			} catch (error) {
				await rm(candidatePath, { force: true }).catch(() => undefined);
				throw error;
			}
		} else {
			if (writerFence) {
				throw new SessionWriterFenceRejectedError(
					sessionId,
					"session is not enrolled in managed persistence",
				);
			}
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, contents, "utf8");
		}
		if (!this.messagesArtifactUploader) {
			return;
		}
		try {
			const row = await this.adapter.getSession(sessionId);
			await this.messagesArtifactUploader.uploadMessagesFile({
				sessionId,
				path,
				contents,
				row,
			});
		} catch (error) {
			this.logger?.debug("Failed to upload persisted session messages", {
				sessionId,
				error,
			});
		}
	}

	private async resolveCompactionPath(sessionId: string): Promise<string> {
		const head = await this.adapter.getCatalogManagedArtifactHead(sessionId);
		if (head?.compactionPath) return head.compactionPath;
		const { manifest } = this.readManifestFile(sessionId);
		return (
			manifest?.compaction_path?.trim() ||
			this.artifacts.sessionCompactionPath(sessionId)
		);
	}

	private async updateCompactionPath(
		sessionId: string,
		path: string | undefined,
		writerFence?: SessionWriterFenceCredential,
	): Promise<void> {
		const manifest = await this.readSessionManifest(sessionId);
		if (!manifest) {
			return;
		}
		if (manifest.compaction_path === path) {
			return;
		}
		await this.writeSessionManifest(
			this.artifacts.sessionManifestPath(sessionId, false),
			{ ...manifest, compaction_path: path },
			writerFence,
		);
	}

	async readSessionCompactionState(
		sessionId: string,
	): Promise<SessionCompactionState | undefined> {
		const path = await this.resolveCompactionPath(sessionId);
		try {
			return parseSessionCompactionState(
				JSON.parse(await readFile(path, "utf8")) as unknown,
			);
		} catch (error) {
			if (isNotFoundError(error)) {
				return undefined;
			}
			this.logger?.debug("Ignoring invalid session compaction state", {
				sessionId,
				path,
				error,
				recovery:
					"Canonical history is unchanged; deleting the sidecar is safe.",
			});
			return undefined;
		}
	}

	async beginSessionManualCompactionOperation(input: {
		sessionId: string;
		operationId: string;
		intentDigest: string;
		writerFence: SessionWriterFenceCredential;
	}): Promise<SessionManualCompactionBeginResult> {
		const durable =
			await this.adapter.beginCatalogManagedManualCompaction(input);
		if (durable.disposition !== "replay") return durable;
		const result = durable.receipt.result;
		if (!result) {
			throw new SessionManualCompactionOperationIntegrityError(
				"terminal manual compaction receipt has no result",
			);
		}
		if (result.outcome === "skipped") {
			return { disposition: "replay", result };
		}
		const path = durable.receipt.compactionPath;
		if (!path) {
			throw new SessionManualCompactionOperationIntegrityError(
				"completed manual compaction receipt has no sidecar path",
			);
		}
		let state: SessionCompactionState;
		try {
			state = SessionCompactionStateSchema.parse(
				JSON.parse(await readFile(path, "utf8")) as unknown,
			);
		} catch {
			throw new SessionManualCompactionOperationIntegrityError(
				"completed manual compaction sidecar is unavailable or invalid",
			);
		}
		if (!isMatchingSessionManualCompactionSummary(state, result.state)) {
			throw new SessionManualCompactionOperationIntegrityError(
				"manual compaction receipt does not match its sidecar",
			);
		}
		return {
			disposition: "replay",
			result: {
				operationId: result.operationId,
				sessionId: result.sessionId,
				outcome: "compacted",
				state,
			},
		};
	}

	async recoverSessionManualCompactionOperations(input: {
		sessionId: string;
		writerFence: SessionWriterFenceCredential;
	}): Promise<number> {
		return await this.adapter.recoverCatalogManagedManualCompactions(input);
	}

	async persistSessionManualCompactionState(input: {
		sessionId: string;
		operationId: string;
		intentDigest: string;
		state: SessionCompactionState;
		writerFence: SessionWriterFenceCredential;
	}): Promise<SessionManualCompactionOperationReceipt> {
		const basePath = this.artifacts.sessionCompactionPath(input.sessionId);
		const payload = SessionCompactionStateSchema.parse(input.state);
		const candidatePath = `${basePath}.g${input.writerFence.writerGeneration}.${randomUUID()}.json`;
		await writeFileAtomic(
			candidatePath,
			`${JSON.stringify(payload, null, 2)}\n`,
		);
		let receipt: SessionManualCompactionOperationReceipt;
		try {
			receipt = await this.adapter.commitCatalogManagedManualCompaction({
				sessionId: input.sessionId,
				operationId: input.operationId,
				intentDigest: input.intentDigest,
				status: "completed",
				result: {
					operationId: input.operationId,
					sessionId: input.sessionId,
					outcome: "compacted",
					state: summarizeSessionManualCompactionState(payload),
				},
				compactionPath: candidatePath,
				writerFence: input.writerFence,
			});
		} catch (error) {
			await rm(candidatePath, { force: true }).catch(() => undefined);
			throw error;
		}
		try {
			await this.updateCompactionPath(
				input.sessionId,
				candidatePath,
				input.writerFence,
			);
		} catch (error) {
			this.logger?.debug(
				"Failed to mirror authoritative manual compaction path into manifest",
				{ sessionId: input.sessionId, error },
			);
		}
		return receipt;
	}

	async finishSessionManualCompactionOperation(input: {
		sessionId: string;
		operationId: string;
		intentDigest: string;
		status: "skipped" | "failed";
		writerFence: SessionWriterFenceCredential;
	}): Promise<SessionManualCompactionOperationReceipt> {
		return await this.adapter.commitCatalogManagedManualCompaction({
			...input,
			...(input.status === "skipped"
				? {
						result: {
							operationId: input.operationId,
							sessionId: input.sessionId,
							outcome: "skipped" as const,
						},
					}
				: {}),
		});
	}

	async persistSessionCompactionState(
		sessionId: string,
		state: SessionCompactionState,
		writerFence?: SessionWriterFenceCredential,
	): Promise<void> {
		let path = await this.resolveCompactionPath(sessionId);
		const payload = SessionCompactionStateSchema.parse(state);
		const contents = `${JSON.stringify(payload, null, 2)}\n`;
		const managed = await this.adapter.isCatalogManaged(sessionId);
		if (managed) {
			if (!writerFence) {
				throw new SessionWriterFenceRejectedError(
					sessionId,
					"managed compaction write requires writer authority",
				);
			}
			const basePath = this.artifacts.sessionCompactionPath(sessionId);
			const candidatePath = `${basePath}.g${writerFence.writerGeneration}.${randomUUID()}.json`;
			await writeFileAtomic(candidatePath, contents);
			try {
				await this.adapter.commitCatalogManagedArtifact({
					sessionId,
					kind: "compaction",
					path: candidatePath,
					writerFence,
				});
				path = candidatePath;
			} catch (error) {
				await rm(candidatePath, { force: true }).catch(() => undefined);
				throw error;
			}
		} else {
			if (writerFence) {
				throw new SessionWriterFenceRejectedError(
					sessionId,
					"session is not enrolled in managed persistence",
				);
			}
			await writeFileAtomic(path, contents);
		}
		await this.updateCompactionPath(sessionId, path, writerFence);
	}

	async deleteSessionCompactionState(
		sessionId: string,
		writerFence?: SessionWriterFenceCredential,
	): Promise<void> {
		const path = await this.resolveCompactionPath(sessionId);
		const managed = await this.adapter.isCatalogManaged(sessionId);
		if (managed) {
			if (!writerFence) {
				throw new SessionWriterFenceRejectedError(
					sessionId,
					"managed compaction deletion requires writer authority",
				);
			}
			await this.adapter.commitCatalogManagedArtifact({
				sessionId,
				kind: "compaction",
				path: undefined,
				writerFence,
			});
		} else if (writerFence) {
			throw new SessionWriterFenceRejectedError(
				sessionId,
				"session is not enrolled in managed persistence",
			);
		}
		await rm(path, { force: true });
		await this.updateCompactionPath(sessionId, undefined, writerFence);
	}

	appendStaleSessionHookLog(
		detectedAt: string,
		sessionId: string,
		pid: number,
		reason: string,
		source: string,
	): void {
		const envPath = process.env.CLINE_HOOKS_LOG_PATH?.trim() || undefined;
		const logPath = envPath ?? join(ensureHookLogDir(), "hooks.jsonl");
		appendFileSync(
			logPath,
			`${JSON.stringify({
				ts: detectedAt,
				hookName: "session_shutdown",
				reason,
				sessionId,
				pid,
				source,
			})}\n`,
			"utf8",
		);
	}
}
