/**
 * Payload schemas for every `window.desktop` request.
 *
 * The renderer is same-origin-guarded and the runtime is health-checked for
 * a `<title>Kanban</title>` body before we ever attach, but neither of those
 * makes the renderer *trusted*: it runs remote-loaded code, and this bridge
 * is the one path from there into the host process. Every inbound payload is
 * parsed here before a handler sees it, so a malformed or hostile message is
 * rejected at the boundary instead of reaching OS APIs.
 *
 * Tauri's capability manifest gates *which* commands a window may call at
 * all; these schemas gate what it may say once allowed. Both are needed —
 * capabilities cannot express "this string is at most 200 characters".
 */

import { z } from "zod";

export const openProjectWindowPayloadSchema = z.object({
	projectId: z.string().trim().min(1),
});

export type OpenProjectWindowPayload = z.infer<
	typeof openProjectWindowPayloadSchema
>;

/**
 * Notification text is bounded so a runaway renderer can't push megabyte
 * strings into the OS notification centre. The limits are generous next to
 * what any platform actually renders — macOS and Windows both truncate far
 * sooner — so clamping here costs nothing a user would see.
 */
export const notifyPayloadSchema = z
	.object({
		key: z.string().trim().min(1).max(200),
		title: z.string().trim().min(1).max(200),
		body: z.string().max(1_000),
		projectId: z.string().trim().min(1).optional(),
		taskId: z.string().trim().min(1).optional(),
	})
	// A task id without its project can't be turned into a URL — the web UI
	// addresses tasks as `/<projectId>?task=<id>` — so reject the pair rather
	// than shipping a notification whose click does nothing.
	.refine((value) => (value.taskId ? Boolean(value.projectId) : true), {
		message: "taskId requires projectId",
	});

export type NotifyPayload = z.infer<typeof notifyPayloadSchema>;

/**
 * Counts are clamped rather than merely validated. A renderer bug producing a
 * huge number would otherwise reach the dock badge, and there is no sensible
 * reading of "9 million tasks ready".
 */
const presenceCount = z.number().int().min(0).max(9_999).catch(0);

export const presenceCountsPayloadSchema = z.object({
	running: presenceCount,
	readyForReview: presenceCount,
});

export type PresenceCountsPayload = z.infer<typeof presenceCountsPayloadSchema>;

/**
 * Menu contents are bounded: the menu is rebuilt on every publish, and an
 * unbounded list would let a renderer bug stall the UI thread building
 * thousands of native menu items.
 */
export const menuActionsPayloadSchema = z
	.array(
		z.object({
			id: z.string().trim().min(1).max(100),
			label: z.string().trim().min(1).max(120),
			group: z.string().trim().min(1).max(60),
			accelerator: z.string().trim().min(1).max(60).nullable().catch(null),
			enabled: z.boolean().catch(false),
		}),
	)
	.max(100);

export type MenuActionsPayload = z.infer<typeof menuActionsPayloadSchema>;

export const pickDirectoryPayloadSchema = z
	.object({ title: z.string().trim().min(1).max(200).optional() })
	.optional();

export type PickDirectoryPayload = z.infer<typeof pickDirectoryPayloadSchema>;

/**
 * Shared by every request that takes no arguments. Modelled explicitly rather
 * than skipping validation, so a payload-less request that later grows a
 * payload can't silently start accepting unvalidated input.
 */
export const emptyPayloadSchema = z.undefined();
