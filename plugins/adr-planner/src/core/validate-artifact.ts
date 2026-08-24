import type { ZodError } from "zod";
import {
	type ArtifactEnvelope,
	ArtifactEnvelopeSchema,
	type ArtifactKind,
	type Diagnostic,
	PAYLOAD_SCHEMAS,
} from "../schema";
import { canonicalJson, digestCanonicalJson } from "./canonical-json";
import { diagnostic, hasErrors, sortDiagnostics } from "./diagnostics";
import { validateConcernGraph } from "./validate-graph";
import { validateConcernRouting } from "./validate-routing";

export interface ArtifactValidationResult {
	valid: boolean;
	payloadDigest?: string;
	normalized?: string;
	diagnostics: Diagnostic[];
}

function zodDiagnostics(
	code: string,
	error: ZodError,
	prefix = "",
): Diagnostic[] {
	return error.issues.map((issue) =>
		diagnostic(code, "error", issue.message, {
			path: [prefix, ...issue.path.map(String)].filter(Boolean).join("."),
		}),
	);
}

function validatePayload(
	kind: ArtifactKind,
	payload: unknown,
): { data?: unknown; diagnostics: Diagnostic[] } {
	const result = PAYLOAD_SCHEMAS[kind].safeParse(payload);
	if (!result.success) {
		return {
			diagnostics: zodDiagnostics(
				"artifact.payload_schema",
				result.error,
				"payload",
			),
		};
	}

	const diagnostics: Diagnostic[] = [];
	if (kind === "concern_inventory") {
		const concerns = (
			result.data as { concerns: Parameters<typeof validateConcernGraph>[0] }
		).concerns;
		diagnostics.push(
			...validateConcernGraph(concerns),
			...validateConcernRouting(concerns),
		);
	}
	return { data: result.data, diagnostics };
}

export function validateArtifact(input: unknown): ArtifactValidationResult {
	const envelopeResult = ArtifactEnvelopeSchema.safeParse(input);
	if (!envelopeResult.success) {
		return {
			valid: false,
			diagnostics: sortDiagnostics(
				zodDiagnostics("artifact.envelope_schema", envelopeResult.error),
			),
		};
	}

	const envelope = envelopeResult.data;
	const payloadResult = validatePayload(
		envelope.artifactKind,
		envelope.payload,
	);
	// Producer diagnostics are part of the artifact's machine verdict. An
	// artifact cannot become valid merely because its payload and digest pass.
	const diagnostics = [...envelope.diagnostics, ...payloadResult.diagnostics];
	let payloadDigest: string | undefined;
	try {
		payloadDigest = digestCanonicalJson(envelope.payload);
		if (payloadDigest !== envelope.inputDigest) {
			diagnostics.push(
				diagnostic(
					"artifact.digest_mismatch",
					"error",
					`Payload digest ${payloadDigest} does not match inputDigest ${envelope.inputDigest}`,
					{ path: "inputDigest" },
				),
			);
		}
	} catch (error) {
		diagnostics.push(
			diagnostic(
				"artifact.non_canonical_payload",
				"error",
				error instanceof Error ? error.message : String(error),
				{ path: "payload" },
			),
		);
	}

	let normalized: string | undefined;
	if (payloadResult.data !== undefined && !hasErrors(diagnostics)) {
		const normalizedEnvelope: ArtifactEnvelope = {
			...envelope,
			payload: payloadResult.data,
			diagnostics: sortDiagnostics(envelope.diagnostics),
		};
		normalized = canonicalJson(normalizedEnvelope);
	}

	return {
		valid: !hasErrors(diagnostics),
		...(payloadDigest ? { payloadDigest } : {}),
		...(normalized ? { normalized } : {}),
		diagnostics: sortDiagnostics(diagnostics),
	};
}

export function createArtifactEnvelope(input: {
	artifactKind: ArtifactKind;
	runId: string;
	generatedAt: string;
	producer: ArtifactEnvelope["producer"];
	policyVersion: string;
	payload: unknown;
}): ArtifactEnvelope {
	return {
		schemaVersion: "1",
		artifactKind: input.artifactKind,
		runId: input.runId,
		generatedAt: input.generatedAt,
		producer: input.producer,
		policyVersion: input.policyVersion,
		inputDigest: digestCanonicalJson(input.payload),
		payload: input.payload,
		diagnostics: [],
	};
}
