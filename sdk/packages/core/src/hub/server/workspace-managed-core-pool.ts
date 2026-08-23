import type {
	HubChatLifecycleCommandName,
	HubChatProjectionCommandName,
	HubChatRuntimeCommandName,
	HubChatRuntimeCursor,
} from "@cline/shared";
import { ChatCatalogError } from "../../chat-catalog/sqlite-chat-catalog-service";
import type {
	ClineCoreChatLifecycleApi,
	ClineCoreChatLifecycleConfirmationRequest,
} from "../../cline-core/types";
import type {
	HubAuthenticatedConnection,
	HubWorkspaceCapabilityAuthority,
} from "./workspace-capability-authority";
import { digestHubWorkspaceConnectionPolicy } from "./workspace-capability-authority";

const DEFAULT_FACTORY_TIMEOUT_MS = 30_000;
const DEFAULT_RETIREMENT_WAIT_MS = 5_000;
const DEFAULT_DISPOSAL_WAIT_MS = 5_000;

export interface HubWorkspaceManagedCore {
	readonly chatLifecycle: ClineCoreChatLifecycleApi;
	readonly lifecycleWire?: HubWorkspaceManagedLifecycleWire;
	readonly projectionWire?: HubWorkspaceManagedProjectionWire;
	readonly eventWire?: HubWorkspaceManagedEventWire;
	readonly runtimeWire?: HubWorkspaceManagedRuntimeWire;
	readonly runtimeEventWire?: HubWorkspaceManagedRuntimeEventWire;
	dispose(reason?: string): Promise<void>;
}

/** Internal server correlation for one Core-originated confirmation prompt. */
export interface HubWorkspaceManagedConfirmationInvocation {
	readonly identity: HubAuthenticatedConnection;
	readonly signal: AbortSignal;
	readonly command: HubChatLifecycleCommandName;
	readonly operationId: string;
	readonly request: ClineCoreChatLifecycleConfirmationRequest;
}

export type HubWorkspaceManagedConfirmationRequester = (
	input: HubWorkspaceManagedConfirmationInvocation,
) => boolean | Promise<boolean>;

export interface HubWorkspaceManagedLifecycleInvocation {
	readonly identity: HubAuthenticatedConnection;
	readonly signal: AbortSignal;
	readonly command: HubChatLifecycleCommandName;
	/** Exact command-lifetime fence used only by confirmation and its mutation. */
	readonly confirmationSignal?: AbortSignal;
	/**
	 * Server-owned responder bound to this exact wire operation. Core supplies
	 * the normalized target; callers never submit approval or a credential.
	 */
	readonly confirm?: (
		request: ClineCoreChatLifecycleConfirmationRequest,
	) => boolean | Promise<boolean>;
	/** Canonical existing directory contained by identity.workspaceKey. */
	readonly resolvedCwd?: string;
	readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Trusted adapter from strict wire intent to the local managed lifecycle.
 * It owns profile lookup, dynamic provenance, and final cancellation fencing.
 * The adapter must use resolvedCwd and must never resolve relativeCwd itself.
 */
export interface HubWorkspaceManagedLifecycleWire {
	/**
	 * Resolve a server-authoritative confirmation target that cannot be carried
	 * safely by the public wire (currently archived resume by session ID).
	 */
	resolveConfirmationTarget?(
		input: HubWorkspaceManagedLifecycleInvocation,
	): Promise<ClineCoreChatLifecycleConfirmationRequest | undefined>;
	invoke(input: HubWorkspaceManagedLifecycleInvocation): Promise<unknown>;
}

export interface HubWorkspaceManagedProjectionInvocation {
	readonly identity: HubAuthenticatedConnection;
	readonly signal: AbortSignal;
	readonly command: HubChatProjectionCommandName;
	readonly payload: Readonly<Record<string, unknown>>;
}

/** Audience-bound, pathless read projection for one authenticated scope. */
export interface HubWorkspaceManagedProjectionWire {
	invoke(input: HubWorkspaceManagedProjectionInvocation): Promise<unknown>;
}

export interface HubWorkspaceManagedEventInvocation {
	readonly identity: HubAuthenticatedConnection;
	readonly signal: AbortSignal;
	readonly sessionId?: string;
	readonly afterSequence?: number;
	readonly ready?: (throughSequence: number) => void;
	readonly emit: (event: unknown) => void;
}

/** Trusted source of strict pathless lifecycle projections for one workspace. */
export interface HubWorkspaceManagedEventWire {
	subscribe(input: HubWorkspaceManagedEventInvocation): () => void;
}

export interface HubWorkspaceManagedRuntimeInvocation {
	readonly identity: HubAuthenticatedConnection;
	readonly signal: AbortSignal;
	readonly command: HubChatRuntimeCommandName;
	readonly payload: Readonly<Record<string, unknown>>;
}

/** Trusted adapter from the strict runtime companion wire to resident Core. */
export interface HubWorkspaceManagedRuntimeWire {
	invoke(input: HubWorkspaceManagedRuntimeInvocation): Promise<unknown>;
}

export interface HubWorkspaceManagedRuntimeEventInvocation {
	readonly identity: HubAuthenticatedConnection;
	readonly signal: AbortSignal;
	readonly sessionId?: string;
	readonly cursor?: HubChatRuntimeCursor;
	readonly ready?: (cursor: HubChatRuntimeCursor) => void;
	readonly emit: (event: unknown) => void;
}

/** Trusted source of strict, sequenced, pathless runtime projections. */
export interface HubWorkspaceManagedRuntimeEventWire {
	subscribe(input: HubWorkspaceManagedRuntimeEventInvocation): () => void;
}

export interface HubWorkspaceManagedCoreScope {
	readonly principalId: string;
	readonly tenantId: string;
	readonly workspaceKey: string;
	readonly workspaceEpoch: number;
	readonly authorityClassId: string;
	readonly audienceId: string;
	readonly policyEpoch: number;
	readonly signal: AbortSignal;
}

export interface HubWorkspaceManagedCoreFactory {
	create(
		scope: HubWorkspaceManagedCoreScope,
	): HubWorkspaceManagedCore | Promise<HubWorkspaceManagedCore>;
}

export interface HubWorkspaceManagedCorePoolOptions {
	readonly factoryTimeoutMs?: number;
	readonly retirementWaitMs?: number;
	readonly disposalWaitMs?: number;
}

interface PoolEntry {
	readonly key: string;
	readonly scope: HubWorkspaceManagedCoreScope;
	readonly controller: AbortController;
	readonly rawCreation: Promise<HubWorkspaceManagedCore>;
	readonly creation: Promise<HubWorkspaceManagedCore>;
	timeout?: ReturnType<typeof setTimeout>;
	core?: HubWorkspaceManagedCore;
	retired: boolean;
	retirementReason?: string;
	disposePromise?: Promise<void>;
	coreDisposePromise?: Promise<void>;
}

type BoundedResult<T> =
	| { readonly status: "fulfilled"; readonly value: T }
	| { readonly status: "rejected"; readonly reason: unknown }
	| { readonly status: "timeout" };

async function settleWithin<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<BoundedResult<T>> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then(
				(value): BoundedResult<T> => ({ status: "fulfilled", value }),
				(reason: unknown): BoundedResult<T> => ({ status: "rejected", reason }),
			),
			new Promise<BoundedResult<T>>((resolve) => {
				timeout = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

function boundedPositiveInteger(
	value: number | undefined,
	fallback: number,
	label: string,
): number {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 300_000) {
		throw new ChatCatalogError("invalid_input", `${label} is invalid`);
	}
	return resolved;
}

function poolKey(input: {
	principalId: string;
	tenantId: string;
	workspaceKey: string;
	policy: HubAuthenticatedConnection["policy"];
}): string {
	return JSON.stringify([
		input.tenantId,
		input.principalId,
		input.workspaceKey,
		input.policy.authorityClassId,
		input.policy.audienceId,
		input.policy.policyEpoch,
		digestHubWorkspaceConnectionPolicy(input.policy),
	]);
}

function assertManagedCore(value: HubWorkspaceManagedCore): void {
	if (
		!value ||
		typeof value !== "object" ||
		typeof value.dispose !== "function" ||
		!value.chatLifecycle ||
		typeof value.chatLifecycle !== "object" ||
		(value.lifecycleWire !== undefined &&
			typeof value.lifecycleWire.invoke !== "function") ||
		(value.projectionWire !== undefined &&
			typeof value.projectionWire.invoke !== "function") ||
		(value.eventWire !== undefined &&
			typeof value.eventWire.subscribe !== "function") ||
		(value.runtimeWire !== undefined &&
			typeof value.runtimeWire.invoke !== "function") ||
		(value.runtimeEventWire !== undefined &&
			typeof value.runtimeEventWire.subscribe !== "function")
	) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"workspace managed Core factory returned an invalid runtime",
		);
	}
}

/**
 * Process-local managed-Core ownership keyed by authenticated workspace scope.
 * The pool never derives scope from public client registration or command data.
 */
export class HubWorkspaceManagedCorePool {
	readonly #authority: HubWorkspaceCapabilityAuthority;
	readonly #factory: HubWorkspaceManagedCoreFactory;
	readonly #factoryTimeoutMs: number;
	readonly #retirementWaitMs: number;
	readonly #disposalWaitMs: number;
	readonly #entries = new Map<string, PoolEntry>();
	#closed = false;

	constructor(
		authority: HubWorkspaceCapabilityAuthority,
		factory: HubWorkspaceManagedCoreFactory,
		options: HubWorkspaceManagedCorePoolOptions = {},
	) {
		this.#authority = authority;
		this.#factory = factory;
		this.#factoryTimeoutMs = boundedPositiveInteger(
			options.factoryTimeoutMs,
			DEFAULT_FACTORY_TIMEOUT_MS,
			"workspace managed Core factory timeout",
		);
		this.#retirementWaitMs = boundedPositiveInteger(
			options.retirementWaitMs,
			DEFAULT_RETIREMENT_WAIT_MS,
			"workspace managed Core retirement timeout",
		);
		this.#disposalWaitMs = boundedPositiveInteger(
			options.disposalWaitMs,
			DEFAULT_DISPOSAL_WAIT_MS,
			"workspace managed Core disposal timeout",
		);
	}

	async get(
		identity: HubAuthenticatedConnection,
	): Promise<HubWorkspaceManagedCore> {
		this.#assertOpen();
		this.#authority.assertActive(identity);
		const key = poolKey(identity);
		for (;;) {
			let entry = this.#entries.get(key);
			if (entry && entry.scope.workspaceEpoch !== identity.workspaceEpoch) {
				await this.#retire(entry, "workspace_epoch_replaced");
				this.#assertOpen();
				this.#authority.assertActive(identity);
				continue;
			}
			if (!entry) {
				entry = this.#createEntry(identity, key);
				this.#entries.set(key, entry);
			}
			try {
				const core = await entry.creation;
				this.#assertOpen();
				this.#authority.assertActive(identity);
				if (entry.retired || this.#entries.get(key) !== entry) {
					throw new ChatCatalogError(
						"unsupported_capability",
						"workspace managed Core authority was retired",
					);
				}
				return core;
			} catch (error) {
				if (entry.core) {
					await this.#retire(entry, "workspace_authority_lost").catch(
						() => undefined,
					);
				}
				throw error;
			}
		}
	}

	async revokeWorkspace(input: {
		tenantId: string;
		workspaceKey: string;
	}): Promise<void> {
		const entries = [...this.#entries.values()].filter(
			(entry) =>
				entry.scope.tenantId === input.tenantId &&
				entry.scope.workspaceKey === input.workspaceKey,
		);
		await this.#retireAll(entries, "workspace_revoked");
	}

	async dispose(reason = "hub_server_stop"): Promise<void> {
		if (this.#closed) {
			await this.#retireAll([...this.#entries.values()], reason);
			return;
		}
		this.#closed = true;
		await this.#retireAll([...this.#entries.values()], reason);
	}

	#createEntry(identity: HubAuthenticatedConnection, key: string): PoolEntry {
		const controller = new AbortController();
		const scope = Object.freeze({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		}) satisfies HubWorkspaceManagedCoreScope;
		let entry: PoolEntry;
		const rawCreation = Promise.resolve()
			.then(() => this.#factory.create(scope))
			.then((core) => {
				assertManagedCore(core);
				entry.core = core;
				if (entry.timeout) clearTimeout(entry.timeout);
				if (entry.retired) {
					void this.#disposeCore(
						entry,
						entry.retirementReason ?? "workspace_authority_lost",
					).catch(() => undefined);
				}
				return core;
			})
			.catch((error) => {
				if (entry.timeout) clearTimeout(entry.timeout);
				if (this.#entries.get(key) === entry) this.#entries.delete(key);
				throw error;
			});
		const aborted = new Promise<never>((_resolve, reject) => {
			controller.signal.addEventListener(
				"abort",
				() =>
					reject(
						new ChatCatalogError(
							"unsupported_capability",
							"workspace managed Core authority was retired",
						),
					),
				{ once: true },
			);
		});
		const creation = Promise.race([rawCreation, aborted]);
		entry = {
			key,
			scope,
			controller,
			rawCreation,
			creation,
			retired: false,
		};
		entry.timeout = setTimeout(() => {
			void this.#retire(entry, "workspace_factory_timeout").catch(
				() => undefined,
			);
		}, this.#factoryTimeoutMs);
		return entry;
	}

	#retire(entry: PoolEntry, reason: string): Promise<void> {
		if (entry.disposePromise) return entry.disposePromise;
		entry.retired = true;
		entry.retirementReason = reason;
		if (entry.timeout) clearTimeout(entry.timeout);
		entry.controller.abort();
		if (this.#entries.get(entry.key) === entry) {
			this.#entries.delete(entry.key);
		}
		entry.disposePromise = this.#settleRetirement(entry, reason);
		return entry.disposePromise;
	}

	async #settleRetirement(entry: PoolEntry, reason: string): Promise<void> {
		const creation = await settleWithin(
			entry.rawCreation,
			this.#retirementWaitMs,
		);
		if (creation.status !== "fulfilled") return;
		const disposal = await settleWithin(
			this.#disposeCore(entry, reason),
			this.#disposalWaitMs,
		);
		if (disposal.status === "rejected") throw disposal.reason;
	}

	#disposeCore(entry: PoolEntry, reason: string): Promise<void> {
		entry.coreDisposePromise ??=
			entry.core?.dispose(reason) ?? Promise.resolve();
		return entry.coreDisposePromise;
	}

	async #retireAll(
		entries: readonly PoolEntry[],
		reason: string,
	): Promise<void> {
		const settled = await Promise.allSettled(
			entries.map((entry) => this.#retire(entry, reason)),
		);
		const failures = settled.flatMap((result) =>
			result.status === "rejected" ? [result.reason] : [],
		);
		if (failures.length > 0) {
			throw new AggregateError(
				failures,
				"workspace managed Core retirement failed",
			);
		}
	}

	#assertOpen(): void {
		if (this.#closed) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"workspace managed Core pool is closed",
			);
		}
	}
}
