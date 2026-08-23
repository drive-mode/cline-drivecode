import {
	CHAT_PROJECTION_MAX_PAGE_SIZE,
	CHAT_PROJECTION_WIRE_VERSION,
	type HubChatProjectionCommandName,
	type HubChatProjectionGetRequest,
	type HubChatProjectionGetResult,
	type HubChatProjectionListRequest,
	type HubChatProjectionListResult,
	type HubReplyEnvelope,
	parseHubChatProjectionWireReply,
	parseHubChatProjectionWireRequest,
} from "@cline/shared";
import { readTerminalHubCommandRejectionCode } from "./managed-command-error";

export interface HubChatProjectionClientTransport {
	command(
		command: HubChatProjectionCommandName,
		payload?: Record<string, unknown>,
		sessionId?: string,
		options?: {
			timeoutMs?: number | null;
			requiredConnectionGeneration?: number;
		},
	): Promise<HubReplyEnvelope>;
}

export interface HubChatProjectionCommandOptions {
	readonly requiredConnectionGeneration: number;
	readonly timeoutMs?: number | null;
}

export class HubChatProjectionCommandError extends Error {
	constructor(
		readonly command: HubChatProjectionCommandName,
		readonly code: string,
	) {
		super("Managed projection command was rejected.");
		this.name = "HubChatProjectionCommandError";
	}
}

export class HubChatProjectionProtocolError extends Error {
	constructor(message = "Managed projection output failed v1 validation.") {
		super(message);
		this.name = "HubChatProjectionProtocolError";
	}
}

interface SnapshotState {
	readonly snapshotSequence: number;
	readonly connectionGeneration: number;
	readonly catalogState: "active" | "archived" | "all" | undefined;
	readonly seenChatIds: Set<string>;
	lastChat?: { readonly lastActivityAt: string; readonly chatId: string };
	nextCursor?: string;
}

const MAX_TRACKED_SNAPSHOTS = 64;

function requiredConnectionGeneration(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error("Managed projection connection generation is invalid.");
	}
	return value;
}

/** Strict, mutation-free client for the bounded managed chat projection. */
export class HubChatProjectionClient {
	readonly #snapshots = new Map<string, SnapshotState>();
	readonly #continuationsInFlight = new Set<string>();

	constructor(private readonly transport: HubChatProjectionClientTransport) {}

	async list(
		input: HubChatProjectionListRequest = {},
		options: HubChatProjectionCommandOptions,
	): Promise<HubChatProjectionListResult> {
		const request = parseHubChatProjectionWireRequest({
			version: CHAT_PROJECTION_WIRE_VERSION,
			command: "chat_projection.list",
			payload: input,
		});
		const prior = input.snapshotId
			? this.#snapshots.get(input.snapshotId)
			: undefined;
		if (input.snapshotId && (!prior || prior.nextCursor !== input.cursor)) {
			throw new HubChatProjectionProtocolError(
				"Managed projection continuation is not owned by this client.",
			);
		}
		if (prior && prior.catalogState !== input.catalogState) {
			throw new HubChatProjectionProtocolError(
				"Managed projection continuation changed its query.",
			);
		}
		if (
			prior &&
			prior.connectionGeneration !== options.requiredConnectionGeneration
		) {
			throw new HubChatProjectionProtocolError(
				"Managed projection continuation crossed a connection generation.",
			);
		}
		const continuationSnapshotId = input.snapshotId;
		if (
			continuationSnapshotId &&
			this.#continuationsInFlight.has(continuationSnapshotId)
		) {
			throw new HubChatProjectionProtocolError(
				"Managed projection continuation is already in flight.",
			);
		}
		if (continuationSnapshotId) {
			this.#continuationsInFlight.add(continuationSnapshotId);
		}

		try {
			const result = await this.#invoke<HubChatProjectionListResult>(
				request.command,
				request.payload,
				options,
			);
			if (
				input.snapshotId !== undefined &&
				result.snapshotId !== input.snapshotId
			) {
				throw new HubChatProjectionProtocolError(
					"Managed projection continuation changed its snapshot.",
				);
			}
			if (prior && prior.snapshotSequence !== result.snapshotSequence) {
				throw new HubChatProjectionProtocolError(
					"Managed projection continuation changed its catalog cut.",
				);
			}
			if (input.cursor && result.nextCursor === input.cursor) {
				throw new HubChatProjectionProtocolError(
					"Managed projection continuation did not advance.",
				);
			}
			if (!input.snapshotId && this.#snapshots.has(result.snapshotId)) {
				throw new HubChatProjectionProtocolError(
					"Managed projection reused an active snapshot identity.",
				);
			}
			const limit = input.limit ?? CHAT_PROJECTION_MAX_PAGE_SIZE;
			if (result.chats.length > limit) {
				throw new HubChatProjectionProtocolError(
					"Managed projection exceeded the requested page size.",
				);
			}
			for (const chat of result.chats) {
				if (
					input.catalogState !== undefined &&
					input.catalogState !== "all" &&
					chat.catalogState !== input.catalogState
				) {
					throw new HubChatProjectionProtocolError(
						"Managed projection escaped its lifecycle-state query.",
					);
				}
			}
			this.#recordPage(
				input,
				result,
				prior,
				options.requiredConnectionGeneration,
			);
			return result;
		} finally {
			if (continuationSnapshotId) {
				this.#continuationsInFlight.delete(continuationSnapshotId);
			}
		}
	}

	async get(
		input: HubChatProjectionGetRequest,
		options: HubChatProjectionCommandOptions,
	): Promise<HubChatProjectionGetResult> {
		const request = parseHubChatProjectionWireRequest({
			version: CHAT_PROJECTION_WIRE_VERSION,
			command: "chat_projection.get",
			payload: input,
		});
		const result = await this.#invoke<HubChatProjectionGetResult>(
			request.command,
			request.payload,
			options,
		);
		if (result.chat && result.chat.chatId !== input.chatId) {
			throw new HubChatProjectionProtocolError(
				"Managed projection returned a different chat target.",
			);
		}
		return result;
	}

	async #invoke<T>(
		command: HubChatProjectionCommandName,
		payload: Record<string, unknown>,
		options: HubChatProjectionCommandOptions,
	): Promise<T> {
		const generation = requiredConnectionGeneration(
			options.requiredConnectionGeneration,
		);
		let reply: HubReplyEnvelope;
		try {
			reply = await this.transport.command(command, payload, undefined, {
				requiredConnectionGeneration: generation,
				...(options.timeoutMs === undefined
					? {}
					: { timeoutMs: options.timeoutMs }),
			});
		} catch (error) {
			const code = readTerminalHubCommandRejectionCode(error);
			if (code) throw new HubChatProjectionCommandError(command, code);
			throw error;
		}
		let parsed: HubReplyEnvelope;
		try {
			parsed = parseHubChatProjectionWireReply(command, reply);
		} catch {
			throw new HubChatProjectionProtocolError();
		}
		if (!parsed.ok) {
			throw new HubChatProjectionCommandError(
				command,
				parsed.error?.code ?? "projection_rejected",
			);
		}
		return parsed.payload?.result as T;
	}

	#recordPage(
		input: HubChatProjectionListRequest,
		result: HubChatProjectionListResult,
		prior: SnapshotState | undefined,
		connectionGeneration: number,
	): void {
		const state: SnapshotState = prior
			? {
					snapshotSequence: prior.snapshotSequence,
					connectionGeneration: prior.connectionGeneration,
					catalogState: prior.catalogState,
					seenChatIds: new Set(prior.seenChatIds),
					...(prior.lastChat ? { lastChat: { ...prior.lastChat } } : {}),
					...(prior.nextCursor ? { nextCursor: prior.nextCursor } : {}),
				}
			: {
					snapshotSequence: result.snapshotSequence,
					connectionGeneration,
					catalogState: input.catalogState,
					seenChatIds: new Set<string>(),
				};
		for (const chat of result.chats) {
			if (state.seenChatIds.has(chat.chatId)) {
				throw new HubChatProjectionProtocolError(
					"Managed projection repeated a chat across snapshot pages.",
				);
			}
			if (state.lastChat) {
				const previousActivity = Date.parse(state.lastChat.lastActivityAt);
				const activity = Date.parse(chat.lastActivityAt);
				if (
					activity > previousActivity ||
					(activity === previousActivity && chat.chatId < state.lastChat.chatId)
				) {
					throw new HubChatProjectionProtocolError(
						"Managed projection page order crossed its prior page.",
					);
				}
			}
			state.seenChatIds.add(chat.chatId);
			state.lastChat = {
				lastActivityAt: chat.lastActivityAt,
				chatId: chat.chatId,
			};
		}
		state.nextCursor = result.nextCursor;
		this.#snapshots.set(result.snapshotId, state);
		while (this.#snapshots.size > MAX_TRACKED_SNAPSHOTS) {
			const oldest = this.#snapshots.keys().next().value;
			if (oldest === undefined) break;
			this.#snapshots.delete(oldest);
		}
	}
}
