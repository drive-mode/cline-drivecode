import {
	BUILTIN_PROVIDER_MANIFESTS,
	type DriveProviderManifest,
	type EgressClass,
	type RuntimeTopology,
	type SttBackend,
	sttBackendsEqual,
	type TtsBackend,
	topologyCacheKey,
	ttsBackendsEqual,
} from "@cline/shared";
import { applyAudioOutputSinkId } from "./driveHardwarePrefs";
import { LocalSttError, transcribeAudioBlob } from "./transcribeAudioBlob";

export interface SttHandlers {
	onInterim?(text: string): void;
	onFinal(text: string): void;
	onError(error: { code: string; message: string }): void;
}

export interface SttSession {
	stop(): void;
}

export interface SttPort {
	readonly backend: SttBackend;
	readonly egress: EgressClass;
	start(handlers: SttHandlers): SttSession;
}

export interface TtsSpeakOptions {
	voiceSlot?: string;
	volume?: number;
	/** Preferred audiooutput deviceId (HTMLAudioElement / AudioContext setSinkId). */
	sinkId?: string;
}

export interface TtsPort {
	readonly backend: TtsBackend;
	readonly egress: EgressClass;
	speak(text: string, opts?: TtsSpeakOptions): Promise<void>;
	cancel(): void;
}

export interface VoiceStack {
	readonly stt: SttPort;
	readonly tts: TtsPort;
	readonly topology: RuntimeTopology;
}

const voiceStackCache = new Map<string, VoiceStack>();

function matchSttManifest(
	manifest: DriveProviderManifest,
	stt: SttBackend,
): boolean {
	if (manifest.slot !== "stt") {
		return false;
	}
	return sttBackendsEqual(manifest.backend as SttBackend, stt);
}

function matchTtsManifest(
	manifest: DriveProviderManifest,
	tts: TtsBackend,
): boolean {
	if (manifest.slot !== "tts") {
		return false;
	}
	return ttsBackendsEqual(manifest.backend as TtsBackend, tts);
}

/**
 * Composition root for Drive voice adapters (ADR-0010).
 * Builtins only for now; workspace plugins load in a later phase.
 * Memoized by topology fingerprint to avoid recreating TTS/STT ports per send.
 */
export function createVoiceStack(
	topology: RuntimeTopology,
	registry: readonly DriveProviderManifest[] = BUILTIN_PROVIDER_MANIFESTS,
): VoiceStack {
	const key = topologyCacheKey(topology);
	const cached = voiceStackCache.get(key);
	if (cached) {
		return cached;
	}
	const sttManifest = registry.find((manifest) =>
		matchSttManifest(manifest, topology.stt),
	);
	const ttsManifest = registry.find((manifest) =>
		matchTtsManifest(manifest, topology.tts),
	);
	if (!sttManifest || !ttsManifest) {
		throw new Error("No builtin adapter matches the resolved topology");
	}

	const stack: VoiceStack = {
		topology,
		stt: createBuiltinSttPort(sttManifest),
		tts: createBuiltinTtsPort(ttsManifest),
	};
	voiceStackCache.set(key, stack);
	return stack;
}

function createBuiltinSttPort(manifest: DriveProviderManifest): SttPort {
	const backend = manifest.backend as SttBackend;
	const config =
		manifest.defaultConfig && typeof manifest.defaultConfig === "object"
			? (manifest.defaultConfig as Record<string, unknown>)
			: {};
	return {
		backend,
		egress: manifest.egress,
		start(handlers) {
			if (backend.kind === "webSpeech") {
				// Mic UX uses SpeechInput; SttPort.start stays a cheap redirect stub.
				handlers.onError({
					code: "use_speech_input",
					message:
						"Use SpeechInput for webSpeech STT; SttPort.start is a no-op.",
				});
				return { stop() {} };
			}
			if (backend.kind === "local-worker" || backend.kind === "cloud-api") {
				// MediaRecorder session → OpenAI-compatible local/cloud transcription.
				// Privacy: blobs are not persisted; only confirmed text is returned.
				let stopped = false;
				let mediaRecorder: MediaRecorder | null = null;
				let stream: MediaStream | null = null;
				const chunks: BlobPart[] = [];
				void (async () => {
					try {
						if (
							typeof navigator === "undefined" ||
							!navigator.mediaDevices?.getUserMedia ||
							typeof MediaRecorder === "undefined"
						) {
							handlers.onError({
								code: "stt_unsupported",
								message: "MediaRecorder STT is not available in this environment.",
							});
							return;
						}
						stream = await navigator.mediaDevices.getUserMedia({ audio: true });
						if (stopped) {
							for (const track of stream.getTracks()) {
								track.stop();
							}
							return;
						}
						mediaRecorder = new MediaRecorder(stream);
						mediaRecorder.ondataavailable = (event) => {
							if (event.data.size > 0) {
								chunks.push(event.data);
							}
						};
						mediaRecorder.onstop = () => {
							void (async () => {
								try {
									const blob = new Blob(chunks, {
										type: mediaRecorder?.mimeType || "audio/webm",
									});
									const text = await transcribeAudioBlob({
										blob,
										backend,
										config,
									});
									if (!stopped && text.trim()) {
										handlers.onFinal(text.trim());
									}
								} catch (error) {
									handlers.onError({
										code:
											error instanceof LocalSttError
												? error.code
												: "stt_failed",
										message:
											error instanceof Error
												? error.message
												: String(error),
									});
								} finally {
									if (stream) {
										for (const track of stream.getTracks()) {
											track.stop();
										}
									}
								}
							})();
						};
						mediaRecorder.start();
					} catch (error) {
						handlers.onError({
							code: "stt_permission",
							message:
								error instanceof Error
									? error.message
									: "Could not start local STT capture.",
						});
					}
				})();
				return {
					stop() {
						stopped = true;
						if (mediaRecorder && mediaRecorder.state !== "inactive") {
							mediaRecorder.stop();
						} else if (stream) {
							for (const track of stream.getTracks()) {
								track.stop();
							}
						}
					},
				};
			}
			handlers.onError({
				code: "stt_not_wired",
				message: `STT adapter ${manifest.id} backend is unsupported.`,
			});
			return { stop() {} };
		},
	};
}

function createBuiltinTtsPort(manifest: DriveProviderManifest): TtsPort {
	const backend = manifest.backend as TtsBackend;
	let utterance: SpeechSynthesisUtterance | null = null;
	let audioContext: AudioContext | null = null;
	return {
		backend,
		egress: manifest.egress,
		async speak(text, opts) {
			if (backend.kind !== "browser-speechSynthesis") {
				return;
			}
			if (typeof window === "undefined" || !window.speechSynthesis) {
				return;
			}
			window.speechSynthesis.cancel();

			// Best-effort sink routing for Web Audio / future HTML audio backends.
			// speechSynthesis itself ignores setSinkId (browser limitation).
			if (opts?.sinkId) {
				if (!audioContext) {
					const Ctx =
						window.AudioContext ||
						(
							window as unknown as {
								webkitAudioContext?: typeof AudioContext;
							}
						).webkitAudioContext;
					if (Ctx) {
						audioContext = new Ctx();
					}
				}
				if (audioContext) {
					await applyAudioOutputSinkId(
						audioContext as {
							setSinkId?: (sinkId: string) => Promise<void>;
						},
						opts.sinkId,
					);
				}
			}

			utterance = new SpeechSynthesisUtterance(text);
			const volume =
				typeof opts?.volume === "number" && Number.isFinite(opts.volume)
					? Math.min(1, Math.max(0, opts.volume))
					: 1;
			utterance.volume = volume;
			await new Promise<void>((resolve) => {
				if (!utterance) {
					resolve();
					return;
				}
				utterance.onend = () => resolve();
				utterance.onerror = () => resolve();
				window.speechSynthesis.speak(utterance);
			});
		},
		cancel() {
			if (typeof window !== "undefined" && window.speechSynthesis) {
				window.speechSynthesis.cancel();
			}
			utterance = null;
		},
	};
}

/**
 * Play a remote/local audio URL on the preferred output device.
 * Used by HTML-audio TTS backends; exported for narration players.
 */
export async function playAudioUrlOnSink(input: {
	url: string;
	volume?: number;
	sinkId?: string;
}): Promise<void> {
	if (typeof window === "undefined") {
		return;
	}
	const audio = new Audio(input.url);
	audio.volume =
		typeof input.volume === "number" && Number.isFinite(input.volume)
			? Math.min(1, Math.max(0, input.volume))
			: 1;
	await applyAudioOutputSinkId(audio, input.sinkId);
	await new Promise<void>((resolve, reject) => {
		audio.onended = () => resolve();
		audio.onerror = () => reject(new Error("audio_playback_failed"));
		void audio.play().catch(reject);
	});
}
