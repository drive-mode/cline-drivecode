"use client";

/**
 * The participant sheet (DRV-PARTICIPANT-SHEET) — one seated participant in
 * full: identity, live state, the sanitized runtime badge (family + location
 * only), seat provenance, every title grant the room holds for them, and the
 * actions that are the same hub ops the strip uses: focus the feed, mute,
 * move the Spotlight, share a pin, grant / transfer / revoke Presenter.
 *
 * Never shows prompts, tool allowlists, providers, endpoints, keys or model
 * ids — the snapshot cannot carry them and this sheet does not ask for them.
 */

import type {
	AgentRuntimeBadge,
	AgentTitleGrant,
	Participant,
	StagePin,
} from "@cline/shared";
import {
	Aperture,
	Crown,
	Focus,
	Hand,
	LoaderCircle,
	Mic,
	MicOff,
	Pin,
	ShieldOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import type { ParticipantInk } from "@/lib/drive/agent-ink";
import {
	formatGrantRemaining,
	formatRelativeAge,
	HUMAN_PIN_KIND_LABEL,
	HUMAN_PIN_KINDS,
	type HumanPinKind,
	isGrantActive,
	PRESENTER_ACTION_LABEL,
	type PresenterAction,
	participantStatusLabel,
	runtimeBadgeLabel,
	seatSourceLabel,
} from "@/lib/drive/stage-cards";
import { cn } from "@/lib/utils";
import { ParticipantAvatar, ParticipantStatusDot } from "./roster";

export type ParticipantSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	participant: Participant | null;
	ink: ParticipantInk | null;
	isYou: boolean;
	muted: boolean;
	handRaised: boolean;
	sharing: boolean;
	runtimeBadge: AgentRuntimeBadge | null;
	grants: readonly AgentTitleGrant[];
	/** The action Presenter controls would take for this agent. */
	presenterAction: PresenterAction | null;
	presenterHolderName: string | null;
	pinDefaults: Record<HumanPinKind, StagePin>;
	callLive: boolean;
	busy: ReadonlySet<string>;
	nowMs: number;
	onFocusFeed: (participantId: string) => void;
	onToggleMute: (participantId: string, muted: boolean) => void;
	onMoveSpotlightHere: (participant: Participant) => void;
	onSharePin: (pin: StagePin) => void;
	onPresenterAction: (action: PresenterAction, agentId: string) => void;
};

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
				{label}
			</dt>
			<dd className="text-sm text-foreground">{children}</dd>
		</div>
	);
}

function GrantRow({ grant, nowMs }: { grant: AgentTitleGrant; nowMs: number }) {
	const active = isGrantActive(grant, nowMs);
	return (
		<li className="flex items-center gap-2 text-xs">
			<Crown
				aria-hidden="true"
				className={cn(
					"size-3.5 shrink-0",
					active ? "text-warning-text" : "text-muted-foreground",
				)}
			/>
			<span
				className={cn(
					"capitalize",
					active ? "text-foreground" : "text-muted-foreground",
				)}
			>
				{grant.title}
			</span>
			<span className="font-mono text-[10px] text-muted-foreground">
				{grant.scope.kind}/{grant.scope.ref}
			</span>
			<span className="ml-auto text-[10px] text-muted-foreground">
				{active
					? formatGrantRemaining(grant, nowMs)
					: grant.revokedAt
						? `revoked ${formatRelativeAge(grant.revokedAt, nowMs)} ago`
						: "expired"}
			</span>
		</li>
	);
}

export function ParticipantSheet({
	open,
	onOpenChange,
	participant,
	ink,
	isYou,
	muted,
	handRaised,
	sharing,
	runtimeBadge,
	grants,
	presenterAction,
	presenterHolderName,
	pinDefaults,
	callLive,
	busy,
	nowMs,
	onFocusFeed,
	onToggleMute,
	onMoveSpotlightHere,
	onSharePin,
	onPresenterAction,
}: ParticipantSheetProps) {
	return (
		<Sheet onOpenChange={onOpenChange} open={open}>
			<SheetContent className="w-full gap-0 sm:max-w-md" side="right">
				{participant ? (
					<>
						<SheetHeader className="flex-row items-center gap-3 pr-10">
							<ParticipantAvatar
								ink={ink}
								participant={participant}
								size="lg"
								speaking={participant.status === "speaking"}
							/>
							<div className="flex min-w-0 flex-col gap-0.5">
								<SheetTitle
									className="truncate"
									style={ink ? { color: ink.css } : undefined}
								>
									{participant.displayName}
									{isYou ? (
										<span className="ml-1.5 text-xs font-normal text-muted-foreground">
											you
										</span>
									) : null}
								</SheetTitle>
								<SheetDescription className="flex items-center gap-1.5 capitalize">
									<ParticipantStatusDot status={participant.status} />
									{participant.kind} · {participant.role} ·{" "}
									{participantStatusLabel(participant.status)}
								</SheetDescription>
							</div>
						</SheetHeader>

						<div className="flex flex-wrap items-center gap-1.5 px-4">
							{sharing ? (
								<Badge variant="secondary">On the Spotlight</Badge>
							) : null}
							{presenterAction === "revoke" ? (
								<Badge
									className="gap-1 border-warning-border bg-warning-surface text-warning-text"
									variant="outline"
								>
									<Crown className="size-3" />
									Presenter
								</Badge>
							) : null}
							{muted ? (
								<Badge className="gap-1" variant="destructive">
									<MicOff className="size-3" />
									muted
								</Badge>
							) : null}
							{handRaised ? (
								<Badge className="gap-1" variant="outline">
									<Hand className="size-3" />
									hand raised
								</Badge>
							) : null}
						</div>

						<Separator className="my-4" />

						<dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4">
							<Field label="Participant id">
								<span className="font-mono text-xs">{participant.id}</span>
							</Field>
							{participant.kind === "agent" ? (
								<>
									<Field label="Runtime">
										{runtimeBadge ? (
											<span className="font-mono text-xs">
												{runtimeBadgeLabel(runtimeBadge)}
											</span>
										) : (
											<span className="text-xs text-muted-foreground">
												not reported
											</span>
										)}
									</Field>
									<Field label="Identity">
										<span className="font-mono text-xs">
											{participant.ref
												? participant.ref.kind === "driveagent"
													? `driveagent · ${participant.ref.slug}`
													: `${participant.ref.kind} · ${participant.ref.id}`
												: "legacy seat (no ref)"}
										</span>
									</Field>
									<Field label="Seat">
										{participant.seatSources.length > 0 ? (
											<ul className="flex flex-col gap-0.5 text-xs">
												{participant.seatSources.map((source) => (
													<li key={seatSourceLabel(source)}>
														{seatSourceLabel(source)}
													</li>
												))}
											</ul>
										) : (
											<span className="text-xs text-muted-foreground">
												unknown
											</span>
										)}
									</Field>
									{participant.capPreset ? (
										<Field label="Permission ceiling">
											<span className="text-xs capitalize">
												{participant.capPreset}
											</span>
										</Field>
									) : null}
								</>
							) : (
								<Field label="Role">
									<span className="text-xs capitalize">{participant.role}</span>
								</Field>
							)}
						</dl>

						{participant.kind === "agent" ? (
							<>
								<Separator className="my-4" />
								<section className="px-4">
									<h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
										Titles
									</h3>
									{grants.length === 0 ? (
										<p className="text-xs text-muted-foreground">
											No titles have been granted to this agent in this room.
										</p>
									) : (
										<ul className="flex flex-col gap-1.5">
											{grants.map((grant) => (
												<GrantRow grant={grant} key={grant.id} nowMs={nowMs} />
											))}
										</ul>
									)}
								</section>
							</>
						) : null}

						<Separator className="my-4" />

						<section className="flex flex-col gap-1.5 px-4 pb-4">
							<h3 className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
								Actions
							</h3>
							<Button
								className="justify-start"
								onClick={() => {
									onFocusFeed(participant.id);
									onOpenChange(false);
								}}
								type="button"
								variant="outline"
							>
								<Focus aria-hidden="true" className="size-4" />
								Focus in feed
							</Button>
							<Button
								className="justify-start"
								disabled={!callLive || busy.has("mute")}
								onClick={() => onToggleMute(participant.id, !muted)}
								type="button"
								variant="outline"
							>
								{busy.has("mute") ? (
									<LoaderCircle
										aria-hidden="true"
										className="size-4 motion-safe:animate-spin"
									/>
								) : muted ? (
									<Mic aria-hidden="true" className="size-4" />
								) : (
									<MicOff aria-hidden="true" className="size-4" />
								)}
								{muted ? "Unmute" : "Mute"}
								{participant.kind === "agent" && !muted ? (
									<span className="ml-auto text-[11px] text-muted-foreground">
										cannot speak
									</span>
								) : null}
							</Button>
							{!sharing ? (
								<Button
									className="justify-start"
									disabled={!callLive || busy.has("stage")}
									onClick={() => {
										onMoveSpotlightHere(participant);
										onOpenChange(false);
									}}
									type="button"
									variant="outline"
								>
									<Aperture aria-hidden="true" className="size-4" />
									Move Spotlight here
								</Button>
							) : null}
							{participant.kind === "human" && isYou ? (
								<div className="mt-1 flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 p-2">
									<p className="text-[11px] text-muted-foreground">
										Share a pin — take the Spotlight with a selection, file or
										terminal card. No pixels leave the app.
									</p>
									{HUMAN_PIN_KINDS.map((kind) => (
										<Button
											className="justify-start"
											disabled={!callLive || busy.has("stage")}
											key={kind}
											onClick={() => {
												onSharePin(pinDefaults[kind]);
												onOpenChange(false);
											}}
											size="sm"
											type="button"
											variant="secondary"
										>
											<Pin aria-hidden="true" className="size-3.5" />
											Pin {HUMAN_PIN_KIND_LABEL[kind].toLowerCase()}
											<span className="ml-auto max-w-[10rem] truncate text-[10px] text-muted-foreground">
												{pinDefaults[kind].label}
											</span>
										</Button>
									))}
								</div>
							) : null}
							{participant.kind === "agent" && presenterAction ? (
								<Button
									className="justify-start"
									disabled={!callLive || busy.has("presenter")}
									onClick={() =>
										onPresenterAction(presenterAction, participant.id)
									}
									type="button"
									variant={
										presenterAction === "revoke" ? "destructive" : "outline"
									}
								>
									{busy.has("presenter") ? (
										<LoaderCircle
											aria-hidden="true"
											className="size-4 motion-safe:animate-spin"
										/>
									) : presenterAction === "revoke" ? (
										<ShieldOff aria-hidden="true" className="size-4" />
									) : (
										<Crown aria-hidden="true" className="size-4" />
									)}
									{PRESENTER_ACTION_LABEL[presenterAction]}
									{presenterAction === "transfer" && presenterHolderName ? (
										<span className="ml-auto text-[11px] text-muted-foreground">
											from {presenterHolderName}
										</span>
									) : null}
								</Button>
							) : null}
							{!callLive ? (
								<p className="text-[11px] text-muted-foreground">
									Join the call to change anything about this seat.
								</p>
							) : null}
						</section>
					</>
				) : (
					<SheetHeader>
						<SheetTitle>Participant</SheetTitle>
						<SheetDescription>
							That seat is no longer in the room.
						</SheetDescription>
					</SheetHeader>
				)}
			</SheetContent>
		</Sheet>
	);
}
