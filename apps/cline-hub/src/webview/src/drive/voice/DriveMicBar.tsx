import type { SttBackend } from "@cline/shared";
import { useEffect, useState } from "react";
import { SpeechInput } from "@/components/ai-elements/speech-input";
import {
	describeSpeechInputUnavailable,
	readSpeechInputCapabilities,
	resolveSpeechInputMode,
} from "@/components/ai-elements/speechInputSupport";
import type { SpeechInputMode } from "./speechInputModeForBackend";
import { LocalSttError, transcribeAudioBlob } from "./transcribeAudioBlob";

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

	// Unmounting the SpeechInput is what revokes capture: its teardown stops the
	// recogniser / recorder and drops any partial utterance.
	if (muted) {
		return (
			<div className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
				Mic muted. Unmute on the call strip to speak to the partner.
			</div>
		);
	}

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
			<SpeechInput
				deviceId={micDeviceId}
				disabled={disabled}
				forceMode={resolvedMode}
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
				{caption.trim() ? (
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
						{unavailable ??
							(resolvedMode === "media-recorder"
								? "Speak a task. Local STT posts the utterance to a loopback whisper server."
								: "Speak a task. The browser transcribes it; nothing is recorded to disk.")}
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
			</div>
		</div>
	);
}
