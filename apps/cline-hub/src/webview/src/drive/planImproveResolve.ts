/**
 * Webview bridge for gated plan-improve resolve (accept | reject | mute).
 */

import type { PlanImproveDecision } from "@cline/drive";
import type { PlanningProposal } from "@cline/shared";
import {
	type HostMessage,
	isOptionalString,
	subscribeToHostMessages,
} from "../lib/host-message-gateway";
import { postToHost } from "../vscode";

const TIMEOUT_MS = 5_000;

export type PlanImproveResolveResult = {
	decision: PlanImproveDecision;
	wrote: boolean;
	relativePath?: string;
	offerKey: string;
};

type PlanImproveReply = HostMessage & {
	type: "drive_plan_improve_resolved" | "drive_plan_improve_error";
	requestId?: string;
	decision?: PlanImproveDecision;
	wrote?: boolean;
	relativePath?: string;
	offerKey?: string;
	text?: string;
};

const PLAN_IMPROVE_REPLY_TYPES = [
	"drive_plan_improve_resolved",
	"drive_plan_improve_error",
] as const;

function isPlanImproveReply(message: HostMessage): message is PlanImproveReply {
	return (
		(message.type === "drive_plan_improve_resolved" ||
			message.type === "drive_plan_improve_error") &&
		isOptionalString(message.requestId) &&
		(message.decision === undefined ||
			message.decision === "accept" ||
			message.decision === "reject" ||
			message.decision === "mute") &&
		(message.wrote === undefined || typeof message.wrote === "boolean") &&
		isOptionalString(message.relativePath) &&
		isOptionalString(message.offerKey) &&
		isOptionalString(message.text)
	);
}

export function requestPlanImproveResolve(
	workspaceRoot: string,
	proposal: PlanningProposal,
	decision: PlanImproveDecision,
	options?: { timeoutMs?: number },
): Promise<PlanImproveResolveResult> {
	const timeoutMs = options?.timeoutMs ?? TIMEOUT_MS;
	const requestId = `plan-improve-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const root = workspaceRoot.trim();
	if (!root) {
		return Promise.reject(new Error("workspaceRoot is required"));
	}

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error("drive_plan_improve_resolve timed out"));
		}, timeoutMs);

		const unsubscribe = subscribeToHostMessages({
			types: PLAN_IMPROVE_REPLY_TYPES,
			guard: isPlanImproveReply,
			onMessage: (message) => {
				if (message.requestId !== requestId) {
					return;
				}
				clearTimeout(timer);
				unsubscribe();
				if (message.type === "drive_plan_improve_error") {
					reject(
						new Error(
							message.text?.trim() || "drive_plan_improve_resolve failed",
						),
					);
					return;
				}
				resolve({
					decision: message.decision ?? decision,
					wrote: Boolean(message.wrote),
					...(typeof message.relativePath === "string"
						? { relativePath: message.relativePath }
						: {}),
					offerKey:
						typeof message.offerKey === "string"
							? message.offerKey
							: proposal.offerKey,
				});
			},
		});
		postToHost({
			type: "drive_plan_improve_resolve",
			workspaceRoot: root,
			decision,
			proposal,
			requestId,
		});
	});
}
