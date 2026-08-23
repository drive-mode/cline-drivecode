import type {
	HubChatLifecycleRequestPayload,
	HubChatLifecycleResult,
	HubChatRuntimeRequestPayload,
	HubChatRuntimeResult,
} from "@cline/shared";
import type { ManagedInteractiveRuntimeEvent } from "./managed-runtime-events";

type DeepReadonly<Value> = Value extends readonly unknown[]
	? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
	: Value extends object
		? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
		: Value;

export const INTERACTIVE_CHAT_RUNTIME_CONTRACT_VERSION = "v1" as const;

export const INTERACTIVE_CHAT_RUNTIME_METHODS = Object.freeze([
	"getSnapshot",
	"ensureReady",
	"subscribeEvents",
	"runTurn",
	"abortCurrent",
	"listPendingPrompts",
	"updatePendingPrompt",
	"removePendingPrompt",
	"listMessages",
	"listCheckpoints",
	"getUsage",
	"getCompaction",
	"runCompaction",
	"resetForNewSession",
	"restartForConfigurationChange",
	"forkCurrent",
	"restoreCheckpoint",
	"cleanup",
] as const);

export type InteractiveChatRuntimeMethod =
	(typeof INTERACTIVE_CHAT_RUNTIME_METHODS)[number];

export type InteractiveRuntimeAuthority = "legacy" | "managed";

export type InteractiveRuntimeState =
	| "idle"
	| "starting"
	| "transitioning"
	| "ready"
	| "failed"
	| "disposed";

export type InteractiveRuntimeSessionView = Readonly<{
	authority: InteractiveRuntimeAuthority;
	sessionId: string;
	chatId?: string;
}>;

export type InteractiveRuntimeSnapshot = Readonly<{
	version: typeof INTERACTIVE_CHAT_RUNTIME_CONTRACT_VERSION;
	state: InteractiveRuntimeState;
	generation: number;
	session?: InteractiveRuntimeSessionView;
}>;

export type InteractiveRuntimeContextMetric =
	| Readonly<{ kind: "available"; tokens: number }>
	| Readonly<{ kind: "unavailable" }>;

export type InteractiveRuntimeTurnInput = DeepReadonly<
	Omit<
		HubChatLifecycleRequestPayload<"chat_lifecycle.run_turn">,
		"operationId" | "sessionId"
	>
>;

export type InteractiveRuntimeTurnResult = DeepReadonly<
	HubChatLifecycleResult<"chat_lifecycle.run_turn">
> &
	Readonly<{ context: InteractiveRuntimeContextMetric }>;

export type InteractiveRuntimeEvent = ManagedInteractiveRuntimeEvent;

export type InteractiveRuntimePendingPromptPage = DeepReadonly<
	HubChatRuntimeResult<"chat_runtime.pending_prompts.list">
>;

export type InteractiveRuntimePendingPromptUpdate = DeepReadonly<
	Omit<
		HubChatRuntimeRequestPayload<"chat_runtime.pending_prompts.update">,
		"operationId" | "sessionId"
	>
>;

export type InteractiveRuntimePendingPromptMutation = DeepReadonly<
	HubChatRuntimeResult<"chat_runtime.pending_prompts.update">
>;

export type InteractiveRuntimeDisplayMessagePage = DeepReadonly<
	HubChatRuntimeResult<"chat_runtime.messages.list">
>;

export type InteractiveRuntimeCheckpointPage = DeepReadonly<
	HubChatRuntimeResult<"chat_runtime.checkpoints.list">
>;

export type InteractiveRuntimeUsageSnapshot = DeepReadonly<
	HubChatRuntimeResult<"chat_runtime.usage.get">
>;

export type InteractiveRuntimeCompactionSnapshot = DeepReadonly<
	HubChatRuntimeResult<"chat_runtime.compaction.get">
>;

export type InteractiveRuntimeCompactionResult = DeepReadonly<
	HubChatRuntimeResult<"chat_runtime.compaction.run">
>;

export type InteractiveRuntimeAbortResult =
	| Readonly<{ kind: "deferred" }>
	| Readonly<{ kind: "already_dispatched" }>
	| Readonly<{ kind: "dispatched"; accepted: boolean }>;

export type InteractiveRuntimeConfigurationChange =
	| Readonly<{ reason: "mode"; mode: "act" | "plan" }>
	| Readonly<{
			reason:
				| "account"
				| "compaction"
				| "mcp"
				| "model"
				| "plugin"
				| "policy"
				| "skill"
				| "tool";
	  }>;

export type InteractiveRuntimeForkResult = Readonly<{
	previous: InteractiveRuntimeSessionView;
	current: InteractiveRuntimeSessionView;
}>;

export type InteractiveRuntimeRestoreInput = Readonly<{
	checkpointRunCount: number;
	restoreWorkspace: boolean;
}>;

export type InteractiveRuntimeRestoreResult = Readonly<{
	previous: InteractiveRuntimeSessionView;
	current: InteractiveRuntimeSessionView;
	checkpoint: InteractiveRuntimeCheckpointPage["checkpoints"][number];
}>;

export type InteractiveRuntimeExitSummary = Readonly<{
	sessionId: string;
	messageCount?: number;
	totalCost?: number;
}>;

/**
 * App-owned interactive authority. Implementations terminate Legacy or managed
 * dependencies behind these presentation-safe semantic operations. The port
 * intentionally contains no fresh-process resume operation; managed reattach
 * remains unavailable while ADR-0045 is Proposed.
 */
export interface InteractiveChatRuntime {
	getSnapshot(): InteractiveRuntimeSnapshot;
	ensureReady(): Promise<InteractiveRuntimeSessionView>;
	subscribeEvents(
		listener: (event: InteractiveRuntimeEvent) => void | Promise<void>,
	): () => void;
	runTurn(
		input: InteractiveRuntimeTurnInput,
	): Promise<InteractiveRuntimeTurnResult>;
	abortCurrent(reason?: string): Promise<InteractiveRuntimeAbortResult>;
	listPendingPrompts(input?: {
		cursor?: string;
		limit?: number;
	}): Promise<InteractiveRuntimePendingPromptPage>;
	updatePendingPrompt(
		input: InteractiveRuntimePendingPromptUpdate,
	): Promise<InteractiveRuntimePendingPromptMutation>;
	removePendingPrompt(
		promptId: string,
	): Promise<InteractiveRuntimePendingPromptMutation>;
	listMessages(input?: {
		cursor?: string;
		limit?: number;
	}): Promise<InteractiveRuntimeDisplayMessagePage>;
	listCheckpoints(input?: {
		limit?: number;
	}): Promise<InteractiveRuntimeCheckpointPage>;
	getUsage(): Promise<InteractiveRuntimeUsageSnapshot>;
	getCompaction(): Promise<InteractiveRuntimeCompactionSnapshot>;
	runCompaction(reason?: string): Promise<InteractiveRuntimeCompactionResult>;
	resetForNewSession(): Promise<void>;
	restartForConfigurationChange(
		change: InteractiveRuntimeConfigurationChange,
	): Promise<InteractiveRuntimeSessionView>;
	forkCurrent(): Promise<InteractiveRuntimeForkResult>;
	restoreCheckpoint(
		input: InteractiveRuntimeRestoreInput,
	): Promise<InteractiveRuntimeRestoreResult>;
	cleanup(): Promise<InteractiveRuntimeExitSummary | undefined>;
}
