/**
 * Announcing Kanban's runtime endpoint to a supervising desktop host.
 *
 * When the Tauri shell spawns Kanban it needs to learn which origin the
 * runtime bound to, and it cannot know in advance: the port is configurable
 * and falls back to a free one. The shell reads this process's stdout and
 * waits for a single JSON line naming the endpoint.
 *
 * This is deliberately the same line shape the Cline sidecar already emits
 * (`apps/examples/desktop-app/sidecar/index.ts`), because the shell parses
 * both with one `DesktopBackendReadyLine` struct. Keeping the shapes
 * identical is what lets the host supervise two different backends without
 * two different parsers.
 *
 * ## Why it is opt-in
 *
 * Kanban's stdout is a human-facing CLI surface — spinners, URLs, warnings.
 * Emitting machine JSON unconditionally would put a stray line in front of
 * every `kanban` user for the benefit of one caller. The shell sets
 * `KANBAN_HOST_HANDSHAKE=1` when it spawns us, and only then do we speak.
 */

/** Env var the desktop host sets to request the handshake line. */
export const HOST_HANDSHAKE_ENV = "KANBAN_HOST_HANDSHAKE";

/**
 * Line type the host matches on. Anything else on stdout is treated as log
 * output and forwarded to the host's stderr.
 */
export const HOST_HANDSHAKE_LINE_TYPE = "ready" as const;

export interface HostHandshakeLine {
	type: typeof HOST_HANDSHAKE_LINE_TYPE;
	/** Absolute origin the runtime is serving, e.g. `http://127.0.0.1:5173`. */
	endpoint: string;
}

export interface EmitHostHandshakeOptions {
	endpoint: string;
	/** Defaults to `process.env`; injected in tests. */
	env?: Record<string, string | undefined>;
	/** Defaults to writing a line to stdout; injected in tests. */
	write?: (line: string) => void;
}

export function shouldEmitHostHandshake(
	env: Record<string, string | undefined>,
): boolean {
	const value = env[HOST_HANDSHAKE_ENV]?.trim();
	// Anything truthy other than an explicit "0"/"false" counts, so a host
	// that sets it to "true" rather than "1" still works.
	if (!value) return false;
	return value !== "0" && value.toLowerCase() !== "false";
}

/**
 * Emit the handshake line, or do nothing when not supervised.
 *
 * Returns whether a line was written, which is what the tests assert on —
 * a silent no-op and a silent failure look identical from the outside
 * otherwise.
 */
export function emitHostHandshake(opts: EmitHostHandshakeOptions): boolean {
	const env = opts.env ?? process.env;
	if (!shouldEmitHostHandshake(env)) return false;

	const endpoint = opts.endpoint.trim();
	if (!endpoint) {
		// A blank endpoint would parse fine on the host side and then leave it
		// pointing at nothing, which surfaces much later as an unexplained
		// blank window. Better to stay silent and let the host time out with
		// a message that says the runtime never announced itself.
		console.warn("[kanban] Refusing to announce an empty runtime endpoint.");
		return false;
	}

	const line: HostHandshakeLine = {
		type: HOST_HANDSHAKE_LINE_TYPE,
		endpoint,
	};
	const write = opts.write ?? ((text: string) => process.stdout.write(`${text}\n`));
	write(JSON.stringify(line));
	return true;
}
