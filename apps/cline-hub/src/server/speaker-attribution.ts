import { resolveAddress } from "@cline/drive";
import type { RoomSnapshot } from "@cline/shared";
import type { HubContext } from "./state";

export type SpeakerAttributionSnapshot = Pick<
	RoomSnapshot,
	"addressSet" | "participants"
>;

/** The slice of {@link HubContext} the turn-speaker lifecycle touches. */
export type TurnSpeakerStore = Pick<HubContext, "turnSpeakerBySessionId">;

/**
 * The single agent this turn was **addressed to**, when there is exactly one.
 *
 * Read the name literally: this is who the human addressed, not verified
 * authorship. Nothing routes the addressed agent's persona into the runtime
 * yet — `resolveAddress` has no reader on the send path (see
 * `server/sessions.ts`) — so the reply still comes from the one generic Cline
 * runtime. "Addressed" is the strongest claim the room data supports, and the
 * byline is scoped to exactly that.
 *
 * Only an address resolving to exactly one seated agent yields an id. Seating
 * creates no runtime — `call_seat` commits room metadata only — so once two or
 * more agents are addressed nothing distinguishes them and the result is
 * undefined, leaving the byline absent rather than guessing.
 */
export function resolveAddressedSpeakerId(
	snapshot: SpeakerAttributionSnapshot | undefined | null,
): string | undefined {
	if (!snapshot?.addressSet || !Array.isArray(snapshot.participants)) {
		return undefined;
	}
	let resolved: ReturnType<typeof resolveAddress>;
	try {
		resolved = resolveAddress({
			addressSet: snapshot.addressSet,
			participants: snapshot.participants,
		});
	} catch {
		// Snapshots arrive as an unchecked cast off the wire; a participant
		// missing `seatSources` throws inside pack resolution. Unparseable
		// roster means unknown speaker, not a crashed send.
		return undefined;
	}
	if (!resolved.ok) {
		return undefined;
	}
	// Dedupe first: `resolveAddress` preserves repeats, and `agentIds: [x, x]`
	// naming one agent twice must not read as an ambiguous two.
	const unique = [...new Set(resolved.participantIds)];
	return unique.length === 1 ? unique[0] : undefined;
}

/**
 * Look up the addressed speaker for a session's linked Drive room.
 *
 * Mirrors the `call_get_room` round trip the voice mute gate already uses —
 * the hub keeps no roster of its own, participants only ever pass through it.
 * Any failure (no room, no UI client, malformed reply) resolves to undefined
 * so an unattributed turn stays unattributed.
 */
export async function readAddressedSpeakerId(
	ctx: HubContext,
	sessionId: string | undefined,
): Promise<string | undefined> {
	if (!sessionId || !ctx.uiClient) {
		return undefined;
	}
	try {
		const reply = await ctx.uiClient.command("call_get_room", { sessionId });
		if (!reply.ok) {
			return undefined;
		}
		const snapshot = reply.payload?.snapshot as
			| SpeakerAttributionSnapshot
			| undefined;
		if (!snapshot || typeof snapshot !== "object") {
			return undefined;
		}
		return resolveAddressedSpeakerId(snapshot);
	} catch {
		return undefined;
	}
}

/**
 * Record (or clear) who the assistant turn about to start belongs to.
 * Clearing on an unresolved address is deliberate: a stale id from the
 * previous turn would attribute this reply to the wrong agent.
 */
export function setTurnSpeaker(
	ctx: TurnSpeakerStore,
	sessionId: string,
	speakerId: string | undefined,
): void {
	if (speakerId) {
		ctx.turnSpeakerBySessionId.set(sessionId, speakerId);
		return;
	}
	ctx.turnSpeakerBySessionId.delete(sessionId);
}

/**
 * Drop the attribution when the turn ends.
 *
 * Attribution is only valid for the turn it was resolved for. A turn that
 * starts by some other route — a queued prompt, a resumed session — would
 * otherwise inherit the previous turn's agent and be labelled with a name
 * nothing verified. Also keeps the map bounded to in-flight turns.
 */
export function clearTurnSpeaker(
	ctx: TurnSpeakerStore,
	sessionId: string,
): void {
	ctx.turnSpeakerBySessionId.delete(sessionId);
}
