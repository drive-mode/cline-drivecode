import { randomBytes } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { normalizeChatCatalogWorkspaceKey } from "../../chat-catalog/chat-catalog-authority";
import { ChatCatalogError } from "../../chat-catalog/sqlite-chat-catalog-service";
import type {
	HubAuthenticatedConnection,
	HubWorkspaceCapabilityAuthority,
	HubWorkspaceCapabilityGrant,
	HubWorkspaceConnectionPolicy,
	HubWorkspaceRevocationResult,
} from "./workspace-capability-authority";

const MAX_UNIQUE_ID_ATTEMPTS = 32;

export interface HubWorkspaceRegistration {
	readonly workspaceId: string;
	readonly principalId: string;
	readonly tenantId: string;
	readonly registeredAt: string;
}

export interface HubWorkspaceCapabilityRegistryOptions {
	readonly clock?: () => Date;
	readonly workspaceIdFactory?: () => string;
	/** Trusted registration-time resolver; mint requests never receive this seam. */
	readonly workspaceResolver?: (workspaceKey: string) => string;
}

interface RegisteredWorkspace {
	readonly descriptor: HubWorkspaceRegistration;
	readonly workspaceKey: string;
	readonly scopeKey: string;
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

function defaultWorkspaceResolver(value: string): string {
	try {
		const lexical = normalizeChatCatalogWorkspaceKey(value);
		const canonical = normalizeChatCatalogWorkspaceKey(
			realpathSync.native(lexical),
		);
		if (!statSync(canonical).isDirectory()) {
			throw new Error("not a directory");
		}
		return canonical;
	} catch {
		throw new ChatCatalogError(
			"invalid_input",
			"registered workspace must be an existing canonical directory",
		);
	}
}

function registrationScopeKey(
	tenantId: string,
	principalId: string,
	workspaceKey: string,
): string {
	return JSON.stringify([tenantId, principalId, workspaceKey]);
}

export class HubWorkspaceCapabilityRegistry {
	readonly #authority: HubWorkspaceCapabilityAuthority;
	readonly #clock: () => Date;
	readonly #workspaceIdFactory: () => string;
	readonly #workspaceResolver: (workspaceKey: string) => string;
	readonly #byId = new Map<string, RegisteredWorkspace>();
	readonly #idByScope = new Map<string, string>();

	constructor(
		authority: HubWorkspaceCapabilityAuthority,
		options: HubWorkspaceCapabilityRegistryOptions = {},
	) {
		this.#authority = authority;
		this.#clock = options.clock ?? (() => new Date());
		this.#workspaceIdFactory =
			options.workspaceIdFactory ??
			(() => `hws_${randomBytes(32).toString("base64url")}`);
		this.#workspaceResolver =
			options.workspaceResolver ?? defaultWorkspaceResolver;
	}

	/** Trusted in-process enrollment. Filesystem paths stop at this boundary. */
	register(input: {
		principalId: string;
		tenantId?: string;
		workspaceKey: string;
	}): HubWorkspaceRegistration {
		const principalId = required(input.principalId, "principal id");
		const tenantId = required(input.tenantId ?? "local", "tenant id");
		const workspaceKey = normalizeChatCatalogWorkspaceKey(
			this.#workspaceResolver(input.workspaceKey),
		);
		const scopeKey = registrationScopeKey(tenantId, principalId, workspaceKey);
		const existingId = this.#idByScope.get(scopeKey);
		if (existingId) {
			const existing = this.#byId.get(existingId);
			if (existing) return existing.descriptor;
			this.#idByScope.delete(scopeKey);
		}

		const now = this.#clock();
		if (!Number.isFinite(now.getTime())) {
			throw new ChatCatalogError(
				"invalid_input",
				"workspace registry clock is invalid",
			);
		}
		let workspaceId = "";
		for (let attempt = 0; attempt < MAX_UNIQUE_ID_ATTEMPTS; attempt += 1) {
			const candidate = required(this.#workspaceIdFactory(), "workspace id");
			if (!this.#byId.has(candidate)) {
				workspaceId = candidate;
				break;
			}
		}
		if (!workspaceId) {
			throw new ChatCatalogError(
				"invalid_input",
				"workspace id factory could not produce a unique value",
			);
		}
		const descriptor = Object.freeze({
			workspaceId,
			principalId,
			tenantId,
			registeredAt: now.toISOString(),
		}) satisfies HubWorkspaceRegistration;
		this.#byId.set(workspaceId, { descriptor, workspaceKey, scopeKey });
		this.#idByScope.set(scopeKey, workspaceId);
		return descriptor;
	}

	/** Mint boundary: accepts an opaque ID, never a path or authority fields. */
	issue(input: {
		principalId: string;
		tenantId?: string;
		workspaceId: string;
		ttlMs?: number;
		policy?: HubWorkspaceConnectionPolicy;
	}): HubWorkspaceCapabilityGrant {
		const record = this.#authorizedRecord(input);
		return this.#authority.issue({
			principalId: record.descriptor.principalId,
			tenantId: record.descriptor.tenantId,
			workspaceKey: record.workspaceKey,
			...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
			...(input.policy ? { policy: input.policy } : {}),
		});
	}

	list(input: {
		principalId: string;
		tenantId?: string;
	}): readonly HubWorkspaceRegistration[] {
		const principalId = required(input.principalId, "principal id");
		const tenantId = required(input.tenantId ?? "local", "tenant id");
		return Object.freeze(
			[...this.#byId.values()]
				.filter(
					(record) =>
						record.descriptor.principalId === principalId &&
						record.descriptor.tenantId === tenantId,
				)
				.map((record) => record.descriptor)
				.sort((left, right) =>
					left.workspaceId.localeCompare(right.workspaceId),
				),
		);
	}

	/** Trusted projection from an active identity to its pathless registration. */
	registrationForConnection(
		identity: HubAuthenticatedConnection,
	): HubWorkspaceRegistration {
		this.#authority.assertActive(identity);
		const scopeKey = registrationScopeKey(
			identity.tenantId,
			identity.principalId,
			identity.workspaceKey,
		);
		const workspaceId = this.#idByScope.get(scopeKey);
		const record = workspaceId ? this.#byId.get(workspaceId) : undefined;
		if (!record || record.scopeKey !== scopeKey) {
			throw new ChatCatalogError(
				"invalid_input",
				"workspace registration is missing or unauthorized",
			);
		}
		return record.descriptor;
	}

	revoke(input: {
		principalId: string;
		tenantId?: string;
		workspaceId: string;
	}): HubWorkspaceRevocationResult {
		const record = this.#authorizedRecord(input);
		return this.#authority.revokeWorkspace({
			tenantId: record.descriptor.tenantId,
			workspaceKey: record.workspaceKey,
		});
	}

	unregister(input: {
		principalId: string;
		tenantId?: string;
		workspaceId: string;
	}): {
		readonly registration: HubWorkspaceRegistration;
		readonly revocation: HubWorkspaceRevocationResult;
	} {
		const record = this.#authorizedRecord(input);
		// Enrollment disappears before epoch revocation, so no later mint can
		// race past the unregister linearization point.
		this.#byId.delete(record.descriptor.workspaceId);
		this.#idByScope.delete(record.scopeKey);
		const revocation = this.#authority.revokeWorkspace({
			tenantId: record.descriptor.tenantId,
			workspaceKey: record.workspaceKey,
		});
		return Object.freeze({
			registration: record.descriptor,
			revocation,
		});
	}

	#authorizedRecord(input: {
		principalId: string;
		tenantId?: string;
		workspaceId: string;
	}): RegisteredWorkspace {
		const principalId = required(input.principalId, "principal id");
		const tenantId = required(input.tenantId ?? "local", "tenant id");
		const workspaceId = required(input.workspaceId, "workspace id");
		const record = this.#byId.get(workspaceId);
		if (
			!record ||
			record.descriptor.principalId !== principalId ||
			record.descriptor.tenantId !== tenantId
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"workspace registration is missing or unauthorized",
			);
		}
		return record;
	}
}
