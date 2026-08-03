/**
 * Room-feed gate card (DRV-GATES). Reuses approval.requested plumbing —
 * approve / deny / allow-for-session. policy.hard cannot be session-allowed.
 */

import {
	canOfferGateSessionAllow,
	classifyToolNameForGate,
	defaultDispositionForGateClass,
	type GateActionClass,
} from "@cline/shared";
import { CheckIcon, Loader2Icon, ShieldAlertIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PendingApproval } from "@/components/PendingApprovalsPanel";

function formatApprovalInput(input: unknown): string {
	if (input == null) {
		return "(no input)";
	}
	if (typeof input === "string") {
		return input;
	}
	try {
		return JSON.stringify(input, null, 2);
	} catch {
		return String(input);
	}
}

export type GateFeedResponse =
	| { kind: "approve" }
	| { kind: "deny" }
	| { kind: "allow_session"; actionClass: GateActionClass };

export type GateFeedCardProps = {
	approvals: PendingApproval[];
	/** Participant label for the requesting agent (room feed binding). */
	requesterLabel?: string;
	disabled?: boolean;
	className?: string;
	onRespond: (approvalId: string, response: GateFeedResponse) => void;
};

export function GateFeedCard({
	approvals,
	requesterLabel = "partner",
	disabled,
	className,
	onRespond,
}: GateFeedCardProps) {
	if (approvals.length === 0) {
		return null;
	}
	return (
		<section
			aria-label="Drive gates"
			className={cn("grid max-h-80 gap-2 overflow-auto", className)}
			data-slot="gate-feed"
		>
			{approvals.map((approval) => {
				const actionClass = classifyToolNameForGate(approval.toolName);
				const disposition = defaultDispositionForGateClass(actionClass);
				const offerSession = canOfferGateSessionAllow(actionClass);
				const busy = Boolean(approval.responding) || disabled;
				return (
					<div
						className="grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
						data-gate-class={actionClass}
						data-gate-disposition={disposition}
						key={approval.approvalId}
					>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<p className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-100">
									<ShieldAlertIcon className="size-3.5 shrink-0" />
									{disposition === "block"
										? "Policy block"
										: "Approve high-impact tool?"}
								</p>
								<p className="break-all text-muted-foreground text-xs">
									{approval.toolName}
									<span className="ml-1 font-mono text-[10px]">
										· {actionClass}
									</span>
								</p>
								<p className="text-[10px] text-muted-foreground">
									Requested by {requesterLabel}
								</p>
							</div>
							<div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
								{disposition === "block" ? (
									<Button
										disabled={busy}
										onClick={() =>
											onRespond(approval.approvalId, { kind: "deny" })
										}
										size="sm"
										type="button"
										variant="destructive"
									>
										{busy ? (
											<Loader2Icon className="size-4 animate-spin" />
										) : (
											<XIcon className="size-4" />
										)}
										Acknowledge
									</Button>
								) : (
									<>
										<Button
											disabled={busy}
											onClick={() =>
												onRespond(approval.approvalId, { kind: "deny" })
											}
											size="sm"
											type="button"
											variant="destructive"
										>
											<XIcon className="size-4" />
											Deny
										</Button>
										{offerSession ? (
											<Button
												disabled={busy}
												onClick={() =>
													onRespond(approval.approvalId, {
														kind: "allow_session",
														actionClass,
													})
												}
												size="sm"
												type="button"
												variant="outline"
											>
												Allow session
											</Button>
										) : null}
										<Button
											disabled={busy}
											onClick={() =>
												onRespond(approval.approvalId, { kind: "approve" })
											}
											size="sm"
											type="button"
										>
											{busy ? (
												<Loader2Icon className="size-4 animate-spin" />
											) : (
												<CheckIcon className="size-4" />
											)}
											Approve
										</Button>
									</>
								)}
							</div>
						</div>
						{disposition === "block" ? (
							<p className="text-[11px] text-muted-foreground">
								policy.hard cannot be session-allowed. Edit permissions or agent
								home policy, then replan.
							</p>
						) : null}
						<pre className="max-h-28 overflow-auto rounded-md border bg-background p-2 text-[11px]">
							{formatApprovalInput(approval.input)}
						</pre>
					</div>
				);
			})}
		</section>
	);
}
