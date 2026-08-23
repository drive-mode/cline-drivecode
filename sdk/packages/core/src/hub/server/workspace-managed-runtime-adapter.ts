import type { AsyncLocalStorage } from "node:async_hooks";
import type {
	AgentResult,
	AgentToolContext,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/shared";
import {
	CHAT_RUNTIME_WIRE_VERSION,
	createSessionId,
	type HubChatProjectionChat,
	type HubChatRuntimeCommandName,
	type HubChatRuntimeCursor,
	type MessageWithMetadata,
	parseHubChatRuntimeWireEvent,
	parseHubChatRuntimeWireRequest,
	parseHubChatRuntimeWireResult,
} from "@cline/shared";
import { readManagedProfileAuthority } from "../../chat-catalog/managed-profile-authority";
import { ChatCatalogError } from "../../chat-catalog/sqlite-chat-catalog-service";
import type { ClineCoreChatLifecycleConfirmationRequest } from "../../cline-core/types";
import type { RuntimeCapabilities } from "../../runtime/capabilities";
import type {
	PendingPromptsServiceApi,
	SessionUsageSummary,
} from "../../runtime/host/runtime-host";
import { readSessionCheckpointHistory } from "../../session/checkpoint-restore";
import type { SessionCompactionState } from "../../session/models/session-compaction";
import { SessionManualCompactionOperationConflictError } from "../../session/models/session-manual-compaction-operation";
import type {
	CoreSessionEvent,
	SessionPendingPrompt,
} from "../../types/events";
import type { SessionRecord } from "../../types/sessions";
import {
	BoundedRuntimeEventJournal,
	type BoundedRuntimeEventJournalOptions,
	RuntimeRecoveryUnavailableError,
} from "./bounded-runtime-event-journal";
import type { HubAuthenticatedConnection } from "./workspace-capability-authority";
import type {
	HubWorkspaceManagedCoreScope,
	HubWorkspaceManagedRuntimeEventInvocation,
	HubWorkspaceManagedRuntimeInvocation,
} from "./workspace-managed-core-pool";
import {
	HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
	type HubManagedRuntimeCallbackCapabilityName,
	type HubManagedRuntimeCapabilityManifest,
	normalizeHubManagedRuntimeCapabilityManifest,
	parseHubManagedRuntimeCapabilityRequest,
	parseHubManagedRuntimeCapabilityResult,
} from "./workspace-managed-runtime-capabilities";

export interface ManagedRuntimeInvocationContext {
	readonly identity: HubAuthenticatedConnection;
	readonly signal: AbortSignal;
	readonly confirmationSignal?: AbortSignal;
	readonly lifecycleCommand?: string;
	readonly operationId?: string;
	readonly confirm?: (
		request: ClineCoreChatLifecycleConfirmationRequest,
	) => boolean | Promise<boolean>;
	readonly sessionId?: string;
	readonly runId?: string;
}

export interface ManagedRuntimeCoreHandle {
	abort(sessionId: string, reason?: string | Error): Promise<void>;
	managedSessionAuthoritySignal?(sessionId: string): AbortSignal;
	rekeyManagedSessionAuthority?(input: {
		operationId: string;
		sessionId: string;
		expectedWriterGeneration: number;
		signal?: AbortSignal;
	}): Promise<ManagedSessionAuthority>;
	verifyManagedSessionAuthority(sessionId: string): Promise<{
		readonly sessionId: string;
		readonly leaseRevision: number;
		readonly writerGeneration: number;
		readonly leaseExpiresAt: string;
	}>;
	readonly pendingPrompts: PendingPromptsServiceApi;
	getAccumulatedUsage(
		sessionId: string,
	): Promise<SessionUsageSummary | undefined>;
	readMessages(sessionId: string): Promise<MessageWithMetadata[]>;
	get(sessionId: string): Promise<SessionRecord | undefined>;
	readSessionCompactionState(
		sessionId: string,
	): Promise<SessionCompactionState | undefined>;
	runSessionManualCompaction?(input: {
		operationId: string;
		sessionId: string;
		reason?: string;
		signal?: AbortSignal;
		onStarted?: () => void;
		onFailed?: () => void;
	}): Promise<{
		operationId: string;
		sessionId: string;
		outcome: "compacted" | "skipped";
		state?: SessionCompactionState;
	}>;
	subscribe(
		listener: (event: CoreSessionEvent) => void,
		options?: { sessionId?: string },
	): () => void;
}

export interface ManagedSessionAuthority {
	readonly sessionId: string;
	readonly leaseRevision: number;
	readonly writerGeneration: number;
	readonly leaseExpiresAt: string;
}

export interface ManagedSessionReclaimResult extends ManagedSessionAuthority {
	readonly ownerTransferred: boolean;
}

export interface ManagedSessionReclaimCancellationResult {
	readonly operationId: string;
	readonly sessionId: string;
	readonly writerGeneration: number;
	readonly cancellationAccepted: boolean;
}

interface RuntimeListenerState {
	readonly invocation: HubWorkspaceManagedRuntimeEventInvocation;
	readonly release: () => void;
}

interface ActiveRun {
	readonly runId: string;
	readonly operationId: string;
	readonly connectionId: string;
	readonly signal: AbortSignal;
	readonly startedAt: number;
	state: "running" | "aborting";
	heartbeat?: ReturnType<typeof setInterval>;
}

interface ManagedSessionOwner {
	readonly state: "owned" | "orphaned";
	readonly connectionId?: string;
	readonly signal?: AbortSignal;
	readonly writerGeneration: number;
	readonly capabilityManifest: HubManagedRuntimeCapabilityManifest;
	readonly authoritySignal?: AbortSignal;
	readonly releaseAuthoritySignal?: () => void;
	readonly reclaimIntent?: ManagedSessionOwnerReclaimIntent;
	readonly admissionOperationId?: string;
	readonly admissionCommand?: string;
	readonly readyExposed: boolean;
}

interface ManagedSessionOwnerReclaimIntent {
	readonly operationId: string;
	readonly expectedWriterGeneration: number;
	readonly targetConnectionId: string;
}

interface ManagedSessionOwnerTransition {
	readonly operationId: string;
	readonly expectedWriterGeneration: number;
	readonly targetConnectionId: string;
	readonly promise: Promise<ManagedSessionReclaimResult>;
	readonly controller: AbortController;
	cancellationRequested: boolean;
}

interface ManagedSessionOwnerTransitionReceipt {
	readonly operationId: string;
	readonly expectedWriterGeneration: number;
	readonly targetConnectionId: string;
	readonly authority: ManagedSessionAuthority;
}

interface PendingApproval {
	readonly approvalId: string;
	readonly sessionId: string;
	readonly runId: string;
	readonly connectionId: string;
	readonly resolve: (result: ToolApprovalResult) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
}

interface PendingCapability {
	readonly requestId: string;
	readonly sessionId: string;
	readonly runId: string;
	readonly connectionId: string;
	readonly capability: HubManagedRuntimeCallbackCapabilityName;
	readonly expiresAt: string;
	readonly resolve: (result: string) => void;
	readonly reject: (error: Error) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
	state: "pending" | "resolved" | "cancelled";
}

interface ManagedCompactionRecord {
	readonly operationId: string;
	readonly sessionId: string;
	readonly reason?: string;
	readonly connectionId: string;
	readonly controller: AbortController;
	readonly promise: Promise<{
		readonly operationId: string;
		readonly sessionId: string;
		readonly outcome: "completed" | "skipped";
		readonly state?: {
			readonly version: number;
			readonly updatedAt?: string;
			readonly sourceMessageCount: number;
			readonly compactedMessageCount: number;
			readonly conversationId?: string;
		};
	}>;
}

const APPROVAL_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_CAPABILITY_TIMEOUT_MS = 5 * 60_000;
const MAX_RUNTIME_RECOVERY_REPLAY_EVENTS = 2_048;
const MAX_CAPABILITY_TIMEOUT_MS = 10 * 60_000;
const MAX_PENDING_CAPABILITIES = 128;
const DEFAULT_OWNER_TRANSITION_RECEIPT_LIMIT = 1024;
const RUN_HEARTBEAT_INTERVAL_MS = 15_000;
const SAFE_RUN_FAILURE = "Managed run failed.";
const SAFE_TOOL_FAILURE = "Tool execution failed.";
const SAFE_COMPACTION_FAILURE = "Manual compaction failed.";
const SAFE_COMPACTION_SKIPPED =
	"The conversation did not contain compactable context.";
const SAFE_CAPABILITY_FAILURE = "Managed runtime capability failed.";

function requiredString(value: unknown, label: string): string {
	const normalized = typeof value === "string" ? value.trim() : "";
	if (!normalized) {
		throw new ChatCatalogError("invalid_input", `${label} is missing`);
	}
	return normalized;
}

function orphanManagedSessionOwner(
	owner: ManagedSessionOwner,
	writerGeneration = owner.writerGeneration,
	reclaimIntent = owner.reclaimIntent,
): ManagedSessionOwner {
	return {
		state: "orphaned",
		writerGeneration,
		capabilityManifest: owner.capabilityManifest,
		...(owner.authoritySignal
			? { authoritySignal: owner.authoritySignal }
			: {}),
		...(owner.releaseAuthoritySignal
			? { releaseAuthoritySignal: owner.releaseAuthoritySignal }
			: {}),
		...(reclaimIntent ? { reclaimIntent } : {}),
		...(owner.admissionOperationId
			? { admissionOperationId: owner.admissionOperationId }
			: {}),
		...(owner.admissionCommand
			? { admissionCommand: owner.admissionCommand }
			: {}),
		readyExposed: owner.readyExposed,
	};
}

function boundedText(value: unknown, maximum: number): string {
	return typeof value === "string" ? value.slice(0, maximum) : "";
}

function truncateUtf8(value: unknown, maximumBytes: number): string {
	if (typeof value !== "string") return "";
	const encoder = new TextEncoder();
	if (encoder.encode(value).byteLength <= maximumBytes) return value;
	const chunks: string[] = [];
	let bytes = 0;
	for (const character of value) {
		const characterBytes = encoder.encode(character).byteLength;
		if (bytes + characterBytes > maximumBytes) break;
		chunks.push(character);
		bytes += characterBytes;
	}
	return chunks.join("");
}

function safeUsage(value: SessionUsageSummary["usage"]): unknown {
	if (!value) return undefined;
	return {
		inputTokens: value.inputTokens,
		outputTokens: value.outputTokens,
		cacheReadTokens: value.cacheReadTokens,
		cacheWriteTokens: value.cacheWriteTokens,
		totalCost: value.totalCost,
	};
}

function sanitizePendingPrompt(
	prompt: SessionPendingPrompt,
	maximumPromptBytes = 32 * 1024,
): unknown {
	return {
		promptId: prompt.id,
		prompt: truncateUtf8(prompt.prompt, maximumPromptBytes),
		delivery: prompt.delivery,
		attachments: [
			...Array.from({ length: prompt.userImages?.length ?? 0 }, () => ({
				kind: "image" as const,
			})),
			...Array.from({ length: prompt.userFiles?.length ?? 0 }, () => ({
				kind: "file" as const,
			})),
		],
	};
}

function sanitizePendingPromptPage(
	prompts: SessionPendingPrompt[],
	options: { cursor?: unknown; limit?: unknown } = {},
): {
	prompts: unknown[];
	nextCursor?: string;
	hasMore: boolean;
} {
	const offset =
		typeof options.cursor === "string" && /^offset-\d+$/.test(options.cursor)
			? Number(options.cursor.slice("offset-".length))
			: 0;
	const limit =
		typeof options.limit === "number" ? Math.min(options.limit, 20) : 10;
	const page: unknown[] = [];
	let pageBytes = 0;
	let nextOffset = offset;
	while (nextOffset < prompts.length && page.length < limit) {
		const prompt = prompts[nextOffset];
		if (!prompt) break;
		const projected = sanitizePendingPrompt(prompt);
		const projectedBytes = new TextEncoder().encode(
			JSON.stringify(projected),
		).byteLength;
		if (page.length > 0 && pageBytes + projectedBytes > 512 * 1024) break;
		page.push(projected);
		pageBytes += projectedBytes;
		nextOffset += 1;
	}
	const hasMore = nextOffset < prompts.length;
	return {
		prompts: page,
		...(hasMore ? { nextCursor: `offset-${nextOffset}` } : {}),
		hasMore,
	};
}

function sanitizeMessage(
	message: MessageWithMetadata,
	sequence: number,
	maximumTextBytes = 192 * 1024,
): unknown {
	const blocks = Array.isArray(message.content) ? message.content : undefined;
	const text =
		typeof message.content === "string"
			? message.content
			: (blocks ?? [])
					.filter((block) => block.type === "text")
					.map((block) => (block.type === "text" ? block.text : ""))
					.join("\n");
	const attachments = (blocks ?? []).reduce<Array<{ kind: "image" | "file" }>>(
		(items, block) => {
			if (block.type === "image") items.push({ kind: "image" });
			if (block.type === "file") items.push({ kind: "file" });
			return items;
		},
		[],
	);
	const toolUse = (blocks ?? []).find((block) => block.type === "tool_use");
	const toolResult = (blocks ?? []).find(
		(block) => block.type === "tool_result",
	);
	const tool = toolUse
		? {
				toolCallId: toolUse.id,
				toolName: boundedText(toolUse.name, 256) || "tool",
				status: "started" as const,
			}
		: toolResult
			? {
					toolCallId: toolResult.tool_use_id,
					toolName: boundedText(toolResult.name, 256) || "tool",
					status: toolResult.is_error
						? ("failed" as const)
						: ("completed" as const),
				}
			: undefined;
	const timestamp =
		typeof message.ts === "number" && Number.isFinite(message.ts)
			? new Date(message.ts).toISOString()
			: undefined;
	return {
		messageId:
			typeof message.id === "string" && message.id.trim()
				? message.id.trim().slice(0, 512)
				: `message-${sequence}`,
		sequence,
		role: tool ? ("tool" as const) : message.role,
		...(timestamp ? { timestamp } : {}),
		text: truncateUtf8(text, maximumTextBytes),
		attachments,
		...(tool ? { tool } : {}),
	};
}

function sanitizeCompactionState(state: SessionCompactionState | undefined) {
	if (!state) return null;
	return {
		version: state.version,
		updatedAt: state.updated_at,
		sourceMessageCount: state.source_message_count,
		compactedMessageCount: state.messages.length,
		...(state.conversation_id ? { conversationId: state.conversation_id } : {}),
	};
}

function freezeRuntimeValue<T>(value: T): T {
	if (!value || typeof value !== "object" || Object.isFrozen(value))
		return value;
	for (const child of Object.values(value)) freezeRuntimeValue(child);
	return Object.freeze(value);
}

export class ManagedRuntimeAdapter {
	readonly #core: ManagedRuntimeCoreHandle;
	readonly #scope: HubWorkspaceManagedCoreScope;
	readonly #resolveAudienceSession: (
		sessionId: string,
	) => HubChatProjectionChat | null;
	readonly #invocations: AsyncLocalStorage<ManagedRuntimeInvocationContext>;
	readonly #listeners = new Set<RuntimeListenerState>();
	readonly #activeRuns = new Map<string, ActiveRun>();
	readonly #managedSessions = new Map<string, ManagedSessionOwner>();
	readonly #ownerTransitions = new Map<string, ManagedSessionOwnerTransition>();
	readonly #ownerTransitionReceipts = new Map<
		string,
		ManagedSessionOwnerTransitionReceipt
	>();
	readonly #pendingApprovals = new Map<string, PendingApproval>();
	readonly #pendingCapabilities = new Map<string, PendingCapability>();
	readonly #activeCompactions = new Map<string, ManagedCompactionRecord>();
	readonly #compactionReceipts = new Map<string, ManagedCompactionRecord>();
	readonly #sessionSequences = new Map<string, number>();
	readonly #sessionStreamIds = new Map<string, string>();
	readonly #recoveryJournal: BoundedRuntimeEventJournal;
	readonly #unsubscribeCore: () => void;
	readonly #capabilityTimeoutMs: number;
	readonly #ownerTransitionReceiptLimit: number;
	#processSequence = 0;
	#disposed = false;
	readonly capabilities = Object.freeze({
		requestToolApproval: (request: ToolApprovalRequest) =>
			this.#requestToolApproval(request),
	});

	constructor(input: {
		core: ManagedRuntimeCoreHandle;
		scope: HubWorkspaceManagedCoreScope;
		invocations: AsyncLocalStorage<ManagedRuntimeInvocationContext>;
		resolveAudienceSession: (sessionId: string) => HubChatProjectionChat | null;
		capabilityTimeoutMs?: number;
		recoveryJournal?: BoundedRuntimeEventJournalOptions;
		ownerTransitionReceiptLimit?: number;
	}) {
		this.#core = input.core;
		this.#scope = input.scope;
		this.#resolveAudienceSession = input.resolveAudienceSession;
		this.#invocations = input.invocations;
		this.#capabilityTimeoutMs =
			input.capabilityTimeoutMs ?? DEFAULT_CAPABILITY_TIMEOUT_MS;
		this.#ownerTransitionReceiptLimit =
			input.ownerTransitionReceiptLimit ??
			DEFAULT_OWNER_TRANSITION_RECEIPT_LIMIT;
		this.#recoveryJournal = new BoundedRuntimeEventJournal(
			input.recoveryJournal,
		);
		if (
			!Number.isSafeInteger(this.#capabilityTimeoutMs) ||
			this.#capabilityTimeoutMs < 1 ||
			this.#capabilityTimeoutMs > MAX_CAPABILITY_TIMEOUT_MS
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed runtime capability timeout is invalid",
			);
		}
		if (
			!Number.isSafeInteger(this.#ownerTransitionReceiptLimit) ||
			this.#ownerTransitionReceiptLimit < 1 ||
			this.#ownerTransitionReceiptLimit > DEFAULT_OWNER_TRANSITION_RECEIPT_LIMIT
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed owner transition receipt limit is invalid",
			);
		}
		this.#unsubscribeCore = this.#core.subscribe((event) =>
			this.#projectCoreEvent(event),
		);
		this.#scope.signal.addEventListener("abort", () => this.dispose(), {
			once: true,
		});
	}

	capabilitiesFor(
		manifestInput?: HubManagedRuntimeCapabilityManifest,
	): RuntimeCapabilities {
		const manifest =
			normalizeHubManagedRuntimeCapabilityManifest(manifestInput);
		const askQuestion = manifest.callbacks.includes(
			HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
		)
			? (question: string, options: string[], context: AgentToolContext) =>
					this.#requestAskQuestion(question, options, context)
			: undefined;
		return Object.freeze({
			requestToolApproval: this.capabilities.requestToolApproval,
			...(askQuestion ? { toolExecutors: Object.freeze({ askQuestion }) } : {}),
		});
	}

	async invoke(
		invocation: HubWorkspaceManagedRuntimeInvocation,
	): Promise<unknown> {
		this.#assertScope(invocation.identity);
		this.#scope.signal.throwIfAborted();
		const parsed = parseHubChatRuntimeWireRequest({
			version: CHAT_RUNTIME_WIRE_VERSION,
			command: invocation.command,
			payload: invocation.payload,
		});
		return await this.#invocations.run(
			{ identity: invocation.identity, signal: invocation.signal },
			async () => {
				invocation.signal.throwIfAborted();
				this.#scope.signal.throwIfAborted();
				const result = await this.#dispatch(
					parsed.command,
					parsed.payload,
					invocation.identity,
					invocation.signal,
				);
				invocation.signal.throwIfAborted();
				this.#scope.signal.throwIfAborted();
				return parseHubChatRuntimeWireResult(parsed.command, result);
			},
		);
	}

	subscribe(invocation: HubWorkspaceManagedRuntimeEventInvocation): () => void {
		this.#assertScope(invocation.identity);
		this.#scope.signal.throwIfAborted();
		invocation.signal.throwIfAborted();
		if (this.#disposed) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed runtime event source was disposed",
			);
		}
		let subscribedOwner: ManagedSessionOwner | undefined;
		if (invocation.sessionId) {
			subscribedOwner = this.#assertSessionOwner(
				invocation.sessionId,
				invocation.identity,
			);
		}
		const recoverySessionId = invocation.cursor
			? requiredString(invocation.sessionId, "managed recovery session id")
			: undefined;
		let active = true;
		let state: RuntimeListenerState | undefined;
		const release = () => {
			if (!active) return;
			active = false;
			invocation.signal.removeEventListener("abort", release);
			if (state) this.#listeners.delete(state);
		};
		try {
			let cursor = invocation.cursor;
			let replayedEvents = 0;
			while (recoverySessionId && cursor) {
				const replay = this.#recoveryJournal.replay(recoverySessionId, cursor);
				if (replay.length === 0) break;
				for (const event of replay) {
					if (replayedEvents >= MAX_RUNTIME_RECOVERY_REPLAY_EVENTS) {
						throw new RuntimeRecoveryUnavailableError();
					}
					invocation.signal.throwIfAborted();
					invocation.emit(event);
					replayedEvents += 1;
					cursor = {
						streamId: event.streamId,
						sessionSequence: event.sessionSequence,
					};
				}
			}
			state = { invocation, release };
			this.#listeners.add(state);
			invocation.signal.addEventListener("abort", release, { once: true });
			if (invocation.sessionId) {
				const readyCursor = this.#recoveryJournal.cursor(invocation.sessionId);
				invocation.ready?.(readyCursor);
				const current = this.#managedSessions.get(invocation.sessionId);
				if (
					current &&
					current === subscribedOwner &&
					current.state === "owned" &&
					current.connectionId === invocation.identity.connectionId
				) {
					this.#managedSessions.set(invocation.sessionId, {
						...current,
						readyExposed: true,
					});
				}
			}
		} catch (error) {
			release();
			throw error;
		}
		return release;
	}

	reserveSessionRegistration(sessionIdInput: string): () => void {
		const sessionId = requiredString(sessionIdInput, "managed session id");
		if (this.#disposed) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed runtime adapter is unavailable",
			);
		}
		this.#scope.signal.throwIfAborted();
		return this.#recoveryJournal.reserveSession(sessionId);
	}

	async registerSession(
		sessionIdInput: string,
		identity: HubAuthenticatedConnection,
		signal: AbortSignal,
		writerGeneration: number,
		capabilityManifestInput?: HubManagedRuntimeCapabilityManifest,
		admission?: {
			readonly operationId: string;
			readonly command: string;
		},
	): Promise<ManagedSessionAuthority | undefined> {
		const sessionId = requiredString(sessionIdInput, "managed session id");
		this.#assertScope(identity);
		const admissionOperationId = admission
			? requiredString(admission.operationId, "managed admission operation id")
			: undefined;
		const admissionCommand = admission
			? requiredString(admission.command, "managed admission command")
			: undefined;
		const capabilityManifest = normalizeHubManagedRuntimeCapabilityManifest(
			capabilityManifestInput,
		);
		if (!Number.isSafeInteger(writerGeneration) || writerGeneration < 1) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed writer generation is invalid",
			);
		}
		const owner = this.#managedSessions.get(sessionId);
		const exactUnexposedAdmissionReplay = Boolean(
			owner &&
				admissionOperationId &&
				owner.admissionOperationId === admissionOperationId &&
				owner.admissionCommand === admissionCommand &&
				!owner.readyExposed,
		);
		const coreAuthoritySignal =
			this.#core.managedSessionAuthoritySignal?.(sessionId);
		if (
			owner &&
			owner.writerGeneration !== writerGeneration &&
			!exactUnexposedAdmissionReplay
		) {
			throw new ChatCatalogError(
				"lease_conflict",
				"managed writer generation changed before registration",
			);
		}
		if (
			owner &&
			JSON.stringify(owner.capabilityManifest) !==
				JSON.stringify(capabilityManifest)
		) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed runtime capability authority changed before registration",
			);
		}
		if (
			owner?.authoritySignal &&
			coreAuthoritySignal &&
			owner.authoritySignal !== coreAuthoritySignal
		) {
			throw new ChatCatalogError(
				"lease_conflict",
				"managed writer authority signal changed before registration",
			);
		}
		const authoritySignal = owner?.authoritySignal ?? coreAuthoritySignal;
		if (authoritySignal?.aborted) {
			throw new ChatCatalogError(
				"lease_conflict",
				"managed writer authority was lost before registration",
			);
		}
		if (owner) {
			const liveOwner = owner.state === "owned" && !owner.signal?.aborted;
			if (liveOwner) {
				if (owner.connectionId !== identity.connectionId) {
					throw new ChatCatalogError(
						"lease_conflict",
						"managed session is owned by another connection",
					);
				}
				if (owner.writerGeneration !== writerGeneration) {
					const current =
						await this.#core.verifyManagedSessionAuthority(sessionId);
					if (current.writerGeneration !== owner.writerGeneration) {
						throw new ChatCatalogError(
							"lease_conflict",
							"managed admission replay no longer matches durable authority",
						);
					}
					return current;
				}
				return undefined;
			}
			if (!exactUnexposedAdmissionReplay || signal.aborted) {
				throw new ChatCatalogError(
					"lease_conflict",
					"managed session is not eligible for admission-only reclaim",
				);
			}
			const reclaimed = await this.transitionSessionOwner({
				operationId: createSessionId("runtime_admission_reclaim_"),
				sessionId,
				expectedWriterGeneration: owner.writerGeneration,
				identity,
				signal,
			});
			if (!reclaimed.ownerTransferred) {
				throw new ChatCatalogError(
					"lease_conflict",
					"admission-only reclaim did not transfer runtime ownership",
				);
			}
			return reclaimed;
		}
		if (!this.#sessionStreamIds.has(sessionId)) {
			const streamId = createSessionId("runtime_stream_");
			this.#recoveryJournal.registerSession(sessionId, streamId);
			this.#sessionStreamIds.set(sessionId, streamId);
			this.#sessionSequences.set(sessionId, 0);
		}
		let releaseAuthoritySignal: (() => void) | undefined;
		if (authoritySignal && !releaseAuthoritySignal) {
			const onAuthorityLost = () =>
				this.#handleManagedAuthorityLoss(sessionId, authoritySignal);
			authoritySignal.addEventListener("abort", onAuthorityLost, {
				once: true,
			});
			releaseAuthoritySignal = () =>
				authoritySignal.removeEventListener("abort", onAuthorityLost);
		}
		const authorityBinding = {
			...(authoritySignal ? { authoritySignal } : {}),
			...(releaseAuthoritySignal ? { releaseAuthoritySignal } : {}),
		};
		if (signal.aborted) {
			this.#managedSessions.set(sessionId, {
				state: "orphaned",
				writerGeneration,
				capabilityManifest,
				...authorityBinding,
				...(admissionOperationId ? { admissionOperationId } : {}),
				...(admissionCommand ? { admissionCommand } : {}),
				readyExposed: !admissionOperationId,
			});
			return undefined;
		}
		this.#managedSessions.set(sessionId, {
			state: "owned",
			connectionId: identity.connectionId,
			signal,
			writerGeneration,
			capabilityManifest,
			...authorityBinding,
			...(admissionOperationId ? { admissionOperationId } : {}),
			...(admissionCommand ? { admissionCommand } : {}),
			readyExposed: !admissionOperationId,
		});
		return undefined;
	}

	lookupSessionContinuity(input: {
		sessionId: string;
		identity: HubAuthenticatedConnection;
	}):
		| { readonly sessionId: string; readonly state: "not_resident" }
		| { readonly sessionId: string; readonly state: "owned_elsewhere" }
		| {
				readonly sessionId: string;
				readonly state: "orphaned";
				readonly writerGeneration: number;
				readonly runtimeBaseline: HubChatRuntimeCursor;
		  } {
		const sessionId = requiredString(input.sessionId, "managed session id");
		this.#assertScope(input.identity);
		this.#requireAudienceSession(sessionId);
		const owner = this.#managedSessions.get(sessionId);
		if (!owner || owner.authoritySignal?.aborted) {
			return Object.freeze({ sessionId, state: "not_resident" });
		}
		if (owner.state === "owned" && !owner.signal?.aborted) {
			return Object.freeze({ sessionId, state: "owned_elsewhere" });
		}
		return Object.freeze({
			sessionId,
			state: "orphaned",
			writerGeneration: owner.writerGeneration,
			runtimeBaseline: Object.freeze({
				...this.#recoveryJournal.cursor(sessionId),
			}),
		});
	}

	async hydrateSession(input: {
		sessionId: string;
		expectedWriterGeneration: number;
		baseline: HubChatRuntimeCursor;
		identity: HubAuthenticatedConnection;
	}): Promise<unknown> {
		const sessionId = requiredString(input.sessionId, "managed session id");
		this.#assertScope(input.identity);
		const projection = this.#requireAudienceSession(sessionId);
		const owner = this.#assertSessionOwner(sessionId, input.identity);
		if (
			!Number.isSafeInteger(input.expectedWriterGeneration) ||
			input.expectedWriterGeneration < 1 ||
			owner.writerGeneration !== input.expectedWriterGeneration
		) {
			throw new ChatCatalogError(
				"lease_conflict",
				"managed hydration writer generation is stale",
			);
		}
		if (
			this.#activeRuns.has(sessionId) ||
			this.#activeCompactions.has(sessionId)
		) {
			throw new ChatCatalogError(
				"lease_conflict",
				"managed hydration requires a quiescent resident session",
			);
		}
		const requestedBaseline = Object.freeze({ ...input.baseline });
		const [session, allMessages, allPrompts, usage, compaction] =
			await Promise.all([
				this.#core.get(sessionId),
				this.#core.readMessages(sessionId),
				this.#core.pendingPrompts.list({ sessionId }),
				this.#core.getAccumulatedUsage(sessionId),
				this.#core.readSessionCompactionState(sessionId),
			]);
		const current = this.#assertSessionOwner(sessionId, input.identity);
		if (
			current !== owner ||
			current.writerGeneration !== input.expectedWriterGeneration ||
			this.#activeRuns.has(sessionId) ||
			this.#activeCompactions.has(sessionId)
		) {
			throw new ChatCatalogError(
				"lease_conflict",
				"managed hydration authority changed during the snapshot",
			);
		}
		if (!session) {
			throw new ChatCatalogError(
				"session_not_found",
				"managed session target is unavailable",
			);
		}
		const persistedProfile = readManagedProfileAuthority(session.metadata);
		if (
			!persistedProfile ||
			persistedProfile.authorityClassId !== this.#scope.authorityClassId ||
			persistedProfile.policyEpoch !== this.#scope.policyEpoch
		) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed hydration profile authority is unavailable",
			);
		}
		let replayAvailable = true;
		try {
			this.#recoveryJournal.replay(sessionId, requestedBaseline);
		} catch (error) {
			if (!(error instanceof RuntimeRecoveryUnavailableError)) throw error;
			replayAvailable = false;
		}
		const runtimeBaseline = this.#recoveryJournal.cursor(sessionId);
		const messageStart = Math.max(0, allMessages.length - 32);
		const messages = allMessages
			.slice(messageStart)
			.map((message, index) =>
				sanitizeMessage(message, messageStart + index, 8 * 1024),
			);
		const pendingPrompts = allPrompts
			.slice(0, 20)
			.map((prompt) => sanitizePendingPrompt(prompt, 4 * 1024));
		const checkpointHistory = readSessionCheckpointHistory(session);
		const checkpoints = checkpointHistory.slice(-64).map((checkpoint) => ({
			createdAt: checkpoint.createdAt,
			runCount: checkpoint.runCount,
			...(checkpoint.kind ? { kind: checkpoint.kind } : {}),
		}));
		return freezeRuntimeValue({
			sessionId,
			chatId: projection.chatId,
			writerGeneration: current.writerGeneration,
			profileAuthority: {
				profileId: persistedProfile.profileId,
				profileRevision: persistedProfile.profileRevision,
				authorityClassId: persistedProfile.authorityClassId,
				policyEpoch: persistedProfile.policyEpoch,
				allowedModes: [...persistedProfile.allowedModes],
			},
			requestedBaseline,
			runtimeBaseline,
			replayAvailable,
			messages,
			messagesTruncated: allMessages.length > messages.length,
			pendingPrompts,
			pendingPromptsTruncated: allPrompts.length > pendingPrompts.length,
			checkpoints,
			checkpointsTruncated: checkpointHistory.length > checkpoints.length,
			...(usage?.usage ? { usage: safeUsage(usage.usage) } : {}),
			...(usage?.aggregateUsage
				? { aggregateUsage: safeUsage(usage.aggregateUsage) }
				: {}),
			compaction: sanitizeCompactionState(compaction),
		});
	}

	async transitionSessionOwner(input: {
		operationId: string;
		sessionId: string;
		expectedWriterGeneration: number;
		identity: HubAuthenticatedConnection;
		signal: AbortSignal;
	}): Promise<ManagedSessionReclaimResult> {
		const operationId = requiredString(
			input.operationId,
			"owner transition id",
		);
		const sessionId = requiredString(input.sessionId, "managed session id");
		this.#assertScope(input.identity);
		input.signal.throwIfAborted();
		if (
			!Number.isSafeInteger(input.expectedWriterGeneration) ||
			input.expectedWriterGeneration < 1
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed writer generation is invalid",
			);
		}
		const receiptKey = `${sessionId}\0${operationId}`;
		const inFlight = this.#ownerTransitions.get(sessionId);
		if (inFlight) {
			if (
				inFlight.operationId !== operationId ||
				inFlight.expectedWriterGeneration !== input.expectedWriterGeneration ||
				inFlight.targetConnectionId !== input.identity.connectionId
			) {
				throw new ChatCatalogError(
					"lease_conflict",
					"another managed owner transition is active",
				);
			}
			return await inFlight.promise;
		}
		const receipt = this.#ownerTransitionReceipts.get(receiptKey);
		if (receipt) {
			if (receipt.expectedWriterGeneration !== input.expectedWriterGeneration) {
				throw new ChatCatalogError(
					"invocation_replay_conflict",
					"owner transition operation was reused with changed intent",
				);
			}
			const replayOwner = this.#managedSessions.get(sessionId);
			if (
				replayOwner?.writerGeneration !== receipt.authority.writerGeneration
			) {
				throw new ChatCatalogError(
					"invocation_replay_conflict",
					"owner transition receipt no longer matches current authority",
				);
			}
			if (
				receipt.targetConnectionId === input.identity.connectionId &&
				replayOwner.state === "owned" &&
				replayOwner.connectionId === input.identity.connectionId &&
				!replayOwner.signal?.aborted
			) {
				return { ...receipt.authority, ownerTransferred: true };
			}
			if (replayOwner.state === "orphaned") {
				return { ...receipt.authority, ownerTransferred: false };
			}
			throw new ChatCatalogError(
				"invocation_replay_conflict",
				"owner transition receipt belongs to another active connection",
			);
		}
		const owner = this.#managedSessions.get(sessionId);
		if (!owner) {
			throw new ChatCatalogError(
				"session_not_found",
				"owner transition requires a resident managed session",
			);
		}
		if (owner.writerGeneration !== input.expectedWriterGeneration) {
			throw new ChatCatalogError(
				"lease_conflict",
				"managed writer generation changed before owner transition",
			);
		}
		if (owner.state === "owned" && !owner.signal?.aborted) {
			throw new ChatCatalogError(
				"lease_conflict",
				"managed session owner is still connected",
			);
		}
		const active = this.#activeRuns.get(sessionId);
		if (active) {
			await this.#abortActiveRun(
				sessionId,
				active,
				"managed owner disconnected before reconnect",
			);
			throw new ChatCatalogError(
				"lease_conflict",
				"managed reconnect must retry after the orphaned run settles",
			);
		}
		const compaction = this.#activeCompactions.get(sessionId);
		if (compaction) {
			compaction.controller.abort(
				new Error("managed owner disconnected during manual compaction"),
			);
			await compaction.promise.catch(() => undefined);
			throw new ChatCatalogError(
				"lease_conflict",
				"managed reconnect must retry after manual compaction settles",
			);
		}
		this.#cancelApprovals(
			(pending) => pending.sessionId === sessionId,
			"managed connection changed before approval completed",
		);
		this.#cancelCapabilities(
			(pending) => pending.sessionId === sessionId,
			"managed connection changed before capability completed",
		);
		const rekeyManagedSessionAuthority =
			this.#core.rekeyManagedSessionAuthority;
		if (!rekeyManagedSessionAuthority) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed resident reconnect is unavailable",
			);
		}

		let rekeyed: ManagedSessionAuthority | undefined;
		let transitionRecord!: ManagedSessionOwnerTransition;
		const transitionController = new AbortController();
		const transitionSignal = AbortSignal.any([
			input.signal,
			transitionController.signal,
		]);
		const reclaimIntent = Object.freeze({
			operationId,
			expectedWriterGeneration: input.expectedWriterGeneration,
			targetConnectionId: input.identity.connectionId,
		});
		const transitionPromise = (async () => {
			transitionSignal.throwIfAborted();
			rekeyed = await rekeyManagedSessionAuthority.call(this.#core, {
				operationId,
				sessionId,
				expectedWriterGeneration: input.expectedWriterGeneration,
				signal: transitionSignal,
			});
			if (
				rekeyed.sessionId !== sessionId ||
				rekeyed.writerGeneration !== input.expectedWriterGeneration + 1
			) {
				throw new ChatCatalogError(
					"lease_conflict",
					"durable rekey returned an invalid owner generation",
				);
			}
			this.#ownerTransitionReceipts.set(receiptKey, {
				operationId,
				expectedWriterGeneration: input.expectedWriterGeneration,
				targetConnectionId: input.identity.connectionId,
				authority: rekeyed,
			});
			while (
				this.#ownerTransitionReceipts.size > this.#ownerTransitionReceiptLimit
			) {
				const oldest = this.#ownerTransitionReceipts.keys().next().value;
				if (oldest === undefined) break;
				this.#ownerTransitionReceipts.delete(oldest);
			}
			if (
				this.#ownerTransitions.get(sessionId) !== transitionRecord ||
				this.#managedSessions.get(sessionId) !== owner ||
				transitionRecord.cancellationRequested ||
				input.signal.aborted
			) {
				this.#managedSessions.set(
					sessionId,
					orphanManagedSessionOwner(
						owner,
						rekeyed.writerGeneration,
						reclaimIntent,
					),
				);
				throw new ChatCatalogError(
					"lease_conflict",
					"incoming connection was lost during owner transition",
				);
			}
			const nextOwner: ManagedSessionOwner = {
				state: "owned",
				connectionId: input.identity.connectionId,
				signal: input.signal,
				writerGeneration: rekeyed.writerGeneration,
				capabilityManifest: owner.capabilityManifest,
				reclaimIntent,
				...(owner.admissionOperationId
					? { admissionOperationId: owner.admissionOperationId }
					: {}),
				...(owner.admissionCommand
					? { admissionCommand: owner.admissionCommand }
					: {}),
				readyExposed: false,
				...(owner.authoritySignal
					? { authoritySignal: owner.authoritySignal }
					: {}),
				...(owner.releaseAuthoritySignal
					? { releaseAuthoritySignal: owner.releaseAuthoritySignal }
					: {}),
			};
			this.#managedSessions.set(sessionId, nextOwner);
			input.signal.addEventListener(
				"abort",
				() => {
					if (this.#managedSessions.get(sessionId) === nextOwner) {
						this.#managedSessions.set(
							sessionId,
							orphanManagedSessionOwner(nextOwner),
						);
					}
				},
				{ once: true },
			);
			return { ...rekeyed, ownerTransferred: true };
		})()
			.catch((error) => {
				if (rekeyed) {
					this.#managedSessions.set(
						sessionId,
						orphanManagedSessionOwner(
							owner,
							rekeyed.writerGeneration,
							reclaimIntent,
						),
					);
				}
				throw error;
			})
			.finally(() => {
				if (this.#ownerTransitions.get(sessionId) === transitionRecord) {
					this.#ownerTransitions.delete(sessionId);
				}
			});
		transitionRecord = {
			operationId,
			expectedWriterGeneration: input.expectedWriterGeneration,
			targetConnectionId: input.identity.connectionId,
			promise: transitionPromise,
			controller: transitionController,
			cancellationRequested: false,
		};
		this.#ownerTransitions.set(sessionId, transitionRecord);
		return await transitionPromise;
	}

	cancelSessionOwnerTransition(input: {
		operationId: string;
		sessionId: string;
		expectedWriterGeneration: number;
		identity: HubAuthenticatedConnection;
		signal: AbortSignal;
	}): ManagedSessionReclaimCancellationResult {
		const operationId = requiredString(
			input.operationId,
			"owner transition id",
		);
		const sessionId = requiredString(input.sessionId, "managed session id");
		this.#assertScope(input.identity);
		input.signal.throwIfAborted();
		if (
			!Number.isSafeInteger(input.expectedWriterGeneration) ||
			input.expectedWriterGeneration < 1
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"managed writer generation is invalid",
			);
		}
		const owner = this.#managedSessions.get(sessionId);
		if (!owner) {
			throw new ChatCatalogError(
				"session_not_found",
				"owner transition cancellation requires a resident managed session",
			);
		}
		const inFlight = this.#ownerTransitions.get(sessionId);
		if (inFlight) {
			if (
				inFlight.operationId !== operationId ||
				inFlight.expectedWriterGeneration !== input.expectedWriterGeneration ||
				inFlight.targetConnectionId !== input.identity.connectionId
			) {
				throw new ChatCatalogError(
					"lease_conflict",
					"owner transition cancellation does not match the active transition",
				);
			}
			inFlight.cancellationRequested = true;
			inFlight.controller.abort(
				new Error("managed owner transition was cancelled"),
			);
			return {
				operationId,
				sessionId,
				writerGeneration: owner.writerGeneration,
				cancellationAccepted: true,
			};
		}

		const receipt = this.#ownerTransitionReceipts.get(
			`${sessionId}\0${operationId}`,
		);
		if (receipt) {
			if (
				receipt.expectedWriterGeneration !== input.expectedWriterGeneration ||
				receipt.targetConnectionId !== input.identity.connectionId
			) {
				throw new ChatCatalogError(
					"invocation_replay_conflict",
					"owner transition cancellation changed committed intent",
				);
			}
			const current = this.#managedSessions.get(sessionId);
			if (
				!current ||
				current.writerGeneration !== receipt.authority.writerGeneration
			) {
				throw new ChatCatalogError(
					"invocation_replay_conflict",
					"owner transition cancellation no longer matches current authority",
				);
			}
			if (
				current.state === "owned" &&
				current.connectionId !== input.identity.connectionId
			) {
				throw new ChatCatalogError(
					"invocation_replay_conflict",
					"owner transition cancellation belongs to another active connection",
				);
			}
			if (current.state === "owned") {
				this.#managedSessions.set(
					sessionId,
					orphanManagedSessionOwner(current),
				);
			}
			return {
				operationId,
				sessionId,
				writerGeneration: receipt.authority.writerGeneration,
				cancellationAccepted: true,
			};
		}

		const retainedIntent = owner.reclaimIntent;
		if (retainedIntent?.operationId === operationId) {
			if (
				retainedIntent.expectedWriterGeneration !==
					input.expectedWriterGeneration ||
				retainedIntent.targetConnectionId !== input.identity.connectionId
			) {
				throw new ChatCatalogError(
					"invocation_replay_conflict",
					"owner transition cancellation changed retained owner intent",
				);
			}
			if (
				owner.state === "owned" &&
				owner.connectionId !== input.identity.connectionId
			) {
				throw new ChatCatalogError(
					"invocation_replay_conflict",
					"owner transition cancellation belongs to another active connection",
				);
			}
			if (owner.state === "owned") {
				this.#managedSessions.set(sessionId, orphanManagedSessionOwner(owner));
			}
			return {
				operationId,
				sessionId,
				writerGeneration: owner.writerGeneration,
				cancellationAccepted: true,
			};
		}

		return {
			operationId,
			sessionId,
			writerGeneration: owner.writerGeneration,
			cancellationAccepted: false,
		};
	}

	assertSessionOwner(
		sessionIdInput: string,
		identity: HubAuthenticatedConnection,
	): void {
		this.#assertSessionOwner(
			requiredString(sessionIdInput, "managed session id"),
			identity,
		);
	}

	assertSessionOwnerIfRegistered(
		sessionIdInput: string,
		identity: HubAuthenticatedConnection,
		admission?: {
			readonly operationId: string;
			readonly command: string;
		},
	): void {
		const sessionId = requiredString(sessionIdInput, "managed session id");
		const owner = this.#managedSessions.get(sessionId);
		if (!owner) return;
		this.#assertScope(identity);
		const liveOwner = owner.state === "owned" && !owner.signal?.aborted;
		if (
			admission &&
			!liveOwner &&
			!owner.readyExposed &&
			owner.admissionOperationId ===
				requiredString(
					admission.operationId,
					"managed admission operation id",
				) &&
			owner.admissionCommand ===
				requiredString(admission.command, "managed admission command")
		) {
			return;
		}
		this.#assertSessionOwner(sessionId, identity);
	}

	async prepareSessionStop(
		sessionIdInput: string,
		identity: HubAuthenticatedConnection,
	): Promise<void> {
		const sessionId = requiredString(sessionIdInput, "managed session id");
		this.#assertSessionOwner(sessionId, identity);
		const active = this.#activeRuns.get(sessionId);
		if (active) {
			if (active.connectionId !== identity.connectionId) {
				throw new ChatCatalogError(
					"unsupported_capability",
					"managed run belongs to another connection",
				);
			}
			await this.#abortActiveRun(
				sessionId,
				active,
				"managed session is stopping",
			);
		}
		this.#cancelApprovals(
			(pending) => pending.sessionId === sessionId,
			"managed session is stopping",
		);
		this.#cancelCapabilities(
			(pending) => pending.sessionId === sessionId,
			"managed session is stopping",
		);
	}

	unregisterSession(sessionIdInput: string): void {
		const sessionId = requiredString(sessionIdInput, "managed session id");
		const owner = this.#managedSessions.get(sessionId);
		this.#cancelApprovals(
			(pending) => pending.sessionId === sessionId,
			"managed session stopped",
		);
		this.#cancelCapabilities(
			(pending) => pending.sessionId === sessionId,
			"managed session stopped",
		);
		this.#managedSessions.delete(sessionId);
		this.#sessionSequences.delete(sessionId);
		this.#sessionStreamIds.delete(sessionId);
		this.#recoveryJournal.clearSession(sessionId);
		owner?.releaseAuthoritySignal?.();
		this.#ownerTransitions.delete(sessionId);
		for (const key of this.#ownerTransitionReceipts.keys()) {
			if (key.startsWith(`${sessionId}\0`)) {
				this.#ownerTransitionReceipts.delete(key);
			}
		}
		const active = this.#activeRuns.get(sessionId);
		if (active?.heartbeat) clearInterval(active.heartbeat);
		this.#activeRuns.delete(sessionId);
		this.#activeCompactions
			.get(sessionId)
			?.controller.abort(new Error("managed session stopped"));
		this.#activeCompactions.delete(sessionId);
		for (const key of this.#compactionReceipts.keys()) {
			if (key.startsWith(`${sessionId}\0`)) {
				this.#compactionReceipts.delete(key);
			}
		}
	}

	async runTurn<T extends AgentResult | undefined>(input: {
		operationId: string;
		sessionId: string;
		identity: HubAuthenticatedConnection;
		signal: AbortSignal;
		run: () => Promise<T>;
	}): Promise<T> {
		const runId = requiredString(input.operationId, "run operation id");
		const sessionId = requiredString(input.sessionId, "session id");
		const owner = this.#assertSessionOwner(sessionId, input.identity);
		if (!owner.readyExposed) {
			throw new ChatCatalogError(
				"lease_conflict",
				"managed session is not ready for a turn",
			);
		}
		if (this.#activeCompactions.has(sessionId)) {
			throw new ChatCatalogError(
				"lease_conflict",
				"managed session is running manual compaction",
			);
		}
		if (this.#activeRuns.has(sessionId)) {
			throw new ChatCatalogError(
				"lease_conflict",
				"managed session already has an active run",
			);
		}
		this.#assertScope(input.identity);
		const active: ActiveRun = {
			runId,
			operationId: runId,
			connectionId: input.identity.connectionId,
			signal: input.signal,
			startedAt: Date.now(),
			state: "running" as const,
		};
		this.#activeRuns.set(sessionId, active);
		const abortForConnection = () => {
			void this.#abortActiveRun(
				sessionId,
				active,
				"managed connection disconnected or was revoked",
			).catch(() => undefined);
		};
		input.signal.addEventListener("abort", abortForConnection, {
			once: true,
		});
		this.#emit(sessionId, {
			kind: "run.started",
			operationId: runId,
			runId,
		});
		active.heartbeat = setInterval(() => {
			if (
				this.#activeRuns.get(sessionId) !== active ||
				active.state !== "running" ||
				active.signal.aborted
			) {
				return;
			}
			this.#emit(sessionId, {
				kind: "run.heartbeat",
				runId,
				elapsedMs: Date.now() - active.startedAt,
			});
		}, RUN_HEARTBEAT_INTERVAL_MS);
		(active.heartbeat as { unref?: () => void }).unref?.();
		try {
			const result = await this.#invocations.run(
				{
					identity: input.identity,
					signal: input.signal,
					sessionId,
					runId,
				},
				input.run,
			);
			if (active.state === "aborting" || result?.finishReason === "aborted") {
				this.#emit(sessionId, { kind: "run.aborted", runId });
			} else if (result?.finishReason === "error") {
				this.#emit(sessionId, {
					kind: "run.failed",
					runId,
					error: SAFE_RUN_FAILURE,
				});
			} else {
				this.#emit(sessionId, {
					kind: "run.completed",
					runId,
					...(result?.finishReason
						? { finishReason: boundedText(result.finishReason, 256) }
						: {}),
				});
			}
			return result;
		} catch (error) {
			this.#emit(
				sessionId,
				active.state === "aborting"
					? { kind: "run.aborted", runId }
					: { kind: "run.failed", runId, error: SAFE_RUN_FAILURE },
			);
			throw error;
		} finally {
			input.signal.removeEventListener("abort", abortForConnection);
			if (active.heartbeat) clearInterval(active.heartbeat);
			this.#cancelApprovals(
				(pending) => pending.sessionId === sessionId && pending.runId === runId,
				"managed run ended before approval completed",
			);
			this.#cancelCapabilities(
				(pending) => pending.sessionId === sessionId && pending.runId === runId,
				"managed run ended before capability completed",
			);
			if (this.#activeRuns.get(sessionId) === active) {
				this.#activeRuns.delete(sessionId);
			}
		}
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		try {
			this.#unsubscribeCore();
		} finally {
			for (const listener of [...this.#listeners]) listener.release();
			for (const active of this.#activeRuns.values()) {
				if (active.heartbeat) clearInterval(active.heartbeat);
			}
			this.#activeRuns.clear();
			for (const compaction of this.#activeCompactions.values()) {
				compaction.controller.abort(new Error("managed runtime was disposed"));
			}
			this.#activeCompactions.clear();
			this.#compactionReceipts.clear();
			for (const owner of this.#managedSessions.values()) {
				owner.releaseAuthoritySignal?.();
			}
			this.#managedSessions.clear();
			this.#ownerTransitions.clear();
			this.#ownerTransitionReceipts.clear();
			this.#cancelApprovals(() => true, "managed runtime was disposed");
			this.#cancelCapabilities(() => true, "managed runtime was disposed");
			this.#recoveryJournal.clear();
			this.#sessionSequences.clear();
			this.#sessionStreamIds.clear();
		}
	}

	async #dispatch(
		command: HubChatRuntimeCommandName,
		payload: Record<string, unknown>,
		identity: HubAuthenticatedConnection,
		signal: AbortSignal,
	): Promise<unknown> {
		const sessionId = requiredString(payload.sessionId, "session id");
		if (command === "chat_runtime.session.continuity") {
			return this.lookupSessionContinuity({ sessionId, identity });
		}
		if (command === "chat_runtime.session.hydrate") {
			return await this.hydrateSession({
				sessionId,
				expectedWriterGeneration:
					typeof payload.expectedWriterGeneration === "number"
						? payload.expectedWriterGeneration
						: 0,
				baseline: payload.baseline as HubChatRuntimeCursor,
				identity,
			});
		}
		if (command === "chat_runtime.session.reclaim") {
			return await this.transitionSessionOwner({
				operationId: requiredString(payload.operationId, "operation id"),
				sessionId,
				expectedWriterGeneration:
					typeof payload.expectedWriterGeneration === "number"
						? payload.expectedWriterGeneration
						: 0,
				identity,
				signal,
			});
		}
		if (command === "chat_runtime.session.reclaim.cancel") {
			return this.cancelSessionOwnerTransition({
				operationId: requiredString(payload.operationId, "operation id"),
				sessionId,
				expectedWriterGeneration:
					typeof payload.expectedWriterGeneration === "number"
						? payload.expectedWriterGeneration
						: 0,
				identity,
				signal,
			});
		}
		const owner = this.#assertSessionOwner(sessionId, identity);
		if (!owner.readyExposed) {
			throw new ChatCatalogError(
				"lease_conflict",
				"managed session is not ready for runtime operations",
			);
		}
		switch (command) {
			case "chat_runtime.abort": {
				const operationId = requiredString(payload.operationId, "operation id");
				const runId = requiredString(payload.runId, "run id");
				const active = this.#activeRuns.get(sessionId);
				if (!active || active.runId !== runId) {
					throw new ChatCatalogError(
						"invalid_input",
						"managed abort does not match the active run",
					);
				}
				if (active.connectionId !== identity.connectionId) {
					throw new ChatCatalogError(
						"unsupported_capability",
						"managed abort belongs to another connection",
					);
				}
				await this.#abortActiveRun(
					sessionId,
					active,
					boundedText(payload.reason, 2048) || "managed runtime abort",
				);
				return { operationId, sessionId, runId, accepted: true };
			}
			case "chat_runtime.pending_prompts.list": {
				const prompts = await this.#core.pendingPrompts.list({ sessionId });
				return {
					sessionId,
					...sanitizePendingPromptPage(prompts, {
						cursor: payload.cursor,
						limit: payload.limit,
					}),
				};
			}
			case "chat_runtime.pending_prompts.update": {
				const result = await this.#core.pendingPrompts.update({
					sessionId,
					promptId: requiredString(payload.promptId, "prompt id"),
					...(typeof payload.prompt === "string"
						? { prompt: payload.prompt }
						: {}),
					...(payload.mode === "act" ||
					payload.mode === "plan" ||
					payload.mode === "yolo"
						? { mode: payload.mode }
						: {}),
					...(payload.delivery === "queue" || payload.delivery === "steer"
						? { delivery: payload.delivery }
						: {}),
				});
				const page = sanitizePendingPromptPage(result.prompts);
				return {
					sessionId,
					...page,
					...(result.prompt
						? { prompt: sanitizePendingPrompt(result.prompt) }
						: {}),
					...(result.updated === undefined ? {} : { updated: result.updated }),
				};
			}
			case "chat_runtime.pending_prompts.remove": {
				const result = await this.#core.pendingPrompts.delete({
					sessionId,
					promptId: requiredString(payload.promptId, "prompt id"),
				});
				const page = sanitizePendingPromptPage(result.prompts);
				return {
					sessionId,
					...page,
					...(result.removed === undefined ? {} : { removed: result.removed }),
				};
			}
			case "chat_runtime.messages.list": {
				const messages = await this.#core.readMessages(sessionId);
				const limit =
					typeof payload.limit === "number" ? Math.min(payload.limit, 200) : 50;
				const offset =
					typeof payload.cursor === "string" &&
					/^offset-\d+$/.test(payload.cursor)
						? Number(payload.cursor.slice("offset-".length))
						: 0;
				const page: unknown[] = [];
				let pageBytes = 0;
				let nextOffset = offset;
				while (nextOffset < messages.length && page.length < limit) {
					const message = messages[nextOffset];
					if (!message) break;
					const projected = sanitizeMessage(message, nextOffset);
					const projectedBytes = new TextEncoder().encode(
						JSON.stringify(projected),
					).byteLength;
					if (page.length > 0 && pageBytes + projectedBytes > 640 * 1024) {
						break;
					}
					page.push(projected);
					pageBytes += projectedBytes;
					nextOffset += 1;
				}
				return {
					sessionId,
					messages: page,
					...(nextOffset < messages.length
						? { nextCursor: `offset-${nextOffset}` }
						: {}),
					hasMore: nextOffset < messages.length,
				};
			}
			case "chat_runtime.checkpoints.list": {
				const session = await this.#core.get(sessionId);
				if (!session) {
					throw new ChatCatalogError(
						"session_not_found",
						"managed session not found",
					);
				}
				const limit =
					typeof payload.limit === "number"
						? Math.min(payload.limit, 200)
						: 200;
				return {
					sessionId,
					checkpoints: readSessionCheckpointHistory(session)
						.slice(-limit)
						.map((checkpoint) => ({
							createdAt: checkpoint.createdAt,
							runCount: checkpoint.runCount,
							...(checkpoint.kind ? { kind: checkpoint.kind } : {}),
						})),
				};
			}
			case "chat_runtime.usage.get": {
				const usage = await this.#core.getAccumulatedUsage(sessionId);
				return {
					sessionId,
					...(usage?.usage ? { usage: safeUsage(usage.usage) } : {}),
					...(usage?.aggregateUsage
						? { aggregateUsage: safeUsage(usage.aggregateUsage) }
						: {}),
				};
			}
			case "chat_runtime.compaction.get": {
				const state = await this.#core.readSessionCompactionState(sessionId);
				return { sessionId, state: sanitizeCompactionState(state) };
			}
			case "chat_runtime.approval.respond": {
				const operationId = requiredString(payload.operationId, "operation id");
				const runId = requiredString(payload.runId, "run id");
				const approvalId = requiredString(payload.approvalId, "approval id");
				const pending = this.#pendingApprovals.get(approvalId);
				if (
					!pending ||
					pending.sessionId !== sessionId ||
					pending.runId !== runId ||
					pending.connectionId !== identity.connectionId
				) {
					throw new ChatCatalogError(
						"invalid_input",
						"managed approval is unknown or belongs to another run",
					);
				}
				this.#pendingApprovals.delete(approvalId);
				clearTimeout(pending.timeout);
				const decision = payload.decision === "approve" ? "approve" : "deny";
				const reason = boundedText(payload.reason, 2048) || undefined;
				pending.resolve({
					approved: decision === "approve",
					...(reason ? { reason } : {}),
				});
				this.#emit(
					sessionId,
					{
						kind: "approval.resolved",
						approvalId,
						decision,
						...(reason ? { reason } : {}),
					},
					pending.connectionId,
				);
				return { sessionId, operationId, runId, approvalId, decision };
			}
			case "chat_runtime.compaction.run":
				return await this.#runManualCompaction(
					sessionId,
					payload,
					identity,
					owner,
				);
			case "chat_runtime.capability.respond": {
				const operationId = requiredString(payload.operationId, "operation id");
				const runId = requiredString(payload.runId, "run id");
				const requestId = requiredString(payload.requestId, "request id");
				const capability = requiredString(
					payload.capability,
					"capability name",
				);
				const pending = this.#pendingCapabilities.get(requestId);
				if (
					pending?.state !== "pending" ||
					pending.sessionId !== sessionId ||
					pending.runId !== runId ||
					pending.connectionId !== identity.connectionId ||
					pending.capability !== capability
				) {
					throw new ChatCatalogError(
						"invalid_input",
						"managed capability is unknown or belongs to another run",
					);
				}
				if (Date.now() >= Date.parse(pending.expiresAt)) {
					this.#cancelCapability(pending, "managed capability timed out");
					throw new ChatCatalogError(
						"invalid_input",
						"managed capability is unknown or expired",
					);
				}
				const result =
					typeof payload.error === "string"
						? undefined
						: parseHubManagedRuntimeCapabilityResult(
								pending.capability,
								payload.result,
							);
				this.#pendingCapabilities.delete(requestId);
				pending.state = "resolved";
				clearTimeout(pending.timeout);
				if (typeof payload.error === "string") {
					pending.reject(new Error(SAFE_CAPABILITY_FAILURE));
				} else {
					pending.resolve(result as string);
				}
				return {
					sessionId,
					operationId,
					runId,
					requestId,
					accepted: true,
				};
			}
		}
	}

	async #runManualCompaction(
		sessionId: string,
		payload: Record<string, unknown>,
		identity: HubAuthenticatedConnection,
		owner: ManagedSessionOwner,
	): Promise<{
		operationId: string;
		sessionId: string;
		outcome: "completed" | "skipped";
		state?: {
			version: number;
			updatedAt?: string;
			sourceMessageCount: number;
			compactedMessageCount: number;
			conversationId?: string;
		};
	}> {
		const operationId = requiredString(payload.operationId, "operation id");
		const reason = boundedText(payload.reason, 2048) || undefined;
		const receiptKey = `${sessionId}\0${operationId}`;
		const replay = this.#compactionReceipts.get(receiptKey);
		if (replay) {
			if (replay.reason !== reason) {
				throw new ChatCatalogError(
					"invocation_replay_conflict",
					"manual compaction operation was reused with changed intent",
				);
			}
			return await replay.promise;
		}
		if (this.#activeRuns.has(sessionId)) {
			throw new ChatCatalogError(
				"lease_conflict",
				"manual compaction requires an idle managed session",
			);
		}
		const active = this.#activeCompactions.get(sessionId);
		if (active) {
			throw new ChatCatalogError(
				"lease_conflict",
				"another manual compaction is already active",
			);
		}
		const runSessionManualCompaction = this.#core.runSessionManualCompaction;
		if (!runSessionManualCompaction) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"manual compaction is unavailable on this runtime",
			);
		}
		const ownerSignal = owner.signal;
		if (!ownerSignal || ownerSignal.aborted) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed session has no live connection owner",
			);
		}
		const controller = new AbortController();
		const abortForOwner = () => controller.abort(ownerSignal.reason);
		const abortForScope = () => controller.abort(this.#scope.signal.reason);
		ownerSignal.addEventListener("abort", abortForOwner, { once: true });
		this.#scope.signal.addEventListener("abort", abortForScope, { once: true });
		let record!: ManagedCompactionRecord;
		const promise = (async () => {
			let started = false;
			let failedDurably = false;
			try {
				const result = await runSessionManualCompaction.call(this.#core, {
					operationId,
					sessionId,
					...(reason ? { reason } : {}),
					signal: controller.signal,
					onStarted: () => {
						if (started) return;
						started = true;
						this.#emit(
							sessionId,
							{ kind: "compaction.started", operationId },
							identity.connectionId,
						);
					},
					onFailed: () => {
						failedDurably = true;
					},
				});
				if (result.outcome === "compacted") {
					const state = sanitizeCompactionState(result.state);
					if (!state) {
						throw new Error(
							"manual compaction completed without durable state",
						);
					}
					if (started) {
						this.#emit(
							sessionId,
							{ kind: "compaction.completed", operationId, state },
							identity.connectionId,
						);
					}
					return {
						operationId,
						sessionId,
						outcome: "completed" as const,
						state,
					};
				} else {
					if (started) {
						this.#emit(
							sessionId,
							{
								kind: "compaction.skipped",
								operationId,
								reason: SAFE_COMPACTION_SKIPPED,
							},
							identity.connectionId,
						);
					}
					return {
						operationId,
						sessionId,
						outcome: "skipped" as const,
					};
				}
			} catch (error) {
				if (started && failedDurably) {
					this.#emit(
						sessionId,
						{
							kind: "compaction.failed",
							operationId,
							error: SAFE_COMPACTION_FAILURE,
						},
						identity.connectionId,
					);
				}
				if (error instanceof SessionManualCompactionOperationConflictError) {
					throw new ChatCatalogError(
						"invocation_replay_conflict",
						"manual compaction operation was reused with changed intent",
					);
				}
				throw error;
			} finally {
				ownerSignal.removeEventListener("abort", abortForOwner);
				this.#scope.signal.removeEventListener("abort", abortForScope);
				if (this.#activeCompactions.get(sessionId) === record) {
					this.#activeCompactions.delete(sessionId);
				}
				if (this.#compactionReceipts.get(receiptKey) === record) {
					this.#compactionReceipts.delete(receiptKey);
				}
			}
		})();
		record = {
			operationId,
			sessionId,
			reason,
			connectionId: identity.connectionId,
			controller,
			promise,
		};
		this.#activeCompactions.set(sessionId, record);
		this.#compactionReceipts.set(receiptKey, record);
		return await promise;
	}

	#requestToolApproval(
		request: ToolApprovalRequest,
	): Promise<ToolApprovalResult> {
		if (this.#disposed || this.#scope.signal.aborted) {
			return Promise.resolve({
				approved: false,
				reason: "managed runtime is unavailable",
			});
		}
		const sessionId = requiredString(request.sessionId, "approval session id");
		const context = this.#invocations.getStore();
		const active = this.#activeRuns.get(sessionId);
		if (
			active?.state !== "running" ||
			active.signal.aborted ||
			!context ||
			context.sessionId !== sessionId ||
			context.runId !== active.runId ||
			context.identity.connectionId !== active.connectionId
		) {
			return Promise.resolve({
				approved: false,
				reason: "approval request has no active managed run",
			});
		}
		const approvalId = createSessionId("approval_");
		const expiresAt = new Date(Date.now() + APPROVAL_TIMEOUT_MS).toISOString();
		return new Promise<ToolApprovalResult>((resolve) => {
			const timeout = setTimeout(() => {
				const pending = this.#pendingApprovals.get(approvalId);
				if (!pending) return;
				this.#pendingApprovals.delete(approvalId);
				resolve({ approved: false, reason: "managed approval timed out" });
				this.#emit(
					sessionId,
					{
						kind: "approval.resolved",
						approvalId,
						decision: "deny",
						reason: "managed approval timed out",
					},
					active.connectionId,
				);
			}, APPROVAL_TIMEOUT_MS);
			(timeout as { unref?: () => void }).unref?.();
			this.#pendingApprovals.set(approvalId, {
				approvalId,
				sessionId,
				runId: active.runId,
				connectionId: active.connectionId,
				resolve,
				timeout,
			});
			this.#emit(
				sessionId,
				{
					kind: "approval.requested",
					runId: active.runId,
					approvalId,
					toolCallId: boundedText(request.toolCallId, 512) || "tool-call",
					toolName: boundedText(request.toolName, 256) || "tool",
					policy: "manual",
					summary: `Approval required for ${boundedText(request.toolName, 256) || "tool"}`,
					expiresAt,
				},
				active.connectionId,
			);
		});
	}

	#cancelApprovals(
		filter: (pending: PendingApproval) => boolean,
		reason: string,
	): void {
		for (const [approvalId, pending] of this.#pendingApprovals) {
			if (!filter(pending)) continue;
			this.#pendingApprovals.delete(approvalId);
			clearTimeout(pending.timeout);
			pending.resolve({ approved: false, reason });
			this.#emit(
				pending.sessionId,
				{
					kind: "approval.resolved",
					approvalId,
					decision: "deny",
					reason,
				},
				pending.connectionId,
			);
		}
	}

	async #requestAskQuestion(
		question: string,
		options: string[],
		toolContext: AgentToolContext,
	): Promise<string> {
		if (this.#disposed || this.#scope.signal.aborted) {
			throw new Error(SAFE_CAPABILITY_FAILURE);
		}
		const sessionId = requiredString(
			toolContext.sessionId,
			"capability session id",
		);
		const context = this.#invocations.getStore();
		const active = this.#activeRuns.get(sessionId);
		const owner = this.#managedSessions.get(sessionId);
		if (
			active?.state !== "running" ||
			active.signal.aborted ||
			!context ||
			context.sessionId !== sessionId ||
			context.runId !== active.runId ||
			context.identity.connectionId !== active.connectionId ||
			(toolContext.runId !== undefined && toolContext.runId !== active.runId) ||
			owner?.state !== "owned" ||
			owner.connectionId !== active.connectionId ||
			!owner.signal ||
			owner.signal.aborted ||
			owner.authoritySignal?.aborted ||
			!owner.capabilityManifest.callbacks.includes(
				HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
			)
		) {
			throw new Error(SAFE_CAPABILITY_FAILURE);
		}
		if (this.#pendingCapabilities.size >= MAX_PENDING_CAPABILITIES) {
			throw new Error(SAFE_CAPABILITY_FAILURE);
		}
		const request = parseHubManagedRuntimeCapabilityRequest(
			HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
			{ question, options },
		);
		let requestId = "";
		for (let attempt = 0; attempt < 32; attempt += 1) {
			const candidate = createSessionId("runtime_capability_");
			if (!this.#pendingCapabilities.has(candidate)) {
				requestId = candidate;
				break;
			}
		}
		if (!requestId) throw new Error(SAFE_CAPABILITY_FAILURE);
		const expiresAt = new Date(
			Date.now() + this.#capabilityTimeoutMs,
		).toISOString();
		return await new Promise<string>((resolve, reject) => {
			const timeout = setTimeout(() => {
				const pending = this.#pendingCapabilities.get(requestId);
				if (pending) {
					this.#cancelCapability(pending, "managed capability timed out");
				}
			}, this.#capabilityTimeoutMs);
			(timeout as { unref?: () => void }).unref?.();
			this.#pendingCapabilities.set(requestId, {
				requestId,
				sessionId,
				runId: active.runId,
				connectionId: active.connectionId,
				capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
				expiresAt,
				resolve,
				reject,
				timeout,
				state: "pending",
			});
			this.#emit(
				sessionId,
				{
					kind: "capability.requested",
					runId: active.runId,
					requestId,
					capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
					request,
					expiresAt,
				},
				active.connectionId,
			);
		});
	}

	#cancelCapability(pending: PendingCapability, reason: string): void {
		if (
			pending.state !== "pending" ||
			this.#pendingCapabilities.get(pending.requestId) !== pending
		) {
			return;
		}
		this.#pendingCapabilities.delete(pending.requestId);
		pending.state = "cancelled";
		clearTimeout(pending.timeout);
		pending.reject(new Error(SAFE_CAPABILITY_FAILURE));
		this.#emit(
			pending.sessionId,
			{
				kind: "capability.cancelled",
				runId: pending.runId,
				requestId: pending.requestId,
				capability: pending.capability,
				reason: boundedText(reason, 2048) || "managed capability cancelled",
			},
			pending.connectionId,
		);
	}

	#cancelCapabilities(
		filter: (pending: PendingCapability) => boolean,
		reason: string,
	): void {
		for (const pending of this.#pendingCapabilities.values()) {
			if (pending.state !== "pending" || !filter(pending)) continue;
			this.#cancelCapability(pending, reason);
		}
	}

	#projectCoreEvent(event: CoreSessionEvent): void {
		if (this.#disposed) return;
		const sessionId = event.payload.sessionId;
		if (!this.#managedSessions.has(sessionId)) return;
		if (event.type === "pending_prompts") {
			const page = sanitizePendingPromptPage(event.payload.prompts);
			this.#emit(sessionId, {
				kind: "pending_prompts.changed",
				...page,
			});
			return;
		}
		if (event.type === "pending_prompt_submitted") {
			this.#emit(sessionId, {
				kind: "pending_prompt.submitted",
				prompt: sanitizePendingPrompt({
					id: event.payload.id,
					prompt: event.payload.prompt,
					delivery: event.payload.delivery,
					attachmentCount: event.payload.attachmentCount,
					userImages: event.payload.userImages,
					userFiles: event.payload.userFiles,
				}),
			});
			return;
		}
		if (event.type !== "agent_event") return;
		const context = this.#invocations.getStore();
		const run = this.#activeRuns.get(sessionId);
		if (
			run?.state !== "running" ||
			!context ||
			context.sessionId !== sessionId ||
			context.runId !== run.runId ||
			context.identity.connectionId !== run.connectionId
		) {
			return;
		}
		const agentEvent = event.payload.event;
		switch (agentEvent.type) {
			case "content_start":
				if (agentEvent.contentType === "text" && agentEvent.text) {
					this.#emit(sessionId, {
						kind: "assistant.delta",
						runId: run.runId,
						text: truncateUtf8(agentEvent.text, 128 * 1024),
					});
				} else if (agentEvent.contentType === "tool") {
					this.#emit(sessionId, {
						kind: "tool.started",
						runId: run.runId,
						toolCallId: boundedText(agentEvent.toolCallId, 512) || "tool-call",
						toolName: boundedText(agentEvent.toolName, 256) || "tool",
						status: "started",
					});
				}
				return;
			case "content_update":
				this.#emit(sessionId, {
					kind: "tool.updated",
					runId: run.runId,
					toolCallId: boundedText(agentEvent.toolCallId, 512) || "tool-call",
					toolName: boundedText(agentEvent.toolName, 256) || "tool",
					status: "running",
				});
				return;
			case "content_end":
				if (agentEvent.contentType === "text") {
					this.#emit(sessionId, {
						kind: "assistant.finished",
						runId: run.runId,
						text: truncateUtf8(agentEvent.text, 192 * 1024),
					});
				} else if (agentEvent.contentType === "tool") {
					this.#emit(sessionId, {
						kind: "tool.finished",
						runId: run.runId,
						toolCallId: boundedText(agentEvent.toolCallId, 512) || "tool-call",
						toolName: boundedText(agentEvent.toolName, 256) || "tool",
						status: agentEvent.error ? "failed" : "completed",
						...(agentEvent.error ? { error: SAFE_TOOL_FAILURE } : {}),
					});
				}
				return;
			case "usage":
				this.#emit(sessionId, {
					kind: "usage.updated",
					usage: {
						inputTokens: agentEvent.totalInputTokens,
						outputTokens: agentEvent.totalOutputTokens,
						cacheReadTokens: agentEvent.totalCacheReadTokens ?? 0,
						cacheWriteTokens: agentEvent.totalCacheWriteTokens ?? 0,
						totalCost: agentEvent.totalCost ?? 0,
					},
				});
				return;
			default:
				return;
		}
	}

	#emit(
		sessionId: string,
		payload: Record<string, unknown>,
		targetConnectionId?: string,
	): void {
		if (this.#disposed || this.#scope.signal.aborted) return;
		const owner = this.#managedSessions.get(sessionId);
		if (!owner) return;
		if (
			this.#processSequence >= Number.MAX_SAFE_INTEGER ||
			(this.#sessionSequences.get(sessionId) ?? 0) >= Number.MAX_SAFE_INTEGER
		) {
			this.#rolloverRuntimeEventAuthority();
		}
		const streamId = this.#sessionStreamIds.get(sessionId);
		if (!streamId) return;
		const recipientConnectionId =
			owner.state === "owned" &&
			owner.connectionId &&
			(!targetConnectionId || targetConnectionId === owner.connectionId)
				? owner.connectionId
				: undefined;
		const sessionSequence = (this.#sessionSequences.get(sessionId) ?? 0) + 1;
		const processSequence = this.#processSequence + 1;
		let event: ReturnType<typeof parseHubChatRuntimeWireEvent>;
		try {
			event = freezeRuntimeValue(
				parseHubChatRuntimeWireEvent({
					version: CHAT_RUNTIME_WIRE_VERSION,
					event: "chat.runtime",
					eventId: createSessionId("runtime_event_"),
					streamId,
					sessionId,
					timestamp: Date.now(),
					processSequence,
					sessionSequence,
					payload,
				}),
			);
			this.#recoveryJournal.append(event);
		} catch {
			return;
		}
		this.#sessionSequences.set(sessionId, sessionSequence);
		this.#processSequence = processSequence;
		if (!recipientConnectionId) return;
		for (const state of [...this.#listeners]) {
			const { invocation } = state;
			if (
				invocation.signal.aborted ||
				invocation.identity.connectionId !== recipientConnectionId ||
				(invocation.sessionId && invocation.sessionId !== sessionId)
			) {
				continue;
			}
			try {
				invocation.emit(event);
			} catch {
				// Subscriber failure is isolated from runtime authority.
			}
		}
	}

	#rolloverRuntimeEventAuthority(): void {
		this.#recoveryJournal.clear();
		this.#sessionSequences.clear();
		this.#sessionStreamIds.clear();
		for (const sessionId of this.#managedSessions.keys()) {
			const streamId = createSessionId("runtime_stream_");
			this.#recoveryJournal.registerSession(sessionId, streamId);
			this.#sessionStreamIds.set(sessionId, streamId);
			this.#sessionSequences.set(sessionId, 0);
		}
		this.#processSequence = 0;
	}

	async #abortActiveRun(
		sessionId: string,
		active: ActiveRun,
		reason: string,
	): Promise<void> {
		if (
			this.#activeRuns.get(sessionId) !== active ||
			active.state === "aborting"
		) {
			return;
		}
		active.state = "aborting";
		if (active.heartbeat) clearInterval(active.heartbeat);
		this.#cancelApprovals(
			(pending) =>
				pending.sessionId === sessionId && pending.runId === active.runId,
			"managed run was aborted",
		);
		this.#cancelCapabilities(
			(pending) =>
				pending.sessionId === sessionId && pending.runId === active.runId,
			"managed run was aborted",
		);
		await this.#core.abort(sessionId, reason);
	}

	#handleManagedAuthorityLoss(
		sessionId: string,
		authoritySignal: AbortSignal,
	): void {
		const owner = this.#managedSessions.get(sessionId);
		if (owner?.authoritySignal !== authoritySignal) return;
		const active = this.#activeRuns.get(sessionId);
		if (active) {
			active.state = "aborting";
			if (active.heartbeat) clearInterval(active.heartbeat);
		}
		this.#cancelApprovals(
			(pending) => pending.sessionId === sessionId,
			"managed writer authority was lost",
		);
		this.#cancelCapabilities(
			(pending) => pending.sessionId === sessionId,
			"managed writer authority was lost",
		);
		this.#activeCompactions
			.get(sessionId)
			?.controller.abort(new Error("managed writer authority was lost"));
	}

	#requireAudienceSession(sessionId: string): HubChatProjectionChat {
		const projection = this.#resolveAudienceSession(sessionId);
		if (!projection) {
			throw new ChatCatalogError(
				"session_not_found",
				"managed session target is unavailable",
			);
		}
		return projection;
	}

	#assertSessionOwner(
		sessionId: string,
		identity: HubAuthenticatedConnection,
	): ManagedSessionOwner {
		const owner = this.#managedSessions.get(sessionId);
		if (!owner) {
			throw new ChatCatalogError(
				"session_not_found",
				"runtime operation requires a resident managed session",
			);
		}
		if (this.#ownerTransitions.has(sessionId)) {
			throw new ChatCatalogError(
				"lease_conflict",
				"managed session owner transition is active",
			);
		}
		if (
			owner.state !== "owned" ||
			!owner.connectionId ||
			!owner.signal ||
			owner.signal.aborted ||
			owner.authoritySignal?.aborted
		) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed session has no live connection owner",
			);
		}
		if (owner.connectionId !== identity.connectionId) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed session belongs to another connection",
			);
		}
		return owner;
	}

	#assertScope(identity: HubAuthenticatedConnection): void {
		if (
			identity.principalId !== this.#scope.principalId ||
			identity.tenantId !== this.#scope.tenantId ||
			identity.workspaceKey !== this.#scope.workspaceKey ||
			identity.workspaceEpoch !== this.#scope.workspaceEpoch ||
			identity.policy.authorityClassId !== this.#scope.authorityClassId ||
			identity.policy.audienceId !== this.#scope.audienceId ||
			identity.policy.policyEpoch !== this.#scope.policyEpoch
		) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed runtime identity does not match the Core authority scope",
			);
		}
	}
}
