"use client";

/**
 * One agent's profile page (DRV-AGENT-PROFILE).
 *
 * Addressed by the durable profile id — the agent's `AgentRef` flattened —
 * so it works whether or not the agent is seated. Configuration comes from
 * `.driveagent/<slug>/` through the sanitized `drive_agent_home` lane, and
 * appearance from the durable `drive_agent_profiles` map. Appearance saves
 * are optimistic: the preview paints first, the hub reply reconciles, and a
 * failed write rolls the ink back to what was painted before.
 *
 * What this page does not claim: agents do not run independently. One Cline
 * runtime sits behind the feed; a profile configures identity, appearance
 * and policy — not execution.
 */

import type { DriveagentHomePatch } from "@cline/drive";
import type { AgentProfile as StoredAgentProfile } from "@cline/shared";
import {
	ArrowLeft,
	Hand,
	Loader2,
	MicOff,
	RefreshCw,
	TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DriveMarkIcon } from "@/components/icons/drive-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	agentInitial,
	agentInkColor,
	agentRefLabel,
	buildAgentProfileDraft,
	type DriveAgentInk,
	inkFromProfile,
	useDriveInkTheme,
} from "@/lib/drive/agent-appearance";
import {
	type AgentDirectoryEntry,
	parseAgentProfiles,
	participantStatusLabel,
	relativeTimeLabel,
	runtimeBadgeLabel,
	seatSourceLabel,
} from "@/lib/drive/agent-directory";
import {
	type AgentHomeProjection,
	parseAgentHomeReply,
	presetIntentLabel,
} from "@/lib/drive/agent-policy-draft";
import { parseDriveCommandError } from "@/lib/drive/drive-client";
import { useDriveHub } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";
import {
	AgentAppearanceEditor,
	type AppearanceSaveState,
} from "./agent-appearance-editor";
import { AgentPolicyEditor } from "./agent-policy-editor";

type HomeState =
	| { status: "loading" }
	| { status: "ready"; home: AgentHomeProjection }
	| { status: "error"; message: string }
	| { status: "none" };

const CLINE_BUILTIN_REF_ID = "pair_partner";

function Section({
	title,
	note,
	children,
	className,
}: {
	title: string;
	note?: string;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<section
			aria-label={title}
			className={cn(
				"space-y-4 rounded-lg border border-border bg-card p-5",
				className,
			)}
		>
			<div className="space-y-1">
				<h2 className="text-sm font-semibold text-foreground">{title}</h2>
				{note ? (
					<p className="text-xs leading-5 text-muted-foreground">{note}</p>
				) : null}
			</div>
			{children}
		</section>
	);
}

function Fact({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="min-w-0 text-foreground">{children}</dd>
		</>
	);
}

function TitleChip({
	title,
	expiresAt,
	now,
}: {
	title: string;
	expiresAt: string;
	now: string;
}) {
	const remaining = Math.max(0, Date.parse(expiresAt) - Date.parse(now));
	const minutes = Math.ceil(remaining / 60_000);
	return (
		<Badge className="gap-1 capitalize" variant="secondary">
			{title}
			<span className="font-normal normal-case text-muted-foreground">
				· {minutes <= 1 ? "under a minute" : `${minutes}m`} left
			</span>
		</Badge>
	);
}

export function AgentProfile({
	entry,
	profiles,
	now,
	onBack,
	onProfilesChanged,
}: {
	entry: AgentDirectoryEntry;
	profiles: readonly StoredAgentProfile[];
	now: string;
	onBack: () => void;
	onProfilesChanged: (profiles: readonly StoredAgentProfile[]) => void;
}) {
	const { phase, source } = useDriveHub();
	const theme = useDriveInkTheme();
	const { profileId, ref } = entry;
	const canWrite = phase === "live" || phase === "demo";
	const isCline = ref?.kind === "builtin" && ref.id === CLINE_BUILTIN_REF_ID;
	const homeSlug = ref?.kind === "driveagent" ? ref.slug : null;

	const stored = useMemo(
		() => profiles.find((profile) => profile.id === profileId) ?? null,
		[profileId, profiles],
	);
	const [ink, setInk] = useState<DriveAgentInk>(() => inkFromProfile(stored));
	const [save, setSave] = useState<AppearanceSaveState>({ status: "idle" });
	const [homeState, setHomeState] = useState<HomeState>(
		homeSlug ? { status: "loading" } : { status: "none" },
	);
	const inFlight = useRef(0);

	// The durable map is the truth for appearance; local ink only leads while
	// a write is in flight.
	useEffect(() => {
		if (inFlight.current === 0) {
			setInk(inkFromProfile(stored));
		}
	}, [stored]);

	// Only the newest read or write of the home may land: an older get that
	// resolves after a source or slug change, or after a save, is dropped.
	const homeGeneration = useRef(0);
	const loadHome = useCallback(async () => {
		const generation = ++homeGeneration.current;
		const current = () => generation === homeGeneration.current;
		if (!homeSlug) {
			setHomeState({ status: "none" });
			return;
		}
		setHomeState({ status: "loading" });
		try {
			const reply = await source.agentHome("get", { slug: homeSlug });
			if (!current()) {
				return;
			}
			const home = parseAgentHomeReply(reply);
			if (!home) {
				setHomeState({
					status: "error",
					message: "The hub returned a home this app could not read.",
				});
				return;
			}
			setHomeState({ status: "ready", home });
		} catch (error) {
			if (!current()) {
				return;
			}
			setHomeState({
				status: "error",
				message: parseDriveCommandError(error).text,
			});
		}
	}, [homeSlug, source]);

	useEffect(() => {
		void loadHome();
		return () => {
			// Invalidate the read this effect started.
			homeGeneration.current += 1;
		};
	}, [loadHome]);

	const home = homeState.status === "ready" ? homeState.home : null;
	const displayName =
		stored?.displayName?.trim() ||
		home?.compiled.name.trim() ||
		entry.displayName;
	const description =
		home?.compiled.description ||
		entry.description ||
		(homeSlug
			? null
			: "This agent has no Driveagent home in this workspace, so it has no description of its own.");

	const nameColor = agentInkColor({
		ink: ink.nameInk ?? null,
		channel: "name",
		profileId,
		theme,
	});
	const bodyColor = agentInkColor({
		ink: ink.bodyInk ?? null,
		channel: "body",
		profileId,
		theme,
	});

	/**
	 * Paint first, then persist. The local change applies unconditionally so
	 * the preview never lags; the durable write reconciles against what the
	 * hub actually stored, and a failure restores the previous paint.
	 */
	const commitInk = (next: DriveAgentInk) => {
		const previous = ink;
		setInk(next);
		if (!ref || !canWrite) {
			return;
		}
		inFlight.current += 1;
		setSave({ status: "saving" });
		void source
			.agentProfiles("put", {
				profile: buildAgentProfileDraft({
					ref,
					profileId,
					displayName,
					ink: next,
				}),
			})
			.then((reply) => {
				const parsed = parseAgentProfiles(reply);
				const mine = parsed.find((profile) => profile.id === profileId);
				if (mine) {
					setInk(inkFromProfile(mine));
				}
				onProfilesChanged(parsed);
				setSave({ status: "saved" });
			})
			.catch((error: unknown) => {
				setInk(previous);
				setSave({
					status: "error",
					message: parseDriveCommandError(error).text,
				});
			})
			.finally(() => {
				inFlight.current -= 1;
			});
	};

	const savePolicy = async (
		patch: DriveagentHomePatch,
	): Promise<AgentHomeProjection> => {
		if (!homeSlug) {
			throw new Error("This agent has no home to write.");
		}
		const reply = await source.agentHome("put", { slug: homeSlug, patch });
		const next = parseAgentHomeReply(reply);
		if (!next) {
			throw new Error(
				"The hub saved the home but returned an unreadable reply.",
			);
		}
		// The saved home supersedes any read still in flight.
		homeGeneration.current += 1;
		setHomeState({ status: "ready", home: next });
		return next;
	};

	const seat = entry.seat;
	const skills = home?.compiled.skills ?? entry.skills;

	return (
		<div className="space-y-6" data-agent-profile-id={profileId}>
			<div>
				<Button
					className="-ml-2 h-8 text-muted-foreground"
					onClick={onBack}
					size="sm"
					type="button"
					variant="ghost"
				>
					<ArrowLeft aria-hidden="true" className="size-4" />
					All agents
				</Button>
			</div>

			<header className="flex flex-wrap items-center gap-5">
				<span
					aria-hidden="true"
					className="grid size-16 shrink-0 place-items-center rounded-full border border-current/40 bg-current/15 font-mono text-2xl font-bold"
					style={{ color: nameColor }}
				>
					{isCline ? (
						<DriveMarkIcon className="size-8" />
					) : (
						agentInitial(displayName)
					)}
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h1
							className="truncate text-2xl font-semibold"
							data-testid="agent-profile-name"
							style={{ color: nameColor }}
						>
							{displayName}
						</h1>
						{entry.tier === "user" ? (
							<Badge variant="outline">user home</Badge>
						) : null}
						{seat ? (
							<Badge className="capitalize" variant="secondary">
								{seat.role}
							</Badge>
						) : null}
						{seat ? (
							<Badge
								className={cn(
									"gap-1.5",
									seat.status === "speaking" && "text-success-text",
								)}
								variant="outline"
							>
								<span
									aria-hidden="true"
									className={cn(
										"size-1.5 rounded-full",
										seat.status === "speaking" || seat.status === "working"
											? "bg-success-solid"
											: "bg-muted-foreground",
									)}
								/>
								{participantStatusLabel(seat.status)}
							</Badge>
						) : (
							<Badge variant="outline">Not on the call</Badge>
						)}
					</div>
					<p className="mt-1 truncate font-mono text-xs text-muted-foreground">
						{profileId} · {agentRefLabel(ref)}
					</p>
					{description ? (
						<p
							className="mt-2 max-w-3xl text-sm leading-6"
							data-testid="agent-profile-body-sample"
							style={{ color: bodyColor }}
						>
							{description}
						</p>
					) : homeState.status === "loading" ? (
						<Skeleton className="mt-2 h-5 w-96 max-w-full" />
					) : null}
				</div>
			</header>

			<div className="grid gap-6 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
				<div className="min-w-0 space-y-6">
					<Section
						note="Two channels, chosen independently. Stored as a theme-agnostic ink ref in the workspace's agent.appearance facet and re-resolved per theme with a 4.5:1 contrast clamp."
						title="Appearance"
					>
						<AgentAppearanceEditor
							agentRef={ref}
							displayName={displayName}
							durable={Boolean(ref) && canWrite}
							ink={ink}
							isCline={isCline}
							onChange={commitInk}
							profileId={profileId}
							saveState={save}
						/>
					</Section>

					<Section
						note="Policy as code. A typed capability list and an approval posture — never a prompt, tool list, provider or model. Saves merge against the on-disk home server-side, so an absent field means unchanged."
						title="Policy"
					>
						{homeState.status === "loading" ? (
							<div className="space-y-3">
								<Skeleton className="h-9 w-full" />
								<Skeleton className="h-20 w-full" />
								<Skeleton className="h-24 w-full" />
							</div>
						) : homeState.status === "error" ? (
							<div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
								<TriangleAlert
									aria-hidden="true"
									className="size-4 shrink-0 text-destructive"
								/>
								<span className="min-w-0 flex-1 text-foreground">
									{homeState.message}
								</span>
								<Button
									onClick={() => void loadHome()}
									size="sm"
									type="button"
									variant="outline"
								>
									<RefreshCw aria-hidden="true" className="size-3.5" />
									Retry
								</Button>
							</div>
						) : homeState.status === "none" ? (
							<p className="text-sm text-muted-foreground">
								Configuration as code lives in{" "}
								<code className="font-mono">.driveagent/&lt;slug&gt;/</code>.
								This agent is a {ref ? ref.kind : "legacy"} ref, so it has no
								home to read or write.
							</p>
						) : (
							<AgentPolicyEditor
								canWrite={canWrite}
								home={homeState.home}
								onSave={savePolicy}
							/>
						)}
					</Section>
				</div>

				<div className="min-w-0 space-y-6">
					<Section title="On the call">
						{seat ? (
							<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
								<Fact label="Status">
									{participantStatusLabel(seat.status)}
								</Fact>
								<Fact label="Role">
									<span className="capitalize">{seat.role}</span>
								</Fact>
								<Fact label="Seat">{seatSourceLabel(seat.seatSources)}</Fact>
								<Fact label="Ceiling">
									{seat.capPreset
										? presetIntentLabel(
												seat.capPreset as "readonly" | "standard" | "full",
											)
										: "Not recorded"}
								</Fact>
								<Fact label="Runtime">
									{runtimeBadgeLabel(entry.runtimeBadge)}
								</Fact>
								<Fact label="Last active">
									{relativeTimeLabel(entry.lastActiveAt, now) ??
										"No feed activity yet"}
								</Fact>
								<Fact label="Titles">
									{entry.titles.length === 0 ? (
										<span className="text-muted-foreground">None held</span>
									) : (
										<span className="flex flex-wrap gap-1.5">
											{entry.titles.map((title) => (
												<TitleChip
													expiresAt={title.expiresAt}
													key={title.grantId}
													now={now}
													title={title.title}
												/>
											))}
										</span>
									)}
								</Fact>
								{seat.muted || seat.handRaised ? (
									<Fact label="Flags">
										<span className="flex flex-wrap gap-1.5">
											{seat.muted ? (
												<Badge className="gap-1" variant="outline">
													<MicOff aria-hidden="true" className="size-3" />
													Muted
												</Badge>
											) : null}
											{seat.handRaised ? (
												<Badge className="gap-1" variant="outline">
													<Hand aria-hidden="true" className="size-3" />
													Hand raised
												</Badge>
											) : null}
										</span>
									</Fact>
								) : null}
							</dl>
						) : (
							<p className="text-sm text-muted-foreground">
								Not seated in the current room. Seating commits room metadata
								only; the Spotlight, titles and runtime badge appear here once
								it joins a call.
							</p>
						)}
					</Section>

					<Section
						note="The strings this home lists. There is no skill registry behind them."
						title="Capabilities"
					>
						{homeState.status === "loading" && skills.length === 0 ? (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 aria-hidden="true" className="size-4 animate-spin" />
								Loading home…
							</div>
						) : skills.length === 0 ? (
							<p className="text-sm text-muted-foreground">None listed.</p>
						) : (
							<ul className="flex flex-wrap gap-1.5">
								{skills.map((skill) => (
									<li key={skill}>
										<Badge
											className="font-mono text-[11px]"
											variant="secondary"
										>
											{skill}
										</Badge>
									</li>
								))}
							</ul>
						)}
					</Section>

					<Section title="Identity">
						<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
							<Fact label="Profile id">
								<code className="break-all font-mono text-xs">{profileId}</code>
							</Fact>
							<Fact label="Defined in">
								<code className="break-all font-mono text-xs">
									{agentRefLabel(ref)}
								</code>
							</Fact>
							<Fact label="Home">
								{entry.hasHome
									? entry.tier === "user"
										? "User tier — every workspace"
										: "This workspace"
									: "None"}
							</Fact>
							<Fact label="Appearance">
								{entry.hasProfile ? "Pinned durably" : "Stable default"}
							</Fact>
						</dl>
					</Section>
				</div>
			</div>

			<p className="text-xs text-muted-foreground">
				Agents do not run independently. Seating commits room metadata; there is
				one Cline runtime behind the feed. A profile configures identity,
				appearance and policy — not execution.
			</p>
		</div>
	);
}
