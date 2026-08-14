import { describe, expect, it } from "vitest"
import fixture from "./__fixtures__/activity-snapshot.json"
import { parseLocalAgentActivityEvent, parseLocalAgentActivitySnapshot } from "./contract"

describe("local agent activity contract", () => {
	it("accepts the versioned Loco snapshot fixture without renaming wire fields", () => {
		const snapshot = parseLocalAgentActivitySnapshot(fixture)

		expect(snapshot.latest_sequence).toBe(42)
		expect(snapshot.content_recording).toBe(false)
		expect(snapshot.events[0]).toMatchObject({
			event_type: "inference.completed",
			parent_request_id: "drive:tool-call-17",
			route: "candidate",
			model: "mlx-community/Qwen3.8-27B-4bit",
			slots_total: 4,
		})
	})

	it.each(["prompt", "completion", "reasoning", "tool_arguments", "file_path"])(
		"rejects the forbidden content field %s",
		(forbiddenField) => {
			const event = { ...fixture.events[0], [forbiddenField]: "do-not-record-this" }

			expect(() => parseLocalAgentActivityEvent(event)).toThrow()
		},
	)

	it("rejects unknown schema versions and untrusted parent identifiers", () => {
		expect(() =>
			parseLocalAgentActivityEvent({
				...fixture.events[0],
				schema_version: 2,
			}),
		).toThrow()
		expect(() =>
			parseLocalAgentActivityEvent({
				...fixture.events[0],
				parent_request_id: "../../untrusted",
			}),
		).toThrow()
	})
})
