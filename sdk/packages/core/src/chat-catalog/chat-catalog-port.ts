import type {
	ChatBindingRecord,
	ChatDetail,
	ChatMutationProvenance,
	ChatPage,
	SessionLeaseRecord,
} from "@cline/shared";
import {
	assertChatCatalogAuthority,
	assertChatCatalogMutationAllowed,
	type ChatCatalogAuthorityContext,
	type ChatCatalogConfirmationEffect,
	consumeChatCatalogConfirmation,
	getChatCatalogMutationFence,
} from "./chat-catalog-authority";
import {
	type AcquireSessionLeaseInput,
	type AdmitRelatedSessionInput,
	type AdmitRootSessionInput,
	type AdoptRootSessionInput,
	type AttachSuccessorSessionInput,
	type BindChatInput,
	type ChatBindingScope,
	ChatCatalogError,
	type ChatLifecycleMutationInput,
	type ChatMutationResult,
	type ListChatsInput,
	type PurgeChatInput,
	type RecordBranchInput,
	type RecordChatActivityInput,
	type RekeySessionLeaseInput,
	type ReleaseSessionLeaseInput,
	type RenameChatInput,
	type RenewSessionLeaseInput,
	type RevokeSessionLeaseInput,
	type SqliteChatCatalogService,
	type UnbindChatInput,
	type VerifySessionLeaseInput,
} from "./sqlite-chat-catalog-service";

export type AuthorizedCommand<
	T extends { provenance: ChatMutationProvenance },
> = Omit<T, "provenance"> & { invocationId: string };

export interface ChatCatalogMutationReceipt {
	readonly invocationId: string;
	readonly operation: string;
	readonly aggregateKind: "chat" | "binding" | "lease";
	readonly aggregateId: string;
	readonly applied: boolean;
	readonly replayed: boolean;
	readonly resultingRevision: number;
}

export interface ChatCatalogMutationResponse<T> {
	receipt: ChatCatalogMutationReceipt;
	/** Current projection after the mutation; never represented as replay output. */
	current: T;
}

export interface ChatCatalogPurgeResponse {
	receipt: ChatCatalogMutationReceipt;
	sessionIds: string[];
}

export interface ChatCatalogLeaseResponse
	extends ChatCatalogMutationResponse<SessionLeaseRecord> {
	/** Returned only to the winner of a fresh acquisition. */
	leaseToken?: string;
}

export interface ChatCatalogRekeyResponse
	extends ChatCatalogMutationResponse<SessionLeaseRecord> {
	/** Replacement credential retained only inside trusted Core composition. */
	leaseToken: string;
}

export interface ChatCatalogRootAdmissionResponse {
	receipt: ChatCatalogMutationReceipt;
	current: {
		chat: ChatDetail;
		lease: SessionLeaseRecord;
	};
	/** Returned only to the winner of a fresh local admission. */
	leaseToken?: string;
}

export type ChatCatalogRelatedAdmissionResponse =
	ChatCatalogRootAdmissionResponse;

export interface ChatCatalogPort {
	listChats(
		context: ChatCatalogAuthorityContext,
		input: ListChatsInput,
	): Promise<ChatPage>;
	getChat(
		context: ChatCatalogAuthorityContext,
		chatId: string,
	): Promise<ChatDetail | undefined>;
	/** Local authority lookup; remote hosts need an equivalent scoped read. */
	getBinding?(
		context: ChatCatalogAuthorityContext,
		scope: ChatBindingScope,
	): Promise<ChatBindingRecord | undefined>;
	/**
	 * Local-only transactional writer admission. Remote authorities must provide
	 * an equivalent server-owned operation before advertising managed starts.
	 */
	admitRootSession?(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<AdmitRootSessionInput>,
	): Promise<ChatCatalogRootAdmissionResponse>;
	/** Local transactional admission for branch and successor writers. */
	admitRelatedSession?(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<AdmitRelatedSessionInput>,
	): Promise<ChatCatalogRelatedAdmissionResponse>;
	adoptRootSession(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<AdoptRootSessionInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>>;
	recordBranch(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RecordBranchInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>>;
	attachSuccessorSession(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<AttachSuccessorSessionInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>>;
	recordChatActivity(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RecordChatActivityInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>>;
	renameChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RenameChatInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>>;
	archiveChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<ChatLifecycleMutationInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>>;
	activateChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<ChatLifecycleMutationInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>>;
	bindChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<BindChatInput>,
	): Promise<ChatCatalogMutationResponse<ChatBindingRecord>>;
	unbindChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<UnbindChatInput>,
	): Promise<ChatCatalogMutationResponse<ChatBindingRecord>>;
	getSessionLease(
		context: ChatCatalogAuthorityContext,
		sessionId: string,
	): Promise<SessionLeaseRecord | undefined>;
	verifySessionLease(
		context: ChatCatalogAuthorityContext,
		input: VerifySessionLeaseInput,
	): Promise<SessionLeaseRecord>;
	acquireSessionLease(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<AcquireSessionLeaseInput>,
	): Promise<ChatCatalogLeaseResponse>;
	releaseSessionLease(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<ReleaseSessionLeaseInput>,
	): Promise<ChatCatalogMutationResponse<SessionLeaseRecord>>;
	renewSessionLease(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RenewSessionLeaseInput>,
	): Promise<ChatCatalogMutationResponse<SessionLeaseRecord>>;
	/**
	 * Trusted resident-writer transition. Public Hub catalog adapters may omit
	 * this capability rather than carrying a replacement token over client wire.
	 */
	rekeySessionLease?(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RekeySessionLeaseInput>,
	): Promise<ChatCatalogRekeyResponse>;
	revokeSessionLease(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RevokeSessionLeaseInput>,
	): Promise<ChatCatalogMutationResponse<SessionLeaseRecord>>;
	purgeChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<PurgeChatInput>,
	): Promise<ChatCatalogPurgeResponse>;
}

export interface LocalChatCatalogPortOptions {
	service: SqliteChatCatalogService;
	tenantId?: string;
	clock?: () => Date;
}

export class LocalChatCatalogPort implements ChatCatalogPort {
	private readonly service: SqliteChatCatalogService;
	private readonly tenantId: string;
	private readonly clock: () => Date;

	constructor(options: LocalChatCatalogPortOptions) {
		this.service = options.service;
		this.tenantId = options.tenantId?.trim() || "local";
		if (this.service.tenantKey() !== this.tenantId) {
			throw new ChatCatalogError(
				"invalid_input",
				"local catalog port tenant does not match its database tenant",
			);
		}
		this.clock = options.clock ?? (() => new Date());
	}

	private authorize(context: ChatCatalogAuthorityContext): void {
		assertChatCatalogAuthority(context);
		if (context.tenantId !== this.tenantId) {
			throw new ChatCatalogError(
				"chat_not_found",
				"chat is outside the authorized tenant",
			);
		}
	}

	private provenance(
		context: ChatCatalogAuthorityContext,
		invocationId: string,
	): ChatMutationProvenance {
		this.authorize(context);
		// The following service call is synchronous through its SQLite commit for
		// every mutation except purge. No event-loop turn can interleave after this
		// final assertion; purge carries the same fence across its async phases.
		assertChatCatalogMutationAllowed(context);
		const occurredAt = this.clock();
		if (!Number.isFinite(occurredAt.getTime())) {
			throw new ChatCatalogError("invalid_input", "host clock is invalid");
		}
		return {
			invocationId,
			occurredAt: occurredAt.toISOString(),
			actor: {
				kind: context.actorKind,
				id: context.principalId,
				...(context.actorLabel ? { label: context.actorLabel } : {}),
			},
			source: { ...context.source },
		};
	}

	private requireWorkspace(
		context: ChatCatalogAuthorityContext,
		workspaceKey: string,
	): void {
		this.authorize(context);
		if (workspaceKey !== context.workspaceKey) {
			throw new ChatCatalogError(
				"chat_not_found",
				"chat is outside the authorized workspace",
			);
		}
	}

	private requireChat(
		context: ChatCatalogAuthorityContext,
		chatId: string,
	): ChatDetail {
		this.authorize(context);
		const chat = context.audienceId
			? this.service.getAudienceChat({
					chatId,
					workspaceKey: context.workspaceKey,
					audienceId: context.audienceId,
				})
			: this.service.getChat(chatId);
		if (!chat || chat.workspaceKey !== context.workspaceKey) {
			throw new ChatCatalogError(
				"chat_not_found",
				`chat ${chatId} was not found`,
			);
		}
		return chat;
	}

	private requireSession(
		context: ChatCatalogAuthorityContext,
		sessionId: string,
	): void {
		this.authorize(context);
		if (
			context.audienceId &&
			!this.service.hasAudienceSession({
				sessionId,
				workspaceKey: context.workspaceKey,
				audienceId: context.audienceId,
			})
		) {
			throw new ChatCatalogError(
				"session_not_found",
				`session ${sessionId} was not found`,
			);
		}
		const workspaceKey = context.audienceId
			? context.workspaceKey
			: this.service.getSessionWorkspaceKey(sessionId);
		if (!workspaceKey || workspaceKey !== context.workspaceKey) {
			throw new ChatCatalogError(
				"session_not_found",
				`session ${sessionId} was not found`,
			);
		}
	}

	private requireBindingWorkspace(
		context: ChatCatalogAuthorityContext,
		scope: ChatBindingScope,
	): void {
		if (context.audienceId) {
			if (
				!this.service.getAudienceBinding(scope, {
					workspaceKey: context.workspaceKey,
					audienceId: context.audienceId,
				})
			) {
				throw new ChatCatalogError(
					"binding_conflict",
					"binding has no workspace authority",
				);
			}
			return;
		}
		const workspaceKey = this.service.getBindingWorkspaceKey(scope);
		if (!workspaceKey) {
			throw new ChatCatalogError(
				"binding_conflict",
				"binding has no workspace authority",
			);
		}
		this.requireWorkspace(context, workspaceKey);
	}

	private receipt(
		invocationId: string,
		aggregateKind: ChatCatalogMutationReceipt["aggregateKind"],
		aggregateId: string,
		replayed: boolean,
	): ChatCatalogMutationReceipt {
		const outcome = this.service.getMutationOutcome(invocationId);
		if (!outcome) {
			throw new ChatCatalogError(
				"invocation_replay_conflict",
				"catalog mutation did not persist an immutable outcome",
			);
		}
		return Object.freeze({
			invocationId,
			operation: outcome.operation,
			aggregateKind,
			aggregateId,
			applied: outcome.applied,
			replayed,
			resultingRevision: outcome.resultRevision,
		});
	}

	private async chatMutation(
		context: ChatCatalogAuthorityContext,
		invocationId: string,
		chatId: string,
		operation: (
			provenance: ChatMutationProvenance,
		) => ChatMutationResult<ChatDetail>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		this.requireChat(context, chatId);
		const replayed = Boolean(this.service.getMutationOutcome(invocationId));
		const result = operation(this.provenance(context, invocationId));
		return {
			receipt: this.receipt(invocationId, "chat", chatId, replayed),
			current: result.value,
		};
	}

	async listChats(
		context: ChatCatalogAuthorityContext,
		input: ListChatsInput,
	): Promise<ChatPage> {
		this.requireWorkspace(context, input.workspaceKey);
		return this.service.listChats({
			...input,
			...(context.audienceId ? { audienceId: context.audienceId } : {}),
		});
	}

	async getChat(
		context: ChatCatalogAuthorityContext,
		chatId: string,
	): Promise<ChatDetail | undefined> {
		this.authorize(context);
		if (context.audienceId) {
			return this.service.getAudienceChat({
				chatId,
				workspaceKey: context.workspaceKey,
				audienceId: context.audienceId,
			});
		}
		const chat = this.service.getChat(chatId);
		return chat?.workspaceKey === context.workspaceKey ? chat : undefined;
	}

	async getBinding(
		context: ChatCatalogAuthorityContext,
		scope: ChatBindingScope,
	): Promise<ChatBindingRecord | undefined> {
		this.authorize(context);
		if (context.audienceId) {
			return this.service.getAudienceBinding(scope, {
				workspaceKey: context.workspaceKey,
				audienceId: context.audienceId,
			});
		}
		const workspaceKey = this.service.getBindingWorkspaceKey(scope);
		if (!workspaceKey || workspaceKey !== context.workspaceKey)
			return undefined;
		return this.service.getBinding(scope);
	}

	async admitRootSession(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<AdmitRootSessionInput>,
	): Promise<ChatCatalogRootAdmissionResponse> {
		this.requireWorkspace(context, input.workspaceRoot);
		const replayed = Boolean(
			this.service.getMutationOutcome(input.invocationId),
		);
		const { invocationId, ...command } = input;
		const result = this.service.admitRootSession({
			...command,
			...(context.audienceId ? { audienceId: context.audienceId } : {}),
			provenance: this.provenance(context, invocationId),
		});
		return {
			receipt: this.receipt(invocationId, "lease", input.sessionId, replayed),
			current: { chat: result.chat, lease: result.lease },
			...(result.leaseToken ? { leaseToken: result.leaseToken } : {}),
		};
	}

	async admitRelatedSession(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<AdmitRelatedSessionInput>,
	): Promise<ChatCatalogRelatedAdmissionResponse> {
		this.requireWorkspace(context, input.workspaceRoot);
		this.requireSession(context, input.parentSessionId);
		const replayed = Boolean(
			this.service.getMutationOutcome(input.invocationId),
		);
		const { invocationId, ...command } = input;
		const result = this.service.admitRelatedSession({
			...command,
			...(context.audienceId ? { audienceId: context.audienceId } : {}),
			provenance: this.provenance(context, invocationId),
		});
		return {
			receipt: this.receipt(invocationId, "lease", input.sessionId, replayed),
			current: { chat: result.chat, lease: result.lease },
			...(result.leaseToken ? { leaseToken: result.leaseToken } : {}),
		};
	}

	async adoptRootSession(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<AdoptRootSessionInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		this.requireSession(context, input.sessionId);
		const replayed = Boolean(
			this.service.getMutationOutcome(input.invocationId),
		);
		const { invocationId, ...command } = input;
		const result = this.service.adoptRootSession({
			...command,
			...(context.audienceId ? { audienceId: context.audienceId } : {}),
			provenance: this.provenance(context, invocationId),
		});
		return {
			receipt: this.receipt(invocationId, "chat", input.chatId, replayed),
			current: result.value,
		};
	}

	async recordBranch(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RecordBranchInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		this.requireChat(context, input.sourceChatId);
		this.requireSession(context, input.sessionId);
		const replayed = Boolean(
			this.service.getMutationOutcome(input.invocationId),
		);
		const { invocationId, ...command } = input;
		const result = this.service.recordBranch({
			...command,
			provenance: this.provenance(context, invocationId),
		});
		return {
			receipt: this.receipt(invocationId, "chat", input.chatId, replayed),
			current: result.value,
		};
	}

	async attachSuccessorSession(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<AttachSuccessorSessionInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		this.requireChat(context, input.chatId);
		this.requireSession(context, input.sessionId);
		const { invocationId, ...command } = input;
		return this.chatMutation(
			context,
			invocationId,
			input.chatId,
			(provenance) =>
				this.service.attachSuccessorSession({ ...command, provenance }),
		);
	}

	async recordChatActivity(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RecordChatActivityInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		this.requireChat(context, input.chatId);
		this.requireSession(context, input.sessionId);
		const { invocationId, ...command } = input;
		return this.chatMutation(
			context,
			invocationId,
			input.chatId,
			(provenance) =>
				this.service.recordChatActivity({ ...command, provenance }),
		);
	}

	async renameChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RenameChatInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		this.requireChat(context, input.chatId);
		const { invocationId, ...command } = input;
		return this.chatMutation(
			context,
			invocationId,
			input.chatId,
			(provenance) => this.service.renameChat({ ...command, provenance }),
		);
	}

	async archiveChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<ChatLifecycleMutationInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		this.requireChat(context, input.chatId);
		const effects = [
			...(input.stopRunningIntent ? (["stop_running"] as const) : []),
			...(input.clearBindings ? (["clear_bindings"] as const) : []),
		] satisfies readonly ChatCatalogConfirmationEffect[];
		consumeChatCatalogConfirmation(
			context,
			"archive",
			{
				invocationId: input.invocationId,
				aggregateKind: "chat",
				aggregateId: input.chatId,
				expectedRevision: input.expectedRevision,
				...(effects.length > 0 ? { effects } : {}),
			},
			this.clock(),
		);
		const { invocationId, ...command } = input;
		return this.chatMutation(
			context,
			invocationId,
			input.chatId,
			(provenance) => this.service.archiveChat({ ...command, provenance }),
		);
	}

	async activateChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<ChatLifecycleMutationInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		this.requireChat(context, input.chatId);
		consumeChatCatalogConfirmation(
			context,
			"activate",
			{
				invocationId: input.invocationId,
				aggregateKind: "chat",
				aggregateId: input.chatId,
				expectedRevision: input.expectedRevision,
			},
			this.clock(),
		);
		const { invocationId, ...command } = input;
		return this.chatMutation(
			context,
			invocationId,
			input.chatId,
			(provenance) => this.service.activateChat({ ...command, provenance }),
		);
	}

	async bindChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<BindChatInput>,
	): Promise<ChatCatalogMutationResponse<ChatBindingRecord>> {
		this.requireChat(context, input.chatId);
		const existing = context.audienceId
			? this.service.getAudienceBinding(input, {
					workspaceKey: context.workspaceKey,
					audienceId: context.audienceId,
				})
			: this.service.getBinding(input);
		if (existing) {
			this.requireBindingWorkspace(context, input);
		}
		const replayed = Boolean(
			this.service.getMutationOutcome(input.invocationId),
		);
		const { invocationId, ...command } = input;
		const result = this.service.bindChat({
			...command,
			provenance: this.provenance(context, invocationId),
		});
		this.requireBindingWorkspace(context, input);
		return {
			receipt: this.receipt(
				invocationId,
				"binding",
				result.value.bindingId,
				replayed,
			),
			current: result.value,
		};
	}

	async unbindChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<UnbindChatInput>,
	): Promise<ChatCatalogMutationResponse<ChatBindingRecord>> {
		this.authorize(context);
		this.requireBindingWorkspace(context, input);
		const replayed = Boolean(
			this.service.getMutationOutcome(input.invocationId),
		);
		const { invocationId, ...command } = input;
		const result = this.service.unbindChat(
			{
				...command,
				provenance: this.provenance(context, invocationId),
			},
			context.workspaceKey,
			context.audienceId,
		);
		this.requireBindingWorkspace(context, input);
		return {
			receipt: this.receipt(
				invocationId,
				"binding",
				result.value.bindingId,
				replayed,
			),
			current: result.value,
		};
	}

	async acquireSessionLease(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<AcquireSessionLeaseInput>,
	): Promise<ChatCatalogLeaseResponse> {
		this.requireSession(context, input.sessionId);
		const chat = this.service.getChatForSession(input.sessionId);
		if (!chat)
			throw new ChatCatalogError("session_not_found", "session was not found");
		this.requireWorkspace(context, chat.workspaceKey);
		const replayed = Boolean(
			this.service.getMutationOutcome(input.invocationId),
		);
		const { invocationId, ...command } = input;
		const result = this.service.acquireSessionLease({
			...command,
			provenance: this.provenance(context, invocationId),
		});
		return {
			receipt: this.receipt(invocationId, "lease", input.sessionId, replayed),
			current: result.value,
			...(result.leaseToken ? { leaseToken: result.leaseToken } : {}),
		};
	}

	async getSessionLease(
		context: ChatCatalogAuthorityContext,
		sessionId: string,
	): Promise<SessionLeaseRecord | undefined> {
		this.authorize(context);
		try {
			this.requireSession(context, sessionId);
		} catch (error) {
			if (
				error instanceof ChatCatalogError &&
				error.code === "session_not_found"
			) {
				return undefined;
			}
			throw error;
		}
		return this.service.getSessionLease(sessionId);
	}

	async verifySessionLease(
		context: ChatCatalogAuthorityContext,
		input: VerifySessionLeaseInput,
	): Promise<SessionLeaseRecord> {
		this.requireSession(context, input.sessionId);
		return this.service.verifySessionLease(input);
	}

	async releaseSessionLease(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<ReleaseSessionLeaseInput>,
	): Promise<ChatCatalogMutationResponse<SessionLeaseRecord>> {
		this.requireSession(context, input.sessionId);
		const chat = this.service.getChatForSession(input.sessionId);
		if (!chat)
			throw new ChatCatalogError("session_not_found", "session was not found");
		this.requireWorkspace(context, chat.workspaceKey);
		const replayed = Boolean(
			this.service.getMutationOutcome(input.invocationId),
		);
		const { invocationId, ...command } = input;
		const result = this.service.releaseSessionLease({
			...command,
			provenance: this.provenance(context, invocationId),
		});
		return {
			receipt: this.receipt(invocationId, "lease", input.sessionId, replayed),
			current: result.value,
		};
	}

	async renewSessionLease(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RenewSessionLeaseInput>,
	): Promise<ChatCatalogMutationResponse<SessionLeaseRecord>> {
		this.requireSession(context, input.sessionId);
		const chat = this.service.getChatForSession(input.sessionId);
		if (!chat)
			throw new ChatCatalogError("session_not_found", "session was not found");
		this.requireWorkspace(context, chat.workspaceKey);
		const replayed = Boolean(
			this.service.getMutationOutcome(input.invocationId),
		);
		const { invocationId, ...command } = input;
		const result = this.service.renewSessionLease({
			...command,
			provenance: this.provenance(context, invocationId),
		});
		return {
			receipt: this.receipt(invocationId, "lease", input.sessionId, replayed),
			current: result.value,
		};
	}

	async rekeySessionLease(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RekeySessionLeaseInput>,
	): Promise<ChatCatalogRekeyResponse> {
		this.requireSession(context, input.sessionId);
		const chat = this.service.getChatForSession(input.sessionId);
		if (!chat)
			throw new ChatCatalogError("session_not_found", "session was not found");
		this.requireWorkspace(context, chat.workspaceKey);
		const replayed = Boolean(
			this.service.getMutationOutcome(input.invocationId),
		);
		const { invocationId, ...command } = input;
		const result = this.service.rekeySessionLease({
			...command,
			provenance: this.provenance(context, invocationId),
		});
		return {
			receipt: this.receipt(invocationId, "lease", input.sessionId, replayed),
			current: result.value,
			leaseToken: result.leaseToken,
		};
	}

	async revokeSessionLease(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RevokeSessionLeaseInput>,
	): Promise<ChatCatalogMutationResponse<SessionLeaseRecord>> {
		this.requireSession(context, input.sessionId);
		consumeChatCatalogConfirmation(
			context,
			"revoke_lease",
			{
				invocationId: input.invocationId,
				aggregateKind: "lease",
				aggregateId: input.sessionId,
				expectedRevision: input.expectedRevision,
			},
			this.clock(),
		);
		const chat = this.service.getChatForSession(input.sessionId);
		if (!chat)
			throw new ChatCatalogError("session_not_found", "session was not found");
		this.requireWorkspace(context, chat.workspaceKey);
		const replayed = Boolean(
			this.service.getMutationOutcome(input.invocationId),
		);
		const { invocationId, ...command } = input;
		const result = this.service.revokeSessionLease({
			...command,
			provenance: this.provenance(context, invocationId),
		});
		return {
			receipt: this.receipt(invocationId, "lease", input.sessionId, replayed),
			current: result.value,
		};
	}

	async purgeChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<PurgeChatInput>,
	): Promise<ChatCatalogPurgeResponse> {
		this.authorize(context);
		const liveChat = context.audienceId
			? this.service.getAudienceChat({
					chatId: input.chatId,
					workspaceKey: context.workspaceKey,
					audienceId: context.audienceId,
				})
			: this.service.getChat(input.chatId);
		if (!liveChat) {
			const workspaceKey = this.service.getPurgedChatWorkspaceKey(input.chatId);
			const audienceId = this.service.getPurgedChatAudienceId(input.chatId);
			if (
				workspaceKey !== context.workspaceKey ||
				(context.audienceId !== undefined && audienceId !== context.audienceId)
			) {
				throw new ChatCatalogError("chat_not_found", "chat was not found");
			}
		} else if (liveChat.workspaceKey !== context.workspaceKey) {
			throw new ChatCatalogError("chat_not_found", "chat was not found");
		}
		consumeChatCatalogConfirmation(
			context,
			"purge",
			{
				invocationId: input.invocationId,
				aggregateKind: "chat",
				aggregateId: input.chatId,
				expectedRevision: input.expectedRevision,
			},
			this.clock(),
		);
		const replayed = Boolean(
			this.service.getMutationOutcome(input.invocationId),
		);
		const { invocationId, ...command } = input;
		const mutationFence = getChatCatalogMutationFence(context);
		const result = await this.service.purgeChat(
			{
				...command,
				provenance: this.provenance(context, invocationId),
			},
			mutationFence,
		);
		return {
			receipt: this.receipt(invocationId, "chat", input.chatId, replayed),
			sessionIds: result.sessionIds,
		};
	}
}
