import { describe, expect, it } from "vitest"
import { resolveLocalAgentActivitySocket } from "./integration"

describe("resolveLocalAgentActivitySocket", () => {
	it("is disabled unless explicitly enabled or given a socket", () => {
		expect(resolveLocalAgentActivitySocket({}, "/Users/tester")).toBeUndefined()
	})

	it("uses Loco's default state path when enabled", () => {
		expect(resolveLocalAgentActivitySocket({ DRIVEMODE_LOCAL_AGENT_ACTIVITY: "1" }, "/Users/tester")).toBe(
			"/Users/tester/.local/state/local-agent/activity.sock",
		)
	})

	it("honors an absolute shared state-directory override", () => {
		expect(
			resolveLocalAgentActivitySocket(
				{ DRIVEMODE_LOCAL_AGENT_ACTIVITY: "1", LOCAL_AGENT_STATE_DIR: "/private/loco-state" },
				"/Users/tester",
			),
		).toBe("/private/loco-state/activity.sock")
	})

	it("lets an absolute socket override opt in directly", () => {
		expect(resolveLocalAgentActivitySocket({ DRIVEMODE_LOCAL_AGENT_ACTIVITY_SOCKET: "/private/run/loco.sock" })).toBe(
			"/private/run/loco.sock",
		)
	})

	it("rejects relative state and socket paths", () => {
		expect(resolveLocalAgentActivitySocket({ DRIVEMODE_LOCAL_AGENT_ACTIVITY_SOCKET: "relative.sock" })).toBeUndefined()
		expect(
			resolveLocalAgentActivitySocket({ DRIVEMODE_LOCAL_AGENT_ACTIVITY: "1", LOCAL_AGENT_STATE_DIR: "relative" }),
		).toBeUndefined()
	})
})
