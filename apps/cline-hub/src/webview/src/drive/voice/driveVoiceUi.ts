import {
	cloudDefaultsWithAnthropic,
	defaultFacetValuesFromProfile,
	localDefaultsWithOllama,
	resolveTopologyFromFacets,
} from "@cline/drive";
import type {
	DeploymentProfile,
	DriveFacetValues,
	ResolvedLlmEgress,
	RuntimeTopology,
} from "@cline/shared";
import {
	DEFAULT_DRIVE_HARDWARE_PREFS,
	type DriveHardwarePrefs,
	normalizeDriveHardwarePrefs,
} from "./driveHardwarePrefs";
import type { SpeechInputMode } from "./speechInputModeForBackend";
import { speechInputModeForBackend } from "./speechInputModeForBackend";

export type DriveVoiceUi = {
	profile: DeploymentProfile;
	facets: DriveFacetValues;
	settingsOpen: boolean;
	/** Local mic / volume prefs; not facet-backed. */
	hardware: DriveHardwarePrefs;
};

export function createDefaultDriveVoiceUi(
	profile: DeploymentProfile = "cloud",
): DriveVoiceUi {
	return {
		profile,
		facets: defaultFacetValuesFromProfile(profile),
		settingsOpen: false,
		hardware: { ...DEFAULT_DRIVE_HARDWARE_PREFS },
	};
}

export function applyVoiceProfile(
	voice: DriveVoiceUi,
	profile: DeploymentProfile,
): DriveVoiceUi {
	return {
		...voice,
		profile,
		facets: defaultFacetValuesFromProfile(profile),
		// Keep machine-local hardware prefs across profile switches.
		hardware: normalizeDriveHardwarePrefs(voice.hardware),
	};
}

export function applyVoiceFacetPatch(
	voice: DriveVoiceUi,
	patch: Partial<DriveFacetValues>,
): DriveVoiceUi {
	return {
		...voice,
		facets: { ...voice.facets, ...patch },
		profile: patch["runtime.profile"] ?? voice.profile,
	};
}

export function applyHardwarePrefsPatch(
	voice: DriveVoiceUi,
	patch: Partial<DriveHardwarePrefs>,
): DriveVoiceUi {
	return {
		...voice,
		hardware: normalizeDriveHardwarePrefs({
			...voice.hardware,
			...patch,
		}),
	};
}

export function resolveLlmEgressForUi(input: {
	profile: DeploymentProfile;
	providerId: string;
}): ResolvedLlmEgress {
	if (input.profile === "local") {
		return {
			kind: "local",
			providerId: input.providerId,
			baseUrlClass: "loopback",
		};
	}
	return {
		kind: "cloud",
		providerId: input.providerId,
	};
}

/**
 * Why a call can't proceed: `unconfigured` means no LLM credential has been
 * set up anywhere (nothing to route to Settings for except "add one"), while
 * `illegal` means a credential exists but the resolved topology violates
 * ADR-0009/ADR-0010 (e.g. a cloud STT provider under the Local profile).
 * Callers must not collapse these into one "invalid" message — telling a
 * tester their topology is invalid when they simply have no API key yet is
 * wrong (ADR-0021 decision 4).
 */
export type DriveVoiceUnready =
	| { ok: false; reason: "unconfigured"; message: string }
	| { ok: false; reason: "illegal"; message: string };

export function resolveDriveVoiceTopology(input: {
	voice: DriveVoiceUi;
	providerId: string;
}):
	| { ok: true; topology: RuntimeTopology; forceMode: SpeechInputMode }
	| DriveVoiceUnready {
	// No credential configured anywhere (ADR-0021): fail closed instead of
	// substituting a default provider id and reporting fake readiness.
	if (!input.providerId) {
		return {
			ok: false,
			reason: "unconfigured",
			message:
				"No LLM provider is configured yet. Add one in Settings to start a Drive call.",
		};
	}
	const llm = resolveLlmEgressForUi({
		profile: input.voice.profile,
		providerId: input.providerId,
	});
	const resolved = resolveTopologyFromFacets({
		facets: input.voice.facets,
		llm,
	});
	if (!resolved.ok) {
		return { ok: false, reason: "illegal", message: resolved.message };
	}
	return {
		ok: true,
		topology: resolved.topology,
		forceMode: speechInputModeForBackend(resolved.topology.stt),
	};
}

/**
 * Gate for narration TTS (DRV-TTS): off by default via tts.enabled.
 *
 * Input and output are separate. `deafened` is the human's own output mute —
 * the only human toggle that silences playback. Mic mute (`DriveUiState.muted`)
 * is deliberately absent: muting yourself must not stop the partner narrating.
 * `partnerMuted` stays in the gate because a muted partner has nothing to say.
 */
export function shouldSpeakDriveTts(input: {
	facets: DriveFacetValues;
	deafened: boolean;
	partnerMuted: boolean;
}): boolean {
	return (
		input.facets["tts.enabled"] === true &&
		!input.deafened &&
		!input.partnerMuted
	);
}

/**
 * Join greeting / while-away catch-up. These arrive as `driveJoinNote` and are
 * spoken by the join effect, so the narration queue must not speak them twice.
 */
export function isSpokenDriveJoinNote(note: string): boolean {
	return note.startsWith("On the call.") || note.startsWith("Since you left:");
}

export function voiceDefaultsForSmoke(profile: "local" | "cloud"): {
	voice: DriveVoiceUi;
	llm: ResolvedLlmEgress;
} {
	if (profile === "local") {
		const { facets, llm } = localDefaultsWithOllama();
		return {
			voice: {
				profile: "local",
				facets,
				settingsOpen: false,
				hardware: { ...DEFAULT_DRIVE_HARDWARE_PREFS },
			},
			llm,
		};
	}
	const { facets, llm } = cloudDefaultsWithAnthropic();
	return {
		voice: {
			profile: "cloud",
			facets,
			settingsOpen: false,
			hardware: { ...DEFAULT_DRIVE_HARDWARE_PREFS },
		},
		llm,
	};
}
