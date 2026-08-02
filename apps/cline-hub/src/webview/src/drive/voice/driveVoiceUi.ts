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
	normalizeDriveHardwarePrefs,
	type DriveHardwarePrefs,
} from "./driveHardwarePrefs";
import { speechInputModeForBackend } from "./speechInputModeForBackend";
import type { SpeechInputMode } from "./speechInputModeForBackend";

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
			providerId: input.providerId || "ollama",
			baseUrlClass: "loopback",
		};
	}
	return {
		kind: "cloud",
		providerId: input.providerId || "anthropic",
	};
}

export function resolveDriveVoiceTopology(input: {
	voice: DriveVoiceUi;
	providerId: string;
}):
	| { ok: true; topology: RuntimeTopology; forceMode: SpeechInputMode }
	| { ok: false; message: string } {
	const llm = resolveLlmEgressForUi({
		profile: input.voice.profile,
		providerId: input.providerId,
	});
	const resolved = resolveTopologyFromFacets({
		facets: input.voice.facets,
		llm,
	});
	if (!resolved.ok) {
		return resolved;
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
