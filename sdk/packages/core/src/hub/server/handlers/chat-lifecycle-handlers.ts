import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
	type HubChatLifecycleCommandName,
	type HubCommandEnvelope,
	type HubReplyEnvelope,
	parseHubChatLifecycleWireReply,
	parseHubChatLifecycleWireRequest,
	parseHubChatLifecycleWireResult,
} from "@cline/shared";
import { ChatCatalogError } from "../../../chat-catalog/sqlite-chat-catalog-service";
import type { ClineCoreChatLifecycleConfirmationRequest } from "../../../cline-core/types";
import type {
	HubAuthenticatedConnection,
	HubWorkspaceCapabilityAuthority,
} from "../workspace-capability-authority";
import type {
	HubWorkspaceManagedConfirmationRequester,
	HubWorkspaceManagedCorePool,
} from "../workspace-managed-core-pool";
import { errorReply, okReply } from "./context";

function freezeWireValue<T>(value: T): T {
	if (!value || typeof value !== "object" || Object.isFrozen(value))
		return value;
	for (const child of Object.values(value)) freezeWireValue(child);
	return Object.freeze(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function confirmationMatchesInvocation(
	command: HubChatLifecycleCommandName,
	payload: Readonly<Record<string, unknown>>,
	request: ClineCoreChatLifecycleConfirmationRequest,
	expectedResolvedTarget?: ClineCoreChatLifecycleConfirmationRequest,
): boolean {
	switch (request.confirmation) {
		case "archive":
			return (
				command === "chat_lifecycle.archive" &&
				request.aggregateKind === "chat" &&
				request.aggregateId === payload.chatId &&
				request.expectedRevision === payload.expectedRevision &&
				(request.effects ?? []).join("\0") ===
					[
						...(payload.stopRunning === true ? ["stop_running"] : []),
						...(payload.clearBindings === true ? ["clear_bindings"] : []),
					].join("\0")
			);
		case "activate":
			return (
				request.aggregateKind === "chat" &&
				((command === "chat_lifecycle.activate" &&
					request.aggregateId === payload.chatId &&
					request.expectedRevision === payload.expectedRevision &&
					(request.effects?.length ?? 0) === 0) ||
					(command === "chat_lifecycle.resume" &&
						expectedResolvedTarget?.confirmation === "activate" &&
						request.aggregateId === expectedResolvedTarget.aggregateId &&
						request.expectedRevision ===
							expectedResolvedTarget.expectedRevision &&
						(request.effects?.length ?? 0) === 0))
			);
		case "purge":
			return (
				command === "chat_lifecycle.purge" &&
				request.aggregateKind === "chat" &&
				request.aggregateId === payload.chatId &&
				request.expectedRevision === payload.expectedRevision
			);
		case "revoke_lease":
			return (
				command === "chat_lifecycle.recover_lost_lease" &&
				request.aggregateKind === "lease" &&
				request.aggregateId === payload.sessionId
			);
	}
}

function isContainedPath(root: string, candidate: string): boolean {
	const relation = relative(root, candidate);
	return (
		relation === "" ||
		(!isAbsolute(relation) &&
			relation !== ".." &&
			!relation.startsWith(`..${sep}`))
	);
}

/** Resolve a wire cwd through the filesystem, rejecting symlink escapes. */
export async function resolveManagedWorkspaceCwd(
	workspaceKey: string,
	relativeCwd: string | undefined,
): Promise<string | undefined> {
	if (relativeCwd === undefined) return undefined;
	try {
		const canonicalWorkspace = await realpath(workspaceKey);
		const canonicalCwd = await realpath(
			resolve(canonicalWorkspace, relativeCwd),
		);
		if (!isContainedPath(canonicalWorkspace, canonicalCwd)) {
			throw new Error("cwd escaped workspace");
		}
		if (!(await stat(canonicalCwd)).isDirectory()) {
			throw new Error("cwd is not a directory");
		}
		return canonicalCwd;
	} catch {
		throw new ChatCatalogError(
			"invalid_input",
			"managed lifecycle cwd is invalid",
		);
	}
}

async function prepareInvocation(
	payload: Record<string, unknown>,
	workspaceKey: string,
): Promise<{
	payload: Readonly<Record<string, unknown>>;
	resolvedCwd?: string;
}> {
	const start = isRecord(payload.start) ? payload.start : undefined;
	const relativeCwd =
		typeof start?.relativeCwd === "string" ? start.relativeCwd : undefined;
	const resolvedCwd = await resolveManagedWorkspaceCwd(
		workspaceKey,
		relativeCwd,
	);
	if (relativeCwd === undefined || !start) {
		return { payload: freezeWireValue(payload) };
	}
	const { relativeCwd: _relativeCwd, ...safeStart } = start;
	return {
		payload: freezeWireValue({ ...payload, start: safeStart }),
		...(resolvedCwd ? { resolvedCwd } : {}),
	};
}

export async function handleChatLifecycleCommand(
	envelope: HubCommandEnvelope,
	identity: HubAuthenticatedConnection,
	authority: HubWorkspaceCapabilityAuthority,
	pool: HubWorkspaceManagedCorePool,
	requestConfirmation?: HubWorkspaceManagedConfirmationRequester,
): Promise<HubReplyEnvelope> {
	let command: HubChatLifecycleCommandName;
	let payload: Record<string, unknown>;
	try {
		const parsed = parseHubChatLifecycleWireRequest({
			version: envelope.version,
			command: envelope.command,
			payload: envelope.payload,
		});
		command = parsed.command;
		payload = parsed.payload;
	} catch {
		return errorReply(
			envelope,
			"invalid_input",
			"Managed lifecycle request failed v1 schema validation.",
		);
	}

	try {
		authority.assertActive(identity);
		const connectionSignal = authority.signal(identity);
		const invocation = await prepareInvocation(payload, identity.workspaceKey);
		authority.assertActive(identity);
		const core = await pool.get(identity);
		authority.assertActive(identity);
		if (!core.lifecycleWire) {
			return errorReply(
				envelope,
				"unsupported_capability",
				"Managed lifecycle wire is not configured for this workspace.",
			);
		}
		const operationId =
			typeof payload.operationId === "string" ? payload.operationId : undefined;
		const mayRequestConfirmation =
			requestConfirmation !== undefined &&
			operationId !== undefined &&
			(command === "chat_lifecycle.archive" ||
				command === "chat_lifecycle.activate" ||
				command === "chat_lifecycle.purge" ||
				command === "chat_lifecycle.resume" ||
				command === "chat_lifecycle.recover_lost_lease");
		const invocationController = mayRequestConfirmation
			? new AbortController()
			: undefined;
		const confirmationSignal = invocationController
			? AbortSignal.any([connectionSignal, invocationController.signal])
			: undefined;
		const signal = connectionSignal;
		const baseInvocation = Object.freeze({
			identity,
			signal,
			command,
			...invocation,
			...(confirmationSignal ? { confirmationSignal } : {}),
		});
		let result: unknown;
		try {
			const expectedResolvedTarget =
				mayRequestConfirmation && command === "chat_lifecycle.resume"
					? await core.lifecycleWire.resolveConfirmationTarget?.(baseInvocation)
					: undefined;
			confirmationSignal?.throwIfAborted();
			authority.assertActive(identity);
			const confirm =
				mayRequestConfirmation && operationId && confirmationSignal
					? async (request: ClineCoreChatLifecycleConfirmationRequest) => {
							confirmationSignal.throwIfAborted();
							if (
								!confirmationMatchesInvocation(
									command,
									payload,
									request,
									expectedResolvedTarget,
								)
							) {
								throw new ChatCatalogError(
									"invalid_input",
									"managed confirmation does not match the lifecycle operation",
								);
							}
							const confirmed = await requestConfirmation(
								Object.freeze({
									identity,
									signal: confirmationSignal,
									command,
									operationId,
									request: Object.freeze({ ...request }),
								}),
							);
							confirmationSignal.throwIfAborted();
							return confirmed === true;
						}
					: undefined;
			result = await core.lifecycleWire.invoke(
				Object.freeze({
					...baseInvocation,
					...(confirm ? { confirm } : {}),
				}),
			);
		} finally {
			invocationController?.abort();
		}
		authority.assertActive(identity);
		let normalized: unknown;
		try {
			normalized = parseHubChatLifecycleWireResult(command, result);
		} catch {
			return errorReply(
				envelope,
				"unsupported_capability",
				"Managed lifecycle result failed v1 schema validation.",
			);
		}
		return parseHubChatLifecycleWireReply(
			command,
			okReply(envelope, { result: normalized as Record<string, unknown> }),
		);
	} catch (error) {
		if (error instanceof ChatCatalogError) {
			return errorReply(
				envelope,
				error.code,
				"Managed lifecycle command was rejected.",
			);
		}
		return errorReply(
			envelope,
			"chat_lifecycle_failed",
			"Managed lifecycle command failed.",
		);
	}
}
