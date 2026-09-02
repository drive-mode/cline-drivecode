"use client";

/**
 * Presenter controls — grant / transfer / revoke the one exclusive Presenter
 * title through `presenter.*` on the hub. Exclusivity is shown, not hidden:
 * the menu names who holds it and how long is left, and every other agent's
 * item is a *transfer*, never a second grant. The hub is the authority; a
 * refused op surfaces through the provider's `lastError` banner.
 */

import type { AgentTitleGrant, Participant } from "@cline/shared";
import { Crown, LoaderCircle, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ParticipantInk } from "@/lib/drive/agent-ink";
import {
	formatGrantRemaining,
	PRESENTER_ACTION_LABEL,
	presenterActionFor,
} from "@/lib/drive/stage-cards";
import { cn } from "@/lib/utils";
import { ParticipantAvatar } from "./roster";

export type PresenterControlsProps = {
	agents: readonly Participant[];
	grant: AgentTitleGrant | null;
	inkById: Record<string, ParticipantInk>;
	nowMs: number;
	busy: boolean;
	disabled?: boolean;
	onGrant: (agentId: string) => void;
	onTransfer: (agentId: string) => void;
	onRevoke: () => void;
	/** Compact trigger for tight chrome (the Spotlight byline). */
	compact?: boolean;
	className?: string;
};

export function PresenterControls({
	agents,
	grant,
	inkById,
	nowMs,
	busy,
	disabled = false,
	onGrant,
	onTransfer,
	onRevoke,
	compact = false,
	className,
}: PresenterControlsProps) {
	const holder = grant
		? (agents.find((agent) => agent.id === grant.agentId) ?? null)
		: null;
	const holderName = holder?.displayName ?? grant?.agentId ?? null;
	const remaining = grant ? formatGrantRemaining(grant, nowMs) : null;
	const triggerLabel = grant
		? `Presenter: ${holderName} (${remaining}). Grant, transfer or revoke.`
		: "No Presenter. Grant the Presenter title to an agent.";
	const holderInk = holder ? inkById[holder.id] : undefined;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={triggerLabel}
					className={cn(
						"h-6 gap-1.5 rounded-full border px-2 text-[11px] font-medium",
						grant
							? "border-warning-border bg-warning-surface text-warning-text hover:bg-warning-surface"
							: "border-border text-muted-foreground",
						className,
					)}
					disabled={disabled}
					size="xs"
					type="button"
					variant="ghost"
				>
					{busy ? (
						<LoaderCircle
							aria-hidden="true"
							className="size-3 motion-safe:animate-spin"
						/>
					) : (
						<Crown aria-hidden="true" className="size-3" />
					)}
					{compact ? (
						<span className="truncate">
							{grant ? (holderName ?? "Presenter") : "No Presenter"}
						</span>
					) : (
						<span className="truncate">
							{grant ? `Presenter · ${holderName}` : "No Presenter"}
						</span>
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72">
				<DropdownMenuLabel className="flex flex-col gap-0.5">
					<span className="text-xs font-semibold">Presenter</span>
					<span className="text-[11px] font-normal text-muted-foreground">
						{grant
							? `${holderName} holds it · ${remaining}. It is exclusive: granting to someone else transfers it.`
							: "Nobody holds it. One agent at a time may present to the stage."}
					</span>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{agents.length === 0 ? (
					<DropdownMenuItem disabled>No agents are seated.</DropdownMenuItem>
				) : (
					<DropdownMenuGroup>
						{agents.map((agent) => {
							const action = presenterActionFor(agent.id, grant);
							const ink = inkById[agent.id];
							return (
								<DropdownMenuItem
									className="gap-2"
									disabled={busy}
									key={agent.id}
									onSelect={() => {
										switch (action) {
											case "grant":
												onGrant(agent.id);
												return;
											case "transfer":
												onTransfer(agent.id);
												return;
											case "revoke":
												onRevoke();
												return;
											default: {
												const _exhaustive: never = action;
												return _exhaustive;
											}
										}
									}}
									variant={action === "revoke" ? "destructive" : "default"}
								>
									<ParticipantAvatar
										ink={ink ?? null}
										participant={agent}
										size="sm"
									/>
									<span className="flex min-w-0 flex-1 flex-col">
										<span
											className="truncate text-sm"
											style={ink ? { color: ink.css } : undefined}
										>
											{agent.displayName}
										</span>
										<span className="text-[11px] text-muted-foreground">
											{PRESENTER_ACTION_LABEL[action]}
										</span>
									</span>
									{action === "revoke" ? (
										<ShieldOff aria-hidden="true" className="size-3.5" />
									) : action === "transfer" ? (
										<span className="text-[10px] text-muted-foreground">
											from {holderName}
										</span>
									) : null}
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuGroup>
				)}
				{grant && holderInk ? (
					<>
						<DropdownMenuSeparator />
						<p className="px-2 py-1 text-[10px] text-muted-foreground">
							Grant {grant.id} · scope {grant.scope.kind}/{grant.scope.ref}
							{grant.generation ? ` · gen ${grant.generation}` : ""}
						</p>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
