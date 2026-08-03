/**
 * `/agents?id=<profileId>` — one agent's profile (DRV-AGENT-PROFILE).
 *
 * Reachable without a room: everything on it is addressed by the durable
 * profile id, which is the agent's `AgentRef` flattened. Configuration comes
 * from `.driveagent/<slug>/` through the existing hub read/write pair, and
 * appearance from the `agent.appearance` facet — both durable, both surviving a
 * reload.
 *
 * What this page deliberately does NOT claim:
 *  - Teams are a *display* of pack membership. Adding a pack seats room
 *    metadata; nothing spawns a member, and nothing in the tree writes a
 *    `{kind:"spawn"}` seat source.
 *  - Skills are the strings the home lists. There is no skill registry, no
 *    resolution and no enforcement behind them.
 *  - Agents do not run independently. One Cline runtime sits behind the feed;
 *    a profile configures identity and appearance, not execution.
 */

import type { AgentRef, RosterPack } from "@cline/shared";
import { parseAgentProfileId } from "@cline/shared";
import { useEffect, useState } from "react";
import { ClineMarkIcon } from "@/components/icons/cline-mark";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AgentAppearanceEditor } from "./AgentAppearanceEditor";
import { AgentPolicyEditor } from "./AgentPolicyEditor";
import { resolveChannelInk, useDriveInkTheme } from "./agentInk";
import { CLINE_BUILTIN_REF_ID } from "./agentMark";
import { homeSlugForRef, teamsForProfile } from "./agentTeams";
import { requestDriveAgentProfiles } from "./requestDriveAgentProfiles";
import {
	type DriveagentHomeProjection,
	requestDriveagentHome,
} from "./requestDriveagentHome";
import { FIXTURE_ROSTER_PACKS } from "./rosterPackAdd";
import type { DriveAgentInk } from "./types";

type HomeState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ready"; home: DriveagentHomeProjection }
	| { status: "error"; message: string }
	| { status: "none" };

function refLabel(ref: AgentRef): string {
	switch (ref.kind) {
		case "driveagent":
			return `.driveagent/${ref.slug}/`;
		case "builtin":
			return `builtin · ${ref.id}`;
		case "configured":
			return `configured · ${ref.id}`;
		default:
			return "unknown";
	}
}

function fallbackDisplayName(ref: AgentRef): string {
	const raw = ref.kind === "driveagent" ? ref.slug : ref.id;
	return raw
		.split(/[-_]/g)
		.filter(Boolean)
		.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
		.join(" ");
}

function Section({
	title,
	note,
	children,
}: {
	title: string;
	note?: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-2 rounded-lg border bg-card p-4">
			<h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{title}
			</h2>
			{note ? (
				<p className="text-[11px] text-muted-foreground">{note}</p>
			) : null}
			{children}
		</section>
	);
}

function StringList({ items, empty }: { items: string[]; empty: string }) {
	if (items.length === 0) {
		return <p className="text-xs text-muted-foreground">{empty}</p>;
	}
	return (
		<ul className="flex flex-wrap gap-1.5">
			{items.map((item) => (
				<li key={item}>
					<Badge className="font-mono text-[10px]" variant="secondary">
						{item}
					</Badge>
				</li>
			))}
		</ul>
	);
}

export function AgentProfilePage({
	profileId,
	workspaceRoot,
	packs = FIXTURE_ROSTER_PACKS,
	onBack,
}: {
	profileId: string;
	workspaceRoot?: string;
	packs?: readonly RosterPack[];
	onBack: () => void;
}) {
	const theme = useDriveInkTheme();
	const ref = parseAgentProfileId(profileId);
	const root = workspaceRoot?.trim() ?? "";

	const [ink, setInk] = useState<DriveAgentInk>({});
	const [displayName, setDisplayName] = useState<string | null>(null);
	const [homeState, setHomeState] = useState<HomeState>({ status: "idle" });

	/**
	 * Hydrate appearance from the hub, not from this browser.
	 *
	 * This is the whole point of the page being durable: opened cold, in a
	 * browser that has never seen this agent, it must show the colours someone
	 * chose elsewhere.
	 */
	useEffect(() => {
		if (!root) {
			return;
		}
		let cancelled = false;
		void requestDriveAgentProfiles(root)
			.then((profiles) => {
				if (cancelled) {
					return;
				}
				const stored = profiles.find((entry) => entry.id === profileId);
				if (!stored) {
					return;
				}
				setInk({ nameInk: stored.nameInk, bodyInk: stored.bodyInk });
				if (stored.displayName) {
					setDisplayName(stored.displayName);
				}
			})
			.catch(() => {
				// A missing appearance is not an error state for the page: the
				// resolver's stable default is a real colour, not a placeholder.
			});
		return () => {
			cancelled = true;
		};
	}, [root, profileId]);

	const homeSlug = homeSlugForRef(ref);

	useEffect(() => {
		if (!homeSlug) {
			setHomeState({ status: "none" });
			return;
		}
		if (!root) {
			setHomeState({
				status: "error",
				message: "Set a workspace root to load this agent home.",
			});
			return;
		}
		let cancelled = false;
		setHomeState({ status: "loading" });
		void requestDriveagentHome(root, homeSlug)
			.then((home) => {
				if (!cancelled) {
					setHomeState({ status: "ready", home });
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setHomeState({
						status: "error",
						message: error instanceof Error ? error.message : String(error),
					});
				}
			});
		return () => {
			cancelled = true;
		};
	}, [homeSlug, root]);

	if (!ref) {
		return (
			<div className="mx-auto w-full max-w-3xl space-y-4 p-6">
				<h1 className="text-lg font-semibold">Agent not found</h1>
				<p className="text-sm text-muted-foreground">
					<code className="font-mono">{profileId}</code> is not a valid agent
					profile id. Ids are an agent ref flattened —{" "}
					<code className="font-mono">driveagent.&lt;slug&gt;</code> or{" "}
					<code className="font-mono">builtin.&lt;id&gt;</code>.
				</p>
				<button
					className="text-sm underline underline-offset-2"
					onClick={onBack}
					type="button"
				>
					Back to agents
				</button>
			</div>
		);
	}

	const home = homeState.status === "ready" ? homeState.home : null;
	const name =
		displayName?.trim() ||
		home?.compiled.name.trim() ||
		fallbackDisplayName(ref);
	const isCline = ref.kind === "builtin" && ref.id === CLINE_BUILTIN_REF_ID;
	const nameColor = resolveChannelInk({
		ink: ink.nameInk ?? null,
		channel: "name",
		profileId,
		theme,
	});
	const bodyColor = resolveChannelInk({
		ink: ink.bodyInk ?? null,
		channel: "body",
		profileId,
		theme,
	});
	const teams = teamsForProfile(profileId, ref, packs);

	return (
		<div
			className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6"
			data-agent-profile-id={profileId}
		>
			<button
				className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
				onClick={onBack}
				type="button"
			>
				← All agents
			</button>

			<header className="flex flex-wrap items-center gap-3">
				<span
					aria-hidden
					className={cn(
						"grid size-14 shrink-0 place-items-center rounded-full border font-mono text-xl font-bold",
						"border-current/45 bg-current/15",
					)}
					data-agent-avatar={isCline ? "cline-mark" : "initial"}
					style={{ color: nameColor }}
				>
					{isCline ? (
						<ClineMarkIcon className="size-7" />
					) : (
						name.slice(0, 1).toUpperCase()
					)}
				</span>
				<div className="min-w-0">
					<h1
						className="truncate text-xl font-semibold"
						data-testid="agent-profile-name"
						style={{ color: nameColor }}
					>
						{name}
					</h1>
					<p className="font-mono text-[11px] text-muted-foreground">
						{profileId} · {refLabel(ref)}
					</p>
				</div>
			</header>

			<p
				className="text-sm"
				data-testid="agent-profile-body-sample"
				style={{ color: bodyColor }}
			>
				{home?.compiled.description ??
					"This agent has no Driveagent home in this workspace, so it has no description of its own."}
			</p>

			<Section
				note="Two channels, chosen independently. Stored as a theme-agnostic ink ref in the workspace's agent.appearance facet and re-resolved per theme with a 4.5:1 contrast clamp."
				title="Appearance"
			>
				<AgentAppearanceEditor
					agentRef={ref}
					displayName={name}
					ink={ink}
					onDurableProfiles={(profiles) => {
						const stored = profiles.find((entry) => entry.id === profileId);
						if (stored) {
							setInk({ nameInk: stored.nameInk, bodyInk: stored.bodyInk });
						}
					}}
					onInkChange={setInk}
					profileId={profileId}
					workspaceRoot={root}
				/>
			</Section>

			<Section
				note="Skills and tools are the strings this home lists. There is no skill registry behind them — nothing resolves or enforces a skill today."
				title="Capabilities"
			>
				{homeState.status === "loading" || homeState.status === "idle" ? (
					<p className="text-xs text-muted-foreground">Loading home…</p>
				) : homeState.status === "error" ? (
					<p className="text-xs text-destructive">{homeState.message}</p>
				) : homeState.status === "none" ? (
					<p className="text-xs text-muted-foreground">
						Configuration-as-code lives in{" "}
						<code>.driveagent/&lt;slug&gt;/</code>. This agent is a {ref.kind}{" "}
						ref, so it has no home to read.
					</p>
				) : (
					<div className="space-y-3">
						<div className="space-y-1">
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
								Skills
							</div>
							<StringList
								empty="None listed"
								items={[...(home?.compiled.skills ?? [])]}
							/>
						</div>
						<div className="space-y-1">
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
								Tools
							</div>
							<StringList
								empty="None listed"
								items={[...(home?.compiled.tools ?? [])]}
							/>
						</div>
					</div>
				)}
			</Section>

			<Section
				note="Display only. A team is a roster pack — a list. Adding one seats its members' room metadata; it does not start anything, and no member gets a runtime of its own."
				title="Teams"
			>
				{teams.length === 0 ? (
					<p className="text-xs text-muted-foreground">
						This agent is not named by any roster pack.
					</p>
				) : (
					<ul className="space-y-1.5" data-testid="agent-profile-teams">
						{teams.map((team) => (
							<li
								className="rounded border bg-background/60 px-2.5 py-1.5"
								key={team.id}
							>
								<div className="text-xs font-medium">{team.displayName}</div>
								{team.description ? (
									<div className="text-[11px] text-muted-foreground">
										{team.description}
									</div>
								) : null}
								<div className="mt-1 font-mono text-[10px] text-muted-foreground">
									{team.memberProfileIds.join(" · ")}
								</div>
							</li>
						))}
					</ul>
				)}
			</Section>

			{home && root ? (
				<Section
					note="Policies as code. Saves are merged against the on-disk home server-side, so an absent field means unchanged and prompts are never in the payload."
					title="Configuration"
				>
					<AgentPolicyEditor
						home={home}
						onSaved={(next) => setHomeState({ status: "ready", home: next })}
						workspaceRoot={root}
					/>
				</Section>
			) : null}

			<p className="text-[11px] text-muted-foreground">
				Agents do not run independently. Seating commits room metadata; there is
				one Cline runtime behind the feed. A profile configures identity,
				appearance and policy — not execution.
			</p>
		</div>
	);
}
