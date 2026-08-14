import type {
	LocalAgentActivityLane,
	LocalAgentActivityView,
	LocalAgentDisplayPhase,
	LocalAgentModelActivity,
	LocalAgentResourceActivity,
} from "@shared/LocalAgentActivity"
import type { LocalAgentActivityEvent, LocalAgentActivitySnapshot } from "./contract"

export type {
	LocalAgentActivityLane,
	LocalAgentActivityView,
	LocalAgentDisplayPhase,
	LocalAgentModelActivity,
	LocalAgentResourceActivity,
} from "@shared/LocalAgentActivity"

const REQUEST_EVENT_TYPES = new Set<LocalAgentActivityEvent["event_type"]>([
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
])

export class LocalAgentActivityProjection {
	private cursor = 0
	private sequenceGapDetected = false
	private observerDropSignals = 0
	private lastResourceSampleAtUnixMs: number | undefined
	private resources: LocalAgentResourceActivity | undefined
	private readonly agents = new Map<string, LocalAgentActivityLane>()
	private readonly models = new Map<string, LocalAgentModelActivity>()

	applySnapshot(snapshot: LocalAgentActivitySnapshot): void {
		const events = [...snapshot.events].sort((left, right) => left.sequence - right.sequence)
		if (events.some((event) => event.sequence > snapshot.latest_sequence)) {
			throw new Error("local activity snapshot contains an event beyond its cursor")
		}
		this.reset()
		for (const event of events) {
			this.applyEventData(event)
		}
		this.cursor = snapshot.latest_sequence
	}

	applyEvent(event: LocalAgentActivityEvent): boolean {
		if (event.sequence <= this.cursor) {
			return false
		}
		if (this.cursor > 0 && event.sequence !== this.cursor + 1) {
			this.sequenceGapDetected = true
		}
		this.applyEventData(event)
		this.cursor = event.sequence
		return true
	}

	view(): LocalAgentActivityView {
		const agents = Array.from(this.agents.values()).sort(
			(left, right) => left.firstSequence - right.firstSequence || left.requestId.localeCompare(right.requestId),
		)
		const models = Array.from(this.models.values()).sort(
			(left, right) => right.latestSequence - left.latestSequence || left.key.localeCompare(right.key),
		)
		const activeLeases = agents.filter((agent) => agent.leaseHeld && !agent.terminal)
		return {
			cursor: this.cursor,
			contentRecording: false,
			sequenceGapDetected: this.sequenceGapDetected,
			observerDropSignals: this.observerDropSignals,
			lastResourceSampleAtUnixMs: this.lastResourceSampleAtUnixMs,
			resources: this.resources ? { ...this.resources } : undefined,
			activeWeightedSlots: activeLeases.reduce((total, agent) => total + (agent.slotsReserved ?? 1), 0),
			totalWeightedSlots: agents.reduce<number | undefined>((total, agent) => {
				if (agent.slotsTotal === undefined) {
					return total
				}
				return Math.max(total ?? 0, agent.slotsTotal)
			}, undefined),
			agents: agents.map((agent) => ({ ...agent })),
			models: models.map((model) => ({ ...model })),
		}
	}

	private reset(): void {
		this.cursor = 0
		this.sequenceGapDetected = false
		this.observerDropSignals = 0
		this.lastResourceSampleAtUnixMs = undefined
		this.resources = undefined
		this.agents.clear()
		this.models.clear()
	}

	private applyEventData(event: LocalAgentActivityEvent): void {
		if (event.event_type === "observer.events_dropped") {
			this.observerDropSignals += 1
			return
		}
		if (event.event_type === "resource.sample") {
			this.lastResourceSampleAtUnixMs = event.timestamp_unix_ms
			this.resources = {
				updatedAtUnixMs: event.timestamp_unix_ms,
				hostMemoryTotalBytes: event.host_memory_total_bytes,
				memoryFreePercent: event.memory_free_percent,
				swapUsedBytes: event.swap_used_bytes,
				engineFootprintBytes: event.engine_footprint_bytes,
				engineRssBytes: event.engine_rss_bytes,
				engineCpuPercent: event.engine_cpu_percent,
			}
			return
		}
		if (event.event_type === "model.lifecycle") {
			const key = event.model ?? event.profile ?? event.request_id
			this.models.set(key, {
				key,
				model: event.model,
				profile: event.profile,
				outcome: event.outcome,
				safeErrorType: event.safe_error_type,
				updatedAtUnixMs: event.timestamp_unix_ms,
				latestSequence: event.sequence,
			})
			return
		}
		if (!REQUEST_EVENT_TYPES.has(event.event_type)) {
			return
		}

		const previous = this.agents.get(event.request_id)
		const terminal = previous?.terminal === true || isTerminalEvent(event.event_type)
		const lane: LocalAgentActivityLane = {
			requestId: event.request_id,
			parentRequestId: event.parent_request_id ?? previous?.parentRequestId,
			role: event.role ?? previous?.role,
			phase: displayPhase(event, previous),
			lastEventType: event.event_type,
			firstSequence: previous?.firstSequence ?? event.sequence,
			latestSequence: event.sequence,
			startedAtUnixMs: previous?.startedAtUnixMs ?? event.timestamp_unix_ms,
			updatedAtUnixMs: event.timestamp_unix_ms,
			terminal,
			model: event.model ?? previous?.model,
			profile: event.profile ?? previous?.profile,
			route: event.route ?? previous?.route,
			fallback: event.fallback ?? previous?.fallback,
			outcome: event.outcome ?? previous?.outcome,
			leaseHeld: leaseState(event.event_type, previous?.leaseHeld ?? false),
			slot: event.slot ?? previous?.slot,
			slotsReserved: event.slots_reserved ?? previous?.slotsReserved,
			slotsTotal: event.slots_total ?? previous?.slotsTotal,
			estimatedInputTokens: event.estimated_input_tokens ?? previous?.estimatedInputTokens,
			promptTokens: event.prompt_tokens ?? previous?.promptTokens,
			completionTokens: event.completion_tokens ?? previous?.completionTokens,
			totalTokens: event.total_tokens ?? previous?.totalTokens,
			queueMs: event.queue_ms ?? previous?.queueMs,
			elapsedMs: event.elapsed_ms ?? previous?.elapsedMs,
			ttftMs: event.ttft_ms ?? previous?.ttftMs,
			prefillTokensPerSecond: event.prefill_tokens_per_second ?? previous?.prefillTokensPerSecond,
			decodeTokensPerSecond: event.decode_tokens_per_second ?? previous?.decodeTokensPerSecond,
			outputValid: event.output_valid ?? previous?.outputValid,
			outputNormalized: event.output_normalized ?? previous?.outputNormalized,
			safeErrorType: event.safe_error_type ?? previous?.safeErrorType,
		}
		this.agents.set(event.request_id, lane)
	}
}

function isTerminalEvent(eventType: LocalAgentActivityEvent["event_type"]): boolean {
	return ["policy.rejected", "agent.completed", "agent.failed", "agent.canceled"].includes(eventType)
}

function leaseState(eventType: LocalAgentActivityEvent["event_type"], previous: boolean): boolean {
	if (
		["slot.acquired", "inference.started", "inference.prefill", "inference.decode_progress", "inference.completed"].includes(
			eventType,
		)
	) {
		return true
	}
	if (["slot.released", "policy.rejected", "agent.completed", "agent.failed", "agent.canceled"].includes(eventType)) {
		return false
	}
	return previous
}

function displayPhase(event: LocalAgentActivityEvent, previous?: LocalAgentActivityLane): LocalAgentDisplayPhase {
	switch (event.event_type) {
		case "policy.rejected":
			return "rejected"
		case "inference.completed":
		case "slot.released":
		case "output.validated":
			return "validating"
		case "agent.completed":
			return "completed"
		case "agent.failed":
			return "failed"
		case "agent.canceled":
			return "canceled"
		default:
			if (event.phase === "lifecycle" || event.phase === "resource") {
				return previous?.phase ?? "requested"
			}
			return event.phase
	}
}
