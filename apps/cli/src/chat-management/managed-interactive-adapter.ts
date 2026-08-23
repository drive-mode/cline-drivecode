import { createHash } from "node:crypto";
import type {
	ManagedHubChatClient,
	ManagedHubChatRuntimeEvent,
	ManagedHubChatSession,
} from "@cline/core";
import {
	HubChatLifecycleCommandError,
	HubChatRuntimeCommandError,
	ManagedHubChatClientError,
} from "@cline/core";
import type {
	HubChatLifecycleCommandName,
	HubChatLifecycleRequestPayload,
	HubChatLifecycleResult,
	HubChatRuntimeCommandName,
	HubChatRuntimeRequestPayload,
	HubChatRuntimeResult,
} from "@cline/shared";
import {
	HUB_CHAT_LIFECYCLE_REQUEST_SCHEMAS,
	HUB_CHAT_LIFECYCLE_RESULT_SCHEMAS,
	HUB_CHAT_RUNTIME_REQUEST_SCHEMAS,
	HUB_CHAT_RUNTIME_RESULT_SCHEMAS,
} from "@cline/shared";
import {
	assertChatCatalogId,
	assertChatOperationIntent,
	assertChatSessionId,
	type ChatCatalogId,
	type ChatIdentityFactory,
	type ChatOperationIntent,
	type ChatOperationKind,
	type ChatSessionId,
} from "./chat-identities";
import {
	assertManagedChatHistoryTarget,
	type ManagedChatHistoryTarget,
} from "./history-target";
import {
	type ManagedAbortEffect,
	ManagedRuntimeCorrelation,
} from "./managed-runtime-correlation";
import {
	type ManagedInteractiveRuntimeEvent,
	reduceManagedRuntimeEvent,
} from "./managed-runtime-events";

const ASK_QUESTION_CAPABILITY = "tool_executor.askQuestion";
const MAX_TITLE_LENGTH = 512;
const MAX_CALLBACK_TEXT_BYTES = 16 * 1024;
const MAX_UNKNOWN_INTENTS = 64;
const MANAGED_INTERACTIVE_OPERATION_KINDS = [
	"start",
	"config_restart",
	"reset",
	"turn",
	"abort",
	"approval",
	"capability",
	"pending_prompt_update",
	"pending_prompt_remove",
	"compaction",
	"fork",
	"restore",
	"stop",
] as const satisfies readonly ChatOperationKind[];
const MANAGED_INTERACTIVE_OPERATION_KIND_SET = new Set<ChatOperationKind>(
	MANAGED_INTERACTIVE_OPERATION_KINDS,
);

export type ManagedInteractiveOperationKind =
	(typeof MANAGED_INTERACTIVE_OPERATION_KINDS)[number];

type StartProfile =
	HubChatLifecycleRequestPayload<"chat_lifecycle.start_root">["start"];
type TurnAttachments =
	HubChatLifecycleRequestPayload<"chat_lifecycle.run_turn">["attachments"];
type PendingPromptUpdate = Omit<
	HubChatRuntimeRequestPayload<"chat_runtime.pending_prompts.update">,
	"operationId" | "sessionId"
>;
type RestoreOptions = NonNullable<
	HubChatLifecycleRequestPayload<"chat_lifecycle.restore_checkpoint">["restore"]
>;

type DeepReadonly<Value> = Value extends readonly unknown[]
	? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
	: Value extends object
		? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
		: Value;

export type ManagedTurnResult = DeepReadonly<
	HubChatLifecycleResult<"chat_lifecycle.run_turn">
>;
export type ManagedPendingPromptPage = DeepReadonly<
	HubChatRuntimeResult<"chat_runtime.pending_prompts.list">
>;
export type ManagedPendingPromptMutation = DeepReadonly<
	HubChatRuntimeResult<"chat_runtime.pending_prompts.update">
>;
export type ManagedDisplayMessagePage = DeepReadonly<
	HubChatRuntimeResult<"chat_runtime.messages.list">
>;
export type ManagedCheckpointPage = DeepReadonly<
	HubChatRuntimeResult<"chat_runtime.checkpoints.list">
>;
export type ManagedUsageSnapshot = DeepReadonly<
	HubChatRuntimeResult<"chat_runtime.usage.get">
>;
export type ManagedCompactionSnapshot = DeepReadonly<
	HubChatRuntimeResult<"chat_runtime.compaction.get">
>;
export type ManagedCompactionResult = DeepReadonly<
	HubChatRuntimeResult<"chat_runtime.compaction.run">
>;

export interface ManagedInteractiveSessionPort {
	readonly sessionId: string;
	readonly chatId: string;
	getSnapshot(): ReturnType<ManagedHubChatSession["getSnapshot"]>;
	runTurn(
		input: Parameters<ManagedHubChatSession["runTurn"]>[0],
	): ReturnType<ManagedHubChatSession["runTurn"]>;
	abortRun(
		input: Parameters<ManagedHubChatSession["abortRun"]>[0],
	): ReturnType<ManagedHubChatSession["abortRun"]>;
	respondToApproval(
		input: Parameters<ManagedHubChatSession["respondToApproval"]>[0],
	): ReturnType<ManagedHubChatSession["respondToApproval"]>;
	respondToCapability(
		input: Parameters<ManagedHubChatSession["respondToCapability"]>[0],
	): ReturnType<ManagedHubChatSession["respondToCapability"]>;
	listPendingPrompts(
		input?: Parameters<ManagedHubChatSession["listPendingPrompts"]>[0],
	): ReturnType<ManagedHubChatSession["listPendingPrompts"]>;
	updatePendingPrompt(
		input: Parameters<ManagedHubChatSession["updatePendingPrompt"]>[0],
	): ReturnType<ManagedHubChatSession["updatePendingPrompt"]>;
	removePendingPrompt(
		input: Parameters<ManagedHubChatSession["removePendingPrompt"]>[0],
	): ReturnType<ManagedHubChatSession["removePendingPrompt"]>;
	listMessages(
		input?: Parameters<ManagedHubChatSession["listMessages"]>[0],
	): ReturnType<ManagedHubChatSession["listMessages"]>;
	listCheckpoints(
		input?: Parameters<ManagedHubChatSession["listCheckpoints"]>[0],
	): ReturnType<ManagedHubChatSession["listCheckpoints"]>;
	getUsage(): ReturnType<ManagedHubChatSession["getUsage"]>;
	getCompaction(): ReturnType<ManagedHubChatSession["getCompaction"]>;
	runCompaction(
		input: Parameters<ManagedHubChatSession["runCompaction"]>[0],
	): ReturnType<ManagedHubChatSession["runCompaction"]>;
	reset(
		input: Parameters<ManagedHubChatSession["reset"]>[0],
	): ReturnType<ManagedHubChatSession["reset"]>;
	stop(
		input: Parameters<ManagedHubChatSession["stop"]>[0],
	): ReturnType<ManagedHubChatSession["stop"]>;
	disposeAsync(): ReturnType<ManagedHubChatSession["disposeAsync"]>;
	subscribeRuntimeEvents(
		listener: (event: ManagedHubChatRuntimeEvent) => void | Promise<void>,
	): () => void;
}

export interface ManagedInteractiveClientPort {
	startRoot(
		input: Parameters<ManagedHubChatClient["startRoot"]>[0],
	): Promise<ManagedInteractiveSessionPort>;
	startRelated(
		input: Parameters<ManagedHubChatClient["startRelated"]>[0],
	): Promise<ManagedInteractiveSessionPort>;
	restoreCheckpoint(
		input: Parameters<ManagedHubChatClient["restoreCheckpoint"]>[0],
	): Promise<ManagedInteractiveSessionPort>;
	dispose(): Promise<void>;
}

export type ManagedInteractiveAdapterState =
	| "idle"
	| "starting"
	| "transitioning"
	| "ready"
	| "failed"
	| "disposed";

export type ManagedInteractiveSessionView = Readonly<{
	sessionId: string;
	chatId: string;
}>;

export type ManagedInteractiveAdapterSnapshot = Readonly<{
	state: ManagedInteractiveAdapterState;
	generation: number;
	session?: ManagedInteractiveSessionView;
}>;

export type ManagedAbortActionResult =
	| Readonly<{ kind: "deferred" }>
	| Readonly<{ kind: "already_dispatched" }>
	| Readonly<{ kind: "dispatched"; accepted: boolean }>;

export type ManagedInteractiveAdapterErrorCode =
	| "cleanup_failed"
	| "dependency_failed"
	| "disposed"
	| "failed"
	| "invalid_action"
	| "invalid_result"
	| "invalid_state"
	| "operation_rejected"
	| "operation_unknown"
	| "stale_transition";

export class ManagedInteractiveAdapterError extends Error {
	constructor(readonly code: ManagedInteractiveAdapterErrorCode) {
		super("Managed interactive chat action failed closed.");
		this.name = "ManagedInteractiveAdapterError";
	}
}

export interface ManagedInteractiveAdapterOptions {
	readonly client: ManagedInteractiveClientPort;
	readonly identities: ChatIdentityFactory;
	readonly onEvent: (
		event: ManagedInteractiveRuntimeEvent,
	) => void | Promise<void>;
	readonly onError?: (
		error: ManagedInteractiveAdapterError,
	) => void | Promise<void>;
}

export interface ManagedStartRootAction {
	readonly intent: ChatOperationIntent<"start">;
	readonly sessionId: ChatSessionId;
	readonly chatId?: ChatCatalogId;
	readonly start: StartProfile;
	readonly title?: string;
}

export interface ManagedConfigRestartAction {
	readonly intent: ChatOperationIntent<"config_restart">;
	readonly sessionId: ChatSessionId;
	readonly target: ManagedChatHistoryTarget;
	readonly start: StartProfile;
}

export interface ManagedForkAction {
	readonly intent: ChatOperationIntent<"fork">;
	readonly sessionId: ChatSessionId;
	readonly chatId: ChatCatalogId;
	readonly start: StartProfile;
	readonly title?: string;
}

export interface ManagedRestoreCheckpointAction {
	readonly intent: ChatOperationIntent<"restore">;
	readonly sessionId: ChatSessionId;
	readonly chatId: ChatCatalogId;
	readonly start: StartProfile;
	readonly checkpointRunCount: number;
	readonly restore?: RestoreOptions;
	readonly title?: string;
}

interface ActiveSessionContext {
	readonly session: ManagedInteractiveSessionPort;
	readonly correlation: ManagedRuntimeCorrelation;
	readonly cleanupIntent: ChatOperationIntent<"stop">;
	open: boolean;
	inFlightCalls: number;
	lastSequenceEnd?: number;
	unsubscribe?: () => void;
	abortRequest?: Readonly<{ operationId: string; reason?: string }>;
}

interface ManagedIntentAttempt {
	readonly slot: string;
	readonly kind: ChatOperationKind;
	readonly operationId: string;
	readonly digest: string;
	readonly expectedRunId?: string;
	evidenceRunId?: string;
	evidenceObserved: boolean;
}

function fail(code: ManagedInteractiveAdapterErrorCode): never {
	throw new ManagedInteractiveAdapterError(code);
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function assertBoundedBoundaryGraph(value: unknown): void {
	let nodes = 0;
	const ancestors = new WeakSet<object>();
	const inspect = (candidate: unknown, depth: number): void => {
		nodes += 1;
		if (nodes > 8192 || depth > 16) fail("invalid_action");
		if (!candidate || typeof candidate !== "object") return;
		if (ancestors.has(candidate)) fail("invalid_action");
		const prototype = Object.getPrototypeOf(candidate);
		if (
			prototype !== Object.prototype &&
			prototype !== null &&
			prototype !== Array.prototype
		) {
			fail("invalid_action");
		}
		ancestors.add(candidate);
		for (const nested of Object.values(candidate)) inspect(nested, depth + 1);
		ancestors.delete(candidate);
	};
	inspect(value, 0);
}

type BoundarySchemaResult<Output> =
	| Readonly<{ success: true; data: Output }>
	| Readonly<{ success: false }>;

function parseBoundary<Output>(
	schema: unknown,
	value: unknown,
	code: "invalid_action" | "invalid_result",
): Output {
	try {
		assertBoundedBoundaryGraph(value);
	} catch {
		return fail(code);
	}
	let parsed: BoundarySchemaResult<Output>;
	try {
		parsed = (
			schema as {
				safeParse(candidate: unknown): BoundarySchemaResult<Output>;
			}
		).safeParse(value);
	} catch {
		return fail(code);
	}
	if (!parsed.success) return fail(code);
	return parsed.data;
}

function lifecycleRequest<Command extends HubChatLifecycleCommandName>(
	command: Command,
	value: unknown,
): HubChatLifecycleRequestPayload<Command> {
	return parseBoundary<HubChatLifecycleRequestPayload<Command>>(
		HUB_CHAT_LIFECYCLE_REQUEST_SCHEMAS[command],
		value,
		"invalid_action",
	);
}

function runtimeRequest<Command extends HubChatRuntimeCommandName>(
	command: Command,
	value: unknown,
): HubChatRuntimeRequestPayload<Command> {
	return parseBoundary<HubChatRuntimeRequestPayload<Command>>(
		HUB_CHAT_RUNTIME_REQUEST_SCHEMAS[command],
		value,
		"invalid_action",
	);
}

function lifecycleResult<Command extends HubChatLifecycleCommandName>(
	command: Command,
	value: unknown,
): HubChatLifecycleResult<Command> {
	return parseBoundary<HubChatLifecycleResult<Command>>(
		HUB_CHAT_LIFECYCLE_RESULT_SCHEMAS[command],
		value,
		"invalid_result",
	);
}

function runtimeResult<Command extends HubChatRuntimeCommandName>(
	command: Command,
	value: unknown,
): HubChatRuntimeResult<Command> {
	return parseBoundary<HubChatRuntimeResult<Command>>(
		HUB_CHAT_RUNTIME_RESULT_SCHEMAS[command],
		value,
		"invalid_result",
	);
}

function freezeClone<Value>(value: Value): DeepReadonly<Value> {
	const clone = structuredClone(value);
	if (!clone || typeof clone !== "object") return clone as DeepReadonly<Value>;
	const pending: object[] = [clone];
	const seen = new WeakSet<object>();
	while (pending.length > 0) {
		const candidate = pending.pop();
		if (!candidate || seen.has(candidate)) continue;
		seen.add(candidate);
		for (const child of Object.values(candidate)) {
			if (child && typeof child === "object") pending.push(child);
		}
		Object.freeze(candidate);
	}
	return clone as DeepReadonly<Value>;
}

function operation<Kind extends ChatOperationKind>(
	intent: ChatOperationIntent<Kind>,
	kind: Kind,
): ChatOperationIntent<Kind> {
	try {
		return assertChatOperationIntent(intent, kind);
	} catch {
		return fail("invalid_action");
	}
}

function sessionIdentity(value: unknown): ChatSessionId {
	try {
		return assertChatSessionId(value);
	} catch {
		return fail("invalid_action");
	}
}

function chatIdentity(value: unknown): ChatCatalogId {
	try {
		return assertChatCatalogId(value);
	} catch {
		return fail("invalid_action");
	}
}

function title(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim();
	if (!normalized || normalized.length > MAX_TITLE_LENGTH) {
		return fail("invalid_action");
	}
	return normalized;
}

function startProfile(value: StartProfile): StartProfile {
	const candidate = record(value);
	const allowed = new Set(["profileId", "interactive", "mode", "relativeCwd"]);
	if (
		!candidate ||
		Object.keys(candidate).some((key) => !allowed.has(key)) ||
		typeof candidate.profileId !== "string" ||
		candidate.profileId.length === 0 ||
		candidate.profileId.length > 512 ||
		candidate.profileId.trim() !== candidate.profileId ||
		(candidate.interactive !== undefined &&
			typeof candidate.interactive !== "boolean") ||
		(candidate.mode !== undefined &&
			candidate.mode !== "act" &&
			candidate.mode !== "plan" &&
			candidate.mode !== "yolo") ||
		(candidate.relativeCwd !== undefined &&
			typeof candidate.relativeCwd !== "string")
	) {
		return fail("invalid_action");
	}
	if (typeof candidate.relativeCwd === "string") {
		const cwd = candidate.relativeCwd;
		if (
			cwd.length === 0 ||
			cwd.length > 1024 ||
			cwd.trim() !== cwd ||
			cwd.startsWith("/") ||
			cwd.startsWith("\\") ||
			/^[A-Za-z]:[\\/]/.test(cwd) ||
			cwd.split(/[\\/]+/).includes("..")
		) {
			return fail("invalid_action");
		}
	}
	return Object.freeze({
		profileId: candidate.profileId,
		...(candidate.interactive === undefined
			? {}
			: { interactive: candidate.interactive }),
		...(candidate.mode === undefined ? {} : { mode: candidate.mode }),
		...(candidate.relativeCwd === undefined
			? {}
			: { relativeCwd: candidate.relativeCwd }),
	}) as StartProfile;
}

function boundedCallbackText(value: unknown): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		new TextEncoder().encode(value).byteLength > MAX_CALLBACK_TEXT_BYTES
	) {
		return fail("invalid_action");
	}
	return value;
}

function boundedReason(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length > 2048) {
		return fail("invalid_action");
	}
	return value;
}

function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	const candidate = record(value);
	if (!candidate) return fail("invalid_action");
	return `{${Object.keys(candidate)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(candidate[key])}`)
		.join(",")}}`;
}

function managedIntentDigest(value: unknown): string {
	assertBoundedBoundaryGraph(value);
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function isAuthoritativeDependencyError(error: unknown): boolean {
	return (
		error instanceof HubChatLifecycleCommandError ||
		error instanceof HubChatRuntimeCommandError ||
		error instanceof ManagedHubChatClientError
	);
}

/**
 * Gate-off app authority for one managed interactive session. It exposes no
 * generic Core, raw Hub transport, local artifact, or fresh-process reattach
 * escape hatch.
 */
export class ManagedInteractiveChatAdapter {
	readonly #client: ManagedInteractiveClientPort;
	readonly #identities: ChatIdentityFactory;
	readonly #onEvent: ManagedInteractiveAdapterOptions["onEvent"];
	readonly #onError: ManagedInteractiveAdapterOptions["onError"];
	readonly #cleanupTasks = new Set<Promise<void>>();
	readonly #activeIntents = new Map<string, ManagedIntentAttempt>();
	readonly #unknownIntents = new Map<string, ManagedIntentAttempt>();
	#state: ManagedInteractiveAdapterState = "idle";
	#generation = 0;
	#current: ActiveSessionContext | undefined;
	#transition: Promise<unknown> | undefined;
	#disposeBarrier: Promise<void> | undefined;
	#clientDisposeBarrier: Promise<void> | undefined;
	#cleanupFailed = false;

	constructor(options: ManagedInteractiveAdapterOptions) {
		if (
			!options ||
			typeof options.client?.startRoot !== "function" ||
			typeof options.client?.startRelated !== "function" ||
			typeof options.client?.restoreCheckpoint !== "function" ||
			typeof options.client?.dispose !== "function" ||
			typeof options.identities?.operation !== "function" ||
			typeof options.identities?.session !== "function" ||
			typeof options.identities?.chat !== "function" ||
			typeof options.onEvent !== "function" ||
			(options.onError !== undefined && typeof options.onError !== "function")
		) {
			fail("invalid_action");
		}
		this.#client = options.client;
		this.#identities = options.identities;
		this.#onEvent = options.onEvent;
		this.#onError = options.onError;
	}

	operation<Kind extends ManagedInteractiveOperationKind>(
		kind: Kind,
	): ChatOperationIntent<Kind> {
		this.#assertNotDisposed();
		if (!MANAGED_INTERACTIVE_OPERATION_KIND_SET.has(kind)) {
			fail("invalid_action");
		}
		return this.#identities.operation(kind);
	}

	sessionId(): ChatSessionId {
		this.#assertNotDisposed();
		return this.#identities.session();
	}

	chatId(): ChatCatalogId {
		this.#assertNotDisposed();
		return this.#identities.chat();
	}

	getSnapshot(): ManagedInteractiveAdapterSnapshot {
		const current = this.#current;
		return Object.freeze({
			state: this.#state,
			generation: this.#generation,
			...(current
				? {
						session: Object.freeze({
							sessionId: current.session.sessionId,
							chatId: current.session.chatId,
						}),
					}
				: {}),
		});
	}

	async startRoot(
		action: ManagedStartRootAction,
	): Promise<ManagedInteractiveSessionView> {
		const intent = operation(action.intent, "start");
		const sessionId = sessionIdentity(action.sessionId);
		const requestedChatId =
			action.chatId === undefined ? undefined : chatIdentity(action.chatId);
		const profile = startProfile(action.start);
		const nextTitle = title(action.title);
		const request = lifecycleRequest("chat_lifecycle.start_root", {
			operationId: intent.operationId,
			sessionId,
			start: profile,
			...(requestedChatId ? { chatId: requestedChatId } : {}),
			...(nextTitle ? { title: nextTitle, titleSource: "owner" } : {}),
		});
		const cleanupIntent = this.#identities.operation("stop");
		const attempt = this.#beginExclusiveIntent("admission", intent, request);
		return await this.#invokeIntent(
			attempt,
			async () =>
				await this.#runTransition("starting", "idle", async (generation) => {
					let handle: ManagedInteractiveSessionPort;
					try {
						handle = await this.#client.startRoot(request);
					} catch (error) {
						this.#restoreState(generation, "idle");
						throw error;
					}
					if (!this.#isCurrentGeneration(generation)) {
						if (!(await this.#cleanupDetached(handle, cleanupIntent))) {
							this.#markCleanupFailure();
						}
						return this.#throwStale();
					}
					let context: ActiveSessionContext;
					try {
						context = this.#activate(
							handle,
							cleanupIntent,
							sessionId,
							requestedChatId,
						);
					} catch (error) {
						if (!(await this.#cleanupDetached(handle, cleanupIntent))) {
							this.#markCleanupFailure();
						}
						this.#failAdapter("invalid_result");
						throw error;
					}
					if (!this.#isCurrentGeneration(generation)) this.#throwStale();
					return this.#sessionView(context);
				}),
		);
	}

	async configRestart(
		action: ManagedConfigRestartAction,
	): Promise<ManagedInteractiveSessionView> {
		const current = this.#assertQuiescent();
		const target = this.#targetForCurrent(action.target, current);
		const intent = operation(action.intent, "config_restart");
		const sessionId = sessionIdentity(action.sessionId);
		if (sessionId === current.session.sessionId) fail("invalid_action");
		const profile = startProfile(action.start);
		const request = lifecycleRequest("chat_lifecycle.start_related", {
			operationId: intent.operationId,
			sessionId,
			chatId: target.chatId,
			parentSessionId: target.headSessionId,
			relationKind: "config_restart",
			expectedRevision: target.expectedRevision,
			start: profile,
		});
		const attempt = this.#beginExclusiveIntent("structural", intent, request);
		return await this.#invokeIntent(
			attempt,
			async () =>
				await this.#replaceCurrent(
					current,
					async () => await this.#client.startRelated(request),
					sessionId,
					chatIdentity(target.chatId),
				),
		);
	}

	async fork(
		action: ManagedForkAction,
	): Promise<ManagedInteractiveSessionView> {
		const current = this.#assertQuiescent();
		const intent = operation(action.intent, "fork");
		const sessionId = sessionIdentity(action.sessionId);
		const chatId = chatIdentity(action.chatId);
		if (
			sessionId === current.session.sessionId ||
			chatId === current.session.chatId
		) {
			fail("invalid_action");
		}
		const profile = startProfile(action.start);
		const nextTitle = title(action.title);
		const request = lifecycleRequest("chat_lifecycle.start_related", {
			operationId: intent.operationId,
			sessionId,
			chatId,
			parentSessionId: current.session.sessionId,
			relationKind: "fork",
			start: profile,
			...(nextTitle ? { title: nextTitle, titleSource: "owner" } : {}),
		});
		const attempt = this.#beginExclusiveIntent("structural", intent, request);
		return await this.#invokeIntent(
			attempt,
			async () =>
				await this.#replaceCurrent(
					current,
					async () => await this.#client.startRelated(request),
					sessionId,
					chatId,
				),
		);
	}

	async restoreCheckpoint(
		action: ManagedRestoreCheckpointAction,
	): Promise<ManagedInteractiveSessionView> {
		const current = this.#assertQuiescent();
		const intent = operation(action.intent, "restore");
		const sessionId = sessionIdentity(action.sessionId);
		const chatId = chatIdentity(action.chatId);
		if (
			sessionId === current.session.sessionId ||
			chatId === current.session.chatId ||
			!Number.isSafeInteger(action.checkpointRunCount) ||
			action.checkpointRunCount < 0 ||
			action.restore?.messages === false
		) {
			fail("invalid_action");
		}
		const profile = startProfile(action.start);
		const nextTitle = title(action.title);
		const request = lifecycleRequest("chat_lifecycle.restore_checkpoint", {
			operationId: intent.operationId,
			sessionId,
			chatId,
			parentSessionId: current.session.sessionId,
			checkpointRunCount: action.checkpointRunCount,
			start: profile,
			...(action.restore
				? {
						restore: {
							...(action.restore.messages === undefined
								? {}
								: { messages: action.restore.messages }),
							...(action.restore.workspace === undefined
								? {}
								: { workspace: action.restore.workspace }),
							...(action.restore.omitCheckpointMessageFromSession === undefined
								? {}
								: {
										omitCheckpointMessageFromSession:
											action.restore.omitCheckpointMessageFromSession,
									}),
						},
					}
				: {}),
			...(nextTitle ? { title: nextTitle, titleSource: "owner" } : {}),
		});
		const attempt = this.#beginExclusiveIntent("structural", intent, request);
		return await this.#invokeIntent(
			attempt,
			async () =>
				await this.#replaceCurrent(
					current,
					async () => await this.#client.restoreCheckpoint(request),
					sessionId,
					chatId,
				),
		);
	}

	async runTurn(action: {
		intent: ChatOperationIntent<"turn">;
		prompt: string;
		attachments?: TurnAttachments;
		mode?: "act" | "plan" | "yolo";
		delivery?: "queue" | "steer";
		timeoutMs?: number;
	}): Promise<ManagedTurnResult> {
		const current = this.#assertReady();
		const intent = operation(action.intent, "turn");
		const request = lifecycleRequest("chat_lifecycle.run_turn", {
			operationId: intent.operationId,
			sessionId: current.session.sessionId,
			prompt: action.prompt,
			...(action.attachments ? { attachments: action.attachments } : {}),
			...(action.mode ? { mode: action.mode } : {}),
			...(action.delivery ? { delivery: action.delivery } : {}),
			...(action.timeoutMs === undefined
				? {}
				: { timeoutMs: action.timeoutMs }),
		});
		const { sessionId: _sessionId, ...sessionRequest } = request;
		const attempt = this.#beginExclusiveIntent("turn", intent, request);
		try {
			current.correlation.beginTurn(intent);
		} catch (error) {
			this.#completeIntent(attempt);
			throw error;
		}
		try {
			return await this.#invokeIntent(
				attempt,
				async () =>
					await this.#invokeCurrent(current, async () => {
						const result = await current.session.runTurn(sessionRequest);
						let parsed: HubChatLifecycleResult<"chat_lifecycle.run_turn">;
						try {
							parsed = lifecycleResult("chat_lifecycle.run_turn", result);
						} catch {
							return this.#invalidResult(current);
						}
						return freezeClone(parsed);
					}),
			);
		} catch (error) {
			if (
				error instanceof ManagedInteractiveAdapterError &&
				error.code === "operation_unknown"
			) {
				if (current.correlation.getSnapshot().turn?.runId) {
					this.#recordIntentEvidence("turn", {
						operationId: intent.operationId,
						...(current.correlation.getSnapshot().turn?.runId
							? { runId: current.correlation.getSnapshot().turn?.runId }
							: {}),
					});
				}
				throw error;
			}
			try {
				if (!current.open) throw error;
				current.correlation.cancelTurn(intent);
			} catch {
				this.#failContext(current, "failed");
			}
			throw error;
		}
	}

	async abort(action: {
		intent: ChatOperationIntent<"abort">;
		reason?: string;
	}): Promise<ManagedAbortActionResult> {
		const current = this.#assertReady();
		const intent = operation(action.intent, "abort");
		const reason = boundedReason(action.reason);
		if (
			current.abortRequest &&
			(current.abortRequest.operationId !== intent.operationId ||
				current.abortRequest.reason !== reason)
		) {
			fail("invalid_action");
		}
		const request = current.correlation.requestAbort(intent);
		current.abortRequest ??= Object.freeze({
			operationId: intent.operationId,
			...(reason === undefined ? {} : { reason }),
		});
		if (request.kind !== "dispatch") return request;
		try {
			const accepted = await this.#dispatchAbort(
				current,
				request.effect,
				current.abortRequest.reason,
			);
			return Object.freeze({ kind: "dispatched", accepted });
		} catch (error) {
			if (
				error instanceof ManagedInteractiveAdapterError &&
				(error.code === "operation_unknown" ||
					error.code === "operation_rejected")
			) {
				throw error;
			}
			this.#failContext(current, "failed");
			throw error;
		}
	}

	async respondToApproval(action: {
		intent: ChatOperationIntent<"approval">;
		runId: string;
		approvalId: string;
		decision: "approve" | "deny";
		reason?: string;
	}): Promise<void> {
		const current = this.#assertReady();
		const intent = operation(action.intent, "approval");
		const request = runtimeRequest("chat_runtime.approval.respond", {
			operationId: intent.operationId,
			sessionId: current.session.sessionId,
			runId: action.runId,
			approvalId: action.approvalId,
			decision: action.decision,
			...(action.reason === undefined ? {} : { reason: action.reason }),
		});
		const { sessionId: _sessionId, ...sessionRequest } = request;
		const attempt = this.#beginIntent(
			`approval:${action.approvalId}`,
			intent,
			request,
			action.runId,
		);
		try {
			current.correlation.assertApproval(action.runId, action.approvalId);
		} catch (error) {
			this.#completeIntent(attempt);
			throw error;
		}
		await this.#invokeIntent(
			attempt,
			async () =>
				await this.#invokeCurrent(
					current,
					async () => {
						const result =
							await current.session.respondToApproval(sessionRequest);
						let response: HubChatRuntimeResult<"chat_runtime.approval.respond">;
						try {
							response = runtimeResult("chat_runtime.approval.respond", result);
						} catch {
							return this.#invalidResult(current);
						}
						if (
							response.sessionId !== current.session.sessionId ||
							response.operationId !== intent.operationId ||
							response.runId !== action.runId ||
							response.approvalId !== action.approvalId ||
							response.decision !== action.decision
						) {
							return this.#invalidResult(current);
						}
					},
					() => {
						if (attempt.evidenceObserved) fail("operation_unknown");
						current.correlation.assertApproval(action.runId, action.approvalId);
					},
				),
		);
	}

	async respondToQuestion(action: {
		intent: ChatOperationIntent<"capability">;
		runId: string;
		requestId: string;
		answer?: string;
		error?: string;
	}): Promise<boolean> {
		const current = this.#assertReady();
		const intent = operation(action.intent, "capability");
		if ((action.answer === undefined) === (action.error === undefined)) {
			fail("invalid_action");
		}
		const request = runtimeRequest("chat_runtime.capability.respond", {
			operationId: intent.operationId,
			sessionId: current.session.sessionId,
			runId: action.runId,
			requestId: action.requestId,
			capability: ASK_QUESTION_CAPABILITY,
			...(action.answer === undefined
				? { error: boundedCallbackText(action.error) }
				: { result: { answer: boundedCallbackText(action.answer) } }),
		});
		const { sessionId: _sessionId, ...sessionRequest } = request;
		const attempt = this.#beginIntent(
			`question:${action.requestId}`,
			intent,
			request,
			action.runId,
		);
		try {
			current.correlation.assertQuestion(action.runId, action.requestId);
		} catch (error) {
			this.#completeIntent(attempt);
			throw error;
		}
		return await this.#invokeIntent(
			attempt,
			async () =>
				await this.#invokeCurrent(
					current,
					async () => {
						const result =
							await current.session.respondToCapability(sessionRequest);
						let response: HubChatRuntimeResult<"chat_runtime.capability.respond">;
						try {
							response = runtimeResult(
								"chat_runtime.capability.respond",
								result,
							);
						} catch {
							return this.#invalidResult(current);
						}
						if (
							response.sessionId !== current.session.sessionId ||
							response.operationId !== intent.operationId ||
							response.runId !== action.runId ||
							response.requestId !== action.requestId ||
							typeof response.accepted !== "boolean"
						) {
							return this.#invalidResult(current);
						}
						return response.accepted;
					},
					(accepted) => {
						if (attempt.evidenceObserved) fail("operation_unknown");
						current.correlation.assertQuestion(action.runId, action.requestId);
						return accepted;
					},
				),
		);
	}

	async listPendingPrompts(
		input: { cursor?: string; limit?: number } = {},
	): Promise<ManagedPendingPromptPage> {
		const current = this.#assertReady();
		const request = runtimeRequest("chat_runtime.pending_prompts.list", {
			sessionId: current.session.sessionId,
			...input,
		});
		const { sessionId: _sessionId, ...sessionRequest } = request;
		return await this.#invokeRead(current, async () =>
			this.#sessionResult(
				current,
				"chat_runtime.pending_prompts.list",
				await current.session.listPendingPrompts(sessionRequest),
			),
		);
	}

	async updatePendingPrompt(action: {
		intent: ChatOperationIntent<"pending_prompt_update">;
		update: PendingPromptUpdate;
	}): Promise<ManagedPendingPromptMutation> {
		const current = this.#assertReady();
		const intent = operation(action.intent, "pending_prompt_update");
		const request = runtimeRequest("chat_runtime.pending_prompts.update", {
			operationId: intent.operationId,
			sessionId: current.session.sessionId,
			promptId: action.update.promptId,
			...(action.update.prompt === undefined
				? {}
				: { prompt: action.update.prompt }),
			...(action.update.mode === undefined ? {} : { mode: action.update.mode }),
			...(action.update.delivery === undefined
				? {}
				: { delivery: action.update.delivery }),
		});
		const { sessionId: _sessionId, ...sessionRequest } = request;
		const attempt = this.#beginExclusiveIntent(
			`pending-update:${action.update.promptId}`,
			intent,
			request,
		);
		return await this.#invokeIntent(
			attempt,
			async () =>
				await this.#invokeCurrent(current, async () =>
					this.#sessionResult(
						current,
						"chat_runtime.pending_prompts.update",
						await current.session.updatePendingPrompt(sessionRequest),
					),
				),
		);
	}

	async removePendingPrompt(action: {
		intent: ChatOperationIntent<"pending_prompt_remove">;
		promptId: string;
	}): Promise<ManagedPendingPromptMutation> {
		const current = this.#assertReady();
		const intent = operation(action.intent, "pending_prompt_remove");
		const request = runtimeRequest("chat_runtime.pending_prompts.remove", {
			operationId: intent.operationId,
			sessionId: current.session.sessionId,
			promptId: action.promptId,
		});
		const { sessionId: _sessionId, ...sessionRequest } = request;
		const attempt = this.#beginExclusiveIntent(
			`pending-remove:${action.promptId}`,
			intent,
			request,
		);
		return await this.#invokeIntent(
			attempt,
			async () =>
				await this.#invokeCurrent(current, async () =>
					this.#sessionResult(
						current,
						"chat_runtime.pending_prompts.remove",
						await current.session.removePendingPrompt(sessionRequest),
					),
				),
		);
	}

	async listMessages(
		input: { cursor?: string; limit?: number } = {},
	): Promise<ManagedDisplayMessagePage> {
		const current = this.#assertReady();
		const request = runtimeRequest("chat_runtime.messages.list", {
			sessionId: current.session.sessionId,
			...input,
		});
		const { sessionId: _sessionId, ...sessionRequest } = request;
		return await this.#invokeRead(current, async () =>
			this.#sessionResult(
				current,
				"chat_runtime.messages.list",
				await current.session.listMessages(sessionRequest),
			),
		);
	}

	async listCheckpoints(
		input: { limit?: number } = {},
	): Promise<ManagedCheckpointPage> {
		const current = this.#assertReady();
		const request = runtimeRequest("chat_runtime.checkpoints.list", {
			sessionId: current.session.sessionId,
			...input,
		});
		const { sessionId: _sessionId, ...sessionRequest } = request;
		return await this.#invokeRead(current, async () =>
			this.#sessionResult(
				current,
				"chat_runtime.checkpoints.list",
				await current.session.listCheckpoints(sessionRequest),
			),
		);
	}

	async getUsage(): Promise<ManagedUsageSnapshot> {
		const current = this.#assertReady();
		return await this.#invokeRead(current, async () =>
			this.#sessionResult(
				current,
				"chat_runtime.usage.get",
				await current.session.getUsage(),
			),
		);
	}

	async getCompaction(): Promise<ManagedCompactionSnapshot> {
		const current = this.#assertReady();
		return await this.#invokeRead(current, async () =>
			this.#sessionResult(
				current,
				"chat_runtime.compaction.get",
				await current.session.getCompaction(),
			),
		);
	}

	async runCompaction(action: {
		intent: ChatOperationIntent<"compaction">;
		reason?: string;
	}): Promise<ManagedCompactionResult> {
		const current = this.#assertReady();
		const intent = operation(action.intent, "compaction");
		const request = runtimeRequest("chat_runtime.compaction.run", {
			operationId: intent.operationId,
			sessionId: current.session.sessionId,
			...(action.reason === undefined ? {} : { reason: action.reason }),
		});
		const { sessionId: _sessionId, ...sessionRequest } = request;
		const attempt = this.#beginExclusiveIntent("compaction", intent, request);
		return await this.#invokeIntent(
			attempt,
			async () =>
				await this.#invokeCurrent(current, async () => {
					const result = await current.session.runCompaction(sessionRequest);
					let response: HubChatRuntimeResult<"chat_runtime.compaction.run">;
					try {
						response = runtimeResult("chat_runtime.compaction.run", result);
					} catch {
						return this.#invalidResult(current);
					}
					if (
						response.sessionId !== current.session.sessionId ||
						response.operationId !== intent.operationId
					) {
						return this.#invalidResult(current);
					}
					return freezeClone(response);
				}),
		);
	}

	async reset(action: { intent: ChatOperationIntent<"reset"> }): Promise<void> {
		const current = this.#assertQuiescent();
		const intent = operation(action.intent, "reset");
		const request = lifecycleRequest("chat_lifecycle.reset", {
			operationId: intent.operationId,
			sessionId: current.session.sessionId,
		});
		const { sessionId: _sessionId, ...sessionRequest } = request;
		const attempt = this.#beginExclusiveIntent("terminal", intent, request);
		await this.#invokeIntent(
			attempt,
			async () =>
				await this.#runTransition(
					"transitioning",
					"ready",
					async (generation) => {
						let result: Awaited<ReturnType<typeof current.session.reset>>;
						try {
							result = await current.session.reset(sessionRequest);
						} catch (error) {
							this.#restoreReadyAfterCommandError(generation, current);
							throw error;
						}
						this.#assertTransitionContext(generation, current);
						try {
							lifecycleResult("chat_lifecycle.reset", result);
						} catch {
							return this.#invalidResult(current);
						}
						this.#assertTransitionContext(generation, current);
						this.#retire(current);
						this.#restoreState(generation, "idle");
					},
				),
		);
		if (this.#state === "disposed") fail("disposed");
		if (this.#state !== "idle" || this.#current) fail("stale_transition");
	}

	async stop(action: { intent: ChatOperationIntent<"stop"> }): Promise<void> {
		const current = this.#assertQuiescent();
		const intent = operation(action.intent, "stop");
		const request = lifecycleRequest("chat_lifecycle.stop", {
			operationId: intent.operationId,
			sessionId: current.session.sessionId,
		});
		const { sessionId: _sessionId, ...sessionRequest } = request;
		const attempt = this.#beginExclusiveIntent("terminal", intent, request);
		await this.#invokeIntent(
			attempt,
			async () =>
				await this.#runTransition(
					"transitioning",
					"ready",
					async (generation) => {
						let result: Awaited<ReturnType<typeof current.session.stop>>;
						try {
							result = await current.session.stop(sessionRequest);
						} catch (error) {
							this.#restoreReadyAfterCommandError(generation, current);
							throw error;
						}
						this.#assertTransitionContext(generation, current);
						try {
							lifecycleResult("chat_lifecycle.stop", result);
						} catch {
							return this.#invalidResult(current);
						}
						this.#assertTransitionContext(generation, current);
						this.#retire(current);
						this.#restoreState(generation, "idle");
					},
				),
		);
		if (this.#state === "disposed") fail("disposed");
		if (this.#state !== "idle" || this.#current) fail("stale_transition");
	}

	async shutdown(action: {
		intent: ChatOperationIntent<"stop">;
	}): Promise<void> {
		await this.stop(action);
		await this.dispose();
	}

	dispose(): Promise<void> {
		if (this.#disposeBarrier) return this.#disposeBarrier;
		const current = this.#current;
		this.#state = "disposed";
		this.#generation += 1;
		this.#activeIntents.clear();
		this.#unknownIntents.clear();
		if (current) this.#retire(current);
		const transition = this.#transition;
		this.#disposeBarrier = (async () => {
			if (transition) await Promise.resolve(transition).catch(() => undefined);
			if (current) {
				if (
					!(await this.#cleanupDetached(current.session, current.cleanupIntent))
				) {
					this.#markCleanupFailure();
				}
			}
			await Promise.allSettled([...this.#cleanupTasks]);
			let clientDisposeFailed = false;
			try {
				await this.#disposeClientOnce();
			} catch {
				clientDisposeFailed = true;
			}
			if (this.#cleanupFailed) fail("cleanup_failed");
			if (clientDisposeFailed) fail("dependency_failed");
		})();
		return this.#disposeBarrier;
	}

	async #replaceCurrent(
		current: ActiveSessionContext,
		admit: () => Promise<ManagedInteractiveSessionPort>,
		expectedSessionId: ChatSessionId,
		expectedChatId: ChatCatalogId,
	): Promise<ManagedInteractiveSessionView> {
		const cleanupIntent = this.#identities.operation("stop");
		return await this.#runTransition(
			"transitioning",
			"ready",
			async (generation) => {
				let handle: ManagedInteractiveSessionPort;
				try {
					handle = await admit();
				} catch (error) {
					this.#restoreState(generation, "ready");
					throw error;
				}
				try {
					this.#validateHandle(handle, expectedSessionId, expectedChatId);
				} catch (error) {
					if (!(await this.#cleanupDetached(handle, cleanupIntent))) {
						this.#markCleanupFailure();
					}
					this.#failAdapter("invalid_result");
					throw error;
				}
				if (!this.#isCurrentGeneration(generation)) {
					if (!(await this.#cleanupDetached(handle, cleanupIntent))) {
						this.#markCleanupFailure();
					}
					return this.#throwStale();
				}

				this.#retire(current);
				if (
					!(await this.#cleanupDetached(current.session, current.cleanupIntent))
				) {
					this.#markCleanupFailure();
					if (!(await this.#cleanupDetached(handle, cleanupIntent))) {
						this.#markCleanupFailure();
					}
					this.#failAdapter("cleanup_failed");
					return fail("cleanup_failed");
				}
				if (!this.#isCurrentGeneration(generation)) {
					if (!(await this.#cleanupDetached(handle, cleanupIntent))) {
						this.#markCleanupFailure();
					}
					return this.#throwStale();
				}
				let next: ActiveSessionContext;
				try {
					next = this.#activate(
						handle,
						cleanupIntent,
						expectedSessionId,
						expectedChatId,
					);
				} catch (error) {
					if (!(await this.#cleanupDetached(handle, cleanupIntent))) {
						this.#markCleanupFailure();
					}
					this.#failAdapter("invalid_result");
					throw error;
				}
				if (!this.#isCurrentGeneration(generation)) this.#throwStale();
				return this.#sessionView(next);
			},
		);
	}

	#activate(
		session: ManagedInteractiveSessionPort,
		cleanupIntent: ChatOperationIntent<"stop">,
		expectedSessionId: string,
		expectedChatId?: string,
	): ActiveSessionContext {
		this.#validateHandle(session, expectedSessionId, expectedChatId);
		const context: ActiveSessionContext = {
			session,
			correlation: new ManagedRuntimeCorrelation(session.sessionId),
			cleanupIntent,
			open: true,
			inFlightCalls: 0,
		};
		this.#current = context;
		this.#state = "ready";
		try {
			const unsubscribe = session.subscribeRuntimeEvents((event) =>
				this.#acceptRuntimeEvent(context, event),
			);
			if (!context.open || this.#current !== context) {
				try {
					unsubscribe();
				} catch {
					this.#report("failed");
				}
			} else {
				context.unsubscribe = unsubscribe;
			}
		} catch (error) {
			this.#retire(context);
			throw error;
		}
		return context;
	}

	#validateHandle(
		session: ManagedInteractiveSessionPort,
		expectedSessionId: string,
		expectedChatId?: string,
	): void {
		let actualSessionId: string;
		let actualChatId: string;
		try {
			actualSessionId = assertChatSessionId(session?.sessionId);
			actualChatId = assertChatCatalogId(session?.chatId);
		} catch {
			fail("invalid_result");
		}
		const snapshot = session.getSnapshot();
		if (
			actualSessionId !== expectedSessionId ||
			(expectedChatId !== undefined && actualChatId !== expectedChatId) ||
			snapshot.state !== "ready" ||
			snapshot.sessionId !== actualSessionId ||
			snapshot.chatId !== actualChatId
		) {
			fail("invalid_result");
		}
	}

	async #acceptRuntimeEvent(
		context: ActiveSessionContext,
		event: ManagedHubChatRuntimeEvent,
	): Promise<void> {
		if (!this.#isActiveContext(context)) return;
		let reduced: ManagedInteractiveRuntimeEvent;
		try {
			reduced = reduceManagedRuntimeEvent(event);
			if (
				context.lastSequenceEnd !== undefined &&
				reduced.sequenceStart !== context.lastSequenceEnd + 1
			) {
				fail("invalid_result");
			}
			const correlationBefore = context.correlation.getSnapshot();
			const effects = context.correlation.accept(reduced);
			context.lastSequenceEnd = reduced.sequenceEnd;
			if (reduced.kind === "run.started") {
				this.#recordIntentEvidence("turn", {
					operationId: reduced.operationId,
					runId: reduced.runId,
				});
			}
			if (
				reduced.kind === "compaction.started" ||
				reduced.kind === "compaction.completed" ||
				reduced.kind === "compaction.skipped" ||
				reduced.kind === "compaction.failed"
			) {
				this.#recordIntentEvidence("compaction", {
					operationId: reduced.operationId,
				});
			}
			for (const effect of effects) {
				try {
					await this.#dispatchAbort(
						context,
						effect,
						context.abortRequest?.reason,
					);
				} catch (error) {
					if (
						error instanceof ManagedInteractiveAdapterError &&
						(error.code === "operation_unknown" ||
							error.code === "operation_rejected")
					) {
						this.#report(error.code);
						continue;
					}
					throw error;
				}
			}
			if (reduced.kind === "approval.resolved") {
				this.#recordIntentEvidence(`approval:${reduced.approvalId}`, {
					...(correlationBefore.turn?.runId
						? { runId: correlationBefore.turn.runId }
						: {}),
				});
			}
			if (reduced.kind === "question.cancelled") {
				this.#recordIntentEvidence(`question:${reduced.requestId}`, {
					runId: reduced.runId,
				});
			}
			if (
				reduced.kind === "run.aborted" ||
				reduced.kind === "run.completed" ||
				reduced.kind === "run.failed"
			) {
				const runId = reduced.runId;
				if (correlationBefore.turn) {
					this.#recordIntentEvidence("turn", {
						operationId: correlationBefore.turn.operationId,
						runId,
					});
				}
				if (context.abortRequest) {
					this.#recordIntentEvidence("abort", {
						operationId: context.abortRequest.operationId,
						runId,
					});
				}
				const callbackSlots = new Set([
					...this.#activeIntents.keys(),
					...this.#unknownIntents.keys(),
				]);
				for (const slot of callbackSlots) {
					if (slot.startsWith("approval:") || slot.startsWith("question:")) {
						this.#recordIntentEvidence(slot, { runId });
					}
				}
				context.abortRequest = undefined;
			}
		} catch {
			this.#failContext(context, "failed");
			return;
		}
		if (!this.#isActiveContext(context)) return;
		try {
			await this.#onEvent(reduced);
		} catch {
			this.#report("failed");
		}
	}

	async #dispatchAbort(
		context: ActiveSessionContext,
		effect: ManagedAbortEffect,
		reason?: string,
	): Promise<boolean> {
		const request = runtimeRequest("chat_runtime.abort", {
			operationId: effect.intent.operationId,
			sessionId: context.session.sessionId,
			runId: effect.runId,
			...(reason === undefined ? {} : { reason }),
		});
		const { sessionId: _sessionId, ...sessionRequest } = request;
		let attempt: ManagedIntentAttempt;
		try {
			attempt = this.#beginIntent(
				"abort",
				effect.intent,
				request,
				effect.runId,
			);
		} catch (error) {
			context.correlation.markAbortUnknown(effect.intent);
			throw error;
		}
		try {
			return await this.#invokeIntent(
				attempt,
				async () =>
					await this.#invokeCurrent(context, async () => {
						const result = await context.session.abortRun(sessionRequest);
						let response: HubChatRuntimeResult<"chat_runtime.abort">;
						try {
							response = runtimeResult("chat_runtime.abort", result);
						} catch {
							return this.#invalidResult(context);
						}
						if (
							response.sessionId !== context.session.sessionId ||
							response.operationId !== effect.intent.operationId ||
							response.runId !== effect.runId
						) {
							return this.#invalidResult(context);
						}
						return response.accepted;
					}),
			);
		} catch (error) {
			if (context.open && !attempt.evidenceObserved) {
				try {
					context.correlation.markAbortUnknown(effect.intent);
				} catch {
					this.#failContext(context, "failed");
				}
			}
			throw error;
		}
	}

	#sessionResult<Command extends HubChatRuntimeCommandName>(
		context: ActiveSessionContext,
		command: Command,
		result: unknown,
	): DeepReadonly<HubChatRuntimeResult<Command>> {
		let parsed: HubChatRuntimeResult<Command>;
		try {
			parsed = runtimeResult(command, result);
		} catch {
			return this.#invalidResult(context);
		}
		const response = record(parsed);
		if (!response || response.sessionId !== context.session.sessionId) {
			return this.#invalidResult(context);
		}
		return freezeClone(parsed);
	}

	#invalidResult(context: ActiveSessionContext): never {
		this.#failContext(context, "invalid_result");
		return fail("invalid_result");
	}

	#targetForCurrent(
		target: ManagedChatHistoryTarget,
		context: ActiveSessionContext,
	): ManagedChatHistoryTarget {
		let validated: ManagedChatHistoryTarget;
		try {
			validated = assertManagedChatHistoryTarget(target);
		} catch {
			return fail("invalid_action");
		}
		if (
			validated.catalogState !== "active" ||
			validated.chatId !== context.session.chatId ||
			validated.headSessionId !== context.session.sessionId
		) {
			fail("invalid_action");
		}
		return validated;
	}

	#assertQuiescent(): ActiveSessionContext {
		const current = this.#assertReady();
		const correlation = current.correlation.getSnapshot();
		if (
			correlation.turn ||
			correlation.pendingApprovalIds.length > 0 ||
			correlation.pendingQuestionIds.length > 0 ||
			current.inFlightCalls > 0
		) {
			fail("invalid_state");
		}
		return current;
	}

	#assertReady(): ActiveSessionContext {
		if (this.#state === "disposed") fail("disposed");
		if (this.#state !== "ready" || this.#transition || !this.#current?.open) {
			fail("invalid_state");
		}
		return this.#current;
	}

	#assertNotDisposed(): void {
		if (this.#state === "disposed") fail("disposed");
	}

	async #runTransition<Result>(
		transitionState: "starting" | "transitioning",
		requiredState: "idle" | "ready",
		run: (generation: number) => Promise<Result>,
	): Promise<Result> {
		if (
			this.#state === "disposed" ||
			this.#state !== requiredState ||
			this.#transition
		) {
			fail(this.#state === "disposed" ? "disposed" : "invalid_state");
		}
		const generation = this.#generation + 1;
		this.#generation = generation;
		this.#state = transitionState;
		const task = Promise.resolve().then(() => run(generation));
		this.#transition = task;
		try {
			return await task;
		} finally {
			if (this.#transition === task) this.#transition = undefined;
		}
	}

	#restoreState(generation: number, state: "idle" | "ready"): void {
		if (this.#isCurrentGeneration(generation)) this.#state = state;
	}

	#restoreReadyAfterCommandError(
		generation: number,
		context: ActiveSessionContext,
	): void {
		try {
			if (
				this.#isCurrentGeneration(generation) &&
				context.open &&
				context.session.getSnapshot().state === "ready"
			) {
				this.#state = "ready";
				return;
			}
		} catch {
			// A missing usable snapshot is terminal for this app authority.
		}
		this.#failContext(context, "failed");
	}

	#assertTransitionContext(
		generation: number,
		context: ActiveSessionContext,
	): void {
		if (
			!this.#isCurrentGeneration(generation) ||
			!context.open ||
			this.#current !== context
		) {
			this.#throwStale();
		}
	}

	#isCurrentGeneration(generation: number): boolean {
		return this.#state !== "disposed" && this.#generation === generation;
	}

	#isActiveContext(context: ActiveSessionContext): boolean {
		return context.open && this.#current === context && this.#state === "ready";
	}

	#beginIntent(
		slot: string,
		intent: ChatOperationIntent,
		payload: unknown,
		expectedRunId?: string,
	): ManagedIntentAttempt {
		const attempt: ManagedIntentAttempt = {
			slot,
			kind: intent.kind,
			operationId: intent.operationId,
			digest: managedIntentDigest({ kind: intent.kind, payload }),
			...(expectedRunId === undefined ? {} : { expectedRunId }),
			evidenceObserved: false,
		};
		const unresolved = this.#unknownIntents.get(slot);
		if (
			unresolved &&
			(unresolved.kind !== attempt.kind ||
				unresolved.operationId !== attempt.operationId ||
				unresolved.digest !== attempt.digest ||
				unresolved.expectedRunId !== attempt.expectedRunId)
		) {
			fail("invalid_action");
		}
		if (this.#activeIntents.has(slot)) fail("invalid_state");
		if (this.#activeIntents.size >= MAX_UNKNOWN_INTENTS) {
			fail("invalid_state");
		}
		if (!unresolved && this.#unknownIntents.size >= MAX_UNKNOWN_INTENTS) {
			fail("invalid_state");
		}
		this.#activeIntents.set(slot, attempt);
		return attempt;
	}

	#beginExclusiveIntent(
		slot: string,
		intent: ChatOperationIntent,
		payload: unknown,
		expectedRunId?: string,
	): ManagedIntentAttempt {
		const unresolved = this.#unknownIntents.get(slot);
		if (
			this.#activeIntents.size > 0 ||
			this.#unknownIntents.size > (unresolved ? 1 : 0)
		) {
			fail("invalid_state");
		}
		return this.#beginIntent(slot, intent, payload, expectedRunId);
	}

	#completeIntent(attempt: ManagedIntentAttempt): void {
		if (this.#activeIntents.get(attempt.slot) === attempt) {
			this.#activeIntents.delete(attempt.slot);
		}
		const unresolved = this.#unknownIntents.get(attempt.slot);
		if (
			unresolved?.kind === attempt.kind &&
			unresolved.operationId === attempt.operationId &&
			unresolved.digest === attempt.digest
		) {
			this.#unknownIntents.delete(attempt.slot);
		}
	}

	#failIntent(
		attempt: ManagedIntentAttempt,
		error: unknown,
		retainUnknown = true,
	): ManagedInteractiveAdapterError {
		if (this.#activeIntents.get(attempt.slot) === attempt) {
			this.#activeIntents.delete(attempt.slot);
		}
		if (error instanceof ManagedInteractiveAdapterError) {
			this.#unknownIntents.delete(attempt.slot);
			return error;
		}
		if (this.#state === "disposed" || this.#state === "failed") {
			this.#unknownIntents.delete(attempt.slot);
			return new ManagedInteractiveAdapterError(
				this.#state === "disposed" ? "disposed" : "failed",
			);
		}
		if (attempt.evidenceObserved) {
			this.#unknownIntents.delete(attempt.slot);
			return new ManagedInteractiveAdapterError("operation_unknown");
		}
		if (isAuthoritativeDependencyError(error)) {
			this.#unknownIntents.delete(attempt.slot);
			return new ManagedInteractiveAdapterError("operation_rejected");
		}
		if (retainUnknown) {
			if (
				!this.#unknownIntents.has(attempt.slot) &&
				this.#unknownIntents.size >= MAX_UNKNOWN_INTENTS
			) {
				return new ManagedInteractiveAdapterError("invalid_state");
			}
			this.#unknownIntents.set(attempt.slot, attempt);
		}
		return new ManagedInteractiveAdapterError("operation_unknown");
	}

	async #invokeIntent<Result>(
		attempt: ManagedIntentAttempt,
		invoke: () => Promise<Result>,
		retainUnknown = true,
	): Promise<Result> {
		try {
			const result = await invoke();
			this.#completeIntent(attempt);
			return result;
		} catch (error) {
			throw this.#failIntent(attempt, error, retainUnknown);
		}
	}

	#recordIntentEvidence(
		slot: string,
		input: Readonly<{ operationId?: string; runId?: string }> = {},
	): void {
		const active = this.#activeIntents.get(slot);
		if (active && this.#matchesIntentEvidence(active, input)) {
			active.evidenceObserved = true;
			active.evidenceRunId ??= input.runId;
		}
		const unresolved = this.#unknownIntents.get(slot);
		if (!unresolved) return;
		if (!this.#matchesIntentEvidence(unresolved, input)) return;
		this.#unknownIntents.delete(slot);
	}

	#matchesIntentEvidence(
		attempt: ManagedIntentAttempt,
		input: Readonly<{ operationId?: string; runId?: string }>,
	): boolean {
		if (
			input.operationId !== undefined &&
			attempt.operationId !== input.operationId
		) {
			return false;
		}
		const retainedRunId = attempt.expectedRunId ?? attempt.evidenceRunId;
		return (
			input.runId === undefined ||
			retainedRunId === undefined ||
			retainedRunId === input.runId
		);
	}

	#assertNoUnknownIntent(): void {
		if (this.#unknownIntents.size > 0) fail("invalid_state");
	}

	async #invokeRead<Result>(
		context: ActiveSessionContext,
		invoke: () => Promise<Result>,
	): Promise<Result> {
		this.#assertNoUnknownIntent();
		try {
			return await this.#invokeCurrent(context, invoke);
		} catch (error) {
			if (error instanceof ManagedInteractiveAdapterError) throw error;
			throw new ManagedInteractiveAdapterError("dependency_failed");
		}
	}

	async #invokeCurrent<Result, FinalResult = Result>(
		context: ActiveSessionContext,
		invoke: () => Promise<Result>,
		finalize?: (result: Result) => FinalResult,
	): Promise<FinalResult> {
		if (!this.#isActiveContext(context)) fail("invalid_state");
		const generation = this.#generation;
		context.inFlightCalls += 1;
		try {
			const result = await invoke();
			if (generation !== this.#generation || !this.#isActiveContext(context)) {
				fail(this.#state === "disposed" ? "disposed" : "stale_transition");
			}
			const finalized = finalize
				? finalize(result)
				: (result as unknown as FinalResult);
			if (generation !== this.#generation || !this.#isActiveContext(context)) {
				fail(this.#state === "disposed" ? "disposed" : "stale_transition");
			}
			return finalized;
		} finally {
			context.inFlightCalls -= 1;
		}
	}

	#throwStale(): never {
		return fail(this.#state === "disposed" ? "disposed" : "stale_transition");
	}

	#sessionView(context: ActiveSessionContext): ManagedInteractiveSessionView {
		return Object.freeze({
			sessionId: context.session.sessionId,
			chatId: context.session.chatId,
		});
	}

	#retire(context: ActiveSessionContext): void {
		if (!context.open) return;
		context.open = false;
		try {
			context.unsubscribe?.();
		} catch {
			this.#report("failed");
		}
		context.unsubscribe = undefined;
		context.correlation.dispose();
		if (this.#current === context) this.#current = undefined;
	}

	async #cleanupDetached(
		session: ManagedInteractiveSessionPort,
		intent: ChatOperationIntent<"stop">,
	): Promise<boolean> {
		let stopped = false;
		for (let attempt = 0; attempt < 2 && !stopped; attempt += 1) {
			try {
				const result = await session.stop({
					operationId: intent.operationId,
				});
				stopped = result.stopped === true;
			} catch {
				// One exact retry covers an unknown reply without changing intent.
			}
		}
		let released = true;
		try {
			await session.disposeAsync();
		} catch {
			released = false;
		}
		return stopped && released;
	}

	#failContext(
		context: ActiveSessionContext,
		code: ManagedInteractiveAdapterErrorCode,
	): void {
		if (!context.open) return;
		this.#retire(context);
		if (this.#state !== "disposed") {
			this.#state = "failed";
			this.#generation += 1;
		}
		this.#activeIntents.clear();
		this.#unknownIntents.clear();
		this.#report(code);
		this.#trackCleanup(
			this.#cleanupDetached(context.session, context.cleanupIntent).then(
				(cleaned) => {
					if (!cleaned) this.#markCleanupFailure();
					return this.#disposeClientOnce();
				},
			),
		);
	}

	#failAdapter(code: ManagedInteractiveAdapterErrorCode): void {
		const current = this.#current;
		if (current) this.#retire(current);
		if (this.#state !== "disposed") {
			this.#state = "failed";
			this.#generation += 1;
		}
		this.#activeIntents.clear();
		this.#unknownIntents.clear();
		this.#report(code);
		this.#trackCleanup(
			(current
				? this.#cleanupDetached(current.session, current.cleanupIntent)
				: Promise.resolve(true)
			).then((cleaned) => {
				if (!cleaned) this.#markCleanupFailure();
				return this.#disposeClientOnce();
			}),
		);
	}

	#markCleanupFailure(): void {
		if (this.#cleanupFailed) return;
		this.#cleanupFailed = true;
		this.#report("cleanup_failed");
	}

	#trackCleanup(task: Promise<void>): void {
		const contained = task.catch(() => undefined);
		this.#cleanupTasks.add(contained);
		void contained.finally(() => this.#cleanupTasks.delete(contained));
	}

	#disposeClientOnce(): Promise<void> {
		this.#clientDisposeBarrier ??= Promise.resolve().then(() =>
			this.#client.dispose(),
		);
		return this.#clientDisposeBarrier;
	}

	#report(code: ManagedInteractiveAdapterErrorCode): void {
		if (!this.#onError) return;
		try {
			const outcome = this.#onError(new ManagedInteractiveAdapterError(code));
			void Promise.resolve(outcome).catch(() => undefined);
		} catch {
			// Error observers have no authority over adapter state.
		}
	}
}

export function createManagedInteractiveChatAdapter(
	options: ManagedInteractiveAdapterOptions,
): ManagedInteractiveChatAdapter {
	return new ManagedInteractiveChatAdapter(options);
}
