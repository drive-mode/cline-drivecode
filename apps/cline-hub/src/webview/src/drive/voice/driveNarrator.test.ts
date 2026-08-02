import { describe, expect, it } from "vitest";
import {
	createDriveNarrator,
	DRIVE_NARRATION_QUEUE_DEPTH,
	enqueueNarrationLine,
	type NarrationSink,
} from "./driveNarrator";

/** A sink whose utterances resolve only when the test says so. */
function createManualSink(): NarrationSink & {
	spoken: string[];
	cancels: number;
	finish(): void;
} {
	let release: (() => void) | null = null;
	const spoken: string[] = [];
	return {
		spoken,
		cancels: 0,
		speak(text) {
			spoken.push(text);
			return new Promise<void>((resolve) => {
				release = resolve;
			});
		},
		cancel() {
			this.cancels += 1;
			// Browser speechSynthesis.cancel() fires onend, resolving the
			// in-flight utterance promise. Mirror that here.
			release?.();
			release = null;
		},
		finish() {
			release?.();
			release = null;
		},
	};
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("enqueueNarrationLine", () => {
	it("drops the oldest pending line beyond depth two", () => {
		let pending = enqueueNarrationLine([], { text: "one" });
		pending = enqueueNarrationLine(pending, { text: "two" });
		expect(pending.map((line) => line.text)).toEqual(["one", "two"]);

		pending = enqueueNarrationLine(pending, { text: "three" });
		expect(pending).toHaveLength(DRIVE_NARRATION_QUEUE_DEPTH);
		expect(pending.map((line) => line.text)).toEqual(["two", "three"]);
	});
});

describe("createDriveNarrator", () => {
	it("speaks queued lines in order and reports speaking edges", async () => {
		const sink = createManualSink();
		const edges: boolean[] = [];
		const narrator = createDriveNarrator({
			sink,
			onSpeakingChange: (speaking) => edges.push(speaking),
		});

		narrator.speak("first");
		expect(narrator.speaking()).toBe(true);
		expect(edges).toEqual([true]);
		await tick();
		expect(sink.spoken).toEqual(["first"]);

		narrator.speak("second");
		// Still one edge — presence stays on across the queue, not per line.
		expect(edges).toEqual([true]);

		sink.finish();
		await tick();
		expect(sink.spoken).toEqual(["first", "second"]);

		sink.finish();
		await tick();
		expect(narrator.speaking()).toBe(false);
		expect(edges).toEqual([true, false]);
	});

	it("drops the oldest beat when they arrive faster than speech", async () => {
		const sink = createManualSink();
		const narrator = createDriveNarrator({ sink });

		narrator.speak("beat one");
		await tick();
		// "beat one" is in flight; three more pile up behind it.
		narrator.speak("beat two");
		narrator.speak("beat three");
		narrator.speak("beat four");
		expect(narrator.pending().map((line) => line.text)).toEqual([
			"beat three",
			"beat four",
		]);

		sink.finish();
		await tick();
		sink.finish();
		await tick();
		sink.finish();
		await tick();
		expect(sink.spoken).toEqual(["beat one", "beat three", "beat four"]);
	});

	it("cancel cuts the utterance, drops the queue, and clears presence", async () => {
		const sink = createManualSink();
		const edges: boolean[] = [];
		const narrator = createDriveNarrator({
			sink,
			onSpeakingChange: (speaking) => edges.push(speaking),
		});

		narrator.speak("mid sentence");
		narrator.speak("queued behind");
		await tick();

		narrator.cancel();
		expect(sink.cancels).toBe(1);
		expect(narrator.pending()).toEqual([]);
		expect(narrator.speaking()).toBe(false);
		expect(edges).toEqual([true, false]);

		// The cancelled utterance resolving must not restart the drained queue.
		await tick();
		expect(sink.spoken).toEqual(["mid sentence"]);
	});

	it("speaks again after a cancel", async () => {
		const sink = createManualSink();
		const narrator = createDriveNarrator({ sink });
		narrator.speak("cut me off");
		await tick();
		narrator.cancel();
		await tick();

		narrator.speak("back on");
		await tick();
		expect(sink.spoken).toEqual(["cut me off", "back on"]);
		expect(narrator.speaking()).toBe(true);
	});

	it("ignores blank narration", () => {
		const sink = createManualSink();
		const narrator = createDriveNarrator({ sink });
		narrator.speak("   ");
		expect(narrator.speaking()).toBe(false);
		expect(sink.spoken).toEqual([]);
	});
});
