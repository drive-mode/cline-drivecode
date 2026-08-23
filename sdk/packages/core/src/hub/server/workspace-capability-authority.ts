import { createHash, randomBytes } from "node:crypto";
import { CHAT_AUDIENCE_UNASSIGNED } from "@cline/shared";
import { normalizeChatCatalogWorkspaceKey } from "../../chat-catalog/chat-catalog-authority";
import { ChatCatalogError } from "../../chat-catalog/sqlite-chat-catalog-service";

const DEFAULT_CAPABILITY_TTL_MS = 60_000;
const MAX_CAPABILITY_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_PENDING_CAPABILITIES = 1_024;
const MAX_UNIQUE_VALUE_ATTEMPTS = 32;
const MAX_PROFILE_CLAIMS = 128;

export interface HubWorkspaceConnectionPolicy {
	/** Broad profile/capability class. This is not target authority. */
	readonly authorityClassId: string;
	/** Immutable server-issued target namespace. Callers never select it. */
	readonly audienceId: string;
	/** Advances whenever this class's effective authority changes. */
	readonly policyEpoch: number;
	/** Trusted installed-instance binding. Never accepted from a socket request. */
	readonly installedInstanceId?: string;
	readonly allowedStartProfileIds: readonly string[];
	readonly allowedBindingProfileIds: readonly string[];
}

export const HUB_WORKSPACE_DENY_ALL_POLICY: HubWorkspaceConnectionPolicy =
	Object.freeze({
		authorityClassId: "deny-all",
		audienceId: "aud_deny_all_v1",
		policyEpoch: 0,
		allowedStartProfileIds: Object.freeze([]),
		allowedBindingProfileIds: Object.freeze([]),
	});

export interface HubAuthenticatedConnection {
	readonly connectionId: string;
	readonly principalId: string;
	readonly tenantId: string;
	readonly workspaceKey: string;
	readonly workspaceEpoch: number;
	readonly policy: HubWorkspaceConnectionPolicy;
	readonly transport: "websocket";
	readonly authenticatedAt: string;
}

export interface HubWorkspaceCapabilityGrant {
	/** One-time credential. Callers must never persist or log this value. */
	readonly credential: string;
	readonly expiresAt: string;
}

export interface HubWorkspaceCapabilityAuthorityOptions {
	clock?: () => Date;
	defaultTtlMs?: number;
	maxTtlMs?: number;
	credentialFactory?: () => string;
	connectionIdFactory?: () => string;
	maxPendingCapabilities?: number;
}

interface PendingCapability {
	readonly principalId: string;
	readonly tenantId: string;
	readonly workspaceKey: string;
	readonly workspaceEpoch: number;
	readonly policy: HubWorkspaceConnectionPolicy;
	readonly expiresAt: string;
}

interface ActiveConnection {
	readonly identity: HubAuthenticatedConnection;
	readonly controller: AbortController;
	readonly close?: (reason: "workspace_revoked") => void;
	active: boolean;
}

export interface HubWorkspaceRevocationResult {
	readonly tenantId: string;
	readonly workspaceKey: string;
	readonly workspaceEpoch: number;
	readonly revokedPendingCapabilities: number;
	readonly revokedConnectionIds: readonly string[];
}

function required(value: string | undefined, label: string): string {
	const normalized = value?.trim() ?? "";
	if (!normalized || normalized.length > 512) {
		throw new ChatCatalogError(
			"invalid_input",
			`${label} is missing or invalid`,
		);
	}
	return normalized;
}

function digestCredential(credential: string): string {
	return createHash("sha256").update(credential).digest("hex");
}

function scopeKey(tenantId: string, workspaceKey: string): string {
	return JSON.stringify([tenantId, workspaceKey]);
}

function normalizedProfileIds(
	values: readonly string[],
	label: string,
): readonly string[] {
	if (!Array.isArray(values) || values.length > MAX_PROFILE_CLAIMS) {
		throw new ChatCatalogError("invalid_input", `${label} is invalid`);
	}
	const normalized = values.map((value) => required(value, label));
	if (new Set(normalized).size !== normalized.length) {
		throw new ChatCatalogError("invalid_input", `${label} is invalid`);
	}
	return Object.freeze([...normalized].sort());
}

export function normalizeHubWorkspaceConnectionPolicy(
	input: HubWorkspaceConnectionPolicy,
): HubWorkspaceConnectionPolicy {
	const authorityClassId = required(
		input.authorityClassId,
		"workspace authority class",
	);
	const audienceId = required(input.audienceId, "workspace audience");
	if (audienceId === CHAT_AUDIENCE_UNASSIGNED) {
		throw new ChatCatalogError(
			"invalid_input",
			"workspace audience cannot use the catalog quarantine namespace",
		);
	}
	if (!Number.isSafeInteger(input.policyEpoch) || input.policyEpoch < 0) {
		throw new ChatCatalogError(
			"invalid_input",
			"workspace authority policy epoch is invalid",
		);
	}
	return Object.freeze({
		authorityClassId,
		audienceId,
		policyEpoch: input.policyEpoch,
		...(input.installedInstanceId === undefined
			? {}
			: {
					installedInstanceId: required(
						input.installedInstanceId,
						"installed instance id",
					),
				}),
		allowedStartProfileIds: normalizedProfileIds(
			input.allowedStartProfileIds,
			"allowed start profile",
		),
		allowedBindingProfileIds: normalizedProfileIds(
			input.allowedBindingProfileIds,
			"allowed binding profile",
		),
	});
}

export function digestHubWorkspaceConnectionPolicy(
	input: HubWorkspaceConnectionPolicy,
): string {
	const normalized = normalizeHubWorkspaceConnectionPolicy(input);
	return createHash("sha256")
		.update(
			JSON.stringify([
				normalized.authorityClassId,
				normalized.audienceId,
				normalized.policyEpoch,
				normalized.installedInstanceId ?? null,
				normalized.allowedStartProfileIds,
				normalized.allowedBindingProfileIds,
			]),
		)
		.digest("hex");
}

/**
 * Binds a trusted installed instance to a stable opaque audience. The instance
 * coordinate remains server-side and callers receive only a one-time grant.
 */
export function bindHubWorkspaceConnectionPolicyToInstalledInstance(
	input: HubWorkspaceConnectionPolicy,
	installedInstanceId: string,
): HubWorkspaceConnectionPolicy {
	const policy = normalizeHubWorkspaceConnectionPolicy(input);
	if (policy.installedInstanceId !== undefined) {
		throw new ChatCatalogError(
			"invalid_input",
			"workspace connection policy is already instance-bound",
		);
	}
	const normalizedInstanceId = required(
		installedInstanceId,
		"installed instance id",
	);
	const audienceDigest = createHash("sha256")
		.update(
			JSON.stringify([
				"hub-workspace-installed-instance-audience-v1",
				policy.authorityClassId,
				normalizedInstanceId,
			]),
		)
		.digest("base64url");
	return normalizeHubWorkspaceConnectionPolicy({
		...policy,
		audienceId: `aud_instance_v1_${audienceDigest}`,
		installedInstanceId: normalizedInstanceId,
	});
}

function digestHubWorkspaceAuthorityClassPolicy(
	input: HubWorkspaceConnectionPolicy,
): string {
	const normalized = normalizeHubWorkspaceConnectionPolicy(input);
	return createHash("sha256")
		.update(
			JSON.stringify([
				normalized.authorityClassId,
				normalized.policyEpoch,
				normalized.allowedStartProfileIds,
				normalized.allowedBindingProfileIds,
			]),
		)
		.digest("hex");
}

function createUniqueValue(
	factory: () => string,
	exists: (value: string) => boolean,
	label: string,
): string {
	for (let attempt = 0; attempt < MAX_UNIQUE_VALUE_ATTEMPTS; attempt += 1) {
		const value = required(factory(), label);
		if (!exists(value)) return value;
	}
	throw new ChatCatalogError(
		"invalid_input",
		`${label} factory could not produce a unique value`,
	);
}

export class HubWorkspaceCapabilityAuthority {
	readonly #clock: () => Date;
	readonly #defaultTtlMs: number;
	readonly #maxTtlMs: number;
	readonly #credentialFactory: () => string;
	readonly #connectionIdFactory: () => string;
	readonly #maxPendingCapabilities: number;
	readonly #pending = new Map<string, PendingCapability>();
	readonly #workspaceEpochs = new Map<string, number>();
	readonly #connections = new Map<string, ActiveConnection>();
	readonly #policyClassEpochDigests = new Map<string, string>();
	readonly #issuedConnectionIds = new Set<string>();
	readonly #connectionStates = new WeakMap<object, ActiveConnection>();

	constructor(options: HubWorkspaceCapabilityAuthorityOptions = {}) {
		this.#clock = options.clock ?? (() => new Date());
		this.#maxTtlMs = options.maxTtlMs ?? MAX_CAPABILITY_TTL_MS;
		this.#defaultTtlMs = options.defaultTtlMs ?? DEFAULT_CAPABILITY_TTL_MS;
		this.#credentialFactory =
			options.credentialFactory ??
			(() => randomBytes(32).toString("base64url"));
		this.#connectionIdFactory =
			options.connectionIdFactory ??
			(() => randomBytes(32).toString("base64url"));
		this.#maxPendingCapabilities =
			options.maxPendingCapabilities ?? DEFAULT_MAX_PENDING_CAPABILITIES;
		if (
			!Number.isSafeInteger(this.#maxTtlMs) ||
			!Number.isSafeInteger(this.#defaultTtlMs) ||
			this.#maxTtlMs < 1 ||
			this.#defaultTtlMs < 1 ||
			this.#defaultTtlMs > this.#maxTtlMs ||
			!Number.isSafeInteger(this.#maxPendingCapabilities) ||
			this.#maxPendingCapabilities < 1
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"workspace capability TTL configuration is invalid",
			);
		}
	}

	issue(input: {
		principalId: string;
		tenantId?: string;
		workspaceKey: string;
		ttlMs?: number;
		policy?: HubWorkspaceConnectionPolicy;
	}): HubWorkspaceCapabilityGrant {
		const now = this.#now();
		this.#sweepExpiredCapabilities(now);
		if (this.#pending.size >= this.#maxPendingCapabilities) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"workspace capability pending limit was reached",
			);
		}
		const principalId = required(input.principalId, "principal id");
		const tenantId = required(input.tenantId ?? "local", "tenant id");
		const workspaceKey = normalizeChatCatalogWorkspaceKey(input.workspaceKey);
		const policy = normalizeHubWorkspaceConnectionPolicy(
			input.policy ?? HUB_WORKSPACE_DENY_ALL_POLICY,
		);
		const policyClassEpochKey = JSON.stringify([
			policy.authorityClassId,
			policy.policyEpoch,
		]);
		const policyDigest = digestHubWorkspaceAuthorityClassPolicy(policy);
		const existingPolicyDigest =
			this.#policyClassEpochDigests.get(policyClassEpochKey);
		if (existingPolicyDigest && existingPolicyDigest !== policyDigest) {
			throw new ChatCatalogError(
				"invalid_input",
				"workspace authority class and epoch identify conflicting policies",
			);
		}
		const ttlMs = input.ttlMs ?? this.#defaultTtlMs;
		if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > this.#maxTtlMs) {
			throw new ChatCatalogError(
				"invalid_input",
				"workspace capability TTL is invalid",
			);
		}
		const credential = createUniqueValue(
			this.#credentialFactory,
			(candidate) => this.#pending.has(digestCredential(candidate)),
			"workspace capability credential",
		);
		const digest = digestCredential(credential);
		const epoch = this.#epoch(tenantId, workspaceKey);
		const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
		this.#policyClassEpochDigests.set(policyClassEpochKey, policyDigest);
		this.#pending.set(digest, {
			principalId,
			tenantId,
			workspaceKey,
			workspaceEpoch: epoch,
			policy,
			expiresAt,
		});
		return Object.freeze({ credential, expiresAt });
	}

	consume(input: {
		credential: string;
		transport: "websocket";
		close?: (reason: "workspace_revoked") => void;
	}): HubAuthenticatedConnection {
		const now = this.#now();
		const credential = required(
			input.credential,
			"workspace capability credential",
		);
		const digest = digestCredential(credential);
		const pending = this.#pending.get(digest);
		if (!pending) {
			throw new ChatCatalogError(
				"invalid_input",
				"workspace capability is missing, expired, consumed, or revoked",
			);
		}
		this.#pending.delete(digest);
		if (
			pending.expiresAt <= now.toISOString() ||
			pending.workspaceEpoch !==
				this.#epoch(pending.tenantId, pending.workspaceKey)
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"workspace capability is missing, expired, consumed, or revoked",
			);
		}
		const connectionId = createUniqueValue(
			this.#connectionIdFactory,
			(candidate) => this.#issuedConnectionIds.has(candidate),
			"connection id",
		);
		this.#issuedConnectionIds.add(connectionId);
		const identity = Object.freeze({
			connectionId,
			principalId: pending.principalId,
			tenantId: pending.tenantId,
			workspaceKey: pending.workspaceKey,
			workspaceEpoch: pending.workspaceEpoch,
			policy: pending.policy,
			transport: input.transport,
			authenticatedAt: now.toISOString(),
		}) satisfies HubAuthenticatedConnection;
		const state: ActiveConnection = {
			identity,
			controller: new AbortController(),
			...(input.close ? { close: input.close } : {}),
			active: true,
		};
		this.#connections.set(connectionId, state);
		this.#connectionStates.set(identity, state);
		return identity;
	}

	signal(identity: HubAuthenticatedConnection): AbortSignal {
		this.assertActive(identity);
		const state = this.#connectionStates.get(identity as object);
		if (!state) {
			throw new ChatCatalogError(
				"invalid_input",
				"workspace connection identity is invalid or revoked",
			);
		}
		return state.controller.signal;
	}

	assertActive(identity: HubAuthenticatedConnection): void {
		const state = this.#connectionStates.get(identity as object);
		if (
			!state?.active ||
			state.identity !== identity ||
			this.#connections.get(identity.connectionId) !== state ||
			identity.workspaceEpoch !==
				this.#epoch(identity.tenantId, identity.workspaceKey)
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"workspace connection identity is invalid or revoked",
			);
		}
	}

	release(identity: HubAuthenticatedConnection): boolean {
		const state = this.#connectionStates.get(identity as object);
		if (!state || state.identity !== identity || !state.active) return false;
		state.active = false;
		this.#connections.delete(identity.connectionId);
		state.controller.abort(
			new ChatCatalogError(
				"invalid_input",
				"workspace connection identity was released",
			),
		);
		return true;
	}

	revokeWorkspace(input: {
		tenantId?: string;
		workspaceKey: string;
	}): HubWorkspaceRevocationResult {
		const tenantId = required(input.tenantId ?? "local", "tenant id");
		const workspaceKey = normalizeChatCatalogWorkspaceKey(input.workspaceKey);
		const key = scopeKey(tenantId, workspaceKey);
		const workspaceEpoch = this.#epoch(tenantId, workspaceKey) + 1;
		// Epoch advancement is the revocation linearization point. Every later
		// assertActive/consume observes the new epoch before callbacks run.
		this.#workspaceEpochs.set(key, workspaceEpoch);
		let revokedPendingCapabilities = 0;
		for (const [digest, pending] of this.#pending) {
			if (
				pending.tenantId === tenantId &&
				pending.workspaceKey === workspaceKey
			) {
				this.#pending.delete(digest);
				revokedPendingCapabilities += 1;
			}
		}
		const revoked: ActiveConnection[] = [];
		for (const [connectionId, state] of this.#connections) {
			if (
				state.identity.tenantId === tenantId &&
				state.identity.workspaceKey === workspaceKey
			) {
				state.active = false;
				this.#connections.delete(connectionId);
				state.controller.abort(
					new ChatCatalogError(
						"invalid_input",
						"workspace connection identity was revoked",
					),
				);
				revoked.push(state);
			}
		}
		for (const state of revoked) {
			try {
				state.close?.("workspace_revoked");
			} catch {
				// Authority is already revoked; socket cleanup is best effort here.
			}
		}
		return Object.freeze({
			tenantId,
			workspaceKey,
			workspaceEpoch,
			revokedPendingCapabilities,
			revokedConnectionIds: Object.freeze(
				revoked.map((state) => state.identity.connectionId).sort(),
			),
		});
	}

	currentEpoch(input: { tenantId?: string; workspaceKey: string }): number {
		const tenantId = required(input.tenantId ?? "local", "tenant id");
		return this.#epoch(
			tenantId,
			normalizeChatCatalogWorkspaceKey(input.workspaceKey),
		);
	}

	snapshot(): {
		pendingCapabilities: number;
		activeConnections: readonly HubAuthenticatedConnection[];
	} {
		return Object.freeze({
			pendingCapabilities: this.#pending.size,
			activeConnections: Object.freeze(
				[...this.#connections.values()]
					.map((state) => state.identity)
					.sort((left, right) =>
						left.connectionId.localeCompare(right.connectionId),
					),
			),
		});
	}

	#epoch(tenantId: string, workspaceKey: string): number {
		return this.#workspaceEpochs.get(scopeKey(tenantId, workspaceKey)) ?? 0;
	}

	#sweepExpiredCapabilities(now: Date): void {
		const timestamp = now.toISOString();
		for (const [digest, pending] of this.#pending) {
			if (pending.expiresAt <= timestamp) this.#pending.delete(digest);
		}
	}

	#now(): Date {
		const now = this.#clock();
		if (!Number.isFinite(now.getTime())) {
			throw new ChatCatalogError(
				"invalid_input",
				"workspace capability clock is invalid",
			);
		}
		return now;
	}
}
