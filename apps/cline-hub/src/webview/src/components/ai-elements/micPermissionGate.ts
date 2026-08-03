/**
 * Sticky microphone-permission state shared by every mic request in the
 * webview — both `getUserMedia` call sites and `SpeechRecognition.start()`,
 * which the browser governs with the same microphone permission.
 *
 * A surface that blocks the mic — an embedded browser pane, an enterprise
 * policy — raises its own banner on *every* request, so a UI that keeps asking
 * after a refusal spams a prompt the user cannot answer. This remembers the
 * refusal and answers locally instead.
 *
 * It must never make the mic unrecoverable, so the sticky state is deliberately
 * easy to clear: a `PermissionStatus` flip to "granted" clears it with no
 * reload, and an explicit user retry clears it even in browsers that cannot be
 * queried at all. A failed or absent `navigator.permissions.query` degrades to
 * the old attempt-based behaviour — feature detection is never itself a block.
 *
 * No React and no imports beyond the shared classifier, so the webview's
 * node-env tests can drive the real logic through
 * {@link createMicPermissionGate}.
 */

import { isSpeechInputDenial } from "./speechInputSupport";

export type MicPermissionState = "unknown" | "granted" | "denied";

/** The slice of `PermissionStatus` this gate uses. */
export type MicPermissionStatusLike = {
	state: string;
	onchange: (() => void) | null;
};

export type MicPermissionQuery = () => Promise<MicPermissionStatusLike>;

/**
 * A capture failure, in whichever shape the call site has it: `getUserMedia`
 * rejects with an `Error`, `SpeechRecognition` reports a string code. Both
 * reach the same classifier so the two paths cannot disagree about what a
 * refusal is.
 */
export type MicPermissionFailure = {
	/** `SpeechRecognitionErrorEvent.error` */
	code?: string;
	/** `getUserMedia` / `MediaRecorder` rejection */
	error?: unknown;
};

export type MicPermissionGate = {
	/** Last known state. Synchronous, never throws — safe to read in render. */
	state(): MicPermissionState;
	/**
	 * Pre-flight for a mic request. "denied" means: do not ask, the prompt is
	 * known-blocked. Anything else means the caller should try.
	 */
	check(): Promise<MicPermissionState>;
	/** Record a capture that started. */
	noteGranted(): void;
	/** Record a failure. True when it was denial-class and is now sticky. */
	noteFailure(failure: MicPermissionFailure): boolean;
	/** Explicit user retry — forget a remembered denial. */
	retry(): void;
	subscribe(listener: (state: MicPermissionState) => void): () => void;
};

/**
 * How long a `navigator.permissions.query` gets before the gate stops waiting
 * on it. A probe that never settles must cost one press a short pause, not
 * wedge the mic button for the rest of the session.
 */
const DEFAULT_QUERY_TIMEOUT_MS = 1500;

function defaultMicPermissionQuery(): Promise<MicPermissionStatusLike> {
	if (typeof navigator === "undefined" || !navigator.permissions?.query) {
		return Promise.reject(new Error("permissions_query_unsupported"));
	}
	// Firefox has historically rejected the "microphone" descriptor. The caller
	// treats that as "cannot know", never as a denial.
	return navigator.permissions.query({
		name: "microphone" as PermissionName,
	}) as unknown as Promise<MicPermissionStatusLike>;
}

export function createMicPermissionGate(
	query: MicPermissionQuery = defaultMicPermissionQuery,
	options: { queryTimeoutMs?: number } = {},
): MicPermissionGate {
	const queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
	let state: MicPermissionState = "unknown";
	let watched: MicPermissionStatusLike | null = null;
	/** The `watched.state` we last acted on, so a later read can spot a move. */
	let lastSeen: string | null = null;
	let watching: Promise<void> | null = null;
	let queryable = true;
	const listeners = new Set<(next: MicPermissionState) => void>();

	function publish(next: MicPermissionState): void {
		if (next === state) {
			return;
		}
		state = next;
		for (const listener of [...listeners]) {
			listener(next);
		}
	}

	/**
	 * @param moved Whether the permission actually changed since we last looked.
	 * Only a move can clear a refusal with "prompt" — see the branch comment.
	 */
	function adopt(status: MicPermissionStatusLike, moved: boolean): void {
		lastSeen = status.state;
		if (status.state === "granted") {
			publish("granted");
			return;
		}
		if (status.state === "denied") {
			publish("denied");
			return;
		}
		// "prompt" that *moved* is the user re-opening the question — Chrome's
		// "Reset permission" lands here — so a remembered refusal is stale.
		// A standing "prompt" is not: a surface that blocks capture by policy
		// reports "prompt" forever, and adopting that on every check would
		// forget the denial and re-trigger the prompt this gate exists to stop.
		if (moved || state !== "denied") {
			publish("unknown");
		}
	}

	function watch(): Promise<void> {
		if (watching) {
			return watching;
		}
		const probe = (async () => {
			let status: MicPermissionStatusLike;
			try {
				status = await query();
			} catch {
				queryable = false;
				return;
			}
			if (!status || typeof status.state !== "string") {
				queryable = false;
				return;
			}
			watched = status;
			// A grant made after the denial has to reach us without a reload.
			status.onchange = () => adopt(status, true);
			adopt(status, false);
		})();
		// Nothing waits on the probe forever. If it outruns the budget the gate
		// falls back to attempt-based behaviour; a late result is still adopted
		// when it lands, it just stops holding the mic button hostage.
		let timer: ReturnType<typeof setTimeout> | undefined;
		const expiry = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, queryTimeoutMs);
		});
		watching = Promise.race([probe, expiry]).then(() => {
			clearTimeout(timer);
			if (!watched) {
				queryable = false;
			}
		});
		return watching;
	}

	return {
		state: () => state,
		async check() {
			if (watched) {
				// A permission that moved since we last looked is news even when the
				// browser never fired `onchange`. One that has not moved cannot clear
				// a refusal we observed with a real capture attempt: the reported
				// surface blocks the mic above the page permission, so its reading
				// stays put while capture keeps failing.
				if (watched.state !== lastSeen) {
					adopt(watched, true);
				}
				return state;
			}
			// A remembered denial answers without spending a probe.
			if (state === "denied") {
				return "denied";
			}
			if (queryable) {
				await watch();
			}
			return state;
		},
		noteGranted() {
			publish("granted");
		},
		noteFailure(failure) {
			if (!isSpeechInputDenial(failure)) {
				return false;
			}
			publish("denied");
			return true;
		},
		retry() {
			// A browser that still reports "denied" re-arms the gate on the next
			// check without another prompt; one that reports "prompt" — or cannot
			// be queried at all — buys exactly one more attempt.
			publish("unknown");
			if (watched) {
				// An explicit retry re-opens the question, so the current reading is
				// re-read as news rather than as the value we already acted on.
				adopt(watched, true);
			}
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

const gate = createMicPermissionGate();

export function micPermissionState(): MicPermissionState {
	return gate.state();
}

export function ensureMicPermission(): Promise<MicPermissionState> {
	return gate.check();
}

export function noteMicPermissionGranted(): void {
	gate.noteGranted();
}

export function noteMicPermissionFailure(
	failure: MicPermissionFailure,
): boolean {
	return gate.noteFailure(failure);
}

export function retryMicPermission(): void {
	gate.retry();
}

export function subscribeMicPermission(
	listener: (state: MicPermissionState) => void,
): () => void {
	return gate.subscribe(listener);
}
