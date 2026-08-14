import type { LocalAgentActivityObserverState } from "@shared/LocalAgentActivity"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { LocalSubagentActivityPanel } from "./LocalSubagentActivityPanel"

const liveState: LocalAgentActivityObserverState = {
	connection: "live",
	attempt: 0,
	view: {
		cursor: 12,
		contentRecording: false,
		sequenceGapDetected: false,
		observerDropSignals: 0,
		activeWeightedSlots: 2,
		totalWeightedSlots: 4,
		models: [],
		agents: [
			{
				requestId: "request-a",
				parentRequestId: "drive:tool-call-17",
				role: "planner",
				phase: "inference",
				lastEventType: "inference.started",
				firstSequence: 1,
				latestSequence: 12,
				startedAtUnixMs: 1_786_733_400_000,
				updatedAtUnixMs: 1_786_733_401_000,
				terminal: false,
				model: "mlx-community/Qwen3.8-27B-4bit",
				profile: "qwen38-32k-4",
				leaseHeld: true,
				slotsReserved: 2,
				slotsTotal: 4,
				estimatedInputTokens: 2_048,
			},
		],
	},
}

describe("LocalSubagentActivityPanel", () => {
	it("shows live model, lifecycle, capacity, and honest unavailable measurements", () => {
		render(<LocalSubagentActivityPanel state={liveState} />)

		expect(screen.getByText("Local subagents")).toBeInTheDocument()
		expect(screen.getByText("Live")).toBeInTheDocument()
		expect(screen.getByText("1 active · 2/4 weighted slots")).toBeInTheDocument()
		expect(screen.getByText("Qwen3.8-27B-4bit")).toBeInTheDocument()
		expect(screen.getByLabelText("Inference: active")).toBeInTheDocument()
		expect(screen.getByText("2K in")).toBeInTheDocument()
		expect(screen.getByText("Prefill rate —")).toBeInTheDocument()
		expect(screen.getByText("Decode rate —")).toBeInTheDocument()
		expect(screen.getByText("Engine CPU — not measured")).toBeInTheDocument()
		expect(screen.getByText("GPU — not measured")).toBeInTheDocument()
		expect(screen.getByText("Engine footprint — not measured")).toBeInTheDocument()
		expect(screen.queryByText(/0\.0 tok\/s/)).not.toBeInTheDocument()
	})

	it("shows measured stream timing without inventing missing host utilization", () => {
		const measuredState: LocalAgentActivityObserverState = {
			...liveState,
			view: {
				...liveState.view,
				agents: [
					{
						...liveState.view.agents[0],
						ttftMs: 480,
						prefillTokensPerSecond: 4_150,
						decodeTokensPerSecond: 39.4,
					},
				],
			},
		}

		render(<LocalSubagentActivityPanel state={measuredState} />)

		expect(screen.getByText("TTFT 480 ms")).toBeInTheDocument()
		expect(screen.getByText("4150.0 tok/s prefill")).toBeInTheDocument()
		expect(screen.getByText("39.4 tok/s decode")).toBeInTheDocument()
		expect(screen.getByText("Host memory — not measured")).toBeInTheDocument()
	})

	it("shows measured engine footprint and host memory headroom", () => {
		render(
			<LocalSubagentActivityPanel
				state={{
					...liveState,
					view: {
						...liveState.view,
						resources: {
							updatedAtUnixMs: 1_786_733_405_000,
							hostMemoryTotalBytes: 51_539_607_552,
							memoryFreePercent: 47,
							swapUsedBytes: 5_015_213_179,
							engineFootprintBytes: 21_992_521_760,
							engineRssBytes: 100_597_760,
							engineCpuPercent: 0.6,
						},
					},
				}}
			/>,
		)

		expect(screen.getByText("Engine CPU 0.6%")).toBeInTheDocument()
		expect(screen.getByText("Engine footprint 20.5 GiB")).toBeInTheDocument()
		expect(screen.getByText("Host memory 47% free / 48.0 GiB")).toBeInTheDocument()
		expect(screen.getByText("Swap 4.7 GiB")).toBeInTheDocument()
		expect(screen.getByTitle(/Process RSS: 95\.9 MiB/)).toBeInTheDocument()
		expect(screen.getByText("GPU — not measured")).toBeInTheDocument()
	})

	it("collapses the detailed activity lanes", () => {
		render(<LocalSubagentActivityPanel state={liveState} />)

		fireEvent.click(screen.getByRole("button", { name: /local subagents/i }))

		expect(screen.queryByText("Qwen3.8-27B-4bit")).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: /local subagents/i })).toHaveAttribute("aria-expanded", "false")
	})

	it("makes observer failure explicit without implying model failure", () => {
		render(
			<LocalSubagentActivityPanel
				state={{
					...liveState,
					connection: "unavailable",
					attempt: 1,
					view: { ...liveState.view, agents: [], activeWeightedSlots: 0 },
				}}
			/>,
		)

		expect(screen.getByText("Unavailable")).toBeInTheDocument()
		expect(screen.getByText("Observer unavailable; model work remains unaffected.")).toBeInTheDocument()
		expect(screen.getByText("No local subagent requests observed yet.")).toBeInTheDocument()
	})
})
