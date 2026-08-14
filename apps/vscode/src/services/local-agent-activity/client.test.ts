import { describe, expect, it, vi } from "vitest"
import fixture from "./__fixtures__/activity-snapshot.json"
import {
	createUnixSocketActivityTransport,
	fetchLocalAgentActivitySnapshot,
	type LocalActivityHttpGet,
	LocalAgentActivityClientError,
	parseLocalAgentActivitySse,
	streamLocalAgentActivity,
} from "./client"

function response(body: AsyncIterable<Uint8Array | string>, contentType: string): Awaited<ReturnType<LocalActivityHttpGet>> {
	return {
		statusCode: 200,
		headers: { "content-type": contentType },
		body,
	}
}

async function* chunks(...values: Array<string | Uint8Array>) {
	for (const value of values) {
		yield value
	}
}

function sse(event: (typeof fixture.events)[number], id = event.sequence): string {
	return `id: ${id}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`
}

describe("local activity Unix-socket client", () => {
	it("parses a bounded snapshot through the injected native transport", async () => {
		const get = vi.fn<LocalActivityHttpGet>(async () =>
			response(chunks(JSON.stringify(fixture)), "application/json; charset=utf-8"),
		)

		const snapshot = await fetchLocalAgentActivitySnapshot(get)

		expect(snapshot.latest_sequence).toBe(42)
		expect(get).toHaveBeenCalledWith("/v1/activity/snapshot", undefined)
	})

	it("parses chunked events and ignores an at-least-once duplicate", async () => {
		const next = { ...fixture.events[0], sequence: 43, event_type: "slot.released" as const }
		const wire = `${sse(fixture.events[0])}${sse(next)}`
		const split = Math.floor(wire.length / 2)
		const observed = []

		for await (const event of parseLocalAgentActivitySse(chunks(wire.slice(0, split), wire.slice(split)), 42)) {
			observed.push(event)
		}

		expect(observed.map((event) => event.sequence)).toEqual([43])
	})

	it("streams validated events from the requested cursor", async () => {
		const next = { ...fixture.events[0], sequence: 43, event_type: "agent.completed" as const, phase: "completed" as const }
		const get = vi.fn<LocalActivityHttpGet>(async () => response(chunks(sse(next)), "text/event-stream"))
		const onEvent = vi.fn()

		const cursor = await streamLocalAgentActivity(get, { after: 42, onEvent })

		expect(cursor).toBe(43)
		expect(get).toHaveBeenCalledWith("/v1/activity/events?after=42", undefined)
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ sequence: 43 }))
	})

	it("fails closed when the SSE id disagrees with the signed event envelope", async () => {
		const iterator = parseLocalAgentActivitySse(chunks(sse(fixture.events[0], 43)), 0)

		await expect(iterator.next()).rejects.toThrow("does not match")
	})

	it("fails closed when streamed data includes forbidden content", async () => {
		const unsafe = { ...fixture.events[0], prompt: "do not expose" }
		const iterator = parseLocalAgentActivitySse(chunks(sse(unsafe as (typeof fixture.events)[number])), 0)

		await expect(iterator.next()).rejects.toThrow("violates the contract")
	})

	it("rejects non-absolute socket paths before opening a request", () => {
		expect(() => createUnixSocketActivityTransport("relative/activity.sock")).toThrow(LocalAgentActivityClientError)
	})
})
