import { resolve } from "node:path";
import type * as LlmsProviders from "@cline/llms";
import type { AgentResult, ChatBindingRecord, ChatDetail } from "@cline/shared";
import type { CheckpointEntry } from "../hooks/checkpoint-hooks";
import { retainCheckpointRefs } from "../hooks/checkpoint-hooks";
import type {
	RestoreSessionInput,
	RuntimeHost,
	SendSessionInput,
	SessionWriterLease,
	StartSessionInput,
	StartSessionResult,
} from "../runtime/host/runtime-host";
import {
	applyCheckpointToWorktree,
	beginWorktreeRestoreTransaction,
	type WorktreeRestoreTransaction,
} from "../session/checkpoint-restore";
import { SessionVersioningService } from "../session/session-versioning-service";
import { SessionSource } from "../types/common";
import {
	assertManagedProfileContinuity,
	type ManagedProfileAuthority,
	readManagedProfileAuthority,
} from "./managed-profile-authority";
import type {
	CatalogBindingTarget,
	CatalogLeaseGuard,
	CatalogLeaseHandle,
	ChatSessionLifecycleCoordinator,
} from "./session-lifecycle-coordinator";
import {
	type ChatBindingScope,
	ChatCatalogError,
} from "./sqlite-chat-catalog-service";

export interface CatalogManagedResumeInput {
	/** Stable across retries of the same user-visible resume operation. */
	operationId: string;
	/** CAS observed before beginning this resume operation. */
	expectedLeaseRevision?: number;
	leaseTtlMs?: number;
	startInput: StartSessionInput;
}

export interface CatalogManagedRecoverLostLeaseInput {
	/** Stable across retries of the same confirmed recovery operation. */
	operationId: string;
	leaseTtlMs?: number;
	startInput: StartSessionInput;
}

export interface CatalogManagedResumeResult {
	startResult: StartSessionResult;
	turnResult?: AgentResult;
	chatId: string;
	leaseRevision: number;
	writerGeneration: number;
	leaseExpiresAt: string;
}

export interface CatalogManagedSessionAuthority {
	readonly sessionId: string;
	readonly leaseRevision: number;
	readonly writerGeneration: number;
	readonly leaseExpiresAt: string;
}

export interface CatalogManagedReconnectInput {
	/** Stable across retries of the same resident reconnect operation. */
	operationId: string;
	sessionId: string;
	expectedWriterGeneration: number;
	/** Cancels only while the transition remains pre-durable. */
	signal?: AbortSignal;
}

export interface CatalogManagedStartRootInput {
	/** Stable across retries of the same user-visible fresh-start operation. */
	operationId: string;
	chatId?: string;
	title?: string;
	titleSource?: string;
	leaseTtlMs?: number;
	startInput: StartSessionInput;
}

export interface CatalogManagedStartRelatedInput {
	/** Stable across retries of the same user-visible derived-start operation. */
	operationId: string;
	chatId: string;
	parentSessionId: string;
	relationKind: "fork" | "checkpoint_restore" | "config_restart" | "recovery";
	expectedRevision?: number;
	title?: string;
	titleSource?: string;
	leaseTtlMs?: number;
	startInput: StartSessionInput;
}

export interface CatalogManagedRestoreCheckpointInput
	extends Omit<
		CatalogManagedStartRelatedInput,
		"relationKind" | "expectedRevision"
	> {
	checkpointRunCount: number;
	cwd?: string;
	restore?: RestoreSessionInput["restore"];
}

export interface CatalogManagedRestoreCheckpointResult
	extends CatalogManagedResumeResult {
	messages?: LlmsProviders.Message[];
	checkpoint: CheckpointEntry;
}

export interface CatalogManagedSessionRuntimeOptions {
	host: RuntimeHost;
	coordinator: ChatSessionLifecycleCoordinator;
	clock?: () => Date;
	checkpointRestore?: {
		beginWorkspaceRestoreTransaction(
			cwd: string,
		): Promise<WorktreeRestoreTransaction>;
		applyWorkspaceCheckpoint(
			cwd: string,
			checkpoint: CheckpointEntry,
		): Promise<void>;
		retainCheckpointRefs(
			cwd: string,
			sessionId: string,
			checkpoints: readonly CheckpointEntry[],
		): Promise<void>;
	};
}

export interface CatalogManagedBindInput {
	operationId: string;
	sessionId: string;
	target: CatalogBindingTarget;
}

export interface CatalogManagedResetInput {
	operationId: string;
	sessionId: string;
	binding?: CatalogBindingTarget;
}

export interface CatalogManagedArchiveInput {
	operationId: string;
	chatId: string;
	expectedRevision: number;
	/** Explicit human-requested stop-and-archive path. */
	stopRunning?: boolean;
	/** Atomically unbind with the archive transition. */
	clearBindings?: boolean;
}

export interface CatalogManagedActivateInput {
	operationId: string;
	chatId: string;
	expectedRevision: number;
}

export interface CatalogManagedRenameInput extends CatalogManagedActivateInput {
	title: string;
}

export interface CatalogManagedPurgeResult {
	chatId: string;
	sessionIds: string[];
	applied: boolean;
}

export function createCatalogWriterLeaseVerifier(
	coordinator: ChatSessionLifecycleCoordinator,
): (credential: SessionWriterLease & { sessionId: string }) => Promise<void> {
	return async (credential) => {
		await coordinator.verifyLease(credential);
	};
}

/**
 * Trusted-core composition for catalog-authoritative session execution.
 *
 * Lease credentials remain inside this process. Untrusted clients receive only
 * sanitized chat/revision/expiry state and never submit a writer credential to
 * generic runtime commands.
 */
export class CatalogManagedSessionRuntime {
	readonly #host: RuntimeHost;
	readonly #coordinator: ChatSessionLifecycleCoordinator;
	readonly #clock: () => Date;
	readonly #sessionVersioning = new SessionVersioningService();
	readonly #checkpointRestore: NonNullable<
		CatalogManagedSessionRuntimeOptions["checkpointRestore"]
	>;
	readonly #guards = new Map<string, CatalogLeaseGuard>();
	readonly #profileAuthorities = new Map<string, ManagedProfileAuthority>();
	readonly #resetOperations = new Map<string, string>();
	readonly #residentRekeys = new Map<
		string,
		{
			expectedWriterGeneration: number;
			promise: Promise<CatalogManagedSessionAuthority>;
		}
	>();

	constructor(options: CatalogManagedSessionRuntimeOptions) {
		this.#host = options.host;
		this.#coordinator = options.coordinator;
		this.#clock = options.clock ?? (() => new Date());
		this.#checkpointRestore = options.checkpointRestore ?? {
			beginWorkspaceRestoreTransaction: beginWorktreeRestoreTransaction,
			applyWorkspaceCheckpoint: applyCheckpointToWorktree,
			retainCheckpointRefs,
		};
		if (!this.#host.updateSessionWriterLease) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed catalog sessions require runtime writer-fence support",
			);
		}
		if (!this.#host.quiesceSession) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed catalog sessions require runtime quiescence receipts",
			);
		}
		if (!this.#host.transitionSessionWriterLease) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed catalog sessions require writer-transition support",
			);
		}
	}

	/** Verifier injected into the co-located LocalRuntimeHost at construction. */
	writerLeaseVerifier = async (
		credential: SessionWriterLease & { sessionId: string },
	): Promise<void> => {
		await createCatalogWriterLeaseVerifier(this.#coordinator)(credential);
	};

	#requestedProfile(startInput: StartSessionInput) {
		return readManagedProfileAuthority(startInput.sessionMetadata);
	}

	async #assertProfileContinuity(
		sessionId: string,
		startInput: StartSessionInput,
		options: { allowChange?: boolean } = {},
	): Promise<void> {
		const persistedSession = await this.#host.getSession(sessionId);
		const persisted = readManagedProfileAuthority(persistedSession?.metadata);
		const requested = this.#requestedProfile(startInput);
		if (options.allowChange) {
			if (
				Boolean(persisted) !== Boolean(requested) ||
				(persisted !== undefined &&
					requested !== undefined &&
					(persisted.profileId !== requested.profileId ||
						persisted.authorityClassId !== requested.authorityClassId))
			) {
				throw new ChatCatalogError(
					"unsupported_capability",
					"managed session profile transition is not authorized",
				);
			}
			return;
		}
		assertManagedProfileContinuity({ persisted, requested });
	}

	async startRoot(
		input: CatalogManagedStartRootInput,
	): Promise<CatalogManagedResumeResult> {
		const operationId = input.operationId.trim();
		if (!operationId) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed root start requires a stable operation id",
			);
		}
		if (input.startInput.writerLease) {
			throw new ChatCatalogError(
				"invalid_input",
				"writer credentials are minted only by trusted catalog authority",
			);
		}
		const sessionId = input.startInput.config.sessionId?.trim() ?? "";
		const cwd = input.startInput.config.cwd?.trim() ?? "";
		const workspaceRoot = input.startInput.config.workspaceRoot?.trim() ?? "";
		if (!sessionId || !cwd || !workspaceRoot) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed root start requires session and resolved workspace ids",
			);
		}
		if (this.#guards.has(sessionId)) {
			throw new ChatCatalogError(
				"lease_conflict",
				`session ${sessionId} is already managed by this runtime`,
			);
		}
		this.#requestedProfile(input.startInput);
		const startedAt = this.#clock();
		if (!Number.isFinite(startedAt.getTime())) {
			throw new ChatCatalogError("invalid_input", "runtime clock is invalid");
		}
		const handle = await this.#coordinator.admitRoot({
			operationId,
			chatId: input.chatId?.trim() || `chat_${sessionId}`,
			sessionId,
			source: input.startInput.source ?? SessionSource.CORE,
			pid: process.pid,
			startedAt: startedAt.toISOString(),
			interactive: input.startInput.interactive ?? false,
			provider: input.startInput.config.providerId,
			model: input.startInput.config.modelId,
			cwd,
			workspaceRoot,
			...(input.startInput.config.teamName
				? { teamName: input.startInput.config.teamName }
				: {}),
			enableTools: input.startInput.config.enableTools,
			enableSpawn: input.startInput.config.enableSpawnAgent,
			enableTeams: input.startInput.config.enableAgentTeams,
			...(input.startInput.prompt ? { prompt: input.startInput.prompt } : {}),
			...(input.startInput.sessionMetadata
				? { metadata: input.startInput.sessionMetadata }
				: {}),
			...(input.title ? { title: input.title } : {}),
			...(input.titleSource ? { titleSource: input.titleSource } : {}),
			...(input.leaseTtlMs === undefined ? {} : { ttlMs: input.leaseTtlMs }),
		});
		return await this.#startWithHandle(
			handle,
			{
				...input.startInput,
				config: { ...input.startInput.config, sessionId },
			},
			input.leaseTtlMs,
			operationId,
		);
	}

	async startRelated(
		input: CatalogManagedStartRelatedInput,
	): Promise<CatalogManagedResumeResult> {
		return await this.#startRelated(input);
	}

	async restoreCheckpoint(
		input: CatalogManagedRestoreCheckpointInput,
	): Promise<CatalogManagedRestoreCheckpointResult> {
		if (input.restore?.messages === false) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed checkpoint restore must materialize a replacement session",
			);
		}
		const prepared = await this.#sessionVersioning.prepareCheckpointRestore({
			sessionId: input.parentSessionId,
			checkpointRunCount: input.checkpointRunCount,
			...(input.cwd === undefined ? {} : { cwd: input.cwd }),
			...(input.restore === undefined ? {} : { restore: input.restore }),
			getSession: (sessionId) => this.#host.getSession(sessionId),
			readMessages: (sessionId) => this.#host.readSessionMessages(sessionId),
		});
		const { context } = prepared;
		const replacementCwd = input.startInput.config.cwd?.trim() ?? "";
		if (
			!replacementCwd ||
			resolve(context.plan.cwd) !== resolve(replacementCwd)
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed checkpoint restore must target the replacement session workspace",
			);
		}
		let transaction: WorktreeRestoreTransaction | undefined;
		let workspaceCommitted = false;
		const sessionMetadata = context.restoredCheckpointMetadata
			? {
					...(input.startInput.sessionMetadata ?? {}),
					checkpoint: context.restoredCheckpointMetadata,
				}
			: input.startInput.sessionMetadata;
		const startInput: StartSessionInput = {
			...input.startInput,
			...(sessionMetadata ? { sessionMetadata } : {}),
			initialMessages: context.initialMessages,
		};

		const result = await this.#startRelated(
			{
				operationId: input.operationId,
				chatId: input.chatId,
				parentSessionId: input.parentSessionId,
				relationKind: "checkpoint_restore",
				...(input.title ? { title: input.title } : {}),
				...(input.titleSource ? { titleSource: input.titleSource } : {}),
				...(input.leaseTtlMs === undefined
					? {}
					: { leaseTtlMs: input.leaseTtlMs }),
				startInput,
			},
			{
				beforeHostStart: async () => {
					if (!context.restoreWorkspace) return;
					transaction =
						await this.#checkpointRestore.beginWorkspaceRestoreTransaction(
							context.plan.cwd,
						);
					await this.#checkpointRestore.applyWorkspaceCheckpoint(
						context.plan.cwd,
						context.plan.checkpoint,
					);
				},
				afterSuccessfulStart: async () => {
					await this.#checkpointRestore.retainCheckpointRefs(
						context.plan.cwd,
						startInput.config.sessionId ?? "",
						context.restoredCheckpointMetadata?.history ?? [],
					);
					await transaction?.commit();
					workspaceCommitted = true;
				},
				onFailure: async () => {
					if (transaction && !workspaceCommitted) {
						await transaction.rollback();
					}
				},
			},
		);
		return {
			...result,
			...(context.plan.messages ? { messages: context.plan.messages } : {}),
			checkpoint: context.plan.checkpoint,
		};
	}

	async #startRelated(
		input: CatalogManagedStartRelatedInput,
		hooks?: {
			beforeHostStart?: () => Promise<void>;
			afterSuccessfulStart?: () => Promise<void>;
			onFailure?: () => Promise<void>;
		},
	): Promise<CatalogManagedResumeResult> {
		const operationId = input.operationId.trim();
		const parentSessionId = input.parentSessionId.trim();
		const chatId = input.chatId.trim();
		if (!operationId || !parentSessionId || !chatId) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed related start requires stable operation, chat, and parent ids",
			);
		}
		if (input.startInput.writerLease) {
			throw new ChatCatalogError(
				"invalid_input",
				"writer credentials are minted only by trusted catalog authority",
			);
		}
		const sessionId = input.startInput.config.sessionId?.trim() ?? "";
		const cwd = input.startInput.config.cwd?.trim() ?? "";
		const workspaceRoot = input.startInput.config.workspaceRoot?.trim() ?? "";
		if (!sessionId || !cwd || !workspaceRoot) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed related start requires session and resolved workspace ids",
			);
		}
		if (this.#guards.has(sessionId)) {
			throw new ChatCatalogError(
				"lease_conflict",
				`session ${sessionId} is already managed by this runtime`,
			);
		}
		await this.#assertProfileContinuity(parentSessionId, input.startInput, {
			allowChange: input.relationKind === "config_restart",
		});
		const startedAt = this.#clock();
		if (!Number.isFinite(startedAt.getTime())) {
			throw new ChatCatalogError("invalid_input", "runtime clock is invalid");
		}
		const handle = await this.#coordinator.admitRelated({
			operationId,
			chatId,
			parentSessionId,
			relationKind: input.relationKind,
			...(input.expectedRevision === undefined
				? {}
				: { expectedRevision: input.expectedRevision }),
			sessionId,
			source: input.startInput.source ?? SessionSource.CORE,
			pid: process.pid,
			startedAt: startedAt.toISOString(),
			interactive: input.startInput.interactive ?? false,
			provider: input.startInput.config.providerId,
			model: input.startInput.config.modelId,
			cwd,
			workspaceRoot,
			...(input.startInput.config.teamName
				? { teamName: input.startInput.config.teamName }
				: {}),
			enableTools: input.startInput.config.enableTools,
			enableSpawn: input.startInput.config.enableSpawnAgent,
			enableTeams: input.startInput.config.enableAgentTeams,
			...(input.startInput.prompt ? { prompt: input.startInput.prompt } : {}),
			...(input.startInput.sessionMetadata
				? { metadata: input.startInput.sessionMetadata }
				: {}),
			...(input.title ? { title: input.title } : {}),
			...(input.titleSource ? { titleSource: input.titleSource } : {}),
			...(input.leaseTtlMs === undefined ? {} : { ttlMs: input.leaseTtlMs }),
		});
		return await this.#startWithHandle(
			handle,
			{
				...input.startInput,
				config: { ...input.startInput.config, sessionId },
			},
			input.leaseTtlMs,
			operationId,
			hooks,
		);
	}

	async resume(
		input: CatalogManagedResumeInput,
	): Promise<CatalogManagedResumeResult> {
		const operationId = input.operationId.trim();
		const sessionId = input.startInput.config.sessionId?.trim() ?? "";
		if (!operationId || !sessionId) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed resume requires stable operation and session ids",
			);
		}
		if (input.startInput.writerLease) {
			throw new ChatCatalogError(
				"invalid_input",
				"writer credentials are minted only by trusted catalog authority",
			);
		}
		if (this.#guards.has(sessionId)) {
			throw new ChatCatalogError(
				"lease_conflict",
				`session ${sessionId} is already managed by this runtime`,
			);
		}
		await this.#assertProfileContinuity(sessionId, input.startInput);

		const handle = await this.#coordinator.prepareResume({
			operationId,
			sessionId,
			acquireInvocationId: `${operationId}:acquire`,
			...(input.expectedLeaseRevision === undefined
				? {}
				: { expectedLeaseRevision: input.expectedLeaseRevision }),
			...(input.leaseTtlMs === undefined
				? {}
				: { leaseTtlMs: input.leaseTtlMs }),
		});
		return await this.#startWithHandle(
			handle,
			input.startInput,
			input.leaseTtlMs,
			operationId,
		);
	}

	async recoverLostLease(
		input: CatalogManagedRecoverLostLeaseInput,
	): Promise<CatalogManagedResumeResult> {
		const operationId = input.operationId.trim();
		const sessionId = input.startInput.config.sessionId?.trim() ?? "";
		if (!operationId || !sessionId) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed lost-lease recovery requires stable operation and session ids",
			);
		}
		if (input.startInput.writerLease) {
			throw new ChatCatalogError(
				"invalid_input",
				"writer credentials are minted only by trusted catalog authority",
			);
		}
		if (this.#guards.has(sessionId)) {
			throw new ChatCatalogError(
				"lease_conflict",
				`session ${sessionId} is already managed by this runtime`,
			);
		}
		await this.#assertProfileContinuity(sessionId, input.startInput);

		const handle = await this.#coordinator.recoverLostResumeLease({
			operationId,
			sessionId,
			...(input.leaseTtlMs === undefined
				? {}
				: { leaseTtlMs: input.leaseTtlMs }),
		});
		return await this.#startWithHandle(
			handle,
			input.startInput,
			input.leaseTtlMs,
			operationId,
		);
	}

	async runTurn(
		input: SendSessionInput & { operationId: string },
	): Promise<AgentResult | undefined> {
		const operationId = input.operationId.trim();
		if (!operationId) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed turn requires a stable operation id",
			);
		}
		const { operationId: _operationId, ...turnInput } = input;
		const target = turnInput.sessionId.trim();
		const guard = this.#guards.get(target);
		if (!guard) {
			throw new ChatCatalogError(
				"session_not_found",
				"managed turn requires a resident guarded session",
			);
		}
		const profile = this.#profileAuthorities.get(target);
		if (profile) {
			const persistedSession = await this.#host.getSession(target);
			assertManagedProfileContinuity({
				persisted: readManagedProfileAuthority(persistedSession?.metadata),
				requested: profile,
			});
		}
		if (
			profile &&
			turnInput.mode !== undefined &&
			!profile.allowedModes.includes(turnInput.mode)
		) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed turn mode exceeds the persisted profile authority",
			);
		}
		return await this.#runGuardedTurn(guard, turnInput, operationId);
	}

	async getBinding(
		scope: ChatBindingScope,
	): Promise<ChatBindingRecord | undefined> {
		return await this.#coordinator.getBinding(scope);
	}

	async archive(input: CatalogManagedArchiveInput): Promise<ChatDetail> {
		const operationId = input.operationId.trim();
		if (!operationId) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed archive requires a stable operation id",
			);
		}
		return await this.#coordinator.archive({
			operationId,
			chatId: input.chatId,
			expectedRevision: input.expectedRevision,
			...(input.clearBindings ? { clearBindings: true } : {}),
			...(input.stopRunning
				? {
						stopSessions: async (chat) => {
							for (const session of chat.sessions) {
								const sessionId = session.sessionId;
								if (this.#guards.has(sessionId)) {
									await this.stop(
										sessionId,
										`${operationId}:archive:${sessionId}`,
									);
								} else if (
									session.executionStatus === "idle" ||
									session.executionStatus === "running" ||
									session.executionStatus === "pending"
								) {
									throw new ChatCatalogError(
										"chat_running",
										`session ${sessionId} is running outside this managed runtime`,
									);
								}
							}
						},
					}
				: {}),
		});
	}

	async activate(input: CatalogManagedActivateInput): Promise<ChatDetail> {
		return await this.#coordinator.activate(input);
	}

	async rename(input: CatalogManagedRenameInput): Promise<ChatDetail> {
		return await this.#coordinator.rename(input);
	}

	async purge(
		input: CatalogManagedActivateInput,
	): Promise<CatalogManagedPurgeResult> {
		const result = await this.#coordinator.purge(input);
		return {
			chatId: input.chatId.trim(),
			sessionIds: [...result.sessionIds],
			applied: result.receipt.applied,
		};
	}

	async bind(input: CatalogManagedBindInput): Promise<ChatBindingRecord> {
		const operationId = input.operationId.trim();
		const sessionId = input.sessionId.trim();
		if (!operationId || !sessionId) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed bind requires stable operation and session ids",
			);
		}
		const guard = this.#guards.get(sessionId);
		if (!guard || guard.signal.aborted) {
			throw new ChatCatalogError(
				"session_not_found",
				"managed bind requires a resident guarded session",
			);
		}
		const handle = guard.snapshot();
		return await this.#coordinator.bind({
			operationId,
			chatId: handle.chat.chatId,
			sessionId,
			target: input.target,
		});
	}

	async reset(
		input: CatalogManagedResetInput,
	): Promise<ChatBindingRecord | undefined> {
		const operationId = input.operationId.trim();
		const sessionId = input.sessionId.trim();
		if (!operationId || !sessionId) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed reset requires stable operation and session ids",
			);
		}
		const priorOperation = this.#resetOperations.get(sessionId);
		if (priorOperation && priorOperation !== operationId) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed reset retry must reuse the original operation id",
			);
		}
		const guard = this.#guards.get(sessionId);
		if (!guard) {
			throw new ChatCatalogError(
				"session_not_found",
				`no managed writer lease exists for session ${sessionId}`,
			);
		}
		this.#resetOperations.set(sessionId, operationId);
		const quiesceSession = this.#host.quiesceSession;
		if (!quiesceSession) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed runtime lost quiescence capability",
			);
		}
		try {
			await quiesceSession.call(this.#host, sessionId, "catalog_managed_reset");
		} catch (error) {
			await this.#host.abort(sessionId, error).catch(() => undefined);
			await guard.stop({ release: false });
			throw error;
		}
		await guard.stop({ release: false });
		const handle = guard.snapshot();
		const result = await this.#coordinator.reset({
			operationId,
			sessionId,
			stop: async () => undefined,
			...(input.binding ? { binding: input.binding } : {}),
			lease: {
				leaseToken: handle.leaseToken,
				revision: handle.revision,
			},
		});
		this.#guards.delete(sessionId);
		this.#profileAuthorities.delete(sessionId);
		this.#resetOperations.delete(sessionId);
		return result.binding;
	}

	async stop(sessionId: string, operationId: string): Promise<void> {
		const target = sessionId.trim();
		const operation = operationId.trim();
		if (!target || !operation) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed stop requires stable operation and session ids",
			);
		}
		const guard = this.#guards.get(target);
		if (!guard) {
			throw new ChatCatalogError(
				"session_not_found",
				`no managed writer lease exists for session ${target}`,
			);
		}
		const quiesceSession = this.#host.quiesceSession;
		if (!quiesceSession) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed runtime lost quiescence capability",
			);
		}
		try {
			await quiesceSession.call(this.#host, target, "catalog_managed_stop");
		} catch (error) {
			await this.#host.abort(target, error).catch(() => undefined);
			await guard.stop({ release: false });
			throw error;
		}
		await guard.stop({
			release: true,
			operationId: `${operation}:release`,
		});
		this.#guards.delete(target);
		this.#profileAuthorities.delete(target);
		this.#resetOperations.delete(target);
	}

	manages(sessionId: string): boolean {
		return this.#guards.has(sessionId.trim());
	}

	residentAuthoritySignal(sessionIdInput: string): AbortSignal {
		const sessionId = sessionIdInput.trim();
		const guard = this.#guards.get(sessionId);
		if (!sessionId || !guard) {
			throw new ChatCatalogError(
				"session_not_found",
				"managed session authority is not resident",
			);
		}
		return guard.signal;
	}

	async verifyResidentAuthority(
		sessionIdInput: string,
	): Promise<CatalogManagedSessionAuthority> {
		const sessionId = sessionIdInput.trim();
		const guard = this.#guards.get(sessionId);
		if (!sessionId || !guard) {
			throw new ChatCatalogError(
				"session_not_found",
				"managed session authority is not resident",
			);
		}
		const current = await guard.renewNow();
		if (this.#guards.get(sessionId) !== guard || guard.signal.aborted) {
			throw new ChatCatalogError(
				"lease_conflict",
				"managed session authority changed during verification",
			);
		}
		return Object.freeze({
			sessionId,
			leaseRevision: current.revision,
			writerGeneration: current.writerGeneration,
			leaseExpiresAt: current.expiresAt,
		});
	}

	async rekeyResidentAuthority(
		input: CatalogManagedReconnectInput,
	): Promise<CatalogManagedSessionAuthority> {
		const operationId = input.operationId.trim();
		const sessionId = input.sessionId.trim();
		input.signal?.throwIfAborted();
		if (
			!operationId ||
			!sessionId ||
			!Number.isSafeInteger(input.expectedWriterGeneration) ||
			input.expectedWriterGeneration < 1
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"resident rekey requires stable operation, session, and generation",
			);
		}
		const guard = this.#guards.get(sessionId);
		if (!guard || guard.signal.aborted) {
			throw new ChatCatalogError(
				"session_not_found",
				"resident rekey requires a live managed session",
			);
		}
		const transitionSessionWriterLease =
			this.#host.transitionSessionWriterLease;
		if (!transitionSessionWriterLease) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"runtime writer transition is unavailable",
			);
		}
		const replayKey = `${sessionId}\0${operationId}`;
		const replay = this.#residentRekeys.get(replayKey);
		if (replay) {
			if (replay.expectedWriterGeneration !== input.expectedWriterGeneration) {
				throw new ChatCatalogError(
					"invocation_replay_conflict",
					"resident rekey operation was reused with changed intent",
				);
			}
			return await replay.promise;
		}
		const rekey = guard.rekeyWithBarrier<CatalogManagedSessionAuthority>(
			{
				operationId,
				expectedWriterGeneration: input.expectedWriterGeneration,
				...(input.signal ? { signal: input.signal } : {}),
			},
			async ({ current, commit, confirmInstalled }) => {
				return (await transitionSessionWriterLease.call(
					this.#host,
					sessionId,
					{
						operationId,
						expectedLease: this.#writerLease(current),
						...(input.signal ? { signal: input.signal } : {}),
					},
					async () => {
						input.signal?.throwIfAborted();
						if (this.#guards.get(sessionId) !== guard || guard.signal.aborted) {
							throw new ChatCatalogError(
								"lease_conflict",
								"managed session authority changed before durable rekey",
							);
						}
						const rekeyed = await commit();
						const authority = Object.freeze({
							sessionId,
							leaseRevision: rekeyed.revision,
							writerGeneration: rekeyed.writerGeneration,
							leaseExpiresAt: rekeyed.expiresAt,
						});
						return {
							lease: this.#writerLease(rekeyed),
							value: authority,
							afterInstall: () => {
								confirmInstalled();
							},
						};
					},
				)) as CatalogManagedSessionAuthority;
			},
		);
		this.#residentRekeys.set(replayKey, {
			expectedWriterGeneration: input.expectedWriterGeneration,
			promise: rekey,
		});
		try {
			const authority = await rekey;
			while (this.#residentRekeys.size > 1024) {
				const oldest = this.#residentRekeys.keys().next().value;
				if (oldest === undefined) break;
				this.#residentRekeys.delete(oldest);
			}
			return authority;
		} catch (error) {
			if (this.#residentRekeys.get(replayKey)?.promise === rekey) {
				this.#residentRekeys.delete(replayKey);
			}
			throw error;
		}
	}

	async dispose(operationId = "catalog_managed_dispose"): Promise<void> {
		const operation = operationId.trim();
		if (!operation) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed runtime disposal requires an operation id",
			);
		}
		const failures: unknown[] = [];
		for (const sessionId of [...this.#guards.keys()]) {
			try {
				await this.stop(sessionId, `${operation}:${sessionId}`);
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length > 0) {
			throw new AggregateError(
				failures,
				"one or more managed sessions failed to quiesce and release",
			);
		}
	}

	async #cleanupFailedStart(input: {
		sessionId: string;
		guard?: CatalogLeaseGuard;
	}): Promise<void> {
		try {
			await this.#host.abort(
				input.sessionId,
				new Error("managed resume failed"),
			);
			await this.#host.stopSession(input.sessionId);
		} catch {
			// Never release authority while a failed runtime may still be writing.
		}
		if (input.guard) {
			await input.guard.stop({ release: false }).catch(() => undefined);
		}
	}

	async #startWithHandle(
		handle: CatalogLeaseHandle,
		startInput: StartSessionInput,
		leaseTtlMs?: number,
		operationId = "managed_start",
		hooks?: {
			beforeHostStart?: () => Promise<void>;
			afterSuccessfulStart?: () => Promise<void>;
			onFailure?: () => Promise<void>;
		},
	): Promise<CatalogManagedResumeResult> {
		const sessionId = handle.sessionId;
		const requestedPrompt = startInput.prompt;
		let startResult: StartSessionResult | undefined;
		let guard: CatalogLeaseGuard | undefined;
		let hostStarted = false;
		try {
			const profileAuthority = this.#requestedProfile(startInput);
			guard = await this.#coordinator.guardLease(handle, {
				...(leaseTtlMs === undefined ? {} : { leaseTtlMs }),
				onRenewed: async (renewed) => {
					if (!hostStarted) return;
					await this.#host.updateSessionWriterLease?.(
						sessionId,
						this.#writerLease(renewed),
					);
				},
				onLost: async (error) => {
					await this.#host.abort(sessionId, error);
				},
			});
			this.#guards.set(sessionId, guard);
			if (profileAuthority) {
				this.#profileAuthorities.set(sessionId, profileAuthority);
			}
			await hooks?.beforeHostStart?.();
			const startLease = guard.snapshot();
			startResult = await this.#host.startSession({
				...startInput,
				interactive: startInput.interactive ?? false,
				prompt: undefined,
				writerLease: this.#writerLease(startLease),
			});
			hostStarted = true;
			const postStartLease = guard.snapshot();
			if (postStartLease.revision !== startLease.revision) {
				await this.#host.updateSessionWriterLease?.(
					sessionId,
					this.#writerLease(postStartLease),
				);
			}
			const hasTurnInput = Boolean(
				requestedPrompt?.trim() ||
					startInput.userImages?.length ||
					startInput.userFiles?.length,
			);
			const turnResult = hasTurnInput
				? await this.#runGuardedTurn(
						guard,
						{
							sessionId,
							prompt: requestedPrompt ?? "",
							...(startInput.userImages
								? { userImages: startInput.userImages }
								: {}),
							...(startInput.userFiles
								? { userFiles: startInput.userFiles }
								: {}),
						},
						`${operationId}:initial_turn`,
					)
				: undefined;
			if (guard.signal.aborted) {
				throw (
					guard.signal.reason ??
					new ChatCatalogError("lease_conflict", "writer lease guard was lost")
				);
			}
			await hooks?.afterSuccessfulStart?.();
			if (guard.signal.aborted) {
				throw (
					guard.signal.reason ??
					new ChatCatalogError("lease_conflict", "writer lease guard was lost")
				);
			}
			const current = guard.snapshot();
			return {
				startResult,
				...(turnResult ? { turnResult } : {}),
				chatId: current.chat.chatId,
				leaseRevision: current.revision,
				writerGeneration: current.writerGeneration,
				leaseExpiresAt: current.expiresAt,
			};
		} catch (error) {
			await this.#cleanupFailedStart({ sessionId, guard });
			try {
				await hooks?.onFailure?.();
			} catch (recoveryError) {
				throw new AggregateError(
					[error, recoveryError],
					"Managed session start failed and recovery did not complete",
				);
			}
			throw error;
		}
	}

	async #runGuardedTurn(
		guard: CatalogLeaseGuard,
		input: SendSessionInput,
		operationId: string,
	): Promise<AgentResult | undefined> {
		if (guard.signal.aborted) {
			throw (
				guard.signal.reason ??
				new ChatCatalogError("lease_conflict", "writer lease guard was lost")
			);
		}
		const result = await this.#host.runTurn(input);
		if (guard.signal.aborted) {
			throw (
				guard.signal.reason ??
				new ChatCatalogError("lease_conflict", "writer lease guard was lost")
			);
		}
		const current = guard.snapshot();
		const activity = await this.#coordinator.recordActivity({
			operationId,
			chatId: current.chat.chatId,
			sessionId: input.sessionId,
			expectedRevision: current.chat.revision,
		});
		guard.updateChat(activity.current);
		return result;
	}

	#writerLease(handle: CatalogLeaseHandle): SessionWriterLease {
		return {
			leaseToken: handle.leaseToken,
			revision: handle.revision,
			writerGeneration: handle.writerGeneration,
			expiresAt: handle.expiresAt,
		};
	}
}
