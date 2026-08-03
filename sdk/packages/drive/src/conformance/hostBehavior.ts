/**
 * Host behavioural conformance — invokes DriveHostPort methods and asserts
 * on their effects (read back, emission). Complements `runHostConformance`
 * (static HostCapabilities matrix) and `assertFakeHostFailClosed` (proves a
 * stub throws): a host can declare a legal capability matrix and still be a
 * silent no-op, which only invocation catches. Table-driven so the exact
 * same case list runs against every real DriveHostPort implementation
 * (`memoryDriveHost`, `createClineDriveHost`, future browser hosts).
 */

import type { DriveEvent } from "@cline/shared";
import type { DriveHostPort } from "../hostPort.js";
import type { ConformanceIssue, ConformanceReport } from "./fakeHost.js";

export type HostBehaviorCase = {
	readonly name: string;
	run(host: DriveHostPort): Promise<void>;
};

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

function requireGetRoom(
	host: DriveHostPort,
): NonNullable<DriveHostPort["getRoom"]> {
	if (!host.getRoom) {
		throw new Error(
			"host.getRoom is required for behavioural conformance (read-back)",
		);
	}
	return host.getRoom;
}

function uniqueRoomId(tag: string): string {
	return `conformance_${tag}_${crypto.randomUUID()}`;
}

export const HOST_BEHAVIOR_CASES: readonly HostBehaviorCase[] = [
	{
		name: "create_join_read_back",
		async run(host) {
			const getRoom = requireGetRoom(host);
			const roomId = uniqueRoomId("create_join");
			await host.commitRoomOp({
				type: "create",
				roomId,
				hostParticipantId: "human-1",
			});
			await host.commitRoomOp({
				type: "join",
				roomId,
				participant: {
					id: "human-1",
					kind: "human",
					displayName: "Conformance Human",
					role: "host",
					status: "idle",
				},
			});

			const snapshot = await getRoom(roomId);
			assert(snapshot !== null, "getRoom returned null after create+join");
			assert(
				snapshot.participants.some((p) => p.id === "human-1"),
				"joined participant is not present in the read-back snapshot",
			);
			// A joining human defaults to muted. This is a wire-level privacy
			// default, not a client preference, so every host owes it — a host
			// that skips it disagrees with the real hub about whether the user's
			// microphone is live, which is the worst kind of divergence to have
			// go unnoticed.
			assert(
				snapshot.muteByParticipantId["human-1"] === true,
				"a joining human must default to muted",
			);
		},
	},
	{
		name: "leave_removes_participant",
		async run(host) {
			const getRoom = requireGetRoom(host);
			const roomId = uniqueRoomId("leave");
			await host.commitRoomOp({
				type: "create",
				roomId,
				hostParticipantId: "human-1",
			});
			await host.commitRoomOp({
				type: "join",
				roomId,
				participant: {
					id: "human-1",
					kind: "human",
					displayName: "Human One",
					role: "host",
					status: "idle",
				},
			});
			await host.commitRoomOp({
				type: "join",
				roomId,
				participant: {
					id: "human-2",
					kind: "human",
					displayName: "Human Two",
					role: "participant",
					status: "idle",
				},
			});

			await host.commitRoomOp({
				type: "leave",
				roomId,
				participantId: "human-1",
			});

			const snapshot = await getRoom(roomId);
			assert(snapshot !== null, "getRoom returned null after leave");
			assert(
				!snapshot.participants.some((p) => p.id === "human-1"),
				"left participant is still present in the read-back snapshot",
			);
			assert(
				snapshot.participants.some((p) => p.id === "human-2"),
				"leave removed an unrelated participant",
			);
		},
	},
	{
		name: "set_stage_reflects_sharer",
		async run(host) {
			const getRoom = requireGetRoom(host);
			const roomId = uniqueRoomId("stage");
			await host.commitRoomOp({
				type: "create",
				roomId,
				hostParticipantId: "human-1",
			});
			await host.commitRoomOp({
				type: "join",
				roomId,
				participant: {
					id: "agent-1",
					kind: "agent",
					displayName: "Agent One",
					role: "partner",
					status: "idle",
					seatSources: [{ kind: "manual" }],
				},
			});

			await host.commitRoomOp({
				type: "setStage",
				roomId,
				sharer: { kind: "agent", participantId: "agent-1" },
				pin: { kind: "selection", label: "conformance" },
			});

			const snapshot = await getRoom(roomId);
			assert(snapshot !== null, "getRoom returned null after setStage");
			assert(
				snapshot.stage.sharer?.kind === "agent" &&
					snapshot.stage.sharer.participantId === "agent-1",
				"setStage sharer did not reflect in the read-back snapshot",
			);
			assert(
				snapshot.stage.pin?.label === "conformance",
				"setStage pin did not reflect in the read-back snapshot",
			);
		},
	},
	{
		name: "set_mode_reflects_submode",
		async run(host) {
			const getRoom = requireGetRoom(host);
			const roomId = uniqueRoomId("mode");
			await host.commitRoomOp({
				type: "create",
				roomId,
				hostParticipantId: "human-1",
			});

			await host.commitRoomOp({
				type: "setMode",
				roomId,
				subMode: "debug",
				driveActive: true,
			});

			const snapshot = await getRoom(roomId);
			assert(snapshot !== null, "getRoom returned null after setMode");
			assert(
				snapshot.subMode === "debug",
				`setMode subMode did not reflect in the read-back snapshot (got ${snapshot.subMode})`,
			);
			assert(
				snapshot.driveActive === true,
				"setMode driveActive did not reflect in the read-back snapshot",
			);
		},
	},
	{
		name: "mute_reflects_and_emits",
		async run(host) {
			const getRoom = requireGetRoom(host);
			const roomId = uniqueRoomId("mute");
			await host.commitRoomOp({
				type: "create",
				roomId,
				hostParticipantId: "human-1",
			});
			await host.commitRoomOp({
				type: "join",
				roomId,
				participant: {
					id: "human-1",
					kind: "human",
					displayName: "Human One",
					role: "host",
					status: "idle",
				},
			});

			const events: DriveEvent[] = [];
			const unsubscribe = host.subscribe((event) => events.push(event));
			try {
				const muted = await host.commitRoomOp({
					type: "mute",
					roomId,
					participantId: "human-1",
					muted: true,
				});
				assert(
					muted.muteByParticipantId["human-1"] === true,
					"mute(true) did not set muteByParticipantId on the op's own return value (silent no-op)",
				);

				const unmuted = await host.commitRoomOp({
					type: "mute",
					roomId,
					participantId: "human-1",
					muted: false,
				});
				assert(
					unmuted.muteByParticipantId["human-1"] === false,
					"mute(false) did not clear muteByParticipantId on the op's own return value (silent no-op)",
				);
			} finally {
				unsubscribe();
			}

			const snapshot = await getRoom(roomId);
			assert(snapshot !== null, "getRoom returned null after mute");
			assert(
				snapshot.muteByParticipantId["human-1"] === false,
				"mute state did not persist to the read-back snapshot",
			);
			assert(
				events.some((e) => e.type === "control.mute" && e.roomId === roomId),
				"mute did not emit a control.mute event to subscribers",
			);
		},
	},
	{
		name: "raise_hand_reflects_and_emits",
		async run(host) {
			const getRoom = requireGetRoom(host);
			const roomId = uniqueRoomId("raise_hand");
			await host.commitRoomOp({
				type: "create",
				roomId,
				hostParticipantId: "human-1",
			});
			await host.commitRoomOp({
				type: "join",
				roomId,
				participant: {
					id: "human-1",
					kind: "human",
					displayName: "Human One",
					role: "host",
					status: "idle",
				},
			});

			const events: DriveEvent[] = [];
			const unsubscribe = host.subscribe((event) => events.push(event));
			try {
				const raised = await host.commitRoomOp({
					type: "raiseHand",
					roomId,
					participantId: "human-1",
					raised: true,
				});
				assert(
					raised.raisedHandByParticipantId["human-1"] === true,
					"raiseHand(true) did not set raisedHandByParticipantId on the op's own return value (silent no-op)",
				);

				const lowered = await host.commitRoomOp({
					type: "raiseHand",
					roomId,
					participantId: "human-1",
					raised: false,
				});
				assert(
					lowered.raisedHandByParticipantId["human-1"] === false,
					"raiseHand(false) did not clear raisedHandByParticipantId on the op's own return value (silent no-op)",
				);
			} finally {
				unsubscribe();
			}

			const snapshot = await getRoom(roomId);
			assert(snapshot !== null, "getRoom returned null after raiseHand");
			assert(
				snapshot.raisedHandByParticipantId["human-1"] === false,
				"raiseHand state did not persist to the read-back snapshot",
			);
			assert(
				events.some(
					(e) => e.type === "control.raise_hand" && e.roomId === roomId,
				),
				"raiseHand did not emit a control.raise_hand event to subscribers",
			);
		},
	},
	{
		name: "subscribe_receives_commit_events",
		async run(host) {
			const roomId = uniqueRoomId("emit");
			const events: DriveEvent[] = [];
			const unsubscribe = host.subscribe((event) => events.push(event));

			await host.commitRoomOp({
				type: "create",
				roomId,
				hostParticipantId: "human-1",
			});
			await host.commitRoomOp({
				type: "join",
				roomId,
				participant: {
					id: "human-1",
					kind: "human",
					displayName: "Human One",
					role: "host",
					status: "idle",
				},
			});

			assert(
				events.some((e) => e.type === "control.join" && e.roomId === roomId),
				"commitRoomOp(join) never called subscribe's handler (commits are invisible to subscribers)",
			);

			unsubscribe();
			const countAfterUnsubscribe = events.length;
			await host.commitRoomOp({
				type: "leave",
				roomId,
				participantId: "human-1",
			});
			assert(
				events.length === countAfterUnsubscribe,
				"unsubscribe did not stop further events from arriving",
			);
		},
	},
];

/**
 * Runs the full behavioural case table against `host`, invoking real
 * DriveHostPort methods and asserting on their effects. Unlike
 * `runHostConformance` (which only audits the static HostCapabilities
 * matrix), a host that returns stubbed/`null` data from every method fails
 * this suite.
 */
export async function runHostBehaviorConformance(
	host: DriveHostPort,
): Promise<ConformanceReport> {
	const issues: ConformanceIssue[] = [];

	for (const behaviorCase of HOST_BEHAVIOR_CASES) {
		try {
			await behaviorCase.run(host);
		} catch (error) {
			issues.push({
				code: `behavior_failed:${behaviorCase.name}`,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { ok: issues.length === 0, issues };
}
