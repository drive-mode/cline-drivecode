import { createHash } from "node:crypto";
import {
	planningFactDefinition,
	type RegisteredPlanningFactKey,
} from "../catalog/facts";
import type {
	PlanningAttestation,
	PlanningSessionSnapshot,
	WorkflowMode,
} from "../schema";
import {
	PlanningSessionSnapshotSchema,
	RequestedLifecycleGateSchema,
} from "../schema";
import { compareCodeUnits } from "./diagnostics";

const MAX_COMMAND_LENGTH = 2_048;
const MAX_BATCH_ASSIGNMENTS = 16;
const MAX_SESSION_ATTESTATIONS = 32;

export interface AttestationReceipt {
	ok: boolean;
	code:
		| "attestation.applied"
		| "attestation.cleared"
		| "attestation.status"
		| "attestation.invalid";
	message: string;
	added: number;
	replaced: number;
	unchanged: number;
	cleared: number;
	snapshot: PlanningSessionSnapshot;
}

export interface PlanningSessionStore {
	snapshot(): PlanningSessionSnapshot;
	applyAttestations(input: string): AttestationReceipt;
	selectWorkflow(
		mode: WorkflowMode,
		requestedGate: PlanningSessionSnapshot["requestedGate"],
	): PlanningSessionSnapshot;
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function createAttestation(
	key: RegisteredPlanningFactKey,
	value: boolean,
): PlanningAttestation {
	const evidenceId = `attest-${digest(`${key}=${String(value)}`)}`;
	return {
		fact: {
			id: `fact-attested-${digest(key)}`,
			key,
			value,
			evidenceRefs: [evidenceId],
		},
		evidence: {
			id: evidenceId,
			sourceType: "user",
			source: "host-attributed slash command",
			claim: `A host-attributed human command asserted ${key}=${String(value)} for this planning session.`,
		},
	};
}

function invalidReceipt(
	message: string,
	snapshot: PlanningSessionSnapshot,
): AttestationReceipt {
	return {
		ok: false,
		code: "attestation.invalid",
		message,
		added: 0,
		replaced: 0,
		unchanged: 0,
		cleared: 0,
		snapshot,
	};
}

export function emptyPlanningSessionSnapshot(): PlanningSessionSnapshot {
	return PlanningSessionSnapshotSchema.parse({
		revision: 0,
		mode: "preplan",
		requestedGate: "preplan",
		attestations: [],
	});
}

export function createPlanningSessionStore(
	initial: PlanningSessionSnapshot = emptyPlanningSessionSnapshot(),
): PlanningSessionStore {
	const parsedInitial = PlanningSessionSnapshotSchema.parse(initial);
	let revision = parsedInitial.revision;
	let mode: WorkflowMode = parsedInitial.mode;
	let requestedGate: PlanningSessionSnapshot["requestedGate"] =
		parsedInitial.requestedGate;
	let attestations = new Map<RegisteredPlanningFactKey, PlanningAttestation>(
		parsedInitial.attestations.map((entry) => [
			entry.fact.key as RegisteredPlanningFactKey,
			entry,
		]),
	);

	const snapshot = (): PlanningSessionSnapshot =>
		PlanningSessionSnapshotSchema.parse({
			revision,
			mode,
			requestedGate,
			attestations: [...attestations.values()].sort((left, right) =>
				compareCodeUnits(left.fact.key, right.fact.key),
			),
		});

	return {
		snapshot,
		selectWorkflow(nextMode, nextGate) {
			const parsedGate = RequestedLifecycleGateSchema.parse(nextGate);
			if (mode !== nextMode || requestedGate !== parsedGate) {
				mode = nextMode;
				requestedGate = parsedGate;
				revision += 1;
			}
			return snapshot();
		},
		applyAttestations(input) {
			const current = snapshot();
			const normalized = input.trim();
			if (normalized.length === 0) {
				return invalidReceipt(
					"Usage: /adr-attest key=true [key=false ...], status, or clear.",
					current,
				);
			}
			if (normalized.length > MAX_COMMAND_LENGTH) {
				return invalidReceipt(
					"Attestation command exceeds the size limit.",
					current,
				);
			}
			if (normalized === "status") {
				return {
					ok: true,
					code: "attestation.status",
					message: `${current.attestations.length} controlled attestation(s) in this session.`,
					added: 0,
					replaced: 0,
					unchanged: 0,
					cleared: 0,
					snapshot: current,
				};
			}
			if (normalized === "clear") {
				const cleared = attestations.size;
				if (cleared > 0) {
					attestations = new Map();
					revision += 1;
				}
				return {
					ok: true,
					code: "attestation.cleared",
					message: `Cleared ${cleared} controlled attestation(s).`,
					added: 0,
					replaced: 0,
					unchanged: 0,
					cleared,
					snapshot: snapshot(),
				};
			}

			const tokens = normalized.split(/\s+/u);
			if (tokens.length > MAX_BATCH_ASSIGNMENTS) {
				return invalidReceipt(
					"Attestation batch exceeds the assignment limit.",
					current,
				);
			}
			const parsed = new Map<RegisteredPlanningFactKey, boolean>();
			for (const token of tokens) {
				const match =
					/^([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)=(true|false)$/u.exec(token);
				if (!match) {
					return invalidReceipt(
						"Every attestation must use controlled key=true or key=false syntax.",
						current,
					);
				}
				const key = match[1] as RegisteredPlanningFactKey;
				const definition = planningFactDefinition(key);
				if (
					!definition ||
					definition.valueKind !== "boolean" ||
					!definition.authority.includes("host_attested")
				) {
					return invalidReceipt(
						"The assignment uses an unknown, unauthorized, or unsupported fact key.",
						current,
					);
				}
				if (parsed.has(key)) {
					return invalidReceipt(
						"An attestation batch cannot assign the same key twice.",
						current,
					);
				}
				parsed.set(key, match[2] === "true");
			}
			const resultingCount = new Set([...attestations.keys(), ...parsed.keys()])
				.size;
			if (resultingCount > MAX_SESSION_ATTESTATIONS) {
				return invalidReceipt(
					"Session attestation count exceeds the configured limit.",
					current,
				);
			}

			let added = 0;
			let replaced = 0;
			let unchanged = 0;
			const next = new Map(attestations);
			for (const [key, value] of parsed) {
				const previous = next.get(key);
				if (!previous) added += 1;
				else if (previous.fact.value === value) unchanged += 1;
				else replaced += 1;
				next.set(key, createAttestation(key, value));
			}
			if (added > 0 || replaced > 0) {
				attestations = next;
				revision += 1;
			}
			return {
				ok: true,
				code: "attestation.applied",
				message: `Applied ${added} new, ${replaced} replacement, and ${unchanged} unchanged attestation(s).`,
				added,
				replaced,
				unchanged,
				cleared: 0,
				snapshot: snapshot(),
			};
		},
	};
}

export function applyPlanningAttestationCommand(
	input: string,
	current: PlanningSessionSnapshot = emptyPlanningSessionSnapshot(),
): AttestationReceipt {
	return createPlanningSessionStore(current).applyAttestations(input);
}

export function selectPlanningWorkflow(
	current: PlanningSessionSnapshot,
	mode: WorkflowMode,
	requestedGate: PlanningSessionSnapshot["requestedGate"],
): PlanningSessionSnapshot {
	return createPlanningSessionStore(current).selectWorkflow(
		mode,
		requestedGate,
	);
}
