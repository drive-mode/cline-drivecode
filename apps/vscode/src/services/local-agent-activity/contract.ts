import { z } from "zod"

const boundedIdentifier = z.string().min(1).max(128)
const nonNegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
// Sequence numbers order events. This host-uptime clock may exceed the exact-integer
// range after roughly 104 days, but its sub-millisecond precision remains sufficient.
const monotonicNanoseconds = z.number().finite().nonnegative().refine(Number.isInteger)

export const LocalAgentActivityEventTypeSchema = z.enum([
	"agent.requested",
	"policy.accepted",
	"policy.rejected",
	"model.selected",
	"slot.waiting",
	"slot.acquired",
	"inference.started",
	"inference.prefill",
	"inference.decode_progress",
	"inference.completed",
	"slot.released",
	"output.validated",
	"agent.completed",
	"agent.failed",
	"agent.canceled",
	"model.lifecycle",
	"resource.sample",
	"observer.events_dropped",
])

export const LocalAgentActivityPhaseSchema = z.enum([
	"requested",
	"policy",
	"waiting",
	"inference",
	"prefill",
	"decode",
	"validating",
	"completed",
	"failed",
	"canceled",
	"lifecycle",
	"resource",
])

export const LocalAgentActivityEventSchema = z
	.object({
		schema_version: z.literal(1),
		sequence: nonNegativeInteger,
		timestamp_unix_ms: nonNegativeInteger,
		monotonic_ns: monotonicNanoseconds,
		event_type: LocalAgentActivityEventTypeSchema,
		request_id: boundedIdentifier.regex(/^[A-Za-z0-9._:-]+$/),
		parent_request_id: z
			.string()
			.regex(/^(?:codex|claude|cursor|drive|jcode):[A-Za-z0-9._-]{1,96}$/)
			.optional(),
		role: z.enum(["planner", "implementer", "reviewer", "explorer"]).optional(),
		phase: LocalAgentActivityPhaseSchema,
		outcome: z.enum(["accepted", "rejected", "success", "error", "canceled"]).optional(),
		route: z.enum(["auto", "quality", "fast", "candidate", "fallback"]).optional(),
		profile: boundedIdentifier.optional(),
		model: z.string().min(1).max(256).optional(),
		artifact_revision: boundedIdentifier.optional(),
		fallback: z.boolean().optional(),
		prompt_sha256: z
			.string()
			.regex(/^[0-9a-f]{64}$/)
			.optional(),
		task_characters: nonNegativeInteger.optional(),
		context_characters: nonNegativeInteger.optional(),
		estimated_input_tokens: nonNegativeInteger.optional(),
		prompt_tokens: nonNegativeInteger.optional(),
		completion_tokens: nonNegativeInteger.optional(),
		total_tokens: nonNegativeInteger.optional(),
		output_characters: nonNegativeInteger.optional(),
		elapsed_ms: nonNegativeInteger.optional(),
		queue_ms: nonNegativeInteger.optional(),
		ttft_ms: nonNegativeInteger.optional(),
		prefill_tokens_per_second: z.number().finite().nonnegative().optional(),
		decode_tokens_per_second: z.number().finite().nonnegative().optional(),
		host_memory_total_bytes: nonNegativeInteger.optional(),
		memory_free_percent: z.number().int().min(0).max(100).optional(),
		swap_used_bytes: nonNegativeInteger.optional(),
		engine_footprint_bytes: nonNegativeInteger.optional(),
		engine_rss_bytes: nonNegativeInteger.optional(),
		engine_cpu_percent: z.number().finite().nonnegative().optional(),
		slot: nonNegativeInteger.optional(),
		slots_reserved: nonNegativeInteger.optional(),
		slots_total: z.number().int().positive().optional(),
		output_normalized: z.boolean().optional(),
		output_valid: z.boolean().optional(),
		safe_error_type: z
			.string()
			.min(1)
			.max(80)
			.regex(/^[A-Za-z][A-Za-z0-9_]*$/)
			.optional(),
	})
	.strict()

export const LocalAgentActivitySnapshotSchema = z
	.object({
		schema_version: z.literal(1),
		latest_sequence: nonNegativeInteger,
		content_recording: z.literal(false),
		events: z.array(LocalAgentActivityEventSchema).max(100),
	})
	.strict()

export type LocalAgentActivityEvent = z.infer<typeof LocalAgentActivityEventSchema>
export type LocalAgentActivitySnapshot = z.infer<typeof LocalAgentActivitySnapshotSchema>

export function parseLocalAgentActivityEvent(value: unknown): LocalAgentActivityEvent {
	return LocalAgentActivityEventSchema.parse(value)
}

export function parseLocalAgentActivitySnapshot(value: unknown): LocalAgentActivitySnapshot {
	return LocalAgentActivitySnapshotSchema.parse(value)
}
