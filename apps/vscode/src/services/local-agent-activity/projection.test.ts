import { describe, expect, it } from "vitest"
import { parseLocalAgentActivityEvent, parseLocalAgentActivitySnapshot } from "./contract"
import { LocalAgentActivityProjection } from "./projection"

function event(sequence: number, eventType: Record<string, unknown>) {
	return parseLocalAgentActivityEvent({
		schema_version: 1,
		sequence,
		timestamp_unix_ms: 1_786_733_400_000 + sequence,
		monotonic_ns: 9_876_543_210 + sequence,
		request_id: "request-a",
		phase: "requested",
		...eventType,
	})
}

describe("LocalAgentActivityProjection", () => {
	it("projects a complete request into a privacy-safe UI lane", () => {
		const projection = new LocalAgentActivityProjection()
		const events = [
			event(1, {
				event_type: "agent.requested",
				parent_request_id: "drive:tool-call-17",
				role: "planner",
				task_characters: 220,
				context_characters: 440,
			}),
			event(2, {
				event_type: "model.selected",
				phase: "policy",
				model: "mlx-community/Qwen3.8-27B-4bit",
				profile: "qwen38-32k-4",
				route: "candidate",
				prompt_sha256: "a".repeat(64),
			}),
			event(3, {
				event_type: "slot.acquired",
				phase: "waiting",
				slot: 1,
				slots_reserved: 2,
				slots_total: 4,
				queue_ms: 18,
			}),
			event(4, {
				event_type: "inference.completed",
				phase: "inference",
				prompt_tokens: 1_992,
				completion_tokens: 312,
				total_tokens: 2_304,
				elapsed_ms: 18_540,
				ttft_ms: 480,
				prefill_tokens_per_second: 4_150,
				decode_tokens_per_second: 19.4,
			}),
			event(5, { event_type: "slot.released", phase: "inference" }),
			event(6, {
				event_type: "output.validated",
				phase: "validating",
				output_valid: true,
				output_normalized: false,
			}),
			event(7, { event_type: "agent.completed", phase: "completed", outcome: "success" }),
		]
		projection.applySnapshot(
			parseLocalAgentActivitySnapshot({
				schema_version: 1,
				latest_sequence: 7,
				content_recording: false,
				events,
			}),
		)

		const view = projection.view()
		expect(view).toMatchObject({ cursor: 7, contentRecording: false, activeWeightedSlots: 0 })
		expect(view.agents).toEqual([
			expect.objectContaining({
				requestId: "request-a",
				parentRequestId: "drive:tool-call-17",
				role: "planner",
				phase: "completed",
				terminal: true,
				leaseHeld: false,
				model: "mlx-community/Qwen3.8-27B-4bit",
				promptTokens: 1_992,
				completionTokens: 312,
				ttftMs: 480,
				prefillTokensPerSecond: 4_150,
				decodeTokensPerSecond: 19.4,
				outputValid: true,
			}),
		])
		const serialized = JSON.stringify(view)
		expect(serialized).not.toContain("prompt_sha256")
		expect(serialized).not.toContain("task_characters")
		expect(serialized).not.toContain("context_characters")
	})

	it("counts weighted leases and ignores at-least-once duplicates", () => {
		const projection = new LocalAgentActivityProjection()
		expect(
			projection.applyEvent(
				event(1, {
					event_type: "slot.acquired",
					phase: "waiting",
					slots_reserved: 3,
					slots_total: 4,
				}),
			),
		).toBe(true)
		expect(projection.applyEvent(event(1, { event_type: "slot.released", phase: "inference" }))).toBe(false)

		expect(projection.view()).toMatchObject({
			cursor: 1,
			activeWeightedSlots: 3,
			totalWeightedSlots: 4,
			sequenceGapDetected: false,
		})
	})

	it("surfaces sequence gaps and observer drop signals", () => {
		const projection = new LocalAgentActivityProjection()
		projection.applyEvent(event(10, { event_type: "agent.requested" }))
		projection.applyEvent(
			event(12, {
				event_type: "observer.events_dropped",
				request_id: "observer",
				phase: "resource",
			}),
		)

		expect(projection.view()).toMatchObject({
			cursor: 12,
			sequenceGapDetected: true,
			observerDropSignals: 1,
		})
	})

	it("keeps system lifecycle events out of subagent lanes", () => {
		const projection = new LocalAgentActivityProjection()
		projection.applyEvent(
			event(1, {
				event_type: "model.lifecycle",
				request_id: "model-qwen",
				phase: "lifecycle",
				model: "mlx-community/Qwen3.8-27B-4bit",
				profile: "qwen38-32k-4",
				outcome: "success",
			}),
		)
		projection.applyEvent(
			event(2, {
				event_type: "resource.sample",
				request_id: "resource-host",
				phase: "resource",
				host_memory_total_bytes: 51_539_607_552,
				memory_free_percent: 47,
				swap_used_bytes: 5_015_213_179,
				engine_footprint_bytes: 21_992_521_760,
				engine_rss_bytes: 100_597_760,
				engine_cpu_percent: 0.6,
			}),
		)

		const view = projection.view()
		expect(view.agents).toHaveLength(0)
		expect(view.models).toEqual([
			expect.objectContaining({
				model: "mlx-community/Qwen3.8-27B-4bit",
				profile: "qwen38-32k-4",
				outcome: "success",
			}),
		])
		expect(view.lastResourceSampleAtUnixMs).toBe(1_786_733_400_002)
		expect(view.resources).toEqual({
			updatedAtUnixMs: 1_786_733_400_002,
			hostMemoryTotalBytes: 51_539_607_552,
			memoryFreePercent: 47,
			swapUsedBytes: 5_015_213_179,
			engineFootprintBytes: 21_992_521_760,
			engineRssBytes: 100_597_760,
			engineCpuPercent: 0.6,
		})
	})

	it("rejects a snapshot whose cursor precedes one of its events", () => {
		const projection = new LocalAgentActivityProjection()
		const snapshot = parseLocalAgentActivitySnapshot({
			schema_version: 1,
			latest_sequence: 1,
			content_recording: false,
			events: [event(2, { event_type: "agent.requested" })],
		})

		expect(() => projection.applySnapshot(snapshot)).toThrow("beyond its cursor")
	})
})
