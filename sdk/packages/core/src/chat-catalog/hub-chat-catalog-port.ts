import { isAbsolute, resolve } from "node:path";
import {
	CHAT_CATALOG_ERROR_CODES,
	type ChatBindingRecord,
	type ChatDetail,
	type ChatPage,
	type HubChatCatalogCommandName,
	type HubCommandEnvelope,
	type HubReplyEnvelope,
	parseHubChatCatalogWireReply,
	parseHubChatCatalogWireRequest,
	type SessionLeaseRecord,
} from "@cline/shared";
import {
	assertChatCatalogAuthority,
	type ChatCatalogAuthorityContext,
	type ChatCatalogConfirmation,
	consumeChatCatalogConfirmation,
} from "./chat-catalog-authority";
import type {
	AuthorizedCommand,
	ChatCatalogLeaseResponse,
	ChatCatalogMutationResponse,
	ChatCatalogPort,
	ChatCatalogPurgeResponse,
} from "./chat-catalog-port";
import {
	type AcquireSessionLeaseInput,
	type AdoptRootSessionInput,
	type AttachSuccessorSessionInput,
	type BindChatInput,
	ChatCatalogError,
	type ChatLifecycleMutationInput,
	type ListChatsInput,
	type PurgeChatInput,
	type RecordBranchInput,
	type RecordChatActivityInput,
	type ReleaseSessionLeaseInput,
	type RenameChatInput,
	type RenewSessionLeaseInput,
	type RevokeSessionLeaseInput,
	type UnbindChatInput,
	type VerifySessionLeaseInput,
} from "./sqlite-chat-catalog-service";

export interface HubChatCatalogCommandClient {
	command(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
	): Promise<HubReplyEnvelope>;
}

export interface HubChatCatalogPortOptions {
	client: HubChatCatalogCommandClient;
	workspaceKey: string;
	tenantId?: string;
	clock?: () => Date;
}

const ERROR_CODES = new Set<string>(CHAT_CATALOG_ERROR_CODES);

function asPayload(value: object): Record<string, unknown> {
	return value as unknown as Record<string, unknown>;
}

function freezeReceipt<T>(result: T): T {
	if (result && typeof result === "object" && "receipt" in result) {
		const receipt = (result as { receipt?: unknown }).receipt;
		if (receipt && typeof receipt === "object") Object.freeze(receipt);
	}
	return result;
}

function catalogError(error: unknown): ChatCatalogError | undefined {
	if (!error || typeof error !== "object") return undefined;
	const code = "code" in error ? (error as { code?: unknown }).code : undefined;
	if (typeof code !== "string" || !ERROR_CODES.has(code)) return undefined;
	const message =
		"message" in error &&
		typeof (error as { message?: unknown }).message === "string"
			? (error as { message: string }).message
			: "Hub chat catalog command failed";
	return new ChatCatalogError(
		code as (typeof CHAT_CATALOG_ERROR_CODES)[number],
		message,
	);
}

export class HubChatCatalogPort implements ChatCatalogPort {
	private readonly client: HubChatCatalogCommandClient;
	private readonly workspaceKey: string;
	private readonly tenantId: string;
	private readonly clock: () => Date;

	constructor(options: HubChatCatalogPortOptions) {
		this.client = options.client;
		if (!isAbsolute(options.workspaceKey)) {
			throw new ChatCatalogError(
				"invalid_input",
				"hub chat catalog workspace key must be absolute",
			);
		}
		this.workspaceKey = resolve(options.workspaceKey);
		this.tenantId = options.tenantId?.trim() || "local";
		this.clock = options.clock ?? (() => new Date());
	}

	private authorize(context: ChatCatalogAuthorityContext): void {
		assertChatCatalogAuthority(context);
		if (
			context.tenantId !== this.tenantId ||
			context.workspaceKey !== this.workspaceKey
		) {
			throw new ChatCatalogError(
				"chat_not_found",
				"chat is outside the authorized hub catalog scope",
			);
		}
	}

	private async invoke<T>(
		context: ChatCatalogAuthorityContext,
		command: HubChatCatalogCommandName,
		payload: Record<string, unknown>,
		confirmation?: ChatCatalogConfirmation,
	): Promise<T> {
		this.authorize(context);
		let commandPayload = payload;
		if (confirmation) {
			const invocationId = payload.invocationId;
			const aggregateKind = confirmation === "revoke_lease" ? "lease" : "chat";
			const aggregateId =
				aggregateKind === "lease" ? payload.sessionId : payload.chatId;
			const expectedRevision = payload.expectedRevision;
			if (
				typeof invocationId !== "string" ||
				typeof aggregateId !== "string" ||
				typeof expectedRevision !== "number"
			) {
				throw new ChatCatalogError(
					"invalid_input",
					"hub confirmed mutation omitted its confirmation target",
				);
			}
			const effects =
				confirmation === "archive"
					? [
							...(payload.stopRunningIntent === true
								? (["stop_running"] as const)
								: []),
							...(payload.clearBindings === true
								? (["clear_bindings"] as const)
								: []),
						]
					: [];
			const grant = consumeChatCatalogConfirmation(
				context,
				confirmation,
				{
					invocationId,
					aggregateKind,
					aggregateId,
					expectedRevision,
					...(effects.length > 0 ? { effects } : {}),
				},
				this.clock(),
			);
			commandPayload = {
				...payload,
				confirmationCredential: grant.credential,
			};
		}
		let reply: HubReplyEnvelope;
		try {
			parseHubChatCatalogWireRequest({
				version: "v1",
				command,
				payload: commandPayload,
			});
		} catch {
			throw new ChatCatalogError(
				"invalid_input",
				"Hub chat catalog request failed v1 schema validation",
			);
		}
		try {
			reply = await this.client.command(command, commandPayload);
		} catch (error) {
			throw catalogError(error) ?? error;
		}
		try {
			reply = parseHubChatCatalogWireReply(command, reply) as HubReplyEnvelope;
		} catch {
			throw new ChatCatalogError(
				"unsupported_capability",
				"Hub chat catalog reply failed v1 schema validation",
			);
		}
		if (!reply.ok) {
			const mapped = catalogError(reply.error);
			if (mapped) throw mapped;
			throw new ChatCatalogError(
				"unsupported_capability",
				reply.error?.message ?? "Hub chat catalog command failed",
			);
		}
		if (!("result" in (reply.payload ?? {}))) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"Hub chat catalog reply omitted its result",
			);
		}
		return freezeReceipt(reply.payload?.result as T);
	}

	async listChats(
		context: ChatCatalogAuthorityContext,
		input: ListChatsInput,
	): Promise<ChatPage> {
		if (
			!isAbsolute(input.workspaceKey) ||
			resolve(input.workspaceKey) !== this.workspaceKey
		) {
			throw new ChatCatalogError(
				"chat_not_found",
				"chat list is outside the configured hub workspace",
			);
		}
		const { workspaceKey: _workspaceKey, ...filters } = input;
		return this.invoke(context, "chat_catalog.list", asPayload(filters));
	}

	async getChat(
		context: ChatCatalogAuthorityContext,
		chatId: string,
	): Promise<ChatDetail | undefined> {
		const result = await this.invoke<ChatDetail | null>(
			context,
			"chat_catalog.get",
			{ chatId },
		);
		return result ?? undefined;
	}

	async adoptRootSession(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<AdoptRootSessionInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		return this.invoke(context, "chat_catalog.adopt_root", asPayload(input));
	}

	async recordBranch(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RecordBranchInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		return this.invoke(context, "chat_catalog.record_branch", asPayload(input));
	}

	async attachSuccessorSession(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<AttachSuccessorSessionInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		return this.invoke(
			context,
			"chat_catalog.attach_successor",
			asPayload(input),
		);
	}

	async recordChatActivity(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RecordChatActivityInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		return this.invoke(
			context,
			"chat_catalog.record_activity",
			asPayload(input),
		);
	}

	async renameChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RenameChatInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		return this.invoke(context, "chat_catalog.rename", asPayload(input));
	}

	async archiveChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<ChatLifecycleMutationInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		return this.invoke(
			context,
			"chat_catalog.archive",
			asPayload(input),
			"archive",
		);
	}

	async activateChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<ChatLifecycleMutationInput>,
	): Promise<ChatCatalogMutationResponse<ChatDetail>> {
		return this.invoke(
			context,
			"chat_catalog.activate",
			asPayload(input),
			"activate",
		);
	}

	async bindChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<BindChatInput>,
	): Promise<ChatCatalogMutationResponse<ChatBindingRecord>> {
		return this.invoke(context, "chat_catalog.bind", asPayload(input));
	}

	async unbindChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<UnbindChatInput>,
	): Promise<ChatCatalogMutationResponse<ChatBindingRecord>> {
		return this.invoke(context, "chat_catalog.unbind", asPayload(input));
	}

	async acquireSessionLease(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<AcquireSessionLeaseInput>,
	): Promise<ChatCatalogLeaseResponse> {
		return this.invoke(context, "chat_catalog.lease.acquire", asPayload(input));
	}

	async getSessionLease(
		context: ChatCatalogAuthorityContext,
		sessionId: string,
	): Promise<SessionLeaseRecord | undefined> {
		const result = await this.invoke<SessionLeaseRecord | null>(
			context,
			"chat_catalog.lease.get",
			{ sessionId },
		);
		return result ?? undefined;
	}

	async verifySessionLease(
		context: ChatCatalogAuthorityContext,
		input: VerifySessionLeaseInput,
	): Promise<SessionLeaseRecord> {
		return this.invoke(context, "chat_catalog.lease.verify", asPayload(input));
	}

	async releaseSessionLease(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<ReleaseSessionLeaseInput>,
	): Promise<ChatCatalogMutationResponse<SessionLeaseRecord>> {
		return this.invoke(context, "chat_catalog.lease.release", asPayload(input));
	}

	async renewSessionLease(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RenewSessionLeaseInput>,
	): Promise<ChatCatalogMutationResponse<SessionLeaseRecord>> {
		return this.invoke(context, "chat_catalog.lease.renew", asPayload(input));
	}

	async revokeSessionLease(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<RevokeSessionLeaseInput>,
	): Promise<ChatCatalogMutationResponse<SessionLeaseRecord>> {
		return this.invoke(
			context,
			"chat_catalog.lease.revoke",
			asPayload(input),
			"revoke_lease",
		);
	}

	async purgeChat(
		context: ChatCatalogAuthorityContext,
		input: AuthorizedCommand<PurgeChatInput>,
	): Promise<ChatCatalogPurgeResponse> {
		return this.invoke(
			context,
			"chat_catalog.purge",
			asPayload(input),
			"purge",
		);
	}
}
