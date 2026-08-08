"use client";

import { MicIcon, SquareIcon } from "lucide-react";
import type { ComponentProps, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
	ensureMicPermission,
	noteMicPermissionFailure,
	noteMicPermissionGranted,
} from "./micPermissionGate";
import {
	describeSpeechInputError,
	MIC_PERMISSION_DENIED_MESSAGE,
	readSpeechInputCapabilities,
	resolveSpeechInputMode,
	type SpeechInputMode,
} from "./speechInputSupport";

interface SpeechRecognition extends EventTarget {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	start(): void;
	stop(): void;
	onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
	onend: ((this: SpeechRecognition, ev: Event) => void) | null;
	onresult:
		| ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void)
		| null;
	onerror:
		| ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void)
		| null;
}

interface SpeechRecognitionEvent extends Event {
	results: SpeechRecognitionResultList;
	resultIndex: number;
}

interface SpeechRecognitionResultList {
	readonly length: number;
	item(index: number): SpeechRecognitionResult;
	[index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
	readonly length: number;
	item(index: number): SpeechRecognitionAlternative;
	[index: number]: SpeechRecognitionAlternative;
	isFinal: boolean;
}

interface SpeechRecognitionAlternative {
	transcript: string;
	confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
	error: string;
}

declare global {
	interface Window {
		SpeechRecognition: new () => SpeechRecognition;
		webkitSpeechRecognition: new () => SpeechRecognition;
	}
}

export type SpeechInputProps = ComponentProps<typeof Button> & {
	onTranscriptionChange?: (text: string) => void;
	/**
	 * Callback for when audio is recorded using MediaRecorder fallback.
	 * This is called in browsers that don't support the Web Speech API (Firefox, Safari).
	 * The callback receives an audio Blob that should be sent to a transcription service.
	 * Return the transcribed text, which will be passed to onTranscriptionChange.
	 */
	onAudioRecorded?: (audioBlob: Blob) => Promise<string>;
	lang?: string;
	/**
	 * When set (e.g. Drive local-worker STT), skip auto-detect so Web Speech
	 * is never constructed under a loopback-only topology.
	 */
	forceMode?: SpeechInputMode;
	/**
	 * Preferred audioinput deviceId for MediaRecorder capture.
	 * Web Speech recognition still uses the browser default mic.
	 */
	deviceId?: string;
	/**
	 * Honest failure copy for a denied/absent mic. Without a handler the
	 * button simply goes idle, which reads as a dead UI.
	 */
	onCaptureError?: (message: string) => void;
	/**
	 * Press-and-hold capture (consumer call). Pointer/keyboard down starts;
	 * up/cancel stops. Click-toggle is disabled in this mode.
	 */
	holdToTalk?: boolean;
	/** Fires when capture listening state flips (for hold auto-send / mute restore). */
	onListeningChange?: (listening: boolean) => void;
};

export const SpeechInput = ({
	className,
	onTranscriptionChange,
	onAudioRecorded,
	lang = "en-US",
	forceMode,
	deviceId,
	onCaptureError,
	holdToTalk = false,
	onListeningChange,
	disabled,
	children,
	...props
}: SpeechInputProps) => {
	const [isListening, setIsListening] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [mode] = useState<SpeechInputMode>(() =>
		resolveSpeechInputMode({
			requested: forceMode,
			capabilities: readSpeechInputCapabilities(),
		}),
	);
	const [isRecognitionReady, setIsRecognitionReady] = useState(false);
	const recognitionRef = useRef<SpeechRecognition | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	/** Set when teardown stops capture, so a partial utterance is dropped. */
	const abortedRef = useRef(false);
	const deviceIdRef = useRef(deviceId);
	const onTranscriptionChangeRef = useRef<
		SpeechInputProps["onTranscriptionChange"]
	>(onTranscriptionChange);
	const onAudioRecordedRef =
		useRef<SpeechInputProps["onAudioRecorded"]>(onAudioRecorded);
	const onCaptureErrorRef =
		useRef<SpeechInputProps["onCaptureError"]>(onCaptureError);

	// Keep refs in sync
	onTranscriptionChangeRef.current = onTranscriptionChange;
	onAudioRecordedRef.current = onAudioRecorded;
	onCaptureErrorRef.current = onCaptureError;
	deviceIdRef.current = deviceId;

	// Initialize Speech Recognition when mode is speech-recognition
	useEffect(() => {
		if (mode !== "speech-recognition") {
			return;
		}

		const SpeechRecognition =
			window.SpeechRecognition || window.webkitSpeechRecognition;
		// resolveSpeechInputMode already rules this out; the guard keeps a stale
		// `forceMode` from throwing out of an effect and blanking the webview.
		if (!SpeechRecognition) {
			return;
		}
		const speechRecognition = new SpeechRecognition();

		speechRecognition.continuous = true;
		speechRecognition.interimResults = true;
		speechRecognition.lang = lang;

		const handleStart = () => {
			// The service only listens once the browser has handed over the mic,
			// so this is the recognition path's equivalent of a resolved
			// `getUserMedia` — it clears a stale refusal without a reload.
			noteMicPermissionGranted();
			setIsListening(true);
		};

		const handleEnd = () => {
			setIsListening(false);
		};

		const handleResult = (event: Event) => {
			const speechEvent = event as SpeechRecognitionEvent;
			let finalTranscript = "";

			for (
				let i = speechEvent.resultIndex;
				i < speechEvent.results.length;
				i += 1
			) {
				const result = speechEvent.results[i];
				if (result.isFinal) {
					finalTranscript += result[0]?.transcript ?? "";
				}
			}

			if (finalTranscript) {
				onTranscriptionChangeRef.current?.(finalTranscript);
			}
		};

		const handleError = (event: Event) => {
			setIsListening(false);
			const code = (event as SpeechRecognitionErrorEvent).error;
			// Web Speech asks for the same microphone permission `getUserMedia`
			// does, so a refusal here has to reach the shared gate — otherwise
			// the next press re-raises the host surface's blocked-mic banner.
			noteMicPermissionFailure({ code });
			const message = describeSpeechInputError({
				mode: "speech-recognition",
				code,
			});
			if (message) {
				onCaptureErrorRef.current?.(message);
			}
		};

		speechRecognition.addEventListener("start", handleStart);
		speechRecognition.addEventListener("end", handleEnd);
		speechRecognition.addEventListener("result", handleResult);
		speechRecognition.addEventListener("error", handleError);

		recognitionRef.current = speechRecognition;
		setIsRecognitionReady(true);

		return () => {
			speechRecognition.removeEventListener("start", handleStart);
			speechRecognition.removeEventListener("end", handleEnd);
			speechRecognition.removeEventListener("result", handleResult);
			speechRecognition.removeEventListener("error", handleError);
			speechRecognition.stop();
			recognitionRef.current = null;
			setIsRecognitionReady(false);
		};
	}, [mode, lang]);

	// Cleanup MediaRecorder and stream on unmount. Unmount is how callers revoke
	// capture (Drive unmounts the mic bar on mute), so anything already recorded
	// is abandoned rather than transcribed after the fact.
	useEffect(
		() => () => {
			abortedRef.current = true;
			if (mediaRecorderRef.current?.state === "recording") {
				mediaRecorderRef.current.stop();
			}
			audioChunksRef.current = [];
			if (streamRef.current) {
				for (const track of streamRef.current.getTracks()) {
					track.stop();
				}
			}
		},
		[],
	);

	// Start MediaRecorder recording
	const startMediaRecorder = useCallback(async () => {
		if (!onAudioRecordedRef.current) {
			return;
		}

		abortedRef.current = false;
		/**
		 * Set the moment the mic is actually ours. Everything after it —
		 * `new MediaRecorder`, `start()` — can throw `SecurityError` for reasons
		 * that are not a refusal, and recording one as a denial would strand a
		 * mic that demonstrably works.
		 */
		let captured = false;
		try {
			// Asking again after a refusal re-raises the host surface's own blocked-
			// mic banner, so a remembered denial is answered here. The button stays
			// live: the copy still points at the keyboard, and Drive's retry
			// affordance re-arms this without a reload.
			if ((await ensureMicPermission()) === "denied") {
				onCaptureErrorRef.current?.(MIC_PERMISSION_DENIED_MESSAGE);
				return;
			}
			const preferredDeviceId = deviceIdRef.current;
			const audio: MediaTrackConstraints | boolean = preferredDeviceId
				? { deviceId: { ideal: preferredDeviceId } }
				: true;
			const stream = await navigator.mediaDevices.getUserMedia({ audio });
			captured = true;
			noteMicPermissionGranted();
			// Teardown can land while the permission prompt is open; never keep a
			// stream that was granted after capture was revoked.
			if (abortedRef.current) {
				for (const track of stream.getTracks()) {
					track.stop();
				}
				return;
			}
			streamRef.current = stream;
			const mediaRecorder = new MediaRecorder(stream);
			audioChunksRef.current = [];

			const handleDataAvailable = (event: BlobEvent) => {
				if (event.data.size > 0) {
					audioChunksRef.current.push(event.data);
				}
			};

			const handleStop = async () => {
				for (const track of stream.getTracks()) {
					track.stop();
				}
				streamRef.current = null;

				if (abortedRef.current) {
					// Revoked mid-utterance: drop the audio, transcribe nothing.
					audioChunksRef.current = [];
					return;
				}

				const audioBlob = new Blob(audioChunksRef.current, {
					type: "audio/webm",
				});
				audioChunksRef.current = [];

				if (audioBlob.size > 0 && onAudioRecordedRef.current) {
					setIsProcessing(true);
					try {
						const transcript = await onAudioRecordedRef.current(audioBlob);
						if (transcript) {
							onTranscriptionChangeRef.current?.(transcript);
						}
					} catch {
						// Error handling delegated to the onAudioRecorded caller
					} finally {
						setIsProcessing(false);
					}
				}
			};

			const handleError = () => {
				setIsListening(false);
				audioChunksRef.current = [];
				for (const track of stream.getTracks()) {
					track.stop();
				}
				streamRef.current = null;
				const message = describeSpeechInputError({ mode: "media-recorder" });
				if (message) {
					onCaptureErrorRef.current?.(message);
				}
			};

			mediaRecorder.addEventListener("dataavailable", handleDataAvailable);
			mediaRecorder.addEventListener("stop", handleStop);
			mediaRecorder.addEventListener("error", handleError);

			mediaRecorderRef.current = mediaRecorder;
			mediaRecorder.start();
			setIsListening(true);
		} catch (error) {
			setIsListening(false);
			if (!captured) {
				noteMicPermissionFailure({ error });
			}
			const message = describeSpeechInputError({
				mode: "media-recorder",
				error,
			});
			if (message) {
				onCaptureErrorRef.current?.(message);
			}
		}
	}, []);

	// Stop MediaRecorder recording
	const stopMediaRecorder = useCallback(() => {
		if (mediaRecorderRef.current?.state === "recording") {
			mediaRecorderRef.current.stop();
		}
		setIsListening(false);
	}, []);

	// Start Web Speech recognition
	const startRecognition = useCallback(async () => {
		// `SpeechRecognition.start()` is a microphone request: the browser gates
		// it on the same permission as `getUserMedia`, so a blocked surface
		// re-raises its banner on every press. A remembered refusal is answered
		// here instead — the button stays live, the copy still points at the
		// keyboard, and Drive's retry affordance re-arms it without a reload.
		if ((await ensureMicPermission()) === "denied") {
			onCaptureErrorRef.current?.(MIC_PERMISSION_DENIED_MESSAGE);
			return;
		}
		// Teardown can land while the gate is being consulted; the effect nulls
		// this on unmount, so re-read it rather than starting a dead session.
		const recognition = recognitionRef.current;
		if (!recognition) {
			return;
		}
		try {
			recognition.start();
		} catch (error) {
			// start() throws InvalidStateError when a session is already open.
			const message = describeSpeechInputError({
				mode: "speech-recognition",
				error,
			});
			if (message) {
				onCaptureErrorRef.current?.(message);
			}
		}
	}, []);

	const startListening = useCallback(() => {
		if (mode === "speech-recognition" && recognitionRef.current) {
			if (!isListening) {
				void startRecognition();
			}
			return;
		}
		if (mode === "media-recorder" && !isListening) {
			void startMediaRecorder();
		}
	}, [mode, isListening, startRecognition, startMediaRecorder]);

	const stopListening = useCallback(() => {
		if (mode === "speech-recognition" && recognitionRef.current) {
			if (isListening) {
				recognitionRef.current.stop();
			}
			return;
		}
		if (mode === "media-recorder" && isListening) {
			stopMediaRecorder();
		}
	}, [mode, isListening, stopMediaRecorder]);

	const toggleListening = useCallback(() => {
		if (isListening) {
			stopListening();
		} else {
			startListening();
		}
	}, [isListening, startListening, stopListening]);

	useEffect(() => {
		onListeningChange?.(isListening);
	}, [isListening, onListeningChange]);

	// Determine if button should be disabled. `disabled` is pulled out of the
	// spread so a caller passing `disabled={false}` cannot re-enable a button
	// that has no working capture behind it.
	const isDisabled =
		disabled ||
		mode === "none" ||
		(mode === "speech-recognition" && !isRecognitionReady) ||
		(mode === "media-recorder" && !onAudioRecorded) ||
		isProcessing;

	const holdPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (isDisabled) {
			return;
		}
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		startListening();
	};

	const holdPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		stopListening();
	};

	return (
		<div
			className={cn(
				"relative inline-flex items-center justify-center",
				holdToTalk && "w-full",
			)}
		>
			{/* Animated pulse rings */}
			{isListening &&
				[0, 1, 2].map((index) => (
					<div
						className={cn(
							"absolute inset-0 animate-ping border-2 border-red-400/30",
							holdToTalk ? "rounded-2xl" : "rounded-full",
						)}
						key={index}
						style={{
							animationDelay: `${index * 0.3}s`,
							animationDuration: "2s",
						}}
					/>
				))}

			{/* Main record button */}
			<Button
				{...props}
				className={cn(
					"relative z-10 transition-all duration-300",
					holdToTalk
						? "h-[52px] w-full touch-manipulation rounded-2xl text-base font-semibold"
						: "rounded-full",
					isListening
						? "bg-destructive text-white hover:bg-destructive/80 hover:text-white"
						: "bg-primary text-primary-foreground hover:bg-primary/80 hover:text-primary-foreground",
					className,
				)}
				disabled={isDisabled}
				onClick={holdToTalk ? undefined : toggleListening}
				onKeyDown={
					holdToTalk
						? (event) => {
								if (event.key === " " || event.key === "Enter") {
									event.preventDefault();
									if (!event.repeat) {
										startListening();
									}
								}
							}
						: undefined
				}
				onKeyUp={
					holdToTalk
						? (event) => {
								if (event.key === " " || event.key === "Enter") {
									event.preventDefault();
									stopListening();
								}
							}
						: undefined
				}
				onPointerCancel={holdToTalk ? holdPointerUp : undefined}
				onPointerDown={holdToTalk ? holdPointerDown : undefined}
				onPointerUp={holdToTalk ? holdPointerUp : undefined}
				type="button"
			>
				{isProcessing && <Spinner />}
				{!isProcessing &&
					(children ??
						(holdToTalk ? (
							<span>{isListening ? "Listening…" : "Hold to talk"}</span>
						) : isListening ? (
							<SquareIcon className="size-4" />
						) : (
							<MicIcon className="size-4" />
						)))}
			</Button>
		</div>
	);
};
