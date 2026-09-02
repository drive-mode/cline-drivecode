/**
 * Thin /rpc client for the demo harness.
 *
 * Every demo action goes through the same HTTP surface an MCP host uses
 * (`POST /rpc { tool, args }`), so nothing here is a private back door into
 * the writer — if it works in the demo it works from Cursor or Claude Code.
 */

const WRITER = process.env.DRIVEMODE_WRITER_URL ?? "http://127.0.0.1:4600";

export async function rpc(tool, args = {}) {
	const res = await fetch(`${WRITER}/rpc`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ tool, args }),
	});
	const body = await res.json();
	if (!res.ok || body.ok === false) {
		throw new Error(`${tool} failed: ${body.error ?? res.status}`);
	}
	return body.result ?? body;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const writerUrl = WRITER;

/** ISO timestamp `mins` minutes from now — title grants need an expiry. */
export const inMinutes = (mins) =>
	new Date(Date.now() + mins * 60_000).toISOString();
