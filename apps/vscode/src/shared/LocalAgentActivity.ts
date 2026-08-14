export type LocalAgentActivityRole = "planner" | "implementer" | "reviewer" | "explorer"
export type LocalAgentActivityRoute = "auto" | "quality" | "fast" | "candidate" | "fallback"
export type LocalAgentActivityOutcome = "accepted" | "rejected" | "success" | "error" | "canceled"
export type LocalAgentActivityEventType =
	| "agent.requested"
	| "policy.accepted"
	| "policy.rejected"
	| "model.selected"
	| "slot.waiting"
	| "slot.acquired"
	| "inference.started"
	| "inference.prefill"
	| "inference.decode_progress"
	| "inference.completed"
	| "slot.released"
	| "output.validated"
	| "agent.completed"
	| "agent.failed"
	| "agent.canceled"
	| "model.lifecycle"
	| "resource.sample"
	| "observer.events_dropped"

export type LocalAgentDisplayPhase =
	| "requested"
	| "policy"
	| "waiting"
	| "inference"
	| "prefill"
	| "decode"
	| "validating"
	| "completed"
	| "failed"
	| "canceled"
	| "rejected"

export interface LocalAgentActivityLane {
	requestId: string
	parentRequestId?: string
	role?: LocalAgentActivityRole
	phase: LocalAgentDisplayPhase
	lastEventType: LocalAgentActivityEventType
	firstSequence: number
	latestSequence: number
	startedAtUnixMs: number
	updatedAtUnixMs: number
	terminal: boolean
	model?: string
	profile?: string
	route?: LocalAgentActivityRoute
	fallback?: boolean
	outcome?: LocalAgentActivityOutcome
	leaseHeld: boolean
	slot?: number
	slotsReserved?: number
	slotsTotal?: number
	estimatedInputTokens?: number
	promptTokens?: number
	completionTokens?: number
	totalTokens?: number
	queueMs?: number
	elapsedMs?: number
	ttftMs?: number
	decodeTokensPerSecond?: number
	outputValid?: boolean
	outputNormalized?: boolean
	safeErrorType?: string
}

export interface LocalAgentModelActivity {
	key: string
	model?: string
	profile?: string
	outcome?: LocalAgentActivityOutcome
	safeErrorType?: string
	updatedAtUnixMs: number
	latestSequence: number
}

export interface LocalAgentActivityView {
	cursor: number
	contentRecording: false
	sequenceGapDetected: boolean
	observerDropSignals: number
	lastResourceSampleAtUnixMs?: number
	activeWeightedSlots: number
	totalWeightedSlots?: number
	agents: LocalAgentActivityLane[]
	models: LocalAgentModelActivity[]
}

export type LocalAgentActivityConnection = "idle" | "connecting" | "live" | "reconnecting" | "unavailable" | "stopped"

export interface LocalAgentActivityObserverState {
	connection: LocalAgentActivityConnection
	attempt: number
	safeErrorType?: string
	view: LocalAgentActivityView
}
