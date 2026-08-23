import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentMode,
	type AgentResult,
	CHAT_LIFECYCLE_WIRE_VERSION,
	type HubChatLifecycleBindingScope,
	type HubChatLifecycleCommandName,
	type HubChatLifecycleProfileAuthority,
	type HubChatLifecycleStartProfile,
	type HubChatProjectionChat,
	type HubChatProjectionGetRequest,
	type HubChatProjectionListRequest,
	type HubChatRuntimeAttachments,
	parseHubChatLifecycleReconciledWireEvent,
	parseHubChatLifecycleWireEvent,
	parseHubChatLifecycleWireRequest,
	parseHubChatLifecycleWireResult,
	parseHubChatProjectionWireRequest,
	parseHubChatProjectionWireResult,
} from "@cline/shared";
import { ClineCore } from "../../ClineCore";
import type {
	CatalogAudienceChatSource,
	CatalogAudienceLifecycleEvent,
	CatalogLifecycleEvent,
	CatalogLifecycleEventSource,
} from "../../chat-catalog/chat-catalog-event-source";
import { CATALOG_LIFECYCLE_EVENT_TYPES } from "../../chat-catalog/chat-catalog-event-source";
import {
	getClineCoreCatalogAudienceSource,
	getClineCoreCatalogLifecycleEventSource,
} from "../../chat-catalog/cline-core-event-source-registry";
import {
	digestManagedExecutionPolicy,
	MANAGED_PROFILE_AUTHORITY_METADATA_KEY,
	managedProfileAuthorityMetadata,
} from "../../chat-catalog/managed-profile-authority";
import { ChatCatalogError } from "../../chat-catalog/sqlite-chat-catalog-service";
import type {
	ClineCoreChatLifecycleApi,
	ClineCoreChatLifecycleConfirmationRequest,
	ClineCoreChatLifecycleStartRelatedInput,
	ClineCoreOptions,
	ClineCoreStartInput,
} from "../../cline-core/types";
import type { ClineCoreStartConfig } from "../../types/config";
import type { BoundedRuntimeEventJournalOptions } from "./bounded-runtime-event-journal";
import { digestHubWorkspaceConnectionPolicy } from "./workspace-capability-authority";
import type {
	HubWorkspaceManagedCore,
	HubWorkspaceManagedCoreFactory,
	HubWorkspaceManagedCoreScope,
	HubWorkspaceManagedEventInvocation,
	HubWorkspaceManagedLifecycleInvocation,
	HubWorkspaceManagedProjectionInvocation,
	HubWorkspaceManagedRuntimeEventInvocation,
	HubWorkspaceManagedRuntimeInvocation,
} from "./workspace-managed-core-pool";
import {
	ManagedRuntimeAdapter,
	type ManagedRuntimeCoreHandle,
	type ManagedRuntimeInvocationContext,
} from "./workspace-managed-runtime-adapter";
import {
	type HubManagedRuntimeCapabilityManifest,
	normalizeHubManagedRuntimeCapabilityManifest,
} from "./workspace-managed-runtime-capabilities";

type ManagedStartConfig = Omit<
	ClineCoreStartConfig,
	"sessionId" | "cwd" | "workspaceRoot"
>;

export interface HubWorkspaceManagedResolvedStartProfile {
	readonly config: ManagedStartConfig;
	readonly localRuntime?: ClineCoreStartInput["localRuntime"];
	/** Immutable, closed-world client callback authority selected by the host. */
	readonly runtimeCapabilityManifest?: HubManagedRuntimeCapabilityManifest;
	/** Function-bearing profile capabilities are forbidden at this boundary. */
	readonly capabilities?: ClineCoreStartInput["capabilities"];
	readonly toolPolicies?: ClineCoreStartInput["toolPolicies"];
	readonly source?: ClineCoreStartInput["source"];
	readonly sessionMetadata?: Readonly<Record<string, unknown>>;
	readonly interactive: boolean;
	/** Immutable semantic revision persisted with every admitted session. */
	readonly profileRevision: number;
	/** Per-turn mode ceiling persisted with the session. */
	readonly allowedModes: readonly AgentMode[];
}

export interface HubWorkspaceManagedProfileResolver {
	resolveStartProfile(
		input: Readonly<{
			profileId: string;
			identity: HubWorkspaceManagedLifecycleInvocation["identity"];
			signal: AbortSignal;
			requested: Readonly<Omit<HubChatLifecycleStartProfile, "profileId">>;
		}>,
	):
		| HubWorkspaceManagedResolvedStartProfile
		| undefined
		| Promise<HubWorkspaceManagedResolvedStartProfile | undefined>;
	resolveBindingProfile(
		input: Readonly<{
			profileId: string;
			identity: HubWorkspaceManagedLifecycleInvocation["identity"];
			signal: AbortSignal;
			requested: Readonly<Omit<HubChatLifecycleBindingScope, "profileId">>;
		}>,
	):
		| ResolvedBindingScope
		| undefined
		| Promise<ResolvedBindingScope | undefined>;
}

export interface ResolvedBindingScope {
	readonly transport: string;
	readonly instanceId?: string;
	readonly channelId?: string;
	readonly threadId?: string;
	readonly participantScope?: string;
}

interface ManagedClineCoreHandle {
	readonly chatLifecycle: ClineCore["chatLifecycle"];
	readonly chatLifecycleEventSource: CatalogLifecycleEventSource | undefined;
	readonly chatAudienceSource?: CatalogAudienceChatSource;
	readonly runtime?: ManagedRuntimeCoreHandle;
	dispose(reason?: string): Promise<void>;
}

export interface HubWorkspaceManagedClineCoreFactoryOptions {
	readonly profiles: HubWorkspaceManagedProfileResolver;
	readonly coreOptions?: Omit<
		ClineCoreOptions,
		"backendMode" | "chatLifecycle" | "sessionService"
	>;
	readonly dataDirForScope?: (
		scope: HubWorkspaceManagedCoreScope,
	) => string | undefined;
	/** Test/embedding seam; production defaults to ClineCore.create. */
	readonly createCore?: (
		options: ClineCoreOptions,
	) => Promise<ManagedClineCoreHandle>;
	/** Bounded background poll for catalog events not caused by a wire command. */
	readonly eventPollIntervalMs?: number;
	readonly eventBatchLimit?: number;
	/** Bounds the process-local sanitized runtime recovery journal. */
	readonly runtimeRecoveryJournal?: BoundedRuntimeEventJournalOptions;
	/** Receives only fixed, pathless event-source health failures. */
	readonly onEventSourceError?: (error: ChatCatalogError) => void;
}

interface ListenerState {
	readonly invocation: HubWorkspaceManagedEventInvocation;
	scanCursor: number;
	deliveredCursor: number;
	ready: boolean;
	readonly reconciled: boolean;
	readonly release: () => void;
}

interface ProjectionSnapshotState {
	readonly snapshotId: string;
	readonly connectionId: string;
	readonly catalogState: "active" | "archived" | "all";
	readonly pageSize: number;
	readonly snapshotSequence: number;
	readonly chats: readonly HubChatProjectionChat[];
	readonly cursorByOffset: Map<number, string>;
	readonly offsetByCursor: Map<string, number>;
	readonly expiresAt: number;
}

const DEFAULT_EVENT_POLL_INTERVAL_MS = 250;
const DEFAULT_EVENT_BATCH_LIMIT = 256;
const MAX_EVENT_BATCH_LIMIT = 1_024;
const MAX_DRAIN_BATCHES = 64;
const MAX_PROJECTION_SNAPSHOTS = 32;
const MAX_PROJECTION_SNAPSHOT_CHATS = 4_096;
const PROJECTION_SNAPSHOT_TTL_MS = 60_000;
const projectableCatalogEventTypes = new Set<string>(
	CATALOG_LIFECYCLE_EVENT_TYPES,
);

function boundedPositiveInteger(
	value: number | undefined,
	fallback: number,
	maximum: number,
	label: string,
): number {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
		throw new ChatCatalogError("invalid_input", `${label} is invalid`);
	}
	return resolved;
}

function safeSequence(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"catalog lifecycle event sequence is invalid",
		);
	}
	return value;
}

function deepFreezeProfileValue<T>(value: T, seen = new WeakSet<object>()): T {
	if (!value || typeof value !== "object" || seen.has(value)) return value;
	seen.add(value);
	for (const child of Object.values(value as Record<string, unknown>)) {
		deepFreezeProfileValue(child, seen);
	}
	return Object.freeze(value);
}

function snapshotResolvedProfile(
	profile: HubWorkspaceManagedResolvedStartProfile,
): HubWorkspaceManagedResolvedStartProfile {
	try {
		return deepFreezeProfileValue(structuredClone(profile));
	} catch {
		throw new ChatCatalogError(
			"unsupported_capability",
			"managed runtime profile is not immutable data",
		);
	}
}

interface StartPayload {
	operationId: string;
	sessionId: string;
	chatId?: string;
	parentSessionId?: string;
	relationKind?: "fork" | "checkpoint_restore" | "config_restart" | "recovery";
	expectedRevision?: number;
	checkpointRunCount?: number;
	restore?: {
		messages?: boolean;
		workspace?: boolean;
		omitCheckpointMessageFromSession?: boolean;
	};
	title?: string;
	titleSource?: string;
	leaseTtlMs?: number;
	expectedLeaseRevision?: number;
	start: HubChatLifecycleStartProfile;
}

interface ManagedStartMaterialization {
	readonly startInput: ClineCoreStartInput;
	readonly capabilityManifest: HubManagedRuntimeCapabilityManifest;
	readonly profileAuthority: HubChatLifecycleProfileAuthority;
}

function requiredString(value: unknown, label: string): string {
	const normalized = typeof value === "string" ? value.trim() : "";
	if (!normalized)
		throw new ChatCatalogError("invalid_input", `${label} is missing`);
	return normalized;
}

function finite(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function runWithManagedAttachments<T>(input: {
	payload: Record<string, unknown>;
	signal: AbortSignal;
	run: (payload: Record<string, unknown>) => Promise<T>;
}): Promise<T> {
	const attachments = input.payload.attachments as
		| HubChatRuntimeAttachments
		| undefined;
	if (!attachments) return await input.run(input.payload);
	const { attachments: _attachments, ...basePayload } = input.payload;
	const images = (attachments.images ?? []).map(
		(image) => `data:${image.mediaType};base64,${image.dataBase64}`,
	);
	let directory: string | undefined;
	try {
		input.signal.throwIfAborted();
		const userFiles: string[] = [];
		if ((attachments.files?.length ?? 0) > 0) {
			directory = await mkdtemp(join(tmpdir(), "cline-managed-attachments-"));
			for (const [index, file] of (attachments.files ?? []).entries()) {
				input.signal.throwIfAborted();
				const materializedPath = join(
					directory,
					`${String(index).padStart(3, "0")}-${file.name}`,
				);
				await writeFile(materializedPath, file.content, {
					encoding: "utf8",
					flag: "wx",
					mode: 0o600,
				});
				userFiles.push(materializedPath);
			}
		}
		input.signal.throwIfAborted();
		return await input.run({
			...basePayload,
			...(images.length > 0 ? { userImages: images } : {}),
			...(userFiles.length > 0 ? { userFiles } : {}),
		});
	} finally {
		if (directory) {
			await rm(directory, { recursive: true, force: true }).catch(
				() => undefined,
			);
		}
	}
}

function sanitizeTurn(result: AgentResult | undefined): unknown {
	if (!result) return null;
	return {
		text:
			result.finishReason === "error"
				? "Managed run failed."
				: result.text.slice(0, 256 * 1024),
		usage: {
			inputTokens: finite(result.usage.inputTokens),
			outputTokens: finite(result.usage.outputTokens),
			cacheReadTokens: finite(result.usage.cacheReadTokens),
			cacheWriteTokens: finite(result.usage.cacheWriteTokens),
			totalCost: finite(result.usage.totalCost),
		},
		iterations: result.iterations,
		finishReason: result.finishReason,
		model: { id: result.model.id, provider: result.model.provider },
		startedAt: result.startedAt.toISOString(),
		endedAt: result.endedAt.toISOString(),
		durationMs: result.durationMs,
	};
}

function sanitizeBinding(
	binding: Awaited<ReturnType<ClineCoreChatLifecycleApi["bind"]>>,
): unknown {
	return {
		bindingId: binding.bindingId,
		transport: binding.transport,
		instanceId: binding.instanceId,
		channelId: binding.channelId,
		threadId: binding.threadId,
		participantScope: binding.participantScope,
		bound: binding.bound,
		...(binding.chatId ? { chatId: binding.chatId } : {}),
		...(binding.sessionId ? { sessionId: binding.sessionId } : {}),
		revision: binding.revision,
		updatedAt: binding.updatedAt,
	};
}

function sanitizeChat(
	chat: Awaited<ReturnType<ClineCoreChatLifecycleApi["archive"]>>,
): unknown {
	return {
		chatId: chat.chatId,
		catalogState: chat.catalogState,
		headSessionId: chat.headSessionId,
		...(chat.parentChatId ? { parentChatId: chat.parentChatId } : {}),
		...(chat.title ? { title: chat.title } : {}),
		...(chat.titleSource ? { titleSource: chat.titleSource } : {}),
		sourceKind: chat.sourceKind,
		createdAt: chat.createdAt,
		lastActivityAt: chat.lastActivityAt,
		...(chat.archivedAt ? { archivedAt: chat.archivedAt } : {}),
		revision: chat.revision,
		sessions: chat.sessions.map((session) => ({ ...session })),
		bindings: chat.bindings.map((binding) => sanitizeBinding(binding)),
	};
}

function sanitizeStart(
	result: Awaited<ReturnType<ClineCoreChatLifecycleApi["startRoot"]>>,
	profileAuthority: HubChatLifecycleProfileAuthority,
): unknown {
	return {
		sessionId: result.startResult.sessionId,
		chatId: result.chatId,
		leaseRevision: result.leaseRevision,
		writerGeneration: result.writerGeneration,
		leaseExpiresAt: result.leaseExpiresAt,
		profileAuthority,
		...(result.turnResult ? { turn: sanitizeTurn(result.turnResult) } : {}),
	};
}

function safeScope(input: ResolvedBindingScope): ResolvedBindingScope {
	return Object.freeze({
		transport: requiredString(input.transport, "binding transport"),
		...(input.instanceId
			? { instanceId: requiredString(input.instanceId, "binding instance") }
			: {}),
		...(input.channelId
			? { channelId: requiredString(input.channelId, "binding channel") }
			: {}),
		...(input.threadId
			? { threadId: requiredString(input.threadId, "binding thread") }
			: {}),
		...(input.participantScope
			? {
					participantScope: requiredString(
						input.participantScope,
						"binding participant",
					),
				}
			: {}),
	});
}

class ManagedLifecycleAdapter {
	readonly #core: ManagedClineCoreHandle;
	readonly #audienceSource: CatalogAudienceChatSource;
	readonly #profiles: HubWorkspaceManagedProfileResolver;
	readonly #invocations: AsyncLocalStorage<ManagedRuntimeInvocationContext>;
	readonly #scope: HubWorkspaceManagedCoreScope;
	readonly #eventPollIntervalMs: number;
	readonly #eventBatchLimit: number;
	readonly #onEventSourceError: ((error: ChatCatalogError) => void) | undefined;
	readonly #disposeCore: (reason?: string) => Promise<void>;
	readonly #runtime: ManagedRuntimeAdapter | undefined;
	readonly #listeners = new Set<ListenerState>();
	readonly #projectionSnapshots = new Map<string, ProjectionSnapshotState>();
	#pollTimer: ReturnType<typeof setTimeout> | undefined;
	#disposed = false;
	#eventSourceFailed = false;

	constructor(input: {
		core: ManagedClineCoreHandle;
		audienceSource: CatalogAudienceChatSource;
		profiles: HubWorkspaceManagedProfileResolver;
		invocations: AsyncLocalStorage<ManagedRuntimeInvocationContext>;
		scope: HubWorkspaceManagedCoreScope;
		eventPollIntervalMs: number;
		eventBatchLimit: number;
		onEventSourceError?: (error: ChatCatalogError) => void;
		disposeCore: (reason?: string) => Promise<void>;
		runtime?: ManagedRuntimeAdapter;
	}) {
		this.#core = input.core;
		this.#audienceSource = input.audienceSource;
		this.#profiles = input.profiles;
		this.#invocations = input.invocations;
		this.#scope = input.scope;
		this.#eventPollIntervalMs = input.eventPollIntervalMs;
		this.#eventBatchLimit = input.eventBatchLimit;
		this.#onEventSourceError = input.onEventSourceError;
		this.#disposeCore = input.disposeCore;
		this.#runtime = input.runtime;
		this.#scope.signal.addEventListener(
			"abort",
			() => {
				this.#stopPolling();
				for (const listener of [...this.#listeners]) listener.release();
			},
			{ once: true },
		);
	}

	async resolveConfirmationTarget(
		invocation: HubWorkspaceManagedLifecycleInvocation,
	): Promise<ClineCoreChatLifecycleConfirmationRequest | undefined> {
		this.#assertScope(invocation.identity);
		this.#scope.signal.throwIfAborted();
		invocation.signal.throwIfAborted();
		invocation.confirmationSignal?.throwIfAborted();
		const parsed = parseHubChatLifecycleWireRequest({
			version: CHAT_LIFECYCLE_WIRE_VERSION,
			command: invocation.command,
			payload: invocation.payload,
		});
		if (parsed.command !== "chat_lifecycle.resume") return undefined;
		const sessionId = requiredString(
			parsed.payload.sessionId,
			"resume session id",
		);
		const projection = this.#audienceSource.getSessionProjection({ sessionId });
		invocation.signal.throwIfAborted();
		invocation.confirmationSignal?.throwIfAborted();
		this.#scope.signal.throwIfAborted();
		if (projection.chat?.catalogState !== "archived") {
			return undefined;
		}
		return Object.freeze({
			confirmation: "activate",
			aggregateKind: "chat",
			aggregateId: projection.chat.chatId,
			expectedRevision: projection.chat.revision,
		});
	}

	async invoke(
		invocation: HubWorkspaceManagedLifecycleInvocation,
	): Promise<unknown> {
		this.#assertScope(invocation.identity);
		this.#scope.signal.throwIfAborted();
		const parsed = parseHubChatLifecycleWireRequest({
			version: CHAT_LIFECYCLE_WIRE_VERSION,
			command: invocation.command,
			payload: invocation.payload,
		});
		const operationId =
			typeof parsed.payload.operationId === "string"
				? parsed.payload.operationId
				: undefined;
		return await this.#invocations.run(
			{
				identity: invocation.identity,
				signal: invocation.signal,
				...(invocation.confirmationSignal
					? { confirmationSignal: invocation.confirmationSignal }
					: {}),
				lifecycleCommand: parsed.command,
				...(operationId ? { operationId } : {}),
				...(invocation.confirm ? { confirm: invocation.confirm } : {}),
			},
			async () => {
				invocation.signal.throwIfAborted();
				this.#scope.signal.throwIfAborted();
				const result = await this.#dispatch(
					parsed.command,
					parsed.payload,
					invocation,
				);
				invocation.signal.throwIfAborted();
				this.#scope.signal.throwIfAborted();
				const normalized = parseHubChatLifecycleWireResult(
					parsed.command,
					result,
				);
				this.#requestDrain();
				return normalized;
			},
		);
	}

	async invokeProjection(
		invocation: HubWorkspaceManagedProjectionInvocation,
	): Promise<unknown> {
		this.#assertScope(invocation.identity);
		this.#scope.signal.throwIfAborted();
		invocation.signal.throwIfAborted();
		const parsed = parseHubChatProjectionWireRequest({
			version: "v1",
			command: invocation.command,
			payload: invocation.payload,
		});
		let result: unknown;
		switch (parsed.command) {
			case "chat_projection.list":
				result = this.#listProjection(
					invocation.identity.connectionId,
					parsed.payload as HubChatProjectionListRequest,
				);
				break;
			case "chat_projection.get":
				result = this.#getProjection(
					parsed.payload as HubChatProjectionGetRequest,
				);
				break;
		}
		invocation.signal.throwIfAborted();
		this.#scope.signal.throwIfAborted();
		return parseHubChatProjectionWireResult(parsed.command, result);
	}

	#listProjection(
		connectionId: string,
		request: HubChatProjectionListRequest,
	): unknown {
		const now = Date.now();
		this.#pruneProjectionSnapshots(now);
		const catalogState = request.catalogState ?? "all";
		const pageSize = request.limit ?? 100;
		let snapshot: ProjectionSnapshotState;
		let offset = 0;
		if (request.snapshotId === undefined) {
			const materialized = this.#audienceSource.createProjectionSnapshot({
				catalogState,
				maxChats: MAX_PROJECTION_SNAPSHOT_CHATS,
			});
			const snapshotId = `snap_${randomUUID()}`;
			snapshot = Object.freeze({
				snapshotId,
				connectionId,
				catalogState,
				pageSize,
				snapshotSequence: safeSequence(materialized.snapshotSequence),
				chats: Object.freeze([...materialized.chats]),
				cursorByOffset: new Map<number, string>(),
				offsetByCursor: new Map<string, number>(),
				expiresAt: now + PROJECTION_SNAPSHOT_TTL_MS,
			});
			while (this.#projectionSnapshots.size >= MAX_PROJECTION_SNAPSHOTS) {
				const oldest = this.#projectionSnapshots.keys().next().value;
				if (typeof oldest !== "string") break;
				this.#projectionSnapshots.delete(oldest);
			}
			this.#projectionSnapshots.set(snapshotId, snapshot);
		} else {
			const existing = this.#projectionSnapshots.get(request.snapshotId);
			if (
				!existing ||
				existing.connectionId !== connectionId ||
				existing.catalogState !== catalogState ||
				existing.pageSize !== pageSize ||
				existing.expiresAt <= now ||
				request.cursor === undefined
			) {
				throw new ChatCatalogError(
					"invalid_input",
					"projection continuation is unavailable",
				);
			}
			const resumedOffset = existing.offsetByCursor.get(request.cursor);
			if (resumedOffset === undefined) {
				throw new ChatCatalogError(
					"invalid_input",
					"projection continuation is unavailable",
				);
			}
			snapshot = existing;
			offset = resumedOffset;
		}
		const chats = snapshot.chats.slice(offset, offset + pageSize);
		const nextOffset = offset + chats.length;
		const hasMore = nextOffset < snapshot.chats.length;
		let nextCursor: string | undefined;
		if (hasMore) {
			nextCursor = snapshot.cursorByOffset.get(nextOffset);
			if (!nextCursor) {
				nextCursor = `cur_${randomUUID()}`;
				snapshot.cursorByOffset.set(nextOffset, nextCursor);
				snapshot.offsetByCursor.set(nextCursor, nextOffset);
			}
		}
		return {
			snapshotId: snapshot.snapshotId,
			snapshotSequence: snapshot.snapshotSequence,
			chats,
			...(nextCursor ? { nextCursor } : {}),
			hasMore,
		};
	}

	#getProjection(request: HubChatProjectionGetRequest): unknown {
		const result = this.#audienceSource.getProjection({
			chatId: request.chatId,
		});
		return {
			snapshotId: `snap_${randomUUID()}`,
			snapshotSequence: safeSequence(result.snapshotSequence),
			chat: result.chat,
		};
	}

	#pruneProjectionSnapshots(now: number): void {
		for (const [snapshotId, snapshot] of this.#projectionSnapshots) {
			if (snapshot.expiresAt <= now) {
				this.#projectionSnapshots.delete(snapshotId);
			}
		}
	}

	subscribe(invocation: HubWorkspaceManagedEventInvocation): () => void {
		this.#assertScope(invocation.identity);
		this.#scope.signal.throwIfAborted();
		invocation.signal.throwIfAborted();
		if (this.#disposed) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed lifecycle event source was disposed",
			);
		}
		if (this.#eventSourceFailed) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed lifecycle event source is unhealthy",
			);
		}
		const sourceHead = safeSequence(this.#audienceSource.currentSequence());
		const reconciled = invocation.afterSequence !== undefined;
		const cursor = reconciled
			? safeSequence(invocation.afterSequence as number)
			: sourceHead;
		if (cursor > sourceHead) {
			throw new ChatCatalogError(
				"lifecycle_replay_unavailable",
				"lifecycle cursor is ahead of the retained catalog head",
			);
		}
		if (reconciled && invocation.sessionId) {
			throw new ChatCatalogError(
				"invalid_input",
				"reconciled lifecycle replay is global to its audience",
			);
		}
		let active = true;
		let state: ListenerState;
		const release = () => {
			if (!active) return;
			active = false;
			invocation.signal.removeEventListener("abort", release);
			this.#listeners.delete(state);
			this.#stopPollingWhenIdle();
		};
		state = {
			invocation,
			scanCursor: cursor,
			deliveredCursor: cursor,
			ready: !reconciled,
			reconciled,
			release,
		};
		this.#listeners.add(state);
		invocation.signal.addEventListener("abort", release, { once: true });
		if (reconciled) {
			try {
				this.#replayState(state);
			} catch (error) {
				release();
				throw error;
			}
		}
		this.#startPolling();
		return release;
	}

	async dispose(reason?: string): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#stopPolling();
		for (const listener of [...this.#listeners]) listener.release();
		this.#projectionSnapshots.clear();
		await this.#disposeCore(reason);
	}

	#assertScope(
		identity: HubWorkspaceManagedLifecycleInvocation["identity"],
	): void {
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
				"managed lifecycle identity does not match the Core authority scope",
			);
		}
	}

	async #startInput(
		wire: HubChatLifecycleStartProfile,
		sessionId: string,
		invocation: HubWorkspaceManagedLifecycleInvocation,
	): Promise<ManagedStartMaterialization> {
		const profile = await this.#profiles.resolveStartProfile(
			Object.freeze({
				profileId: wire.profileId,
				identity: invocation.identity,
				signal: invocation.signal,
				requested: Object.freeze({
					...(wire.interactive === undefined
						? {}
						: { interactive: wire.interactive }),
					...(wire.mode === undefined ? {} : { mode: wire.mode }),
					...(wire.relativeCwd === undefined
						? {}
						: { relativeCwd: wire.relativeCwd }),
				}),
			}),
		);
		invocation.signal.throwIfAborted();
		if (!profile) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed runtime profile is unavailable",
			);
		}
		if (
			profile.localRuntime !== undefined ||
			profile.capabilities !== undefined
		) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed runtime profile contains unsupported runtime authority",
			);
		}
		const resolvedProfile = snapshotResolvedProfile(profile);
		const capabilityManifest = normalizeHubManagedRuntimeCapabilityManifest(
			resolvedProfile.runtimeCapabilityManifest,
		);
		if (capabilityManifest.callbacks.length > 0 && !this.#runtime) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed runtime callback authority is unavailable",
			);
		}
		const rawConfig = resolvedProfile.config as ClineCoreStartConfig;
		if (
			rawConfig.sessionId !== undefined ||
			rawConfig.cwd !== undefined ||
			rawConfig.workspaceRoot !== undefined
		) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed runtime profile contains forbidden authority fields",
			);
		}
		const {
			sessionId: _sessionId,
			cwd: _cwd,
			workspaceRoot: _workspaceRoot,
			...trustedConfig
		} = rawConfig;
		if (
			!Number.isSafeInteger(resolvedProfile.profileRevision) ||
			resolvedProfile.profileRevision < 1 ||
			!Array.isArray(resolvedProfile.allowedModes) ||
			resolvedProfile.allowedModes.length < 1 ||
			typeof resolvedProfile.interactive !== "boolean"
		) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed runtime profile is missing required security policy",
			);
		}
		const allowedModes = resolvedProfile.allowedModes;
		const effectiveMode = wire.mode ?? trustedConfig.mode;
		if (effectiveMode && !allowedModes.includes(effectiveMode)) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed runtime profile does not allow the requested mode",
			);
		}
		if (
			resolvedProfile.sessionMetadata &&
			MANAGED_PROFILE_AUTHORITY_METADATA_KEY in resolvedProfile.sessionMetadata
		) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed runtime profile contains reserved authority metadata",
			);
		}
		const interactive = wire.interactive ?? resolvedProfile.interactive;
		const compactionPolicy = trustedConfig.compaction;
		const executionPolicyDigest = digestManagedExecutionPolicy({
			profileRevision: resolvedProfile.profileRevision,
			allowedModes: [...allowedModes].sort(),
			interactive,
			providerId: trustedConfig.providerId,
			modelId: trustedConfig.modelId,
			mode: effectiveMode,
			yolo: trustedConfig.yolo,
			enableTools: trustedConfig.enableTools,
			enableSpawnAgent: trustedConfig.enableSpawnAgent,
			enableAgentTeams: trustedConfig.enableAgentTeams,
			disableMcpSettingsTools: trustedConfig.disableMcpSettingsTools,
			thinking: trustedConfig.thinking,
			reasoningEffort: trustedConfig.reasoningEffort,
			thinkingBudgetTokens: trustedConfig.thinkingBudgetTokens,
			toolPolicies: resolvedProfile.toolPolicies,
			manualCompaction: {
				enabled: compactionPolicy?.enabled === true,
				strategy: compactionPolicy?.strategy ?? "agentic",
				preserveRecentTokens: compactionPolicy?.preserveRecentTokens ?? null,
				summarizer: compactionPolicy?.summarizer
					? {
							providerId: compactionPolicy.summarizer.providerId,
							modelId: compactionPolicy.summarizer.modelId,
							maxOutputTokens:
								compactionPolicy.summarizer.maxOutputTokens ?? null,
						}
					: null,
				clientCallbackAllowed: false,
			},
			runtimeCapabilityManifest: capabilityManifest,
			source: resolvedProfile.source,
		});
		const profileAuthorityMetadata = managedProfileAuthorityMetadata({
			profileId: wire.profileId,
			profileRevision: resolvedProfile.profileRevision,
			authorityClassId: invocation.identity.policy.authorityClassId,
			policyEpoch: invocation.identity.policy.policyEpoch,
			connectionPolicyDigest: digestHubWorkspaceConnectionPolicy(
				invocation.identity.policy,
			),
			executionPolicyDigest,
			interactive,
			allowedModes,
		});
		const persistedProfileAuthority =
			profileAuthorityMetadata[MANAGED_PROFILE_AUTHORITY_METADATA_KEY];
		const profileAuthority = Object.freeze({
			profileId: persistedProfileAuthority.profileId,
			profileRevision: persistedProfileAuthority.profileRevision,
			authorityClassId: persistedProfileAuthority.authorityClassId,
			policyEpoch: persistedProfileAuthority.policyEpoch,
			allowedModes: Object.freeze([...persistedProfileAuthority.allowedModes]),
		});
		const cwd = invocation.resolvedCwd ?? this.#scope.workspaceKey;
		return Object.freeze({
			startInput: {
				config: {
					...trustedConfig,
					...(wire.mode ? { mode: wire.mode } : {}),
					sessionId,
					cwd,
					workspaceRoot: this.#scope.workspaceKey,
				},
				interactive,
				...(this.#runtime
					? {
							capabilities: this.#runtime.capabilitiesFor(capabilityManifest),
						}
					: {}),
				...(resolvedProfile.toolPolicies
					? { toolPolicies: resolvedProfile.toolPolicies }
					: {}),
				...(resolvedProfile.source ? { source: resolvedProfile.source } : {}),
				sessionMetadata: {
					...(resolvedProfile.sessionMetadata ?? {}),
					...profileAuthorityMetadata,
				},
			},
			capabilityManifest,
			profileAuthority,
		});
	}

	async #bindingScope(
		wire: HubChatLifecycleBindingScope,
		invocation: HubWorkspaceManagedLifecycleInvocation,
	): Promise<ResolvedBindingScope> {
		const { profileId, ...requested } = wire;
		const resolved = await this.#profiles.resolveBindingProfile(
			Object.freeze({
				profileId,
				identity: invocation.identity,
				signal: invocation.signal,
				requested: Object.freeze(requested),
			}),
		);
		invocation.signal.throwIfAborted();
		if (!resolved) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"managed binding profile is unavailable",
			);
		}
		return safeScope(resolved);
	}

	async #withRuntimeSessionRegistration<
		T extends {
			readonly startResult: { readonly sessionId: string };
			readonly leaseRevision: number;
			readonly writerGeneration: number;
			readonly leaseExpiresAt: string;
		},
	>(input: {
		readonly sessionId: string;
		readonly operationId: string;
		readonly command: HubChatLifecycleCommandName;
		readonly invocation: HubWorkspaceManagedLifecycleInvocation;
		readonly capabilityManifest:
			| HubManagedRuntimeCapabilityManifest
			| undefined;
		readonly start: () => Promise<T>;
	}): Promise<T> {
		const runtime = this.#runtime;
		if (!runtime) return await input.start();
		const releaseReservation = runtime.reserveSessionRegistration(
			input.sessionId,
		);
		try {
			const result = await input.start();
			if (result.startResult.sessionId !== input.sessionId) {
				throw new ChatCatalogError(
					"invalid_input",
					"managed lifecycle returned a mismatched session id",
				);
			}
			const reconciledAuthority = await runtime.registerSession(
				result.startResult.sessionId,
				input.invocation.identity,
				input.invocation.signal,
				result.writerGeneration,
				input.capabilityManifest,
				{
					operationId: input.operationId,
					command: input.command,
				},
			);
			return reconciledAuthority
				? ({
						...result,
						leaseRevision: reconciledAuthority.leaseRevision,
						writerGeneration: reconciledAuthority.writerGeneration,
						leaseExpiresAt: reconciledAuthority.leaseExpiresAt,
					} as T)
				: result;
		} finally {
			releaseReservation?.();
		}
	}

	async #dispatch(
		command: HubChatLifecycleCommandName,
		payload: Record<string, unknown>,
		invocation: HubWorkspaceManagedLifecycleInvocation,
	): Promise<unknown> {
		const api = this.#core.chatLifecycle;
		switch (command) {
			case "chat_lifecycle.start_root": {
				const input = payload as unknown as StartPayload;
				const materialized = await this.#startInput(
					input.start,
					input.sessionId,
					invocation,
				);
				const result = await this.#withRuntimeSessionRegistration({
					sessionId: input.sessionId,
					operationId: input.operationId,
					command: "chat_lifecycle.start_root",
					invocation,
					capabilityManifest: materialized.capabilityManifest,
					start: () =>
						api.startRoot({
							operationId: input.operationId,
							sessionId: input.sessionId,
							...(input.chatId ? { chatId: input.chatId } : {}),
							...(input.title ? { title: input.title } : {}),
							...(input.titleSource ? { titleSource: input.titleSource } : {}),
							...(input.leaseTtlMs === undefined
								? {}
								: { leaseTtlMs: input.leaseTtlMs }),
							startInput: materialized.startInput,
						}),
				});
				return sanitizeStart(result, materialized.profileAuthority);
			}
			case "chat_lifecycle.start_related": {
				const input = payload as unknown as StartPayload;
				this.#runtime?.assertSessionOwnerIfRegistered(
					requiredString(input.parentSessionId, "parent session id"),
					invocation.identity,
				);
				const materialized = await this.#startInput(
					input.start,
					input.sessionId,
					invocation,
				);
				const common = {
					operationId: input.operationId,
					sessionId: input.sessionId,
					chatId: requiredString(input.chatId, "chat id"),
					parentSessionId: requiredString(
						input.parentSessionId,
						"parent session id",
					),
					...(input.title ? { title: input.title } : {}),
					...(input.titleSource ? { titleSource: input.titleSource } : {}),
					...(input.leaseTtlMs === undefined
						? {}
						: { leaseTtlMs: input.leaseTtlMs }),
					startInput: materialized.startInput,
				};
				const relatedInput: ClineCoreChatLifecycleStartRelatedInput =
					input.relationKind === "config_restart" ||
					input.relationKind === "recovery"
						? {
								...common,
								relationKind: input.relationKind,
								expectedRevision: input.expectedRevision ?? 0,
							}
						: {
								...common,
								relationKind: input.relationKind ?? "fork",
							};
				const result = await this.#withRuntimeSessionRegistration({
					sessionId: input.sessionId,
					operationId: input.operationId,
					command: "chat_lifecycle.start_related",
					invocation,
					capabilityManifest: materialized.capabilityManifest,
					start: () => api.startRelated(relatedInput),
				});
				return sanitizeStart(result, materialized.profileAuthority);
			}
			case "chat_lifecycle.restore_checkpoint": {
				const input = payload as unknown as StartPayload;
				this.#runtime?.assertSessionOwnerIfRegistered(
					requiredString(input.parentSessionId, "parent session id"),
					invocation.identity,
				);
				const materialized = await this.#startInput(
					input.start,
					input.sessionId,
					invocation,
				);
				const result = await this.#withRuntimeSessionRegistration({
					sessionId: input.sessionId,
					operationId: input.operationId,
					command: "chat_lifecycle.restore_checkpoint",
					invocation,
					capabilityManifest: materialized.capabilityManifest,
					start: () =>
						api.restoreCheckpoint({
							operationId: input.operationId,
							sessionId: input.sessionId,
							chatId: requiredString(input.chatId, "chat id"),
							parentSessionId: requiredString(
								input.parentSessionId,
								"parent session id",
							),
							checkpointRunCount: input.checkpointRunCount ?? 0,
							...(input.restore ? { restore: input.restore } : {}),
							...(input.title ? { title: input.title } : {}),
							...(input.titleSource ? { titleSource: input.titleSource } : {}),
							...(input.leaseTtlMs === undefined
								? {}
								: { leaseTtlMs: input.leaseTtlMs }),
							...(invocation.resolvedCwd
								? { cwd: invocation.resolvedCwd }
								: {}),
							startInput: materialized.startInput,
						}),
				});
				return {
					...(sanitizeStart(result, materialized.profileAuthority) as Record<
						string,
						unknown
					>),
					checkpoint: {
						createdAt: result.checkpoint.createdAt,
						runCount: result.checkpoint.runCount,
						...(result.checkpoint.kind ? { kind: result.checkpoint.kind } : {}),
					},
					restoredMessageCount: result.messages?.length ?? 0,
				};
			}
			case "chat_lifecycle.resume":
			case "chat_lifecycle.recover_lost_lease": {
				const input = payload as unknown as StartPayload;
				this.#runtime?.assertSessionOwnerIfRegistered(
					input.sessionId,
					invocation.identity,
					{
						operationId: input.operationId,
						command,
					},
				);
				const materialized = await this.#startInput(
					input.start,
					input.sessionId,
					invocation,
				);
				const result = await this.#withRuntimeSessionRegistration({
					sessionId: input.sessionId,
					operationId: input.operationId,
					command,
					invocation,
					capabilityManifest: materialized.capabilityManifest,
					start: () =>
						command === "chat_lifecycle.resume"
							? api.resume({
									operationId: input.operationId,
									sessionId: input.sessionId,
									...(input.expectedLeaseRevision === undefined
										? {}
										: {
												expectedLeaseRevision: input.expectedLeaseRevision,
											}),
									...(input.leaseTtlMs === undefined
										? {}
										: { leaseTtlMs: input.leaseTtlMs }),
									startInput: materialized.startInput,
								})
							: api.recoverLostLease({
									operationId: input.operationId,
									sessionId: input.sessionId,
									...(input.leaseTtlMs === undefined
										? {}
										: { leaseTtlMs: input.leaseTtlMs }),
									startInput: materialized.startInput,
								}),
				});
				return sanitizeStart(result, materialized.profileAuthority);
			}
			case "chat_lifecycle.run_turn": {
				const input = payload as {
					operationId: string;
					sessionId: string;
				};
				const run = () =>
					runWithManagedAttachments({
						payload,
						signal: invocation.signal,
						run: (prepared) => api.runTurn(prepared as never),
					});
				const result = this.#runtime
					? await this.#runtime.runTurn({
							operationId: input.operationId,
							sessionId: input.sessionId,
							identity: invocation.identity,
							signal: invocation.signal,
							run,
						})
					: await run();
				return { turn: sanitizeTurn(result) };
			}
			case "chat_lifecycle.binding.get": {
				const scope = await this.#bindingScope(
					payload as unknown as HubChatLifecycleBindingScope,
					invocation,
				);
				const binding = await api.getBinding(scope);
				return binding ? sanitizeBinding(binding) : null;
			}
			case "chat_lifecycle.bind": {
				const input = payload as {
					operationId: string;
					sessionId: string;
					target: HubChatLifecycleBindingScope & {
						bindingId: string;
						expectedBindingRevision: number;
					};
				};
				this.#runtime?.assertSessionOwner(input.sessionId, invocation.identity);
				const scope = await this.#bindingScope(input.target, invocation);
				return sanitizeBinding(
					await api.bind({
						operationId: input.operationId,
						sessionId: input.sessionId,
						target: {
							...scope,
							bindingId: input.target.bindingId,
							expectedBindingRevision: input.target.expectedBindingRevision,
						},
					}),
				);
			}
			case "chat_lifecycle.reset": {
				const input = payload as {
					operationId: string;
					sessionId: string;
					binding?: HubChatLifecycleBindingScope & {
						bindingId: string;
						expectedBindingRevision: number;
					};
				};
				this.#runtime?.assertSessionOwner(input.sessionId, invocation.identity);
				const binding = input.binding
					? {
							...(await this.#bindingScope(input.binding, invocation)),
							bindingId: input.binding.bindingId,
							expectedBindingRevision: input.binding.expectedBindingRevision,
						}
					: undefined;
				const result = await api.reset({
					operationId: input.operationId,
					sessionId: input.sessionId,
					...(binding ? { binding } : {}),
				});
				return result ? sanitizeBinding(result) : null;
			}
			case "chat_lifecycle.archive":
				if (payload.stopRunning === true && this.#runtime) {
					throw new ChatCatalogError(
						"unsupported_capability",
						"managed stop-and-archive requires an ownership-aware chat transaction",
					);
				}
				return sanitizeChat(await api.archive(payload as never));
			case "chat_lifecycle.activate":
				return sanitizeChat(await api.activate(payload as never));
			case "chat_lifecycle.rename":
				return sanitizeChat(await api.rename(payload as never));
			case "chat_lifecycle.purge": {
				const result = await api.purge(payload as never);
				return { ...result, sessionIds: [...result.sessionIds] };
			}
			case "chat_lifecycle.stop": {
				const sessionId = requiredString(payload.sessionId, "session id");
				await this.#runtime?.prepareSessionStop(sessionId, invocation.identity);
				await api.stop(payload as never);
				this.#runtime?.unregisterSession(sessionId);
				return { stopped: true };
			}
		}
	}

	#startPolling(): void {
		if (
			this.#pollTimer ||
			this.#disposed ||
			this.#eventSourceFailed ||
			this.#listeners.size === 0
		)
			return;
		this.#pollTimer = setTimeout(() => {
			this.#pollTimer = undefined;
			this.#requestDrain();
			this.#startPolling();
		}, this.#eventPollIntervalMs);
		(this.#pollTimer as { unref?: () => void }).unref?.();
	}

	#stopPollingWhenIdle(): void {
		if (this.#listeners.size === 0) this.#stopPolling();
	}

	#stopPolling(): void {
		if (!this.#pollTimer) return;
		clearTimeout(this.#pollTimer);
		this.#pollTimer = undefined;
	}

	#requestDrain(): void {
		if (this.#disposed || this.#eventSourceFailed) return;
		try {
			this.#drainEvents();
		} catch (error) {
			const fatal = error instanceof ChatCatalogError;
			const sanitized = new ChatCatalogError(
				"unsupported_capability",
				fatal
					? "managed lifecycle event source was disabled after invalid authoritative metadata"
					: "managed lifecycle event source read failed",
			);
			try {
				this.#onEventSourceError?.(sanitized);
			} catch {
				// Health reporting cannot influence command or lifecycle authority.
			}
			if (!fatal) return;
			this.#eventSourceFailed = true;
			this.#stopPolling();
			for (const listener of [...this.#listeners]) listener.release();
		}
	}

	#drainEvents(): void {
		if (this.#disposed || this.#listeners.size === 0) return;
		for (const state of [...this.#listeners]) {
			if (state.invocation.signal.aborted) {
				state.release();
				continue;
			}
			this.#drainState(state, false);
		}
	}

	#replayState(state: ListenerState): void {
		const complete = this.#drainState(state, true);
		if (!complete) {
			throw new ChatCatalogError(
				"lifecycle_replay_unavailable",
				"lifecycle replay exceeds the bounded admission window",
			);
		}
		state.invocation.ready?.(state.scanCursor);
		state.ready = true;
	}

	#drainState(state: ListenerState, requireComplete: boolean): boolean {
		for (let batchIndex = 0; batchIndex < MAX_DRAIN_BATCHES; batchIndex += 1) {
			if (
				this.#disposed ||
				!this.#listeners.has(state) ||
				state.invocation.signal.aborted
			) {
				return true;
			}
			const afterSequence = state.scanCursor;
			const batch = this.#audienceSource.listAfter({
				afterSequence,
				limit: this.#eventBatchLimit,
			});
			const throughSequence = safeSequence(batch.throughSequence);
			if (throughSequence < afterSequence) {
				throw new ChatCatalogError(
					"unsupported_capability",
					"catalog lifecycle event cursor moved backwards",
				);
			}
			for (const event of batch.events) {
				if (event.sequence <= state.scanCursor) continue;
				const timestamp = this.#validateCatalogEvent(event);
				const delivered = this.#emitCatalogEvent(state, event, timestamp);
				if (delivered) state.deliveredCursor = event.sequence;
			}
			state.scanCursor = Math.max(state.scanCursor, throughSequence);
			if (!batch.hasMore) return true;
			if (throughSequence === afterSequence) {
				throw new ChatCatalogError(
					"unsupported_capability",
					"catalog lifecycle replay made no progress",
				);
			}
		}
		return !requireComplete;
	}

	#validateCatalogEvent(event: CatalogLifecycleEvent): number {
		if (!projectableCatalogEventTypes.has(event.eventType)) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"catalog lifecycle event type is unsupported",
			);
		}
		const timestamp = Date.parse(event.occurredAt);
		if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"catalog lifecycle event timestamp is invalid",
			);
		}
		this.#projectCatalogEvent(event, timestamp);
		return timestamp;
	}

	#projectCatalogEvent(
		event: CatalogLifecycleEvent,
		timestamp: number,
		sessionId?: string,
	): ReturnType<typeof parseHubChatLifecycleWireEvent> {
		try {
			return parseHubChatLifecycleWireEvent({
				version: CHAT_LIFECYCLE_WIRE_VERSION,
				event: "chat.changed",
				eventId: event.eventId,
				...(sessionId ? { sessionId } : {}),
				timestamp,
				payload: {
					chatId: event.chatId,
					eventType: event.eventType,
					aggregateKind: event.aggregateKind,
					aggregateId: event.aggregateId,
					previousRevision: event.previousRevision,
					resultingRevision: event.resultingRevision,
					occurredAt: event.occurredAt,
					chat: null,
				},
			});
		} catch {
			throw new ChatCatalogError(
				"unsupported_capability",
				"catalog lifecycle event metadata is invalid",
			);
		}
	}

	#projectReconciledCatalogEvent(
		state: ListenerState,
		event: CatalogAudienceLifecycleEvent,
		timestamp: number,
	) {
		try {
			return parseHubChatLifecycleReconciledWireEvent({
				version: CHAT_LIFECYCLE_WIRE_VERSION,
				event: "chat.changed",
				eventId: event.eventId,
				timestamp,
				catalogSequence: event.sequence,
				previousDeliveredSequence: state.deliveredCursor,
				payload: {
					chatId: event.chatId,
					eventType: event.eventType,
					aggregateKind: event.aggregateKind,
					aggregateId: event.aggregateId,
					previousRevision: event.previousRevision,
					resultingRevision: event.resultingRevision,
					occurredAt: event.occurredAt,
					chat: event.projection,
				},
			});
		} catch {
			throw new ChatCatalogError(
				"unsupported_capability",
				"catalog reconciled lifecycle event metadata is invalid",
			);
		}
	}

	#emitCatalogEvent(
		state: ListenerState,
		event: CatalogAudienceLifecycleEvent,
		timestamp: number,
	): boolean {
		const { invocation } = state;
		if (
			this.#disposed ||
			!this.#listeners.has(state) ||
			invocation.signal.aborted ||
			this.#scope.signal.aborted
		)
			return false;
		let sessionId: string | undefined;
		if (invocation.sessionId) {
			if (!event.relatedSessionIds.includes(invocation.sessionId)) return false;
			sessionId = invocation.sessionId;
		}
		const projected = state.reconciled
			? this.#projectReconciledCatalogEvent(state, event, timestamp)
			: this.#projectCatalogEvent(event, timestamp, sessionId);
		try {
			invocation.emit(projected);
		} catch {
			if (!state.ready) {
				throw new ChatCatalogError(
					"unsupported_capability",
					"lifecycle replay delivery was not admitted",
				);
			}
			state.release();
			return false;
		}
		return true;
	}
}

export function createHubWorkspaceManagedClineCoreFactory(
	options: HubWorkspaceManagedClineCoreFactoryOptions,
): HubWorkspaceManagedCoreFactory {
	const createCore =
		options.createCore ??
		(async (input: ClineCoreOptions): Promise<ManagedClineCoreHandle> => {
			const core = await ClineCore.create(input);
			return {
				chatLifecycle: core.chatLifecycle,
				chatLifecycleEventSource: getClineCoreCatalogLifecycleEventSource(core),
				chatAudienceSource: getClineCoreCatalogAudienceSource(core),
				runtime: {
					abort: (sessionId, reason) => core.abort(sessionId, reason),
					managedSessionAuthoritySignal: (sessionId) =>
						core.managedSessionAuthoritySignal(sessionId),
					rekeyManagedSessionAuthority: (rekeyInput) =>
						core.rekeyManagedSessionAuthority(rekeyInput),
					verifyManagedSessionAuthority: (sessionId) =>
						core.verifyManagedSessionAuthority(sessionId),
					pendingPrompts: core.pendingPrompts,
					getAccumulatedUsage: (sessionId) =>
						core.getAccumulatedUsage(sessionId),
					readMessages: (sessionId) => core.readMessages(sessionId),
					get: (sessionId) => core.get(sessionId),
					readSessionCompactionState: (sessionId) =>
						core.readSessionCompactionState(sessionId),
					subscribe: (listener, subscribeOptions) =>
						core.subscribe(listener, subscribeOptions),
				},
				dispose: core.dispose,
			};
		});
	const eventPollIntervalMs = boundedPositiveInteger(
		options.eventPollIntervalMs,
		DEFAULT_EVENT_POLL_INTERVAL_MS,
		60_000,
		"catalog lifecycle event poll interval",
	);
	const eventBatchLimit = boundedPositiveInteger(
		options.eventBatchLimit,
		DEFAULT_EVENT_BATCH_LIMIT,
		MAX_EVENT_BATCH_LIMIT,
		"catalog lifecycle event batch limit",
	);
	return {
		async create(scope): Promise<HubWorkspaceManagedCore> {
			scope.signal.throwIfAborted();
			const invocations =
				new AsyncLocalStorage<ManagedRuntimeInvocationContext>();
			const retirements = new AsyncLocalStorage<boolean>();
			const retirementController = new AbortController();
			const dataDir = options.dataDirForScope?.(scope);
			const core = await createCore({
				...(options.coreOptions ?? {}),
				backendMode: "local",
				chatLifecycle: {
					workspaceRoot: scope.workspaceKey,
					tenantId: scope.tenantId,
					audienceId: scope.audienceId,
					principalId: scope.principalId,
					source: { kind: "hub", transport: "websocket" },
					mutationFence: () => {
						const current = invocations.getStore();
						if (retirements.getStore() === true) {
							return Object.freeze({
								signal: retirementController.signal,
								assertActive: () => {},
							});
						}
						const signal = current
							? AbortSignal.any([
									scope.signal,
									current.signal,
									...(current.confirmationSignal
										? [current.confirmationSignal]
										: []),
								])
							: scope.signal;
						return Object.freeze({
							signal,
							assertActive: () => {
								scope.signal.throwIfAborted();
								current?.signal.throwIfAborted();
								current?.confirmationSignal?.throwIfAborted();
							},
						});
					},
					...(dataDir ? { dataDir } : {}),
					confirm: async (request) => {
						const current = invocations.getStore();
						if (!current?.operationId || !current.lifecycleCommand)
							return false;
						scope.signal.throwIfAborted();
						current.signal.throwIfAborted();
						current.confirmationSignal?.throwIfAborted();
						if (!current.confirm) return false;
						const approved = await current.confirm(request);
						current.signal.throwIfAborted();
						current.confirmationSignal?.throwIfAborted();
						scope.signal.throwIfAborted();
						return approved === true;
					},
				},
			});
			const disposeCore = (reason?: string) =>
				retirements.run(true, async () => {
					try {
						await core.dispose(reason);
					} finally {
						retirementController.abort(
							new Error("managed Core retirement completed"),
						);
					}
				});
			const audienceSource =
				core.chatAudienceSource ??
				(options.createCore && core.chatLifecycleEventSource
					? Object.freeze<CatalogAudienceChatSource>({
							currentSequence: () =>
								core.chatLifecycleEventSource?.currentSequence() ?? 0,
							listAfter: (input) => {
								const source = core.chatLifecycleEventSource;
								if (!source) {
									throw new ChatCatalogError(
										"unsupported_capability",
										"test lifecycle source is unavailable",
									);
								}
								const batch = source.listAfter(input);
								return {
									...batch,
									events: batch.events.map((event) => ({
										...event,
										projection: null,
									})),
								};
							},
							createProjectionSnapshot: () => {
								throw new ChatCatalogError(
									"unsupported_capability",
									"test projection source is unavailable",
								);
							},
							getProjection: () => {
								throw new ChatCatalogError(
									"unsupported_capability",
									"test projection source is unavailable",
								);
							},
							getSessionProjection: () => {
								throw new ChatCatalogError(
									"unsupported_capability",
									"test session projection source is unavailable",
								);
							},
						})
					: undefined);
			if (!audienceSource) {
				try {
					await disposeCore("catalog_event_source_unavailable");
				} catch (error) {
					throw new AggregateError(
						[error],
						"managed Core lacked an authoritative lifecycle event source and disposal failed",
					);
				}
				throw new ChatCatalogError(
					"unsupported_capability",
					"managed Core lacks an authoritative audience source",
				);
			}
			const runtimeAdapter = core.runtime
				? new ManagedRuntimeAdapter({
						core: core.runtime,
						scope,
						invocations,
						resolveAudienceSession: (sessionId) =>
							audienceSource.getSessionProjection({ sessionId }).chat,
						...(options.runtimeRecoveryJournal
							? { recoveryJournal: options.runtimeRecoveryJournal }
							: {}),
					})
				: undefined;
			const adapter = new ManagedLifecycleAdapter({
				core,
				audienceSource,
				profiles: options.profiles,
				invocations,
				scope,
				eventPollIntervalMs,
				eventBatchLimit,
				...(options.onEventSourceError
					? { onEventSourceError: options.onEventSourceError }
					: {}),
				disposeCore,
				...(runtimeAdapter ? { runtime: runtimeAdapter } : {}),
			});
			return Object.freeze({
				chatLifecycle: core.chatLifecycle,
				lifecycleWire: {
					resolveConfirmationTarget: (
						input: HubWorkspaceManagedLifecycleInvocation,
					) => adapter.resolveConfirmationTarget(input),
					invoke: (input: HubWorkspaceManagedLifecycleInvocation) =>
						adapter.invoke(input),
				},
				projectionWire: {
					invoke: (input: HubWorkspaceManagedProjectionInvocation) =>
						adapter.invokeProjection(input),
				},
				eventWire: {
					subscribe: (input: HubWorkspaceManagedEventInvocation) =>
						adapter.subscribe(input),
				},
				...(runtimeAdapter
					? {
							runtimeWire: {
								invoke: (input: HubWorkspaceManagedRuntimeInvocation) =>
									runtimeAdapter.invoke(input),
							},
							runtimeEventWire: {
								subscribe: (input: HubWorkspaceManagedRuntimeEventInvocation) =>
									runtimeAdapter.subscribe(input),
							},
						}
					: {}),
				dispose: async (reason?: string) => {
					runtimeAdapter?.dispose();
					await adapter.dispose(reason);
				},
			});
		},
	};
}
