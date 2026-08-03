import { describe, expect, it, vi } from "vitest";
import {
	createMicPermissionGate,
	ensureMicPermission,
	type MicPermissionStatusLike,
	micPermissionState,
	noteMicPermissionFailure,
} from "./micPermissionGate";

/** A fake `PermissionStatus`: mutate `state`, then fire `onchange` like a browser. */
function fakeStatus(
	state: string,
): MicPermissionStatusLike & { fire(next: string): void } {
	const status = {
		onchange: null as (() => void) | null,
		state,
		fire(next: string) {
			status.state = next;
			status.onchange?.();
		},
	};
	return status;
}

const DENIAL = { error: { name: "NotAllowedError" } };
/** What `SpeechRecognitionErrorEvent` reports when the mic is refused. */
const RECOGNITION_DENIAL = { code: "not-allowed" };

describe("createMicPermissionGate", () => {
	it("degrades to attempt-based behaviour when the query is unsupported", async () => {
		// Firefox rejects query({ name: "microphone" }). Feature detection must
		// never be the thing that blocks the mic.
		const query = vi.fn(() => Promise.reject(new Error("unsupported")));
		const gate = createMicPermissionGate(query);

		expect(await gate.check()).toBe("unknown");
		expect(await gate.check()).toBe("unknown");
		// One failed probe is enough; it is not retried on every press.
		expect(query).toHaveBeenCalledTimes(1);
	});

	it("blocks the second request after a denial-class rejection", async () => {
		const gate = createMicPermissionGate(() =>
			Promise.reject(new Error("unsupported")),
		);

		expect(await gate.check()).toBe("unknown");
		expect(gate.noteFailure(DENIAL)).toBe(true);
		expect(await gate.check()).toBe("denied");
	});

	it("does not stick on failures that are not a refusal", async () => {
		const gate = createMicPermissionGate(() =>
			Promise.reject(new Error("unsupported")),
		);

		expect(gate.noteFailure({ error: { name: "NotFoundError" } })).toBe(false);
		expect(gate.noteFailure({ error: { name: "NotReadableError" } })).toBe(
			false,
		);
		expect(gate.noteFailure({ error: new Error("boom") })).toBe(false);
		expect(gate.noteFailure({ code: "audio-capture" })).toBe(false);
		expect(gate.noteFailure({ code: "network" })).toBe(false);
		expect(await gate.check()).toBe("unknown");
	});

	it("remembers a refusal reported by SpeechRecognition, not just getUserMedia", async () => {
		// Web Speech is Drive's default STT backend and asks for the same
		// microphone permission, so its refusal code has to stick too — the
		// event carries a string code, never a DOMException.
		const gate = createMicPermissionGate(() =>
			Promise.resolve(fakeStatus("prompt")),
		);

		expect(await gate.check()).toBe("unknown");
		expect(gate.noteFailure(RECOGNITION_DENIAL)).toBe(true);
		expect(await gate.check()).toBe("denied");
		expect(gate.noteFailure({ code: "service-not-allowed" })).toBe(true);
	});

	it("blocks before the first request when the browser already says denied", async () => {
		const gate = createMicPermissionGate(() =>
			Promise.resolve(fakeStatus("denied")),
		);

		expect(await gate.check()).toBe("denied");
	});

	it("keeps a remembered denial when the browser still reports prompt", async () => {
		// The reported bug's surface: the pane blocks capture by policy while
		// PermissionStatus never leaves "prompt". Re-reading it must not forget.
		const status = fakeStatus("prompt");
		const gate = createMicPermissionGate(() => Promise.resolve(status));

		expect(await gate.check()).toBe("unknown");
		gate.noteFailure(DENIAL);
		expect(await gate.check()).toBe("denied");
		expect(await gate.check()).toBe("denied");
	});

	it("does not let an in-flight query forget a denial recorded while it ran", async () => {
		let settle: (status: MicPermissionStatusLike) => void = () => {};
		const gate = createMicPermissionGate(
			() =>
				new Promise<MicPermissionStatusLike>((resolve) => {
					settle = resolve;
				}),
		);

		const pending = gate.check();
		gate.noteFailure(DENIAL);
		settle(fakeStatus("prompt"));

		expect(await pending).toBe("denied");
		expect(gate.state()).toBe("denied");
	});

	it("clears the denial when PermissionStatus flips to granted", async () => {
		const status = fakeStatus("prompt");
		const gate = createMicPermissionGate(() => Promise.resolve(status));
		const seen: string[] = [];
		gate.subscribe((next) => seen.push(next));

		await gate.check();
		gate.noteFailure(DENIAL);
		expect(gate.state()).toBe("denied");

		status.fire("granted");

		expect(gate.state()).toBe("granted");
		expect(await gate.check()).toBe("granted");
		expect(seen).toEqual(["denied", "granted"]);
	});

	it("clears the denial on an explicit retry even with no query support", async () => {
		const gate = createMicPermissionGate(() =>
			Promise.reject(new Error("unsupported")),
		);

		await gate.check();
		gate.noteFailure(DENIAL);
		expect(await gate.check()).toBe("denied");

		gate.retry();

		// Exactly one more attempt: the browser cannot be asked, so the caller
		// gets to try, and a second refusal re-arms the gate.
		expect(await gate.check()).toBe("unknown");
		gate.noteFailure(DENIAL);
		expect(await gate.check()).toBe("denied");
	});

	it("re-arms after a retry when the browser authoritatively says denied", async () => {
		const status = fakeStatus("denied");
		const gate = createMicPermissionGate(() => Promise.resolve(status));

		expect(await gate.check()).toBe("denied");
		gate.retry();
		// No getUserMedia is spent re-confirming what the browser already answered.
		expect(await gate.check()).toBe("denied");

		status.fire("granted");
		expect(await gate.check()).toBe("granted");
	});

	it("clears the denial when the permission is reset back to prompt", async () => {
		// Chrome's "Reset permission" moves denied -> prompt. That move is the
		// user re-opening the question, so the refusal is stale; a *standing*
		// "prompt" (a pane that blocks capture by policy) is not, and the test
		// above proves that one still holds.
		const status = fakeStatus("denied");
		const gate = createMicPermissionGate(() => Promise.resolve(status));

		expect(await gate.check()).toBe("denied");
		status.fire("prompt");

		expect(gate.state()).toBe("unknown");
		expect(await gate.check()).toBe("unknown");
	});

	it("notices a permission that moved even when onchange never fires", async () => {
		// Not every surface delivers `onchange`. A reading that no longer matches
		// what we acted on is news on its own, so the grant still lands.
		const status = fakeStatus("prompt");
		const gate = createMicPermissionGate(() => Promise.resolve(status));

		await gate.check();
		gate.noteFailure(DENIAL);
		expect(gate.state()).toBe("denied");

		status.state = "granted";

		expect(await gate.check()).toBe("granted");
	});

	it("keeps a refusal that a standing grant contradicts, and lets retry clear it", async () => {
		// The mic can be blocked above the page permission — an OS privacy
		// setting, an embedder — so "granted" plus a real refusal means the ask
		// will fail again. Re-adopting that grant on every check would restore
		// the request loop, so the explicit retry is the way out.
		const status = fakeStatus("granted");
		const gate = createMicPermissionGate(() => Promise.resolve(status));

		expect(await gate.check()).toBe("granted");
		gate.noteFailure(DENIAL);
		expect(await gate.check()).toBe("denied");
		expect(await gate.check()).toBe("denied");

		gate.retry();

		expect(await gate.check()).toBe("granted");
	});

	it("does not hang the caller on a query that never settles", async () => {
		// A probe is a convenience, never a gate on the mic button: an unsettled
		// one falls back to attempt-based behaviour instead of stalling forever.
		const gate = createMicPermissionGate(() => new Promise<never>(() => {}), {
			queryTimeoutMs: 5,
		});

		expect(await gate.check()).toBe("unknown");
		expect(await gate.check()).toBe("unknown");
	});

	it("still adopts a query result that lands after the timeout", async () => {
		let settle: (status: MicPermissionStatusLike) => void = () => {};
		const gate = createMicPermissionGate(
			() =>
				new Promise<MicPermissionStatusLike>((resolve) => {
					settle = resolve;
				}),
			{ queryTimeoutMs: 5 },
		);

		expect(await gate.check()).toBe("unknown");
		settle(fakeStatus("denied"));
		await Promise.resolve();

		expect(await gate.check()).toBe("denied");
	});

	it("clears the denial when a later request succeeds", async () => {
		const gate = createMicPermissionGate(() =>
			Promise.reject(new Error("unsupported")),
		);

		gate.noteFailure(DENIAL);
		gate.noteGranted();
		expect(await gate.check()).toBe("granted");
	});

	it("stops notifying an unsubscribed listener", async () => {
		const gate = createMicPermissionGate(() =>
			Promise.reject(new Error("unsupported")),
		);
		const listener = vi.fn();

		gate.subscribe(listener)();
		gate.noteFailure(DENIAL);

		expect(listener).not.toHaveBeenCalled();
	});

	it("only notifies on a real transition", async () => {
		const gate = createMicPermissionGate(() =>
			Promise.reject(new Error("unsupported")),
		);
		const listener = vi.fn();
		gate.subscribe(listener);

		gate.noteFailure(DENIAL);
		gate.noteFailure(DENIAL);

		expect(listener).toHaveBeenCalledTimes(1);
	});
});

describe("shared gate singleton", () => {
	it("remembers a denial for every call site in the webview", async () => {
		// No `navigator.permissions` in the node env, so this exercises the
		// attempt-based path the three getUserMedia call sites share.
		expect(await ensureMicPermission()).toBe("unknown");
		expect(noteMicPermissionFailure(DENIAL)).toBe(true);
		expect(micPermissionState()).toBe("denied");
		expect(await ensureMicPermission()).toBe("denied");
	});
});
