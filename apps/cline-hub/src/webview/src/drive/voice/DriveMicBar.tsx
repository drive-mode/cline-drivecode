import type { SttBackend } from "@cline/shared";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
	micPermissionState,
	retryMicPermission,
	subscribeMicPermission,
} from "@/components/ai-elements/micPermissionGate";
import { SpeechInput } from "@/components/ai-elements/speech-input";
import {
	describeSpeechInputUnavailable,
	readSpeechInputCapabilities,
	resolveSpeechInputMode,
} from "@/components/ai-elements/speechInputSupport";
import type { SpeechInputMode } from "./speechInputModeForBackend";
import { LocalSttError, transcribeAudioBlob } from "./transcribeAudioBlob";

/** Why the STT mic is inert while the room mic is muted. */
const MUTED_MIC_HINT =
	"Mic muted. Unmute on the call strip to speak to the partner.";
/** The mic is icon-only, so it needs a name in the state it still works in. */
const LIVE_MIC_LABEL = "Voice input (speak a task)";

export function DriveMicBar({
	disabled,
	forceMode,
	caption,
	micDeviceId,
	muted,
	sttBackend,
	sttConfig,
	onCaptionChange,
	onTranscription,
	onSttError,
}: {
	disabled?: boolean;
	forceMode: SpeechInputMode;
	caption: string;
	micDeviceId?: string;
	muted: boolean;
	sttBackend: SttBackend;
	sttConfig?: Record<string, unknown>;
	onCaptionChange: (text: string) => void;
	onTranscription: (text: string) => void;
	onSttError?: (message: string) => void;
}) {
	/**
	 * Capture failures surface here, beside the button the user just pressed.
	 * The chat status line they would otherwise land in is rendered hidden, so
	 * a denied mic would read as a dead button.
	 */
	const [captureError, setCaptureError] = useState<string | null>(null);
	const reportCaptureError = (message: string) => {
		setCaptureError(message);
		onSttError?.(message);
	};

	// A revoked mic is not worth explaining once the mic is off anyway.
	useEffect(() => {
		if (muted) {
			setCaptureError(null);
		}
	}, [muted]);

	/**
	 * The retry affordance for a remembered denial. Subscribed, so a permission
	 * granted in browser settings clears the offer on its own — the button is
	 * the escape hatch for browsers whose permission state cannot be read.
	 */
	const micDenied =
		useSyncExternalStore(
			subscribeMicPermission,
			micPermissionState,
			micPermissionState,
		) === "denied";

	const capabilities = readSpeechInputCapabilities();
	const resolvedMode = resolveSpeechInputMode({
		requested: forceMode,
		capabilities,
	});
	const unavailable = describeSpeechInputUnavailable({
		requested: forceMode,
		capabilities,
	});

	return (
		<div className="flex items-start gap-3 border-t bg-background px-3 py-2">
			{/*
			 * Muting keeps the mic on screen but inert — a control that vanishes
			 * teaches users it does not exist. `muted` rides the key so the flip
			 * still unmounts the live SpeechInput: its teardown is what revokes
			 * capture and drops any partial utterance, which `disabled` alone
			 * would not do to a recording already in flight.
			 */}
			<SpeechInput
				aria-label={muted ? MUTED_MIC_HINT : LIVE_MIC_LABEL}
				deviceId={micDeviceId}
				disabled={disabled || muted}
				forceMode={resolvedMode}
				key={muted ? "muted" : "live"}
				title={muted ? MUTED_MIC_HINT : LIVE_MIC_LABEL}
				onCaptureError={reportCaptureError}
				onAudioRecorded={async (blob) => {
					try {
						const text = await transcribeAudioBlob({
							blob,
							backend: sttBackend,
							config: sttConfig,
						});
						if (text) {
							setCaptureError(null);
							onCaptionChange(text);
							onTranscription(text);
						}
						return text;
					} catch (error) {
						const message =
							error instanceof LocalSttError
								? error.message
								: `STT failed: ${String(error)}`;
						reportCaptureError(message);
						return "";
					}
				}}
				onTranscriptionChange={(text) => {
					setCaptureError(null);
					onCaptionChange(text);
					onTranscription(text);
				}}
			/>
			<div className="min-w-0 flex-1">
				{/* No draft editor while muted: the Send row is muted-gated too, so
				    an editable draft here would be one nothing can send. */}
				{!muted && caption.trim() ? (
					<textarea
						aria-label="Edit spoken caption before send"
						className="min-h-[2.5rem] w-full resize-y rounded-md border bg-background px-2 py-1.5 text-xs text-foreground"
						disabled={disabled}
						onChange={(event) => onCaptionChange(event.target.value)}
						placeholder="Edit what you said before sending…"
						rows={2}
						value={caption}
					/>
				) : (
					<p className="text-xs text-muted-foreground">
						{muted
							? MUTED_MIC_HINT
							: (unavailable ??
								(resolvedMode === "media-recorder"
									? "Speak a task. Local STT posts the utterance to a loopback whisper server."
									: "Speak a task. The browser transcribes it; nothing is recorded to disk."))}
					</p>
				)}
				{captureError ? (
					<p
						aria-live="polite"
						className="mt-1 text-xs text-destructive"
						role="status"
					>
						{captureError}
					</p>
				) : null}
				{/*
				 * Shown while muted too. Mute is the join default, and the Drive
				 * settings device pickers can record the denial before the user
				 * ever unmutes — gating this on `!muted` hid the only escape hatch
				 * in exactly the state most users are in.
				 */}
				{micDenied ? (
					<button
						className="mt-1 rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
						onClick={() => {
							retryMicPermission();
							setCaptureError(null);
						}}
						title="Ask for the microphone again after allowing it in your browser"
						type="button"
					>
						Retry mic access
					</button>
				) : null}
			</div>
		</div>
	);
}
