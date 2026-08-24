import { createHash, randomBytes } from "node:crypto";
import {
	CHAT_CATALOG_CONFIRMATION_MAX_LIFETIME_MS,
	CHAT_CATALOG_CONFIRMATIONS,
	type ChatCatalogConfirmation,
	type ChatCatalogConfirmationAggregateKind,
	type ChatCatalogConfirmationEffect,
	type ChatCatalogConfirmationGrant,
	normalizeChatCatalogConfirmationEffects,
} from "./chat-catalog-authority";
import { ChatCatalogError } from "./sqlite-chat-catalog-service";

export interface HubChatCatalogConfirmationTarget {
	readonly confirmation: ChatCatalogConfirmation;
	readonly invocationId: string;
	readonly aggregateKind: ChatCatalogConfirmationAggregateKind;
	readonly aggregateId: string;
	readonly expectedRevision: number;
	readonly effects?: readonly ChatCatalogConfirmationEffect[];
}

export interface IssueHubChatCatalogConfirmationInput {
	readonly authenticatedClientId: string;
	readonly target: HubChatCatalogConfirmationTarget;
	readonly ttlMs?: number;
}

export interface ConsumeHubChatCatalogConfirmationInput {
	readonly authenticatedClientId: string;
	readonly credential: string;
	readonly target: HubChatCatalogConfirmationTarget;
}

export interface HubChatCatalogConfirmationBrokerOptions {
	readonly clock?: () => Date;
	readonly credentialFactory?: () => string;
	readonly maxPending?: number;
	readonly maxPendingPerClient?: number;
}

interface PendingConfirmation {
	readonly authenticatedClientId: string;
	readonly target: HubChatCatalogConfirmationTarget;
	readonly issuedAt: string;
	readonly expiresAt: string;
}

const issuedBrokers = new WeakSet<object>();
const MAX_UNIQUE_CREDENTIAL_ATTEMPTS = 32;
const DEFAULT_MAX_PENDING = 4_096;
const DEFAULT_MAX_PENDING_PER_CLIENT = 128;

function required(value: string, label: string): string {
	const normalized = value.trim();
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

export function normalizeHubChatCatalogConfirmationTarget(
	target: HubChatCatalogConfirmationTarget,
): HubChatCatalogConfirmationTarget {
	if (!CHAT_CATALOG_CONFIRMATIONS.includes(target.confirmation)) {
		throw new ChatCatalogError(
			"invalid_input",
			"confirmation operation is invalid",
		);
	}
	if (
		!Number.isSafeInteger(target.expectedRevision) ||
		target.expectedRevision < 0
	) {
		throw new ChatCatalogError(
			"invalid_input",
			"confirmation revision is invalid",
		);
	}
	if (target.aggregateKind !== "chat" && target.aggregateKind !== "lease") {
		throw new ChatCatalogError(
			"invalid_input",
			"confirmation aggregate kind is invalid",
		);
	}
	const requiredKind =
		target.confirmation === "revoke_lease" ? "lease" : "chat";
	if (target.aggregateKind !== requiredKind) {
		throw new ChatCatalogError(
			"invalid_input",
			"confirmation operation does not match its aggregate kind",
		);
	}
	const effects = normalizeChatCatalogConfirmationEffects(
		target.confirmation,
		target.effects,
	);
	return Object.freeze({
		confirmation: target.confirmation,
		invocationId: required(target.invocationId, "confirmation invocation"),
		aggregateKind: target.aggregateKind,
		aggregateId: required(target.aggregateId, "confirmation aggregate"),
		expectedRevision: target.expectedRevision,
		...(effects.length > 0 ? { effects } : {}),
	});
}

function sameTarget(
	left: HubChatCatalogConfirmationTarget,
	right: HubChatCatalogConfirmationTarget,
): boolean {
	return (
		left.confirmation === right.confirmation &&
		left.invocationId === right.invocationId &&
		left.aggregateKind === right.aggregateKind &&
		left.aggregateId === right.aggregateId &&
		left.expectedRevision === right.expectedRevision &&
		(left.effects ?? []).join("\0") === (right.effects ?? []).join("\0")
	);
}

/**
 * Host-owned confirmation credential store. Credentials contain 256 bits of
 * entropy and are consumed synchronously before catalog authority is issued.
 */
export class HubChatCatalogConfirmationBroker {
	readonly #clock: () => Date;
	readonly #credentialFactory: () => string;
	readonly #maxPending: number;
	readonly #maxPendingPerClient: number;
	readonly #pending = new Map<string, PendingConfirmation>();

	constructor(options: HubChatCatalogConfirmationBrokerOptions = {}) {
		this.#clock = options.clock ?? (() => new Date());
		this.#credentialFactory =
			options.credentialFactory ??
			(() => randomBytes(32).toString("base64url"));
		this.#maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
		this.#maxPendingPerClient =
			options.maxPendingPerClient ?? DEFAULT_MAX_PENDING_PER_CLIENT;
		if (
			!Number.isSafeInteger(this.#maxPending) ||
			!Number.isSafeInteger(this.#maxPendingPerClient) ||
			this.#maxPending < 1 ||
			this.#maxPendingPerClient < 1 ||
			this.#maxPendingPerClient > this.#maxPending
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"confirmation pending limits are invalid",
			);
		}
		issuedBrokers.add(this);
	}

	issue(
		input: IssueHubChatCatalogConfirmationInput,
	): ChatCatalogConfirmationGrant {
		const now = this.#clock();
		if (!Number.isFinite(now.getTime())) {
			throw new ChatCatalogError(
				"invalid_input",
				"confirmation broker clock is invalid",
			);
		}
		const ttlMs = input.ttlMs ?? 5 * 60_000;
		if (
			!Number.isSafeInteger(ttlMs) ||
			ttlMs <= 0 ||
			ttlMs > CHAT_CATALOG_CONFIRMATION_MAX_LIFETIME_MS
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"confirmation TTL is invalid",
			);
		}
		const authenticatedClientId = required(
			input.authenticatedClientId,
			"authenticated client id",
		);
		const target = normalizeHubChatCatalogConfirmationTarget(input.target);
		this.#sweepExpired(now);
		if (
			this.#pending.size >= this.#maxPending ||
			[...this.#pending.values()].filter(
				(pending) => pending.authenticatedClientId === authenticatedClientId,
			).length >= this.#maxPendingPerClient
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"confirmation pending limit was reached",
			);
		}
		let credential = "";
		let digest = "";
		for (
			let attempt = 0;
			attempt < MAX_UNIQUE_CREDENTIAL_ATTEMPTS;
			attempt += 1
		) {
			const candidate = required(
				this.#credentialFactory(),
				"confirmation credential",
			);
			const candidateDigest = digestCredential(candidate);
			if (!this.#pending.has(candidateDigest)) {
				credential = candidate;
				digest = candidateDigest;
				break;
			}
		}
		if (!credential) {
			throw new ChatCatalogError(
				"invalid_input",
				"confirmation credential factory could not produce a unique value",
			);
		}
		const issuedAt = now.toISOString();
		const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
		const grant = Object.freeze({
			credential,
			...target,
			issuedAt,
			expiresAt,
		});
		this.#pending.set(digest, {
			authenticatedClientId,
			target,
			issuedAt,
			expiresAt,
		});
		return grant;
	}

	consume(
		input: ConsumeHubChatCatalogConfirmationInput,
	): ChatCatalogConfirmationGrant {
		const now = this.#clock();
		const credential = required(input.credential, "confirmation credential");
		const digest = digestCredential(credential);
		this.#sweepExpired(now);
		const pending = this.#pending.get(digest);
		if (
			!Number.isFinite(now.getTime()) ||
			!pending ||
			pending.authenticatedClientId !==
				required(input.authenticatedClientId, "authenticated client id") ||
			!sameTarget(
				pending.target,
				normalizeHubChatCatalogConfirmationTarget(input.target),
			)
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"confirmation credential is missing, mismatched, expired, or consumed",
			);
		}
		this.#pending.delete(digest);
		return Object.freeze({
			credential,
			...pending.target,
			issuedAt: pending.issuedAt,
			expiresAt: pending.expiresAt,
		});
	}

	revoke(credential: string, authenticatedClientId: string): boolean {
		const normalizedCredential = required(
			credential,
			"confirmation credential",
		);
		const digest = digestCredential(normalizedCredential);
		this.#sweepExpired(this.#clock());
		const pending = this.#pending.get(digest);
		if (
			!pending ||
			pending.authenticatedClientId !==
				required(authenticatedClientId, "authenticated client id")
		) {
			return false;
		}
		return this.#pending.delete(digest);
	}

	revokeClient(authenticatedClientId: string): number {
		const normalizedClientId = required(
			authenticatedClientId,
			"authenticated client id",
		);
		let revoked = 0;
		for (const [credential, pending] of this.#pending) {
			if (pending.authenticatedClientId !== normalizedClientId) continue;
			this.#pending.delete(credential);
			revoked += 1;
		}
		return revoked;
	}

	#sweepExpired(now: Date): void {
		if (!Number.isFinite(now.getTime())) return;
		for (const [digest, pending] of this.#pending) {
			if (new Date(pending.expiresAt).getTime() <= now.getTime()) {
				this.#pending.delete(digest);
			}
		}
	}
}

export function consumeHubChatCatalogConfirmation(
	broker: HubChatCatalogConfirmationBroker,
	input: ConsumeHubChatCatalogConfirmationInput,
): ChatCatalogConfirmationGrant {
	if (!issuedBrokers.has(broker as object)) {
		throw new ChatCatalogError(
			"invalid_input",
			"hub confirmation broker was not issued by core",
		);
	}
	return broker.consume(input);
}
