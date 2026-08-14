import { describe, expect, it, vi } from "vitest"
import { type LocalActivityHttpGet, LocalAgentActivityClientError } from "./client"
import { parseLocalAgentActivityEvent, parseLocalAgentActivitySnapshot } from "./contract"
import { type LocalAgentActivityObserverState, LocalAgentActivitySession } from "./session"

async function* chunks(...values: string[]) {
	for (const value of values) {
		yield value
	}
}

function response(body: AsyncIterable<string>, contentType: string) {
	return {
		statusCode: 200,
		headers: { "content-type": contentType },
		body,
	}
}

function snapshot(sequence: number) {
	return parseLocalAgentActivitySnapshot({
		schema_version: 1,
		latest_sequence: sequence,
		content_recording: false,
		events: [],
	})
}

function activityEvent(sequence: number) {
	return parseLocalAgentActivityEvent({
		schema_version: 1,
		sequence,
		timestamp_unix_ms: 1_786_733_400_000 + sequence,
		monotonic_ns: 9_876_543_210 + sequence,
		event_type: "inference.started",
		request_id: "request-a",
		parent_request_id: "drive:tool-call-17",
		role: "planner",
		phase: "inference",
		model: "mlx-community/Qwen3.8-27B-4bit",
		slots_reserved: 2,
		slots_total: 4,
	})
}

function sse(sequence: number): string {
	const event = activityEvent(sequence)
	return `id: ${sequence}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`
}

describe("LocalAgentActivitySession", () => {
	it("hydrates a snapshot and publishes streamed activity", async () => {
		const states: LocalAgentActivityObserverState[] = []
		let releaseStream: (() => void) | undefined
		let observedSession: LocalAgentActivitySession | undefined
		const get = vi.fn<LocalActivityHttpGet>(async (path) => {
			if (path === "/v1/activity/snapshot") {
				return response(chunks(JSON.stringify(snapshot(1))), "application/json")
			}
			async function* stream() {
				yield sse(2)
				await new Promise<void>((resolve) => {
					releaseStream = resolve
				})
			}
			return response(stream(), "text/event-stream")
		})
		const observed = new Promise<void>((resolve) => {
			const session = new LocalAgentActivitySession({
				get,
				onState: (state) => {
					states.push(state)
					if (state.view.cursor === 2) {
						resolve()
					}
				},
			})
			session.start()
			observedSession = session
		})

		await observed
		releaseStream?.()
		await observedSession?.stop()

		const live = states.find((state) => state.view.cursor === 2)
		expect(live).toMatchObject({
			connection: "live",
			view: {
				activeWeightedSlots: 2,
				totalWeightedSlots: 4,
				agents: [
					expect.objectContaining({
						parentRequestId: "drive:tool-call-17",
						phase: "inference",
					}),
				],
			},
		})
		expect(states.at(-1)?.connection).toBe("stopped")
	})

	it("retries unavailable observers without exposing error messages", async () => {
		const states: LocalAgentActivityObserverState[] = []
		let retryReached: (() => void) | undefined
		const retrying = new Promise<void>((resolve) => {
			retryReached = resolve
		})
		const get = vi.fn<LocalActivityHttpGet>(async () => {
			throw new LocalAgentActivityClientError("socket /Users/private/activity.sock was unavailable")
		})
		const session = new LocalAgentActivitySession({
			get,
			retryDelaysMs: [0],
			wait: async (_milliseconds, signal) =>
				new Promise<void>((resolve) => {
					retryReached?.()
					signal.addEventListener("abort", () => resolve(), { once: true })
				}),
			onState: (state) => states.push(state),
		})
		session.start()

		await retrying
		await session.stop()
		const unavailable = states.find((state) => state.connection === "unavailable")
		expect(unavailable).toMatchObject({ attempt: 1, safeErrorType: "LocalAgentActivityClientError" })
		expect(JSON.stringify(states)).not.toContain("/Users/private")
	})

	it("rejects an empty retry schedule", () => {
		expect(
			() =>
				new LocalAgentActivitySession({
					get: vi.fn(),
					onState: vi.fn(),
					retryDelaysMs: [],
				}),
		).toThrow("retry schedule")
	})

	it("keeps running when a UI observer callback throws", async () => {
		let retryReached: (() => void) | undefined
		const retrying = new Promise<void>((resolve) => {
			retryReached = resolve
		})
		const session = new LocalAgentActivitySession({
			get: async () => {
				throw new Error("offline")
			},
			retryDelaysMs: [0],
			wait: async (_milliseconds, signal) =>
				new Promise<void>((resolve) => {
					retryReached?.()
					signal.addEventListener("abort", () => resolve(), { once: true })
				}),
			onState: () => {
				throw new Error("webview callback failed")
			},
		})

		session.start()
		await retrying
		await expect(session.stop()).resolves.toBeUndefined()
	})
})
