/**
 * Webview bridge for gated plan-improve resolve (accept | reject | mute).
 */

import type { PlanImproveDecision } from "@cline/drive";
import type { PlanningProposal } from "@cline/shared";
import { postToHost } from "../vscode";

const TIMEOUT_MS = 5_000;

export type PlanImproveResolveResult = {
	decision: PlanImproveDecision;
	wrote: boolean;
	relativePath?: string;
	offerKey: string;
};

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
			window.removeEventListener("message", onMessage);
			reject(new Error("drive_plan_improve_resolve timed out"));
		}, timeoutMs);

		function onMessage(event: MessageEvent) {
			const message = event.data as {
				type?: string;
				requestId?: string;
				decision?: PlanImproveDecision;
				wrote?: boolean;
				relativePath?: string;
				offerKey?: string;
				text?: string;
			};
			if (
				message.type !== "drive_plan_improve_resolved" &&
				message.type !== "drive_plan_improve_error"
			) {
				return;
			}
			if (message.requestId !== requestId) {
				return;
			}
			clearTimeout(timer);
			window.removeEventListener("message", onMessage);
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
		}

		window.addEventListener("message", onMessage);
		postToHost({
			type: "drive_plan_improve_resolve",
			workspaceRoot: root,
			decision,
			proposal,
			requestId,
		});
	});
}
