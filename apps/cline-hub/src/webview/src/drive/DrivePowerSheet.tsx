/**
 * Power cockpit sheet — PU0–PU9 instruments (stop, spend, files, model lite).
 */

import type { ChatForkRecord, StageCard } from "@cline/shared";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	readDrivePowerChrome,
	subscribeDrivePowerChrome,
	writeDrivePowerChrome,
} from "../lib/drive-power-chrome";
import { AgentAvatar } from "./AgentAvatar";
import { resolveParticipantNameInk, useDriveInkTheme } from "./agentInk";
import {
	type CallSpendSnapshot,
	formatCallSpend,
	hasCallSpend,
} from "./callSpend";
import {
	participantStatusLabel,
	resolveRosterParticipants,
} from "./rosterHelpers";
import { rosterParticipantTaskLine } from "./rosterTaskLine";
import type { DriveUiState } from "./types";

type PowerTab = "roster" | "files" | "model";

const RUNNING_FORK: ReadonlySet<ChatForkRecord["lifecycle"]> = new Set([
	"seeded",
	"running",
	"promoting",
]);

function runningForkForParticipant(
	forks: readonly ChatForkRecord[],
	participantId: string,
): ChatForkRecord | undefined {
	return forks.find(
		(fork) =>
			RUNNING_FORK.has(fork.lifecycle) &&
			fork.seed.assigneeParticipantId === participantId,
	);
}

export function DrivePowerSheet({
	drive,
	open,
	onOpenChange,
	powerChrome,
	onPowerChromeChange,
	chatForks = [],
	onCancelFork,
	spend = null,
	modelShortlist = [],
	currentModel,
	onSelectModel,
}: {
	drive: DriveUiState;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	powerChrome: boolean;
	onPowerChromeChange: (enabled: boolean) => void;
	chatForks?: readonly ChatForkRecord[];
	onCancelFork?: (workerSessionId: string) => void;
	spend?: CallSpendSnapshot | null;
	/** `provider:model` ids from last-used + current. */
	modelShortlist?: readonly string[];
	currentModel?: string;
	onSelectModel?: (providerModel: string) => void;
}) {
	const [tab, setTab] = useState<PowerTab>("roster");
	const participants = resolveRosterParticipants(drive);
	const inkTheme = useDriveInkTheme();
	const nowTitle = drive.bankSnapshot.nowTitle?.trim() || null;
	const nextTitle = drive.bankSnapshot.nextTitle?.trim() || null;
	const editCards = useMemo(
		() => drive.stageCards.filter((card) => card.category === "edit"),
		[drive.stageCards],
	);
	const orphanWorkers = useMemo(
		() =>
			chatForks.filter(
				(fork) =>
					RUNNING_FORK.has(fork.lifecycle) &&
					!participants.some((p) => p.id === fork.seed.assigneeParticipantId),
			),
		[chatForks, participants],
	);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-w-md gap-0 p-0 sm:max-w-md">
				<DialogHeader className="border-b px-4 py-3 text-left">
					<DialogTitle>Power</DialogTitle>
					<DialogDescription>
						Cockpit density for phone pilots. Spotlight stays full-bleed —
						instruments live here.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center justify-between gap-3 border-b px-4 py-3">
					<div className="min-w-0">
						<Label className="text-sm font-medium" htmlFor="power-chrome">
							Power chrome
						</Label>
						<p className="text-xs text-muted-foreground">
							Remember denser roster lines on this device.
						</p>
					</div>
					<Switch
						checked={powerChrome}
						id="power-chrome"
						onCheckedChange={onPowerChromeChange}
					/>
				</div>

				<div className="border-b px-4 py-3">
					<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						Session spend
					</p>
					{hasCallSpend(spend) && spend ? (
						<p className="mt-1 text-sm font-medium tabular-nums">
							{formatCallSpend(spend)}
						</p>
					) : (
						<p className="mt-1 text-sm text-muted-foreground">
							Spend appears here when this call has measured usage.
						</p>
					)}
				</div>

				{(nowTitle || nextTitle) && (
					<div className="border-b px-4 py-3">
						{nowTitle ? (
							<>
								<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
									Now
								</p>
								<p className="mt-1 text-sm font-medium">{nowTitle}</p>
							</>
						) : null}
						{nextTitle ? (
							<>
								<p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
									About to
								</p>
								<p className="mt-1 text-sm text-foreground/90">{nextTitle}</p>
							</>
						) : null}
					</div>
				)}

				<div
					className="flex gap-1 border-b px-3 py-2"
					role="tablist"
					aria-label="Power sections"
				>
					{(
						[
							["roster", "Roster"],
							["files", "Files"],
							["model", "Model"],
						] as const
					).map(([id, label]) => (
						<button
							aria-selected={tab === id}
							className={
								tab === id
									? "rounded-md bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary"
									: "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50"
							}
							key={id}
							onClick={() => setTab(id)}
							role="tab"
							type="button"
						>
							{label}
						</button>
					))}
				</div>

				{tab === "roster" ? (
					<ul aria-label="Roster task lines" className="max-h-64 overflow-y-auto">
						{participants.map((participant) => {
							const task = rosterParticipantTaskLine(drive, participant);
							const ink = resolveParticipantNameInk({
								drive,
								participant,
								theme: inkTheme,
							});
							const fork = runningForkForParticipant(chatForks, participant.id);
							return (
								<li
									className="flex items-start gap-2.5 border-b border-border/60 px-4 py-2.5 last:border-b-0"
									key={participant.id}
								>
									<AgentAvatar
										className="mt-0.5"
										ink={ink}
										participant={participant}
										size="sm"
									/>
									<div className="min-w-0 flex-1">
										<div className="flex min-w-0 items-baseline gap-2">
											<span
												className="truncate text-sm font-medium"
												style={ink ? { color: ink } : undefined}
											>
												{participant.displayName}
											</span>
											<span className="shrink-0 text-[10px] capitalize text-muted-foreground">
												{participantStatusLabel(participant.status)}
											</span>
										</div>
										{task || fork?.seed.title ? (
											<p className="mt-0.5 truncate text-xs text-foreground/80">
												{task ?? fork?.seed.title}
											</p>
										) : (
											<p className="mt-0.5 text-xs text-muted-foreground">
												No task line
											</p>
										)}
									</div>
									{fork && onCancelFork ? (
										<Button
											className="shrink-0 text-destructive"
											onClick={() => onCancelFork(fork.workerSessionId)}
											size="sm"
											type="button"
											variant="ghost"
										>
											Stop
										</Button>
									) : null}
								</li>
							);
						})}
						{orphanWorkers.map((fork) => (
							<li
								className="flex items-start gap-2.5 border-b border-border/60 px-4 py-2.5 last:border-b-0"
								key={fork.workerSessionId}
							>
								<div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-[10px] font-bold text-amber-800 dark:text-amber-200">
									W
								</div>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium">
										{fork.seed.title}
									</p>
									<p className="mt-0.5 text-xs text-muted-foreground">
										Worker · {fork.lifecycle}
									</p>
								</div>
								{onCancelFork ? (
									<Button
										className="shrink-0 text-destructive"
										onClick={() => onCancelFork(fork.workerSessionId)}
										size="sm"
										type="button"
										variant="ghost"
									>
										Stop
									</Button>
								) : null}
							</li>
						))}
					</ul>
				) : null}

				{tab === "files" ? (
					<ul aria-label="Files touched" className="max-h-64 overflow-y-auto">
						{editCards.length === 0 ? (
							<li className="px-4 py-3 text-sm text-muted-foreground">
								No edit cards on Spotlight yet.
							</li>
						) : (
							editCards.map((card: StageCard) => (
								<li
									className="border-b border-border/60 px-4 py-2.5 last:border-b-0"
									key={card.id}
								>
									<p className="truncate text-sm font-medium">{card.title}</p>
									{card.summary ? (
										<p className="mt-0.5 truncate text-xs text-muted-foreground">
											{card.summary}
										</p>
									) : null}
								</li>
							))
						)}
					</ul>
				) : null}

				{tab === "model" ? (
					<ul aria-label="Model shortlist" className="max-h-64 overflow-y-auto">
						{modelShortlist.length === 0 ? (
							<li className="px-4 py-3 text-sm text-muted-foreground">
								No recent models yet — pick one in the composer.
							</li>
						) : (
							modelShortlist.map((id) => {
								const selected = id === currentModel;
								return (
									<li key={id}>
										<button
											className={
												selected
													? "flex w-full items-center justify-between border-b border-border/60 bg-primary/10 px-4 py-2.5 text-left text-sm font-medium text-primary"
													: "flex w-full items-center justify-between border-b border-border/60 px-4 py-2.5 text-left text-sm hover:bg-muted/40"
											}
											disabled={!onSelectModel}
											onClick={() => onSelectModel?.(id)}
											type="button"
										>
											<span className="truncate font-mono text-xs">{id}</span>
											{selected ? (
												<span className="shrink-0 text-[10px] uppercase">
													Current
												</span>
											) : null}
										</button>
									</li>
								);
							})
						)}
					</ul>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** Hook-friendly helpers for strip dock without forcing Dialog into every parent. */
export function useDrivePowerChromePref(): {
	powerChrome: boolean;
	setPowerChrome: (enabled: boolean) => void;
} {
	const [powerChrome, setPowerChromeState] = useState(readDrivePowerChrome);
	useEffect(() => subscribeDrivePowerChrome(setPowerChromeState), []);
	return {
		powerChrome,
		setPowerChrome: writeDrivePowerChrome,
	};
}
