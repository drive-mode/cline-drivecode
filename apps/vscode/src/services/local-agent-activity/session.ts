import type { LocalAgentActivityConnection, LocalAgentActivityObserverState } from "@shared/LocalAgentActivity"
import {
	fetchLocalAgentActivitySnapshot,
	type LocalActivityHttpGet,
	LocalAgentActivityClientError,
	streamLocalAgentActivity,
} from "./client"
import { LocalAgentActivityProjection } from "./projection"

export type { LocalAgentActivityConnection, LocalAgentActivityObserverState } from "@shared/LocalAgentActivity"

export interface LocalAgentActivitySessionOptions {
	get: LocalActivityHttpGet
	onState: (state: LocalAgentActivityObserverState) => void
	retryDelaysMs?: readonly number[]
	wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const

export class LocalAgentActivitySession {
	private readonly projection = new LocalAgentActivityProjection()
	private readonly retryDelaysMs: readonly number[]
	private readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>
	private abortController: AbortController | undefined
	private runPromise: Promise<void> | undefined
	private currentState: LocalAgentActivityObserverState

	constructor(private readonly options: LocalAgentActivitySessionOptions) {
		if (options.retryDelaysMs?.length === 0 || options.retryDelaysMs?.some((delay) => delay < 0 || !Number.isFinite(delay))) {
			throw new LocalAgentActivityClientError("local activity retry schedule is invalid")
		}
		this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
		this.wait = options.wait ?? abortableWait
		this.currentState = {
			connection: "idle",
			attempt: 0,
			view: this.projection.view(),
		}
	}

	get state(): LocalAgentActivityObserverState {
		return cloneState(this.currentState)
	}

	start(): void {
		if (this.runPromise) {
			return
		}
		this.abortController = new AbortController()
		const signal = this.abortController.signal
		this.runPromise = this.run(signal).finally(() => {
			this.runPromise = undefined
			this.abortController = undefined
		})
	}

	async stop(): Promise<void> {
		const running = this.runPromise
		this.abortController?.abort()
		await running
		if (this.currentState.connection !== "stopped") {
			this.emit("stopped", 0)
		}
	}

	private async run(signal: AbortSignal): Promise<void> {
		let attempt = 0
		while (!signal.aborted) {
			this.emit(attempt === 0 ? "connecting" : "reconnecting", attempt)
			try {
				const snapshot = await fetchLocalAgentActivitySnapshot(this.options.get, signal)
				this.projection.applySnapshot(snapshot)
				this.emit("live", 0)
				attempt = 0
				await streamLocalAgentActivity(this.options.get, {
					after: snapshot.latest_sequence,
					signal,
					onEvent: (event) => {
						this.projection.applyEvent(event)
						if (this.projection.view().sequenceGapDetected) {
							throw new LocalAgentActivityClientError("local activity stream contains a sequence gap")
						}
						this.emit("live", 0)
					},
				})
				if (!signal.aborted) {
					throw new LocalAgentActivityClientError("local activity stream ended")
				}
			} catch (error) {
				if (signal.aborted) {
					break
				}
				attempt += 1
				this.emit(attempt === 1 ? "unavailable" : "reconnecting", attempt, safeErrorType(error))
				await this.wait(retryDelay(this.retryDelaysMs, attempt), signal).catch(() => {})
			}
		}
		this.emit("stopped", 0)
	}

	private emit(connection: LocalAgentActivityConnection, attempt: number, safeErrorTypeValue?: string): void {
		this.currentState = {
			connection,
			attempt,
			safeErrorType: safeErrorTypeValue,
			view: this.projection.view(),
		}
		try {
			this.options.onState(cloneState(this.currentState))
		} catch {
			// Observability is advisory and must never destabilize the extension host.
		}
	}
}

function retryDelay(schedule: readonly number[], attempt: number): number {
	return schedule[Math.min(Math.max(attempt - 1, 0), schedule.length - 1)]
}

function safeErrorType(error: unknown): string {
	const candidate = error instanceof Error ? error.name : "UnknownError"
	return /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(candidate) ? candidate : "UnknownError"
}

function cloneState(state: LocalAgentActivityObserverState): LocalAgentActivityObserverState {
	return {
		...state,
		view: {
			...state.view,
			agents: state.view.agents.map((agent) => ({ ...agent })),
			models: state.view.models.map((model) => ({ ...model })),
		},
	}
}

function abortableWait(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new LocalAgentActivityClientError("local activity retry was aborted"))
			return
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort)
			resolve()
		}, milliseconds)
		const abort = () => {
			clearTimeout(timer)
			reject(new LocalAgentActivityClientError("local activity retry was aborted"))
		}
		signal.addEventListener("abort", abort, { once: true })
	})
}
