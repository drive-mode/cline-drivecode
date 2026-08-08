/**
 * Felt-agency chrome helpers (DRV-FELT-AGENCY).
 * Pure copy / phase helpers — no utterance keys in control chrome.
 */

import type { BankSnapshot } from "@cline/shared";

export type AgencyInterruptPhase = "idle" | "finishing" | "paused";

export type PlanAddTone = "recovery" | "collaborative";

export type PlanMutationKind = "add" | "complete" | "reorder" | "other";

/** Derive raise-hand interrupt chrome from hand + turn state. */
export function resolveInterruptPhase(input: {
	handRaised: boolean;
	turnInFlight: boolean;
}): AgencyInterruptPhase {
	if (!input.handRaised) {
		return "idle";
	}
	return input.turnInFlight ? "finishing" : "paused";
}

/** Call-strip interrupt copy — null when idle. */
export function interruptChromeCopy(
	phase: AgencyInterruptPhase,
): string | null {
	switch (phase) {
		case "idle":
			return null;
		case "finishing":
			return "Finishing current step";
		case "paused":
			return "Paused — waiting on you";
		default: {
			const _exhaustive: never = phase;
			return _exhaustive;
		}
	}
}

/**
 * Full-width app banner (NOW-RAISE-HAND) — title + hard-cancel teaching.
 * Null when idle.
 */
export function interruptBannerCopy(
	phase: AgencyInterruptPhase,
): { title: string; hint: string } | null {
	const title = interruptChromeCopy(phase);
	if (!title) {
		return null;
	}
	return {
		title,
		hint:
			phase === "finishing"
				? "Hand raised — finishing current step. Hard cancel stays one tap away."
				: "Hand raised — paused on you. Lower hand to resume.",
	};
}

/**
 * W1.1 / W-13: announce that Now was rewritten after an interrupt redirect.
 * Feed / strip narration only — no utterance payload.
 */
export function interruptRedirectNowAnnounce(input: {
	previousNowTitle?: string | null;
	nextNowTitle?: string | null;
	nextNowTaskId?: string | null;
}): string | null {
	const next =
		input.nextNowTitle?.trim() ||
		input.nextNowTaskId?.trim() ||
		null;
	if (!next) {
		return null;
	}
	const prev = input.previousNowTitle?.trim();
	if (prev && prev === next) {
		return null;
	}
	if (prev) {
		return `Redirect: Now was “${prev}”; now “${next}”.`;
	}
	return `Redirect: Now is “${next}”.`;
}

/** Visible call-strip badge when privacy.debugRetention is on. */
export function debugRetentionStripCopy(debugRetention: boolean): string | null {
	return debugRetention ? "Debug retention on" : null;
}

/**
 * One-shot consequence after a PlanEditor bank mutation.
 * Skips reorder-only noise when the cursor (now/next) is unchanged.
 */
export function planEditConsequenceBanner(
	prev: BankSnapshot,
	next: BankSnapshot,
	options?: {
		mutation?: PlanMutationKind;
		addedTitle?: string;
		recovery?: boolean;
	},
): string | null {
	const cursorChanged =
		prev.nowTaskId !== next.nowTaskId ||
		prev.nextTaskId !== next.nextTaskId ||
		prev.nowTitle !== next.nowTitle ||
		prev.nextTitle !== next.nextTitle;

	if (!cursorChanged) {
		return null;
	}

	if (options?.mutation === "add" && options.addedTitle?.trim()) {
		const title = options.addedTitle.trim();
		if (options.recovery) {
			return `You added a fix-up: ${title}`;
		}
		return `You added ${title}`;
	}

	if (prev.nowTaskId !== next.nowTaskId || prev.nowTitle !== next.nowTitle) {
		const title = next.nowTitle ?? next.nowTaskId;
		if (title) {
			return `Now is ${title}`;
		}
	}

	if (
		prev.nextTaskId !== next.nextTaskId ||
		prev.nextTitle !== next.nextTitle
	) {
		const title = next.nextTitle ?? next.nextTaskId;
		if (title) {
			return `Next is now ${title}`;
		}
		return "Next cleared";
	}

	return null;
}

/** Collaborative mid-plan add vs fix-up after lastFailure — never “churn”. */
export function planAddTreatment(hasNowFailure: boolean): {
	tone: PlanAddTone;
	addLabel: string;
	hint: string | null;
} {
	if (hasNowFailure) {
		return {
			tone: "recovery",
			addLabel: "Add fix-up",
			hint: "Current task needs a fix-up before continuing",
		};
	}
	return {
		tone: "collaborative",
		addLabel: "Add task",
		hint: null,
	};
}

export function steerAppliedBanner(): string {
	return "Steer applied";
}

export function hasNowLastFailure(snapshot: BankSnapshot): boolean {
	return Boolean(snapshot.nowLastFailure?.trim());
}
