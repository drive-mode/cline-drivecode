/**
 * SDLC phase-entry freeze → bankable DriveTasks (req-sdlc-bankable / W-44).
 *
 * Guidance stage cards alone do not earn S2. Accepting a freeze creates real
 * DriveTasks + an active plan so Agent can bind nowTaskId and rollups can credit
 * completions. Privacy: titles/bodies as structured fields only — no transcripts.
 *
 * Stage freeze UI may be incomplete; this module is the accept-boundary writer.
 */

import type { BankSnapshot, DrivePlan, DriveTask } from "@cline/shared";
import type { BankStore } from "./bankStore.js";

/** Keys that must never appear on freeze proposals / accept plans. */
export const SDLC_BANKABLE_FORBIDDEN_KEYS = [
	"utterance",
	"utterances",
	"transcript",
	"message",
	"messages",
	"speech",
	"audio",
	"fullTranscript",
] as const;

/** One verifiable slice (or MoSCoW Must) destined for the bank. */
export type SdlcFreezeSlice = {
	title: string;
	body?: string;
	/** Stable id when known; otherwise generated at accept. */
	id?: string;
};

/**
 * Phase-entry freeze proposal (session-tier until accept).
 * Escape hatch skips MoSCoW bureaucracy and lands a single build task.
 */
export type SdlcFreezeProposal =
	| {
			kind: "phase_entry";
			/** First verifiable implementation slice (required). */
			firstSlice: SdlcFreezeSlice;
			/** Optional follow-on Musts → 1:1 additional tasks (default choice). */
			followOnMusts?: SdlcFreezeSlice[];
			planTitle?: string;
			planId?: string;
	  }
	| {
			kind: "escape";
			/** “Just build X” — single task, no checklist theater. */
			slice: SdlcFreezeSlice;
			planTitle?: string;
			planId?: string;
	  };

export type SdlcFreezeAcceptTask = {
	id: string;
	title: string;
	body: string;
};

/** Bank write plan produced by accept — not yet written. */
export type SdlcFreezeAcceptPlan = {
	kind: "sdlc_freeze_accept";
	planId: string;
	planTitle: string;
	tasks: SdlcFreezeAcceptTask[];
	activate: true;
};

export type ApplySdlcFreezeAcceptResult = {
	plan: DrivePlan;
	tasks: DriveTask[];
	snapshot: BankSnapshot;
};

function slugId(prefix: string, title: string, index: number): string {
	const slug = title
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 24);
	return `${prefix}-${slug || "slice"}-${index + 1}`;
}

function normalizeSlice(
	slice: SdlcFreezeSlice,
	prefix: string,
	index: number,
): SdlcFreezeAcceptTask {
	const title = slice.title.trim();
	if (!title) {
		throw new Error("SDLC freeze slice title is required");
	}
	const id = slice.id?.trim() || slugId(prefix, title, index);
	return {
		id,
		title,
		body: slice.body?.trim() ?? "",
	};
}

/** Reject proposals / plans that smuggle utterance-like fields. */
export function sdlcFreezeIsPrivate(value: unknown): boolean {
	if (value === null || typeof value !== "object") {
		return false;
	}
	return findForbiddenSdlcKey(value) == null;
}

function findForbiddenSdlcKey(
	value: unknown,
	path: string[] = [],
): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			const hit = findForbiddenSdlcKey(value[i], [...path, String(i)]);
			if (hit) {
				return hit;
			}
		}
		return null;
	}
	if (typeof value !== "object") {
		return null;
	}
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		const lower = key.toLowerCase();
		for (const forbidden of SDLC_BANKABLE_FORBIDDEN_KEYS) {
			if (lower === forbidden || lower.includes(forbidden)) {
				return [...path, key].join(".") || key;
			}
		}
		const hit = findForbiddenSdlcKey(child, [...path, key]);
		if (hit) {
			return hit;
		}
	}
	return null;
}

/**
 * Build a gated bank write plan from a freeze proposal.
 * Does not write — caller must accept (Plan posture) then apply.
 */
export function buildSdlcFreezeAcceptPlan(
	proposal: SdlcFreezeProposal,
): SdlcFreezeAcceptPlan {
	if (!sdlcFreezeIsPrivate(proposal)) {
		throw new Error("SDLC freeze proposal contains forbidden privacy keys");
	}

	if (proposal.kind === "escape") {
		const task = normalizeSlice(proposal.slice, "t-build", 0);
		const planId =
			proposal.planId?.trim() ||
			slugId("p-build", proposal.planTitle ?? task.title, 0);
		return {
			kind: "sdlc_freeze_accept",
			planId,
			planTitle: proposal.planTitle?.trim() || task.title,
			tasks: [task],
			activate: true,
		};
	}

	if (proposal.kind === "phase_entry") {
		const first = normalizeSlice(proposal.firstSlice, "t-slice", 0);
		const followOns = (proposal.followOnMusts ?? []).map((slice, i) =>
			normalizeSlice(slice, "t-must", i + 1),
		);
		const tasks = [first, ...followOns];
		const planTitle =
			proposal.planTitle?.trim() || `Phase entry: ${first.title}`;
		const planId = proposal.planId?.trim() || slugId("p-phase", planTitle, 0);
		return {
			kind: "sdlc_freeze_accept",
			planId,
			planTitle,
			tasks,
			activate: true,
		};
	}

	const _exhaustive: never = proposal;
	throw new Error(
		`Unknown SDLC freeze proposal: ${JSON.stringify(_exhaustive)}`,
	);
}

/**
 * Write accepted freeze into the bank: create DriveTasks + activate plan.
 * After this, Agent posture can bind nowTaskId; S2 credits completions.
 */
export async function applySdlcFreezeAccept(
	store: BankStore,
	plan: SdlcFreezeAcceptPlan,
): Promise<ApplySdlcFreezeAcceptResult> {
	if (!sdlcFreezeIsPrivate(plan)) {
		throw new Error("SDLC freeze accept plan contains forbidden privacy keys");
	}
	if (plan.tasks.length < 1) {
		throw new Error("SDLC freeze accept requires ≥1 DriveTask");
	}

	const tasks: DriveTask[] = [];
	for (const task of plan.tasks) {
		tasks.push(
			await store.createTask({
				id: task.id,
				title: task.title,
				body: task.body,
			}),
		);
	}
	const drivePlan = await store.createPlan({
		id: plan.planId,
		title: plan.planTitle,
		taskIds: plan.tasks.map((t) => t.id),
		activate: plan.activate,
	});
	const snapshot = await store.getSnapshot();
	return { plan: drivePlan, tasks, snapshot };
}

/**
 * Convenience: build + apply in one gated accept.
 */
export async function acceptSdlcFreeze(
	store: BankStore,
	proposal: SdlcFreezeProposal,
): Promise<ApplySdlcFreezeAcceptResult> {
	const plan = buildSdlcFreezeAcceptPlan(proposal);
	return applySdlcFreezeAccept(store, plan);
}
