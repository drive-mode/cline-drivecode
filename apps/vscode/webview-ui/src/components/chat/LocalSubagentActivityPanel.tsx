import type { LocalAgentActivityLane, LocalAgentActivityObserverState } from "@shared/LocalAgentActivity"
import { ActivityIcon, ChevronDownIcon, ChevronRightIcon, CircleAlertIcon, LockKeyholeIcon, NetworkIcon } from "lucide-react"
import { useMemo, useState } from "react"

interface LocalSubagentActivityPanelProps {
	state: LocalAgentActivityObserverState
}

const PHASES = ["Request", "Policy", "Queue", "Inference", "Validate", "Done"] as const

const PHASE_INDEX: Record<LocalAgentActivityLane["phase"], number> = {
	requested: 0,
	policy: 1,
	rejected: 1,
	waiting: 2,
	inference: 3,
	prefill: 3,
	decode: 3,
	validating: 4,
	completed: 5,
	failed: 5,
	canceled: 5,
}

const CONNECTION_LABEL: Record<LocalAgentActivityObserverState["connection"], string> = {
	idle: "Idle",
	connecting: "Connecting",
	live: "Live",
	reconnecting: "Reconnecting",
	unavailable: "Unavailable",
	stopped: "Stopped",
}

export function LocalSubagentActivityPanel({ state }: LocalSubagentActivityPanelProps) {
	const [expanded, setExpanded] = useState(true)
	const agents = useMemo(
		() =>
			[...state.view.agents]
				.sort(
					(left, right) =>
						Number(left.terminal) - Number(right.terminal) || right.updatedAtUnixMs - left.updatedAtUnixMs,
				)
				.slice(0, 6),
		[state.view.agents],
	)
	const activeAgentCount = state.view.agents.filter((agent) => !agent.terminal).length
	const connectionLabel = CONNECTION_LABEL[state.connection]
	const slotCapacity = state.view.totalWeightedSlots
	const slotText = slotCapacity
		? `${state.view.activeWeightedSlots}/${slotCapacity} weighted slots`
		: `${state.view.activeWeightedSlots} weighted slots`

	return (
		<section
			aria-label="Local subagent activity"
			className="mx-3 mt-2 rounded-md border border-editor-group-border overflow-hidden shrink-0"
			style={{ backgroundColor: "var(--vscode-editor-background)" }}>
			<button
				aria-expanded={expanded}
				className="w-full border-0 bg-transparent text-foreground px-2.5 py-2 flex items-center gap-2 cursor-pointer text-left"
				onClick={() => setExpanded((value) => !value)}
				type="button">
				{expanded ? <ChevronDownIcon className="size-3 shrink-0" /> : <ChevronRightIcon className="size-3 shrink-0" />}
				<NetworkIcon className="size-3 shrink-0 text-link" />
				<span className="font-semibold text-xs">Local subagents</span>
				<span
					aria-live="polite"
					className={`text-[10px] rounded-full px-1.5 py-0.5 ${state.connection === "live" ? "text-success" : state.connection === "unavailable" ? "text-error" : "opacity-70"}`}>
					{connectionLabel}
				</span>
				<span className="ml-auto text-[10px] opacity-70">
					{activeAgentCount} active · {slotText}
				</span>
			</button>

			{expanded && (
				<div className="border-t border-editor-group-border px-2.5 py-2 space-y-2">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] opacity-75">
						<span className="inline-flex items-center gap-1">
							<LockKeyholeIcon className="size-2.5" /> Metadata only
						</span>
						<span>CPU — not measured</span>
						<span>GPU — not measured</span>
						<span>Unified memory — not measured</span>
					</div>

					{state.connection === "unavailable" && (
						<div className="rounded-sm border border-editor-group-border px-2 py-1.5 flex items-center gap-2 text-[11px] text-error">
							<CircleAlertIcon className="size-3 shrink-0" />
							<span>Observer unavailable; model work remains unaffected.</span>
						</div>
					)}

					{state.view.sequenceGapDetected && (
						<div className="rounded-sm border border-editor-group-border px-2 py-1.5 text-[11px] text-error">
							Activity sequence gap detected; reconnecting from a fresh snapshot.
						</div>
					)}

					{agents.length === 0 ? (
						<div className="text-[11px] opacity-65 py-1">No local subagent requests observed yet.</div>
					) : (
						<div className="space-y-1.5">
							{agents.map((agent) => (
								<AgentLane agent={agent} key={agent.requestId} />
							))}
						</div>
					)}
				</div>
			)}
		</section>
	)
}

function AgentLane({ agent }: { agent: LocalAgentActivityLane }) {
	const phaseIndex = phaseIndexFor(agent)
	const terminalFailure = agent.phase === "failed" || agent.phase === "rejected" || agent.phase === "canceled"
	const model = shortModelName(agent.model)
	const timing = agent.ttftMs !== undefined ? `TTFT ${formatDuration(agent.ttftMs)}` : "TTFT —"
	const speed =
		agent.decodeTokensPerSecond !== undefined ? `${agent.decodeTokensPerSecond.toFixed(1)} tok/s decode` : "Decode rate —"

	return (
		<article className="rounded-sm border border-editor-group-border px-2 py-1.5" data-phase={agent.phase}>
			<div className="flex items-center gap-2 min-w-0">
				<ActivityIcon className={`size-3 shrink-0 ${agent.terminal ? "opacity-60" : "text-link"}`} />
				<span className="text-[11px] font-semibold capitalize shrink-0">{agent.role ?? "subagent"}</span>
				<span className="text-[10px] font-mono truncate opacity-75" title={agent.model}>
					{model}
				</span>
				<span className="ml-auto text-[10px] capitalize opacity-80 shrink-0">{agent.phase}</span>
			</div>

			<ol aria-label={`${agent.role ?? "Subagent"} lifecycle`} className="mt-1.5 grid grid-cols-6 gap-1 list-none p-0">
				{PHASES.map((phase, index) => {
					const complete = index < phaseIndex || (agent.phase === "completed" && index === phaseIndex)
					const current = index === phaseIndex && !agent.terminal
					const failed = index === phaseIndex && terminalFailure
					return (
						<li
							aria-label={`${phase}: ${failed ? "failed" : current ? "active" : complete ? "complete" : "pending"}`}
							className="min-w-0"
							key={phase}>
							<div
								className="h-1 rounded-full"
								style={{
									backgroundColor: failed
										? "var(--vscode-errorForeground)"
										: current
											? "var(--vscode-progressBar-background)"
											: complete
												? "var(--vscode-testing-iconPassed)"
												: "var(--vscode-panel-border)",
								}}
							/>
							<div className="mt-0.5 text-[8px] opacity-55 truncate">{phase}</div>
						</li>
					)
				})}
			</ol>

			<div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9px] opacity-70">
				<span>{formatCount(agent.promptTokens ?? agent.estimatedInputTokens)} in</span>
				<span>{formatCount(agent.completionTokens)} out</span>
				<span>{timing}</span>
				<span>{speed}</span>
				<span>{agent.elapsedMs === undefined ? "Elapsed —" : `${formatDuration(agent.elapsedMs)} elapsed`}</span>
				<span>{agent.slotsReserved === undefined ? "Slot —" : `${agent.slotsReserved} slot weight`}</span>
			</div>
		</article>
	)
}

function phaseIndexFor(agent: LocalAgentActivityLane): number {
	if (agent.phase !== "failed" && agent.phase !== "canceled") {
		return PHASE_INDEX[agent.phase]
	}
	if (agent.outputValid !== undefined) {
		return 4
	}
	if (agent.promptTokens !== undefined || agent.completionTokens !== undefined || agent.slot !== undefined) {
		return 3
	}
	if (agent.model || agent.profile) {
		return 2
	}
	return 0
}

function shortModelName(model: string | undefined): string {
	if (!model) {
		return "Model pending"
	}
	return model.split("/").at(-1) || model
}

function formatCount(value: number | undefined): string {
	return value === undefined ? "—" : Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

function formatDuration(milliseconds: number): string {
	if (milliseconds < 1_000) {
		return `${milliseconds} ms`
	}
	return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`
}
