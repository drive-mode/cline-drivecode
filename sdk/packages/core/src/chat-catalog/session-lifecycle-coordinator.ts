import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type {
	ChatBindingRecord,
	ChatCatalogRecord,
	ChatDetail,
	ChatMutationSourceKind,
	SessionLeaseRecord,
} from "@cline/shared";
import {
	type ChatCatalogAuthorityContext,
	type ChatCatalogConfirmation,
	type ChatCatalogConfirmationEffect,
	type ChatCatalogConfirmationGrant,
	type ChatCatalogMutationFence,
	issueChatCatalogAuthority,
} from "./chat-catalog-authority";
import type {
	ChatCatalogLeaseResponse,
	ChatCatalogMutationResponse,
	ChatCatalogPort,
	ChatCatalogPurgeResponse,
	ChatCatalogRekeyResponse,
	ChatCatalogRelatedAdmissionResponse,
	ChatCatalogRootAdmissionResponse,
} from "./chat-catalog-port";
import type {
	AdmitRelatedSessionInput,
	AdmitRootSessionInput,
	ChatBindingScope,
} from "./sqlite-chat-catalog-service";
import { ChatCatalogError } from "./sqlite-chat-catalog-service";

function awaitBeforeLeaseRekey<T>(
	promise: Promise<T> | undefined,
	signal: AbortSignal | undefined,
): Promise<T | undefined> {
	if (!promise) {
		signal?.throwIfAborted();
		return Promise.resolve(undefined);
	}
	if (!signal) return promise;
	signal.throwIfAborted();
	return new Promise<T>((resolvePromise, rejectPromise) => {
		let settled = false;
		const finish = (callback: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			callback();
		};
		const onAbort = (): void =>
			finish(() =>
				rejectPromise(
					signal.reason instanceof Error
						? signal.reason
						: new Error("lease rekey was cancelled"),
				),
			);
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => finish(() => resolvePromise(value)),
			(error) => finish(() => rejectPromise(error)),
		);
	});
}

export interface ChatCatalogConfirmationTarget {
	confirmation: ChatCatalogConfirmation;
	invocationId: string;
	aggregateKind: "chat" | "lease";
	aggregateId: string;
	expectedRevision: number;
	effects?: readonly ChatCatalogConfirmationEffect[];
}

export interface ChatCatalogConfirmationIssuer {
	issue(
		target: ChatCatalogConfirmationTarget,
	): Promise<ChatCatalogConfirmationGrant> | ChatCatalogConfirmationGrant;
}

export interface ChatSessionLifecycleCoordinatorOptions {
	port: ChatCatalogPort;
	workspaceKey: string;
	tenantId?: string;
	/** Immutable target namespace for managed caller composition. */
	audienceId?: string;
	principalId: string;
	actorLabel?: string;
	source: {
		kind: ChatMutationSourceKind;
		clientId?: string;
		transport?: string;
		threadId?: string;
		channelId?: string;
	};
	confirmationIssuer: ChatCatalogConfirmationIssuer;
	mutationFence?: () => ChatCatalogMutationFence | undefined;
	clock?: () => Date;
	idFactory?: (prefix: "chat" | "invocation" | "binding") => string;
}

export interface CatalogBindingTarget extends ChatBindingScope {
	bindingId: string;
	expectedBindingRevision: number;
}

export interface CatalogLeaseCredential {
	sessionId: string;
	leaseToken: string;
	revision: number;
	writerGeneration: number;
	expiresAt: string;
}

export interface CatalogLeaseHandle extends CatalogLeaseCredential {
	chat: ChatDetail;
}

export interface CatalogLeaseGuardOptions {
	leaseTtlMs?: number;
	renewEveryMs?: number;
	onRenewed?: (handle: CatalogLeaseHandle) => Promise<void> | void;
	onLost?: (error: unknown) => Promise<void> | void;
}

export interface CatalogLeaseRekeyTransition {
	current: CatalogLeaseHandle;
	commit(): Promise<CatalogLeaseHandle>;
	confirmInstalled(): CatalogLeaseHandle;
}

export interface CatalogResetResult {
	chat?: ChatDetail;
	binding?: ChatBindingRecord;
	lease?: SessionLeaseRecord;
}

export class CatalogLeaseGuard {
	readonly #coordinator: ChatSessionLifecycleCoordinator;
	readonly #leaseTtlMs: number;
	readonly #renewEveryMs: number;
	readonly #onRenewed?: CatalogLeaseGuardOptions["onRenewed"];
	readonly #onLost?: CatalogLeaseGuardOptions["onLost"];
	readonly #clock: () => Date;
	readonly #abortController = new AbortController();
	#handle: CatalogLeaseHandle;
	#renewTimer: ReturnType<typeof setTimeout> | undefined;
	#expiryTimer: ReturnType<typeof setTimeout> | undefined;
	#renewing: Promise<CatalogLeaseHandle> | undefined;
	#rekeying:
		| {
				operationId: string;
				expectedWriterGeneration: number;
				promise: Promise<CatalogLeaseHandle>;
				transitionPromise?: Promise<unknown>;
		  }
		| undefined;
	#lastRekey:
		| {
				operationId: string;
				expectedWriterGeneration: number;
				result: CatalogLeaseHandle;
				installed: boolean;
		  }
		| undefined;
	#releaseOperationId: string | undefined;
	#releasePromise: Promise<SessionLeaseRecord> | undefined;
	#released: SessionLeaseRecord | undefined;
	#started = false;
	#stopped = false;

	constructor(
		coordinator: ChatSessionLifecycleCoordinator,
		handle: CatalogLeaseHandle,
		options: CatalogLeaseGuardOptions = {},
		clock: () => Date = () => new Date(),
	) {
		this.#coordinator = coordinator;
		this.#handle = handle;
		this.#leaseTtlMs = options.leaseTtlMs ?? 60_000;
		this.#renewEveryMs =
			options.renewEveryMs ?? Math.max(1, Math.floor(this.#leaseTtlMs / 3));
		this.#onRenewed = options.onRenewed;
		this.#onLost = options.onLost;
		this.#clock = clock;
		if (
			!Number.isSafeInteger(this.#leaseTtlMs) ||
			!Number.isSafeInteger(this.#renewEveryMs) ||
			this.#renewEveryMs < 1 ||
			this.#renewEveryMs * 2 > this.#leaseTtlMs
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"lease renewal cadence must be positive and no greater than half the TTL",
			);
		}
	}

	get signal(): AbortSignal {
		return this.#abortController.signal;
	}

	snapshot(): CatalogLeaseHandle {
		return { ...this.#handle };
	}

	updateChat(chat: ChatDetail): void {
		if (
			chat.chatId !== this.#handle.chat.chatId ||
			!chat.sessions.some(
				(session) => session.sessionId === this.#handle.sessionId,
			)
		) {
			throw new ChatCatalogError(
				"lineage_conflict",
				"lease guard chat projection does not contain its managed session",
			);
		}
		this.#handle = { ...this.#handle, chat };
	}

	async start(): Promise<this> {
		if (this.#stopped || this.signal.aborted) {
			throw new ChatCatalogError("lease_conflict", "lease guard is not active");
		}
		if (this.#started) return this;
		try {
			await this.#coordinator.verifyLease(this.#handle);
			this.#started = true;
			this.#scheduleFromCurrentExpiry();
			return this;
		} catch (error) {
			this.#lose(error);
			throw error;
		}
	}

	async renewNow(): Promise<CatalogLeaseHandle> {
		if (!this.#started || this.#stopped || this.signal.aborted) {
			throw new ChatCatalogError("lease_conflict", "lease guard is not active");
		}
		if (this.#rekeying) return await this.#rekeying.promise;
		if (this.#renewing) return await this.#renewing;
		const renewal = this.#coordinator
			.renewLease(this.#handle, this.#leaseTtlMs)
			.then(async (handle) => {
				// A renewal can commit before a concurrent stop observes its reply.
				// Always retain the authoritative revision so release cannot replay a
				// stale handle. A stopped guard does not reopen timers or the write gate.
				this.#handle = handle;
				if (this.#stopped || this.signal.aborted) {
					return this.snapshot();
				}
				this.#scheduleFromCurrentExpiry();
				await this.#onRenewed?.(this.snapshot());
				return this.snapshot();
			})
			.catch((error) => {
				this.#lose(error);
				throw error;
			})
			.finally(() => {
				if (this.#renewing === renewal) this.#renewing = undefined;
			});
		this.#renewing = renewal;
		return await renewal;
	}

	async rekeyNow(input: {
		operationId: string;
		expectedWriterGeneration: number;
	}): Promise<CatalogLeaseHandle> {
		const operationId = input.operationId.trim();
		if (
			!operationId ||
			!Number.isSafeInteger(input.expectedWriterGeneration) ||
			input.expectedWriterGeneration < 1
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"lease rekey requires a stable operation and writer generation",
			);
		}
		if (!this.#started || this.#stopped || this.signal.aborted) {
			throw new ChatCatalogError("lease_conflict", "lease guard is not active");
		}
		if (this.#rekeying) {
			if (
				this.#rekeying.operationId !== operationId ||
				this.#rekeying.expectedWriterGeneration !==
					input.expectedWriterGeneration
			) {
				throw new ChatCatalogError(
					"lease_conflict",
					"another lease rekey transition is active",
				);
			}
			return await this.#rekeying.promise;
		}
		if (
			this.#lastRekey?.operationId === operationId &&
			this.#lastRekey.expectedWriterGeneration ===
				input.expectedWriterGeneration &&
			this.#lastRekey.result.writerGeneration === this.#handle.writerGeneration
		) {
			return { ...this.#lastRekey.result };
		}
		if (this.#handle.writerGeneration !== input.expectedWriterGeneration) {
			throw new ChatCatalogError(
				"lease_conflict",
				"writer generation changed before lease rekey",
			);
		}
		const rekey = (async () => {
			await this.#renewing;
			if (!this.#started || this.#stopped || this.signal.aborted) {
				throw new ChatCatalogError(
					"lease_conflict",
					"lease guard is not active",
				);
			}
			if (this.#handle.writerGeneration !== input.expectedWriterGeneration) {
				throw new ChatCatalogError(
					"lease_conflict",
					"writer generation changed before lease rekey",
				);
			}
			this.#clearTimers();
			const handle = await this.#coordinator.rekeyLease(
				this.#handle,
				operationId,
				input.expectedWriterGeneration,
				this.#leaseTtlMs,
			);
			this.#handle = handle;
			this.#lastRekey = {
				operationId,
				expectedWriterGeneration: input.expectedWriterGeneration,
				result: this.snapshot(),
				installed: false,
			};
			if (this.#stopped || this.signal.aborted) return this.snapshot();
			return this.snapshot();
		})()
			.catch((error) => {
				const preservesAuthority =
					error instanceof ChatCatalogError &&
					(error.code === "invalid_input" ||
						error.code === "invocation_replay_conflict" ||
						error.code === "unsupported_capability");
				if (!preservesAuthority) {
					this.#lose(error);
				} else if (!this.#stopped && !this.signal.aborted) {
					this.#scheduleFromCurrentExpiry();
				}
				throw error;
			})
			.finally(() => {
				if (this.#rekeying?.promise === rekey) this.#rekeying = undefined;
			});
		this.#rekeying = {
			operationId,
			expectedWriterGeneration: input.expectedWriterGeneration,
			promise: rekey,
		};
		return await rekey;
	}

	async rekeyWithBarrier<T>(
		input: {
			operationId: string;
			expectedWriterGeneration: number;
			signal?: AbortSignal;
		},
		barrier: (transition: CatalogLeaseRekeyTransition) => Promise<T>,
	): Promise<T> {
		const operationId = input.operationId.trim();
		if (
			!operationId ||
			!Number.isSafeInteger(input.expectedWriterGeneration) ||
			input.expectedWriterGeneration < 1
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"lease rekey requires a stable operation and writer generation",
			);
		}
		if (!this.#started || this.#stopped || this.signal.aborted) {
			throw new ChatCatalogError("lease_conflict", "lease guard is not active");
		}
		input.signal?.throwIfAborted();
		if (this.#rekeying) {
			if (
				this.#rekeying.operationId !== operationId ||
				this.#rekeying.expectedWriterGeneration !==
					input.expectedWriterGeneration
			) {
				throw new ChatCatalogError(
					"lease_conflict",
					"another lease rekey transition is active",
				);
			}
			if (this.#rekeying.transitionPromise) {
				return (await this.#rekeying.transitionPromise) as T;
			}
			return (await this.#rekeying.promise) as T;
		}
		if (this.#lastRekey?.operationId === operationId) {
			throw new ChatCatalogError(
				"lease_conflict",
				"completed lease rekey must replay through its owning transition",
			);
		}
		if (this.#handle.writerGeneration !== input.expectedWriterGeneration) {
			throw new ChatCatalogError(
				"lease_conflict",
				"writer generation changed before lease rekey",
			);
		}

		let resolveHandle: (handle: CatalogLeaseHandle) => void = () => undefined;
		let rejectHandle: (error: unknown) => void = () => undefined;
		const handlePromise = new Promise<CatalogLeaseHandle>((resolve, reject) => {
			resolveHandle = resolve;
			rejectHandle = reject;
		});
		void handlePromise.catch(() => undefined);
		const rekeying = {
			operationId,
			expectedWriterGeneration: input.expectedWriterGeneration,
			promise: handlePromise,
			transitionPromise: undefined as Promise<unknown> | undefined,
		};
		let commitStarted = false;
		let commitPromise: Promise<CatalogLeaseHandle> | undefined;
		const transitionPromise = (async () => {
			await awaitBeforeLeaseRekey(this.#renewing, input.signal);
			if (!this.#started || this.#stopped || this.signal.aborted) {
				throw new ChatCatalogError(
					"lease_conflict",
					"lease guard is not active",
				);
			}
			if (this.#handle.writerGeneration !== input.expectedWriterGeneration) {
				throw new ChatCatalogError(
					"lease_conflict",
					"writer generation changed before lease rekey",
				);
			}
			const current = this.snapshot();
			this.#clearTimers();
			input.signal?.throwIfAborted();
			const commit = async (): Promise<CatalogLeaseHandle> => {
				if (commitPromise) return await commitPromise;
				commitStarted = true;
				commitPromise = this.#coordinator
					.rekeyLease(
						current,
						operationId,
						input.expectedWriterGeneration,
						this.#leaseTtlMs,
					)
					.then((handle) => {
						this.#handle = handle;
						this.#lastRekey = {
							operationId,
							expectedWriterGeneration: input.expectedWriterGeneration,
							result: this.snapshot(),
							installed: false,
						};
						return this.snapshot();
					});
				return await commitPromise;
			};
			const value = await barrier({
				current,
				commit,
				confirmInstalled: () =>
					this.confirmRekeyInstalled({
						operationId,
						expectedWriterGeneration: input.expectedWriterGeneration,
					}),
			});
			const committed = commitPromise ? await commitPromise : undefined;
			if (!committed || !this.#lastRekey?.installed) {
				throw new ChatCatalogError(
					"lease_conflict",
					"writer rekey barrier returned before authority installation",
				);
			}
			resolveHandle(committed);
			return value;
		})()
			.catch((error) => {
				rejectHandle(error);
				if (commitStarted) {
					this.#lose(error);
				} else if (!this.#stopped && !this.signal.aborted) {
					this.#scheduleFromCurrentExpiry();
				}
				throw error;
			})
			.finally(() => {
				if (this.#rekeying === rekeying) this.#rekeying = undefined;
			});
		rekeying.transitionPromise = transitionPromise;
		this.#rekeying = rekeying;
		return await transitionPromise;
	}

	confirmRekeyInstalled(input: {
		operationId: string;
		expectedWriterGeneration: number;
	}): CatalogLeaseHandle {
		const operationId = input.operationId.trim();
		if (
			!this.#started ||
			this.#stopped ||
			this.signal.aborted ||
			!this.#lastRekey ||
			this.#lastRekey.operationId !== operationId ||
			this.#lastRekey.expectedWriterGeneration !==
				input.expectedWriterGeneration ||
			this.#handle.writerGeneration !== input.expectedWriterGeneration + 1
		) {
			throw new ChatCatalogError(
				"lease_conflict",
				"installed writer authority does not match the completed rekey",
			);
		}
		this.#lastRekey.installed = true;
		this.#scheduleFromCurrentExpiry();
		return this.snapshot();
	}

	async verify(): Promise<SessionLeaseRecord> {
		if (!this.#started || this.#stopped || this.signal.aborted) {
			throw new ChatCatalogError("lease_conflict", "lease guard is not active");
		}
		try {
			return await this.#coordinator.verifyLease(this.#handle);
		} catch (error) {
			this.#lose(error);
			throw error;
		}
	}

	async stop(input: {
		release: boolean;
		operationId?: string;
	}): Promise<SessionLeaseRecord | undefined> {
		if (!this.#stopped) {
			this.#stopped = true;
			this.#clearTimers();
			if (!this.signal.aborted) {
				await Promise.all([
					this.#renewing?.catch(() => undefined),
					this.#rekeying?.promise.catch(() => undefined),
				]);
			}
			if (!this.signal.aborted) {
				this.#abortController.abort(new Error("lease guard stopped"));
			}
		}
		if (!input.release) return undefined;
		const operationId = input.operationId?.trim();
		if (!operationId) {
			throw new ChatCatalogError(
				"invalid_input",
				"lease release requires an operation id",
			);
		}
		if (
			this.#releaseOperationId !== undefined &&
			this.#releaseOperationId !== operationId
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"lease release retry must reuse the original operation id",
			);
		}
		if (this.#released) return this.#released;
		if (this.#releasePromise) return await this.#releasePromise;
		this.#releaseOperationId = operationId;
		const release = this.#coordinator
			.releaseLease(this.#handle, operationId)
			.then((released) => {
				this.#released = released;
				return released;
			})
			.finally(() => {
				if (this.#releasePromise === release) {
					this.#releasePromise = undefined;
				}
			});
		this.#releasePromise = release;
		return await release;
	}

	#lose(error: unknown): void {
		this.#clearTimers();
		if (!this.signal.aborted) {
			this.#abortController.abort(error);
			void Promise.resolve(this.#onLost?.(error)).catch(() => undefined);
		}
	}

	#scheduleFromCurrentExpiry(): void {
		this.#clearTimers();
		if (this.#stopped || this.signal.aborted) return;
		const expiresAtMs = Date.parse(this.#handle.expiresAt);
		const remainingMs = expiresAtMs - this.#clock().getTime();
		if (!Number.isFinite(expiresAtMs) || remainingMs <= 0) {
			this.#lose(
				new ChatCatalogError("lease_conflict", "writer lease has expired"),
			);
			return;
		}
		const renewDelayMs = Math.min(
			this.#renewEveryMs,
			Math.max(0, Math.floor(remainingMs / 2)),
		);
		this.#renewTimer = setTimeout(() => {
			void this.renewNow().catch(() => undefined);
		}, renewDelayMs);
		this.#renewTimer.unref?.();
		this.#expiryTimer = setTimeout(() => {
			this.#lose(
				new ChatCatalogError("lease_conflict", "writer lease expired"),
			);
		}, remainingMs);
		this.#expiryTimer.unref?.();
	}

	#clearTimers(): void {
		if (this.#renewTimer) clearTimeout(this.#renewTimer);
		if (this.#expiryTimer) clearTimeout(this.#expiryTimer);
		this.#renewTimer = undefined;
		this.#expiryTimer = undefined;
	}
}

/**
 * Core-owned orchestration for session lifecycle paths.
 *
 * The coordinator is intentionally not exported from the public package root:
 * it can mint catalog authority and therefore belongs only in trusted runtime
 * composition. UI and connector code should receive a narrowed facade.
 */
export class ChatSessionLifecycleCoordinator {
	readonly #port: ChatCatalogPort;
	readonly #workspaceKey: string;
	readonly #tenantId: string;
	readonly #audienceId?: string;
	readonly #principalId: string;
	readonly #actorLabel?: string;
	readonly #source: ChatSessionLifecycleCoordinatorOptions["source"];
	readonly #confirmationIssuer: ChatCatalogConfirmationIssuer;
	readonly #mutationFence?: () => ChatCatalogMutationFence | undefined;
	readonly #clock: () => Date;
	readonly #idFactory: NonNullable<
		ChatSessionLifecycleCoordinatorOptions["idFactory"]
	>;

	constructor(options: ChatSessionLifecycleCoordinatorOptions) {
		this.#port = options.port;
		this.#workspaceKey = resolve(options.workspaceKey);
		this.#tenantId = options.tenantId?.trim() || "local";
		this.#audienceId = options.audienceId?.trim() || undefined;
		this.#principalId = options.principalId.trim();
		this.#actorLabel = options.actorLabel?.trim() || undefined;
		this.#source = Object.freeze({ ...options.source });
		this.#confirmationIssuer = options.confirmationIssuer;
		this.#mutationFence = options.mutationFence;
		this.#clock = options.clock ?? (() => new Date());
		this.#idFactory =
			options.idFactory ?? ((prefix) => `${prefix}_${randomUUID()}`);
		if (!this.#principalId) {
			throw new ChatCatalogError("invalid_input", "principal id is required");
		}
	}

	#invocationId(): string {
		return this.#idFactory("invocation");
	}

	#stepInvocationId(operationId: string, step: string): string {
		const normalized = operationId.trim();
		if (!normalized) {
			throw new ChatCatalogError("invalid_input", "operation id is required");
		}
		return createHash("sha256").update(`${normalized}\0${step}`).digest("hex");
	}

	#authority(
		confirmationGrants: readonly ChatCatalogConfirmationGrant[] = [],
	): ChatCatalogAuthorityContext {
		const mutationFence = this.#mutationFence?.();
		return issueChatCatalogAuthority({
			principalId: this.#principalId,
			tenantId: this.#tenantId,
			workspaceKey: this.#workspaceKey,
			...(this.#audienceId ? { audienceId: this.#audienceId } : {}),
			actorKind: "human",
			...(this.#actorLabel ? { actorLabel: this.#actorLabel } : {}),
			source: this.#source,
			confirmationGrants,
			...(mutationFence ? { mutationFence } : {}),
			clock: this.#clock,
		});
	}

	async #confirmedAuthority(target: ChatCatalogConfirmationTarget): Promise<{
		authority: ChatCatalogAuthorityContext;
		observedRevision: number | undefined;
	}> {
		const observedRevision = await this.#confirmationTargetRevision(target);
		const grant = await this.#confirmationIssuer.issue(target);
		// A human may take arbitrarily longer than the catalog mutation that made
		// the displayed revision stale. Recheck before any stop/revoke/cleanup
		// side effect can run; the mutation CAS remains the final fence.
		if ((await this.#confirmationTargetRevision(target)) !== observedRevision) {
			throw new ChatCatalogError(
				"revision_conflict",
				"confirmation target changed before approval completed",
			);
		}
		return {
			authority: this.#authority([grant]),
			observedRevision,
		};
	}

	async #confirmationTargetRevision(
		target: ChatCatalogConfirmationTarget,
	): Promise<number | undefined> {
		const current =
			target.aggregateKind === "chat"
				? await this.#port.getChat(this.#authority(), target.aggregateId)
				: await this.#port.getSessionLease(
						this.#authority(),
						target.aggregateId,
					);
		return current?.revision;
	}

	async list(
		catalogState: "active" | "archived" | "all" = "all",
		limit = 100,
	): Promise<ChatCatalogRecord[]> {
		const items: ChatCatalogRecord[] = [];
		let cursor: { lastActivityAt: string; chatId: string } | undefined;
		do {
			const page = await this.#port.listChats(this.#authority(), {
				workspaceKey: this.#workspaceKey,
				catalogState,
				limit,
				...(cursor ? { cursor } : {}),
			});
			items.push(...page.items);
			cursor = page.nextCursor;
		} while (cursor);
		return items;
	}

	async findChatForSession(sessionId: string): Promise<ChatDetail | undefined> {
		for (const summary of await this.list("all")) {
			const detail = await this.#port.getChat(
				this.#authority(),
				summary.chatId,
			);
			if (detail?.sessions.some((session) => session.sessionId === sessionId)) {
				return detail;
			}
		}
		return undefined;
	}

	async get(chatIdInput: string): Promise<ChatDetail | undefined> {
		const chatId = chatIdInput.trim();
		if (!chatId) {
			throw new ChatCatalogError("invalid_input", "chat id is required");
		}
		return await this.#port.getChat(this.#authority(), chatId);
	}

	async rename(input: {
		operationId: string;
		chatId: string;
		title: string;
		expectedRevision: number;
	}): Promise<ChatDetail> {
		const operationId = input.operationId.trim();
		const chatId = input.chatId.trim();
		const title = input.title.trim();
		if (!operationId || !chatId || !title) {
			throw new ChatCatalogError(
				"invalid_input",
				"rename requires stable operation and chat ids plus a title",
			);
		}
		return (
			await this.#port.renameChat(this.#authority(), {
				chatId,
				title,
				expectedRevision: input.expectedRevision,
				invocationId: this.#stepInvocationId(operationId, "rename"),
			})
		).current;
	}

	async archive(input: {
		operationId: string;
		chatId: string;
		expectedRevision: number;
		clearBindings?: boolean;
		stopSessions?: (chat: ChatDetail) => Promise<void>;
	}): Promise<ChatDetail> {
		const operationId = input.operationId.trim();
		const chatId = input.chatId.trim();
		if (!operationId || !chatId) {
			throw new ChatCatalogError(
				"invalid_input",
				"archive requires stable operation and chat ids",
			);
		}
		const chat = await this.get(chatId);
		const invocationId = this.#stepInvocationId(operationId, "archive");
		const effects = [
			...(input.stopSessions ? (["stop_running"] as const) : []),
			...(input.clearBindings ? (["clear_bindings"] as const) : []),
		] satisfies readonly ChatCatalogConfirmationEffect[];
		const { authority, observedRevision } = await this.#confirmedAuthority({
			confirmation: "archive",
			invocationId,
			aggregateKind: "chat",
			aggregateId: chatId,
			expectedRevision: input.expectedRevision,
			...(effects.length > 0 ? { effects } : {}),
		});
		if (
			chat?.revision === input.expectedRevision &&
			observedRevision === input.expectedRevision
		) {
			await input.stopSessions?.(chat);
		}
		return (
			await this.#port.archiveChat(authority, {
				chatId,
				expectedRevision: input.expectedRevision,
				...(input.stopSessions ? { stopRunningIntent: true } : {}),
				...(input.clearBindings ? { clearBindings: true } : {}),
				invocationId,
			})
		).current;
	}

	async activate(input: {
		operationId: string;
		chatId: string;
		expectedRevision: number;
	}): Promise<ChatDetail> {
		const operationId = input.operationId.trim();
		const chatId = input.chatId.trim();
		if (!operationId || !chatId) {
			throw new ChatCatalogError(
				"invalid_input",
				"activate requires stable operation and chat ids",
			);
		}
		const invocationId = this.#stepInvocationId(operationId, "activate");
		const { authority } = await this.#confirmedAuthority({
			confirmation: "activate",
			invocationId,
			aggregateKind: "chat",
			aggregateId: chatId,
			expectedRevision: input.expectedRevision,
		});
		return (
			await this.#port.activateChat(authority, {
				chatId,
				expectedRevision: input.expectedRevision,
				invocationId,
			})
		).current;
	}

	async purge(input: {
		operationId: string;
		chatId: string;
		expectedRevision: number;
	}): Promise<ChatCatalogPurgeResponse> {
		const operationId = input.operationId.trim();
		const chatId = input.chatId.trim();
		if (!operationId || !chatId) {
			throw new ChatCatalogError(
				"invalid_input",
				"purge requires stable operation and chat ids",
			);
		}
		const invocationId = this.#stepInvocationId(operationId, "purge");
		const { authority } = await this.#confirmedAuthority({
			confirmation: "purge",
			invocationId,
			aggregateKind: "chat",
			aggregateId: chatId,
			expectedRevision: input.expectedRevision,
		});
		return await this.#port.purgeChat(authority, {
			chatId,
			expectedRevision: input.expectedRevision,
			invocationId,
		});
	}

	async getBinding(
		scope: ChatBindingScope,
	): Promise<ChatBindingRecord | undefined> {
		const getBinding = this.#port.getBinding;
		if (!getBinding) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"catalog authority does not support binding lookup",
			);
		}
		return await getBinding.call(this.#port, this.#authority(), scope);
	}

	async admitRoot(
		input: Omit<AdmitRootSessionInput, "provenance"> & {
			/** Stable across retries of one user-visible fresh-start operation. */
			operationId: string;
		},
	): Promise<CatalogLeaseHandle> {
		const operationId = input.operationId.trim();
		if (!operationId) {
			throw new ChatCatalogError("invalid_input", "operation id is required");
		}
		const admit = this.#port.admitRootSession;
		if (!admit) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"catalog authority does not support transactional root admission",
			);
		}
		const { operationId: _operationId, ...command } = input;
		const admitted: ChatCatalogRootAdmissionResponse = await admit.call(
			this.#port,
			this.#authority(),
			{
				...command,
				invocationId: this.#stepInvocationId(operationId, "admit_root"),
			},
		);
		if (!admitted.leaseToken) {
			throw new ChatCatalogError(
				"lease_conflict",
				"root admission replay did not return a fresh writer credential",
			);
		}
		return {
			sessionId: input.sessionId,
			leaseToken: admitted.leaseToken,
			revision: admitted.current.lease.revision,
			writerGeneration: admitted.current.lease.writerGeneration,
			expiresAt: admitted.current.lease.expiresAt,
			chat: admitted.current.chat,
		};
	}

	async admitRelated(
		input: Omit<AdmitRelatedSessionInput, "provenance"> & {
			/** Stable across retries of one user-visible derived-start operation. */
			operationId: string;
		},
	): Promise<CatalogLeaseHandle> {
		const operationId = input.operationId.trim();
		if (!operationId) {
			throw new ChatCatalogError("invalid_input", "operation id is required");
		}
		const admit = this.#port.admitRelatedSession;
		if (!admit) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"catalog authority does not support transactional related admission",
			);
		}
		const { operationId: _operationId, ...command } = input;
		const admitted: ChatCatalogRelatedAdmissionResponse = await admit.call(
			this.#port,
			this.#authority(),
			{
				...command,
				invocationId: this.#stepInvocationId(operationId, "admit_related"),
			},
		);
		if (!admitted.leaseToken) {
			throw new ChatCatalogError(
				"lease_conflict",
				"related admission replay did not return a fresh writer credential",
			);
		}
		return {
			sessionId: input.sessionId,
			leaseToken: admitted.leaseToken,
			revision: admitted.current.lease.revision,
			writerGeneration: admitted.current.lease.writerGeneration,
			expiresAt: admitted.current.lease.expiresAt,
			chat: admitted.current.chat,
		};
	}

	async adoptRoot(input: {
		sessionId: string;
		chatId?: string;
		title?: string;
		titleSource?: string;
	}): Promise<ChatDetail> {
		const existing = await this.findChatForSession(input.sessionId);
		if (existing) return existing;
		const chatId = input.chatId?.trim() || this.#idFactory("chat");
		try {
			return (
				await this.#port.adoptRootSession(this.#authority(), {
					chatId,
					sessionId: input.sessionId,
					...(input.title ? { title: input.title } : {}),
					...(input.titleSource ? { titleSource: input.titleSource } : {}),
					invocationId: this.#invocationId(),
				})
			).current;
		} catch (error) {
			if (
				!(error instanceof ChatCatalogError) ||
				error.code !== "session_already_attached"
			) {
				throw error;
			}
			const raced = await this.findChatForSession(input.sessionId);
			if (raced) return raced;
			throw error;
		}
	}

	async bind(input: {
		operationId: string;
		chatId: string;
		sessionId: string;
		target: CatalogBindingTarget;
	}): Promise<ChatBindingRecord> {
		const operationId = input.operationId.trim();
		if (!operationId) {
			throw new ChatCatalogError("invalid_input", "operation id is required");
		}
		const { target } = input;
		return (
			await this.#port.bindChat(this.#authority(), {
				...target,
				chatId: input.chatId,
				sessionId: input.sessionId,
				invocationId: this.#stepInvocationId(operationId, "bind"),
			})
		).current;
	}

	async reset(input: {
		operationId: string;
		sessionId: string;
		stop: (sessionId: string) => Promise<void>;
		binding?: CatalogBindingTarget;
		lease?: Pick<CatalogLeaseHandle, "leaseToken" | "revision">;
	}): Promise<CatalogResetResult> {
		const chat = await this.findChatForSession(input.sessionId);
		if (input.binding && !chat) {
			throw new ChatCatalogError(
				"binding_conflict",
				"bound session is not attached to a chat",
			);
		}
		await input.stop(input.sessionId);
		let binding: ChatBindingRecord | undefined;
		if (input.binding) {
			const { bindingId: _bindingId, ...scope } = input.binding;
			binding = (
				await this.#port.unbindChat(this.#authority(), {
					...scope,
					expectedBindingId: input.binding.bindingId,
					expectedChatId: chat?.chatId ?? "",
					expectedSessionId: input.sessionId,
					invocationId: this.#stepInvocationId(input.operationId, "unbind"),
				})
			).current;
		}
		let lease: SessionLeaseRecord | undefined;
		if (input.lease) {
			lease = (
				await this.#port.releaseSessionLease(this.#authority(), {
					sessionId: input.sessionId,
					leaseToken: input.lease.leaseToken,
					expectedRevision: input.lease.revision,
					invocationId: this.#stepInvocationId(
						input.operationId,
						"release_lease",
					),
				})
			).current;
		}
		return {
			...(chat ? { chat } : {}),
			...(binding ? { binding } : {}),
			...(lease ? { lease } : {}),
		};
	}

	async prepareResume(input: {
		operationId: string;
		sessionId: string;
		leaseTtlMs?: number;
		acquireInvocationId?: string;
		expectedLeaseRevision?: number;
	}): Promise<CatalogLeaseHandle> {
		const operationId = input.operationId.trim();
		const sessionId = input.sessionId.trim();
		if (!operationId || !sessionId) {
			throw new ChatCatalogError(
				"invalid_input",
				"resume requires stable operation and session ids",
			);
		}
		let chat = await this.adoptRoot({ sessionId });
		if (chat.catalogState === "deleting") {
			throw new ChatCatalogError(
				"chat_deleting",
				"deleting chat cannot be resumed",
			);
		}
		if (chat.catalogState === "archived") {
			const invocationId = this.#stepInvocationId(
				operationId,
				"activate_for_resume",
			);
			const { authority } = await this.#confirmedAuthority({
				confirmation: "activate",
				invocationId,
				aggregateKind: "chat",
				aggregateId: chat.chatId,
				expectedRevision: chat.revision,
			});
			chat = (
				await this.#port.activateChat(authority, {
					chatId: chat.chatId,
					expectedRevision: chat.revision,
					invocationId,
				})
			).current;
		}
		const currentLease = await this.#port.getSessionLease(
			this.#authority(),
			sessionId,
		);
		const acquired: ChatCatalogLeaseResponse =
			await this.#port.acquireSessionLease(this.#authority(), {
				sessionId,
				expectedRevision:
					input.expectedLeaseRevision ?? currentLease?.revision ?? 0,
				...(input.leaseTtlMs ? { ttlMs: input.leaseTtlMs } : {}),
				invocationId: input.acquireInvocationId ?? this.#invocationId(),
			});
		if (!acquired.leaseToken) {
			throw new ChatCatalogError(
				"lease_conflict",
				"resume did not receive a fresh writer lease credential",
			);
		}
		return {
			sessionId,
			leaseToken: acquired.leaseToken,
			revision: acquired.current.revision,
			writerGeneration: acquired.current.writerGeneration,
			expiresAt: acquired.current.expiresAt,
			chat,
		};
	}

	async recoverLostResumeLease(input: {
		operationId: string;
		sessionId: string;
		leaseTtlMs?: number;
	}): Promise<CatalogLeaseHandle> {
		const chat = await this.adoptRoot({ sessionId: input.sessionId });
		const currentLease = await this.#port.getSessionLease(
			this.#authority(),
			input.sessionId,
		);
		if (!currentLease?.active) {
			throw new ChatCatalogError(
				"lease_conflict",
				"no live lost-credential lease is available to recover",
			);
		}
		const revokeInvocationId = this.#stepInvocationId(
			input.operationId,
			"revoke_lost_lease",
		);
		const { authority } = await this.#confirmedAuthority({
			confirmation: "revoke_lease",
			invocationId: revokeInvocationId,
			aggregateKind: "lease",
			aggregateId: input.sessionId,
			expectedRevision: currentLease.revision,
		});
		const revoked = await this.#port.revokeSessionLease(authority, {
			sessionId: input.sessionId,
			expectedRevision: currentLease.revision,
			invocationId: revokeInvocationId,
		});
		const acquired = await this.#port.acquireSessionLease(this.#authority(), {
			sessionId: input.sessionId,
			expectedRevision: revoked.current.revision,
			...(input.leaseTtlMs ? { ttlMs: input.leaseTtlMs } : {}),
			invocationId: this.#stepInvocationId(
				input.operationId,
				"acquire_replacement_lease",
			),
		});
		if (!acquired.leaseToken) {
			throw new ChatCatalogError(
				"lease_conflict",
				"lease recovery did not receive a fresh replacement credential",
			);
		}
		return {
			sessionId: input.sessionId,
			leaseToken: acquired.leaseToken,
			revision: acquired.current.revision,
			writerGeneration: acquired.current.writerGeneration,
			expiresAt: acquired.current.expiresAt,
			chat,
		};
	}

	async renewLease(
		handle: CatalogLeaseHandle,
		leaseTtlMs?: number,
	): Promise<CatalogLeaseHandle> {
		const renewed = await this.#port.renewSessionLease(this.#authority(), {
			sessionId: handle.sessionId,
			leaseToken: handle.leaseToken,
			expectedRevision: handle.revision,
			...(leaseTtlMs ? { ttlMs: leaseTtlMs } : {}),
			invocationId: this.#invocationId(),
		});
		return {
			...handle,
			revision: renewed.current.revision,
			expiresAt: renewed.current.expiresAt,
		};
	}

	async rekeyLease(
		handle: CatalogLeaseHandle,
		operationId: string,
		expectedWriterGeneration: number,
		leaseTtlMs?: number,
	): Promise<CatalogLeaseHandle> {
		const rekey = this.#port.rekeySessionLease;
		if (!rekey) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"catalog authority does not support resident lease rekey",
			);
		}
		const invocationId = this.#stepInvocationId(operationId, "rekey_lease");
		const invoke = (): Promise<ChatCatalogRekeyResponse> =>
			rekey.call(this.#port, this.#authority(), {
				sessionId: handle.sessionId,
				leaseToken: handle.leaseToken,
				expectedRevision: handle.revision,
				expectedWriterGeneration,
				...(leaseTtlMs ? { ttlMs: leaseTtlMs } : {}),
				invocationId,
			});
		let response: ChatCatalogRekeyResponse;
		try {
			response = await invoke();
		} catch (error) {
			if (error instanceof ChatCatalogError) throw error;
			response = await invoke();
		}
		return {
			...handle,
			leaseToken: response.leaseToken,
			revision: response.current.revision,
			writerGeneration: response.current.writerGeneration,
			expiresAt: response.current.expiresAt,
		};
	}

	async verifyLease(
		handle: CatalogLeaseCredential,
	): Promise<SessionLeaseRecord> {
		return await this.#port.verifySessionLease(this.#authority(), {
			sessionId: handle.sessionId,
			leaseToken: handle.leaseToken,
			expectedRevision: handle.revision,
		});
	}

	async releaseLease(
		handle: CatalogLeaseHandle,
		operationId: string,
	): Promise<SessionLeaseRecord> {
		return (
			await this.#port.releaseSessionLease(this.#authority(), {
				sessionId: handle.sessionId,
				leaseToken: handle.leaseToken,
				expectedRevision: handle.revision,
				invocationId: this.#stepInvocationId(operationId, "release_lease"),
			})
		).current;
	}

	async guardLease(
		handle: CatalogLeaseHandle,
		options?: CatalogLeaseGuardOptions,
	): Promise<CatalogLeaseGuard> {
		return await new CatalogLeaseGuard(
			this,
			handle,
			options,
			this.#clock,
		).start();
	}

	async recordBranch(input: {
		operationId: string;
		sourceSessionId: string;
		sessionId: string;
		relationKind: "fork" | "checkpoint_restore";
		title?: string;
	}): Promise<ChatDetail> {
		const operationId = input.operationId.trim();
		if (!operationId) {
			throw new ChatCatalogError("invalid_input", "operation id is required");
		}
		const source = await this.adoptRoot({ sessionId: input.sourceSessionId });
		const existing = await this.findChatForSession(input.sessionId);
		if (existing) {
			const membership = existing.sessions.find(
				(session) => session.sessionId === input.sessionId,
			);
			if (
				existing.parentChatId === source.chatId &&
				membership?.parentSessionId === input.sourceSessionId &&
				membership.relationKind === input.relationKind
			) {
				return existing;
			}
			throw new ChatCatalogError(
				"lineage_conflict",
				"branch session is already attached with different lineage",
			);
		}
		return (
			await this.#port.recordBranch(this.#authority(), {
				chatId: this.#idFactory("chat"),
				sessionId: input.sessionId,
				sourceChatId: source.chatId,
				sourceSessionId: input.sourceSessionId,
				relationKind: input.relationKind,
				...(input.title ? { title: input.title, titleSource: "host" } : {}),
				invocationId: this.#stepInvocationId(operationId, "record_branch"),
			})
		).current;
	}

	async recordRecovery(input: {
		operationId: string;
		missingSessionId: string;
		replacementSessionId: string;
	}): Promise<ChatDetail> {
		const operationId = input.operationId.trim();
		if (!operationId) {
			throw new ChatCatalogError("invalid_input", "operation id is required");
		}
		const chat = await this.adoptRoot({ sessionId: input.missingSessionId });
		const existing = chat.sessions.find(
			(session) => session.sessionId === input.replacementSessionId,
		);
		if (existing) {
			if (
				existing.parentSessionId === input.missingSessionId &&
				existing.relationKind === "recovery"
			) {
				return chat;
			}
			throw new ChatCatalogError(
				"lineage_conflict",
				"replacement session is already attached with different lineage",
			);
		}
		return (
			await this.#port.attachSuccessorSession(this.#authority(), {
				chatId: chat.chatId,
				sessionId: input.replacementSessionId,
				parentSessionId: input.missingSessionId,
				relationKind: "recovery",
				expectedRevision: chat.revision,
				invocationId: this.#stepInvocationId(operationId, "record_recovery"),
			})
		).current;
	}

	async recordActivity(input: {
		operationId: string;
		chatId: string;
		sessionId: string;
		expectedRevision: number;
	}): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		return await this.#port.recordChatActivity(this.#authority(), {
			chatId: input.chatId,
			sessionId: input.sessionId,
			expectedRevision: input.expectedRevision,
			invocationId: this.#stepInvocationId(
				input.operationId,
				"record_activity",
			),
		});
	}
}
