/**
 * A participant's avatar — Cline's bot mark, or an initial (DRV-AGENT-PROFILE).
 *
 * Tinted with the participant's resolved name ink, so the avatar, the roster
 * name and the feed byline are all the same colour without any of them picking
 * one: `resolveParticipantNameInk` is the single source, contrast clamp and all.
 */

import type { Participant } from "@cline/shared";
import { ClineMarkIcon } from "@/components/icons/cline-mark";
import { cn } from "@/lib/utils";
import { agentAvatarInitial, agentAvatarKind } from "./agentMark";

const SIZE_CLASSES = {
	sm: { box: "size-5 text-[9px]", mark: "size-3" },
	md: { box: "size-7 text-[11px]", mark: "size-4" },
	lg: { box: "size-11 text-base", mark: "size-5" },
} as const;

export type AgentAvatarSize = keyof typeof SIZE_CLASSES;

export function AgentAvatar({
	participant,
	ink,
	size = "md",
	className,
}: {
	participant: Participant;
	/** Resolved, contrast-clamped name ink. Undefined keeps the human hue. */
	ink?: string;
	size?: AgentAvatarSize;
	className?: string;
}) {
	const sizes = SIZE_CLASSES[size];
	const isAgent = participant.kind === "agent";
	const kind = isAgent ? agentAvatarKind(participant) : "initial";
	const tinted = isAgent && Boolean(ink);

	return (
		<span
			aria-hidden
			className={cn(
				"grid shrink-0 place-items-center rounded-full border font-mono font-bold",
				sizes.box,
				tinted
					? "border-current/45 bg-current/15"
					: isAgent
						? "border-amber-500/45 bg-amber-500/15 text-amber-700 dark:text-amber-300"
						: "border-sky-500/45 bg-sky-500/15 text-sky-700 dark:text-sky-300",
				className,
			)}
			data-agent-avatar={kind}
			data-participant-id={participant.id}
			style={tinted ? { color: ink } : undefined}
		>
			{kind === "cline-mark" ? (
				<ClineMarkIcon className={sizes.mark} />
			) : (
				agentAvatarInitial(participant)
			)}
		</span>
	);
}
