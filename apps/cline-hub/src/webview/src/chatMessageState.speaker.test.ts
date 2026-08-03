import { describe, expect, it } from "vitest";
import { appendAssistantDelta, type ChatMessage } from "./chatMessageState";

/** The ref `appendAssistantDelta` uses to find the streaming message. */
function activeRef(id?: string): { current: string | undefined } {
	return { current: id };
}

describe("assistant delta speaker stamping", () => {
	it("leaves a message unattributed when the delta carries no speaker", () => {
		const messages = appendAssistantDelta([], "hello", activeRef());
		expect(messages).toHaveLength(1);
		expect(messages[0]?.speakerId).toBeUndefined();
	});

	it("stamps the addressed agent onto a new message", () => {
		const messages = appendAssistantDelta(
			[],
			"hello",
			activeRef(),
			"drive:partner",
		);
		expect(messages[0]?.speakerId).toBe("drive:partner");
	});

	it("keeps the speaker across the rest of the stream", () => {
		const ref = activeRef();
		let messages: ChatMessage[] = appendAssistantDelta(
			[],
			"hel",
			ref,
			"drive:partner",
		);
		messages = appendAssistantDelta(messages, "lo", ref, "drive:partner");
		expect(messages).toHaveLength(1);
		expect(messages[0]?.text).toBe("hello");
		expect(messages[0]?.speakerId).toBe("drive:partner");
	});

	it("never relabels a message that already has a speaker", () => {
		// Two browsers can share a session; the second one's send must not
		// rewrite the byline over text the reader already saw.
		const ref = activeRef();
		let messages: ChatMessage[] = appendAssistantDelta(
			[],
			"hel",
			ref,
			"drive:partner",
		);
		messages = appendAssistantDelta(messages, "lo", ref, "agent:reviewer");
		expect(messages[0]?.speakerId).toBe("drive:partner");
	});

	it("lets an unattributed message gain a speaker", () => {
		const ref = activeRef();
		let messages: ChatMessage[] = appendAssistantDelta([], "hel", ref);
		expect(messages[0]?.speakerId).toBeUndefined();
		messages = appendAssistantDelta(messages, "lo", ref, "drive:partner");
		expect(messages[0]?.speakerId).toBe("drive:partner");
	});
});
