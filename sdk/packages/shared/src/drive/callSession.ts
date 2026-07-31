/**
 * Call-session helpers for correlating room + bank events (DRV-CALL-SESSION).
 */

import { z } from "zod";

export const CallSessionIdSchema = z.string().min(1);

export type CallSessionState = {
	callSessionId: string;
	startedAt: string;
};

export function mintCallSessionId(): string {
	return `cs_${crypto.randomUUID()}`;
}

export function durationMsBetween(startedAt: string, endedAt: string): number {
	const start = Date.parse(startedAt);
	const end = Date.parse(endedAt);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
		return 0;
	}
	return end - start;
}
