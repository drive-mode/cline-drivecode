import { describe, expect, it, vi } from "vitest";

import {
	emitHostHandshake,
	HOST_HANDSHAKE_ENV,
	shouldEmitHostHandshake,
} from "../../../src/server/host-handshake";

const SUPERVISED = { [HOST_HANDSHAKE_ENV]: "1" };

describe("shouldEmitHostHandshake", () => {
	it.each(["1", "true", "TRUE", "yes"])(
		"treats %j as supervised",
		(value) => {
			// The host sets "1", but accepting any truthy spelling means a
			// hand-run `KANBAN_HOST_HANDSHAKE=true` behaves the same.
			expect(shouldEmitHostHandshake({ [HOST_HANDSHAKE_ENV]: value })).toBe(
				true,
			);
		},
	);

	it.each(["0", "false", "False", "", "   ", undefined])(
		"treats %j as unsupervised",
		(value) => {
			expect(shouldEmitHostHandshake({ [HOST_HANDSHAKE_ENV]: value })).toBe(
				false,
			);
		},
	);

	it("is unsupervised when the variable is absent entirely", () => {
		expect(shouldEmitHostHandshake({})).toBe(false);
	});
});

describe("emitHostHandshake", () => {
	it("writes one JSON line the host can parse", () => {
		const write = vi.fn();

		const emitted = emitHostHandshake({
			endpoint: "http://127.0.0.1:5173",
			env: SUPERVISED,
			write,
		});

		expect(emitted).toBe(true);
		expect(write).toHaveBeenCalledTimes(1);
		expect(JSON.parse(write.mock.calls[0]?.[0] as string)).toEqual({
			type: "ready",
			endpoint: "http://127.0.0.1:5173",
		});
	});

	it("stays silent when nothing is supervising", () => {
		const write = vi.fn();

		const emitted = emitHostHandshake({
			endpoint: "http://127.0.0.1:5173",
			env: {},
			write,
		});

		// Kanban's stdout is a human-facing CLI surface; a stray JSON line for
		// every ordinary `kanban` user would be the cost of getting this wrong.
		expect(emitted).toBe(false);
		expect(write).not.toHaveBeenCalled();
	});

	it("trims surrounding whitespace off the endpoint", () => {
		const write = vi.fn();

		emitHostHandshake({
			endpoint: "  http://127.0.0.1:5173  ",
			env: SUPERVISED,
			write,
		});

		expect(JSON.parse(write.mock.calls[0]?.[0] as string).endpoint).toBe(
			"http://127.0.0.1:5173",
		);
	});

	it.each(["", "   "])(
		"refuses to announce a blank endpoint (%j)",
		(endpoint) => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const write = vi.fn();

			const emitted = emitHostHandshake({ endpoint, env: SUPERVISED, write });

			// A blank endpoint parses fine on the host side and leaves it
			// pointing at nothing, which shows up much later as an unexplained
			// blank window. Staying silent lets the host time out with a
			// message that actually says what happened.
			expect(emitted).toBe(false);
			expect(write).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalled();
			warn.mockRestore();
		},
	);

	it("emits a single line with no embedded newline", () => {
		// The host reads stdout line by line; an embedded newline would split
		// one message into two unparseable halves.
		const write = vi.fn();

		emitHostHandshake({
			endpoint: "http://127.0.0.1:5173",
			env: SUPERVISED,
			write,
		});

		expect(write.mock.calls[0]?.[0]).not.toContain("\n");
	});
});
