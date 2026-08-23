import { isAbsolute, resolve } from "node:path";
import type {
	ChatMutationActorKind,
	ChatMutationSourceKind,
} from "@cline/shared";
import { CHAT_AUDIENCE_UNASSIGNED } from "@cline/shared";
import { ChatCatalogError } from "./sqlite-chat-catalog-service";

export const CHAT_CATALOG_CONFIRMATIONS = [
	"archive",
	"activate",
	"purge",
	"revoke_lease",
] as const;
export type ChatCatalogConfirmation =
	(typeof CHAT_CATALOG_CONFIRMATIONS)[number];

export const CHAT_CATALOG_CONFIRMATION_EFFECTS = [
	"stop_running",
	"clear_bindings",
] as const;
export type ChatCatalogConfirmationEffect =
	(typeof CHAT_CATALOG_CONFIRMATION_EFFECTS)[number];

export type ChatCatalogConfirmationAggregateKind = "chat" | "lease";

export const CHAT_CATALOG_CONFIRMATION_MAX_LIFETIME_MS = 10 * 60_000;

export interface ChatCatalogConfirmationGrant {
	/** Opaque host-minted credential; never derived from command payload fields. */
	readonly credential: string;
	readonly confirmation: ChatCatalogConfirmation;
	readonly invocationId: string;
	readonly aggregateKind: ChatCatalogConfirmationAggregateKind;
	readonly aggregateId: string;
	readonly expectedRevision: number;
	readonly effects?: readonly ChatCatalogConfirmationEffect[];
	readonly issuedAt: string;
	readonly expiresAt: string;
}

export interface ChatCatalogAuthorityContext {
	readonly principalId: string;
	readonly tenantId: string;
	readonly workspaceKey: string;
	/** Present only for audience-scoped managed authority. */
	readonly audienceId?: string;
	readonly actorKind: ChatMutationActorKind;
	readonly actorLabel?: string;
	readonly source: {
		readonly kind: ChatMutationSourceKind;
		/** Transport-authenticated client identity; distinct from human principal. */
		readonly clientId?: string;
		readonly transport?: string;
		readonly threadId?: string;
		readonly channelId?: string;
	};
	readonly confirmationGrants: readonly ChatCatalogConfirmationGrant[];
}

/**
 * Host-owned final mutation fence. It is retained in module-private state and
 * never appears on the serializable authority context.
 */
export interface ChatCatalogMutationFence {
	readonly signal: AbortSignal;
	assertActive(): void;
}

export interface IssueChatCatalogAuthorityInput {
	principalId: string;
	tenantId?: string;
	workspaceKey: string;
	audienceId?: string;
	actorKind: ChatMutationActorKind;
	actorLabel?: string;
	source: ChatCatalogAuthorityContext["source"];
	confirmationGrants?: readonly ChatCatalogConfirmationGrant[];
	mutationFence?: ChatCatalogMutationFence;
	clock?: () => Date;
}

interface ConfirmationGrantState {
	readonly grant: ChatCatalogConfirmationGrant;
	consumed: boolean;
}

const issuedContexts = new WeakSet<object>();
const grantStates = new WeakMap<object, Map<string, ConfirmationGrantState>>();
const mutationFences = new WeakMap<object, ChatCatalogMutationFence>();
const mutationFenceSources = new WeakMap<object, ChatCatalogMutationFence>();

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

export function normalizeChatCatalogWorkspaceKey(value: string): string {
	const workspace = required(value, "workspace key");
	if (!isAbsolute(workspace)) {
		throw new ChatCatalogError(
			"invalid_input",
			"workspace key must be absolute",
		);
	}
	return resolve(workspace);
}

function grantKey(
	confirmation: ChatCatalogConfirmation,
	invocationId: string,
	aggregateKind: ChatCatalogConfirmationAggregateKind,
	aggregateId: string,
	expectedRevision: number,
	effects: readonly ChatCatalogConfirmationEffect[],
): string {
	return `${confirmation}\0${invocationId}\0${aggregateKind}\0${aggregateId}\0${expectedRevision}\0${effects.join(",")}`;
}

export function normalizeChatCatalogConfirmationEffects(
	confirmation: ChatCatalogConfirmation,
	effects: readonly ChatCatalogConfirmationEffect[] | undefined,
): readonly ChatCatalogConfirmationEffect[] {
	const normalized = [...new Set(effects ?? [])].sort();
	if (
		normalized.some(
			(effect) => !CHAT_CATALOG_CONFIRMATION_EFFECTS.includes(effect),
		)
	) {
		throw new ChatCatalogError(
			"invalid_input",
			"confirmation effect is invalid",
		);
	}
	if (confirmation !== "archive" && normalized.length > 0) {
		throw new ChatCatalogError(
			"invalid_input",
			"confirmation effects are supported only for archive",
		);
	}
	return Object.freeze(normalized);
}

function confirmationAggregateKind(
	value: ChatCatalogConfirmationAggregateKind,
): ChatCatalogConfirmationAggregateKind {
	if (value !== "chat" && value !== "lease") {
		throw new ChatCatalogError(
			"invalid_input",
			"confirmation aggregate kind is invalid",
		);
	}
	return value;
}

function assertConfirmationAggregate(
	confirmation: ChatCatalogConfirmation,
	aggregateKind: ChatCatalogConfirmationAggregateKind,
): void {
	const requiredKind = confirmation === "revoke_lease" ? "lease" : "chat";
	if (aggregateKind !== requiredKind) {
		throw new ChatCatalogError(
			"invalid_input",
			"confirmation operation does not match its aggregate kind",
		);
	}
}

/**
 * Host-only authority issuer. This module is intentionally absent from the
 * public @cline/core package root and from plugin contribution surfaces.
 */
export function issueChatCatalogAuthority(
	input: IssueChatCatalogAuthorityInput,
): ChatCatalogAuthorityContext {
	const workspace = normalizeChatCatalogWorkspaceKey(input.workspaceKey);
	const states = new Map<string, ConfirmationGrantState>();
	const issuedAtNow = (input.clock ?? (() => new Date()))();
	if (!Number.isFinite(issuedAtNow.getTime())) {
		throw new ChatCatalogError(
			"invalid_input",
			"host confirmation clock is invalid",
		);
	}
	const confirmationGrants = Object.freeze(
		(input.confirmationGrants ?? []).map((candidate) => {
			if (!CHAT_CATALOG_CONFIRMATIONS.includes(candidate.confirmation)) {
				throw new ChatCatalogError(
					"invalid_input",
					"catalog confirmation is invalid",
				);
			}
			const grantIssuedAt = new Date(candidate.issuedAt);
			const expiresAt = new Date(candidate.expiresAt);
			if (
				!Number.isFinite(grantIssuedAt.getTime()) ||
				!Number.isFinite(expiresAt.getTime()) ||
				grantIssuedAt.getTime() > issuedAtNow.getTime() ||
				expiresAt.getTime() <= issuedAtNow.getTime() ||
				expiresAt.getTime() - grantIssuedAt.getTime() >
					CHAT_CATALOG_CONFIRMATION_MAX_LIFETIME_MS
			) {
				throw new ChatCatalogError(
					"invalid_input",
					"catalog confirmation issuance window is invalid",
				);
			}
			const aggregateKind = confirmationAggregateKind(candidate.aggregateKind);
			assertConfirmationAggregate(candidate.confirmation, aggregateKind);
			const effects = normalizeChatCatalogConfirmationEffects(
				candidate.confirmation,
				candidate.effects,
			);
			const grant = Object.freeze({
				credential: required(candidate.credential, "confirmation credential"),
				confirmation: candidate.confirmation,
				invocationId: required(
					candidate.invocationId,
					"confirmation invocation",
				),
				aggregateKind,
				aggregateId: required(candidate.aggregateId, "confirmation aggregate"),
				expectedRevision: candidate.expectedRevision,
				...(effects.length > 0 ? { effects } : {}),
				issuedAt: grantIssuedAt.toISOString(),
				expiresAt: expiresAt.toISOString(),
			});
			if (
				!Number.isSafeInteger(grant.expectedRevision) ||
				grant.expectedRevision < 0
			) {
				throw new ChatCatalogError(
					"invalid_input",
					"confirmation revision is invalid",
				);
			}
			const key = grantKey(
				grant.confirmation,
				grant.invocationId,
				grant.aggregateKind,
				grant.aggregateId,
				grant.expectedRevision,
				effects,
			);
			if (states.has(key)) {
				throw new ChatCatalogError(
					"invalid_input",
					"catalog confirmation grant is duplicated",
				);
			}
			states.set(key, { grant, consumed: false });
			return grant;
		}),
	);
	if (confirmationGrants.length > 0 && input.actorKind !== "human") {
		throw new ChatCatalogError(
			"invalid_input",
			"only a human authority can receive confirmation grants",
		);
	}
	const mutationFence = input.mutationFence;
	if (
		mutationFence &&
		(typeof mutationFence.assertActive !== "function" ||
			!mutationFence.signal ||
			typeof mutationFence.signal.throwIfAborted !== "function")
	) {
		throw new ChatCatalogError(
			"invalid_input",
			"catalog mutation fence is invalid",
		);
	}
	const normalizedMutationFence = mutationFence
		? Object.freeze({
				signal: mutationFence.signal,
				assertActive: () => mutationFence.assertActive(),
			})
		: undefined;
	const context: ChatCatalogAuthorityContext = Object.freeze({
		principalId: required(input.principalId, "principal id"),
		tenantId: required(input.tenantId ?? "local", "tenant id"),
		workspaceKey: workspace,
		...(input.audienceId === undefined
			? {}
			: {
					audienceId: (() => {
						const audienceId = required(input.audienceId, "audience id");
						if (audienceId === CHAT_AUDIENCE_UNASSIGNED) {
							throw new ChatCatalogError(
								"invalid_input",
								"managed authority cannot use the quarantine audience",
							);
						}
						return audienceId;
					})(),
				}),
		actorKind: input.actorKind,
		...(input.actorLabel?.trim()
			? { actorLabel: required(input.actorLabel, "actor label") }
			: {}),
		source: Object.freeze({ ...input.source }),
		confirmationGrants,
	});
	issuedContexts.add(context);
	grantStates.set(context, states);
	if (normalizedMutationFence) {
		mutationFences.set(context, normalizedMutationFence);
		mutationFenceSources.set(
			context,
			mutationFence as ChatCatalogMutationFence,
		);
	}
	return context;
}

export function assertChatCatalogAuthority(
	context: ChatCatalogAuthorityContext,
): void {
	if (!issuedContexts.has(context as object)) {
		throw new ChatCatalogError(
			"invalid_input",
			"chat catalog authority was not issued by the host",
		);
	}
}

/** Host-only lookup for carrying one issued fence across an async mutation. */
export function getChatCatalogMutationFence(
	context: ChatCatalogAuthorityContext,
): ChatCatalogMutationFence | undefined {
	assertChatCatalogAuthority(context);
	return mutationFences.get(context as object);
}

/** Verifies that a trusted host retained the exact server-issued fence. */
export function assertChatCatalogMutationFenceSource(
	context: ChatCatalogAuthorityContext,
	mutationFence: ChatCatalogMutationFence,
): void {
	assertChatCatalogAuthority(context);
	if (mutationFenceSources.get(context as object) !== mutationFence) {
		throw new ChatCatalogError(
			"invalid_input",
			"chat catalog authority did not retain the server mutation fence",
		);
	}
}

/** Final synchronous assertion immediately before authoritative mutation. */
export function assertChatCatalogMutationAllowed(
	context: ChatCatalogAuthorityContext,
): void {
	const fence = getChatCatalogMutationFence(context);
	if (!fence) return;
	fence.signal.throwIfAborted();
	fence.assertActive();
	fence.signal.throwIfAborted();
}

export function consumeChatCatalogConfirmation(
	context: ChatCatalogAuthorityContext,
	confirmation: ChatCatalogConfirmation,
	target: {
		invocationId: string;
		aggregateKind: ChatCatalogConfirmationAggregateKind;
		aggregateId: string;
		expectedRevision: number;
		effects?: readonly ChatCatalogConfirmationEffect[];
	},
	now: Date,
): ChatCatalogConfirmationGrant {
	assertChatCatalogAuthority(context);
	if (context.actorKind !== "human" || !Number.isFinite(now.getTime())) {
		throw new ChatCatalogError(
			"invalid_input",
			`${confirmation} requires explicit host-observed human confirmation`,
		);
	}
	const invocationId = required(target.invocationId, "confirmation invocation");
	const aggregateKind = confirmationAggregateKind(target.aggregateKind);
	assertConfirmationAggregate(confirmation, aggregateKind);
	const aggregateId = required(target.aggregateId, "confirmation aggregate");
	const effects = normalizeChatCatalogConfirmationEffects(
		confirmation,
		target.effects,
	);
	if (
		!Number.isSafeInteger(target.expectedRevision) ||
		target.expectedRevision < 0
	) {
		throw new ChatCatalogError(
			"invalid_input",
			"confirmation revision is invalid",
		);
	}
	const state = grantStates
		.get(context as object)
		?.get(
			grantKey(
				confirmation,
				invocationId,
				aggregateKind,
				aggregateId,
				target.expectedRevision,
				effects,
			),
		);
	const expiresAt = state
		? new Date(state.grant.expiresAt).getTime()
		: Number.NaN;
	const issuedAt = state
		? new Date(state.grant.issuedAt).getTime()
		: Number.NaN;
	if (
		!state ||
		state.consumed ||
		!Number.isFinite(issuedAt) ||
		!Number.isFinite(expiresAt) ||
		issuedAt > now.getTime() ||
		expiresAt <= now.getTime() ||
		expiresAt - issuedAt > CHAT_CATALOG_CONFIRMATION_MAX_LIFETIME_MS
	) {
		throw new ChatCatalogError(
			"invalid_input",
			`${confirmation} confirmation is missing, expired, mismatched, or consumed`,
		);
	}
	state.consumed = true;
	return state.grant;
}
