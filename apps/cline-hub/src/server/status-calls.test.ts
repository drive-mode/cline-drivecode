import { describe, expect, it, vi } from "vitest";
import type { HubContext } from "./state";
import { handleStatusCommand } from "./status-calls";
import type { BrowserPeer } from "./types";

/**
 * The bridge that carries the Status Hub's facet counts to the tab.
 *
 * Worth its own suite because nothing else covers it: the hub-side e2e talks to
 * the SDK over `connectToHub` and never crosses this hop, and the view that
 * renders the numbers is `.tsx`, which the node-only webview suite excludes. A
 * chip count that is dropped or mangled here reaches the screen either way.
 */

function peer(): BrowserPeer {
	return { id: "peer-1" } as unknown as BrowserPeer;
}

function ctx(payload: Record<string, unknown> | undefined): {
	context: HubContext;
	sent: Record<string, unknown>[];
} {
	const sent: Record<string, unknown>[] = [];
	const context = {
		uiClient: {
			command: vi.fn(async () => ({ ok: true, payload })),
		},
		send: (_peer: BrowserPeer, message: unknown) => {
			sent.push(message as Record<string, unknown>);
		},
	} as unknown as HubContext;
	return { context, sent };
}

async function pageFor(
	payload: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
	const { context, sent } = ctx(payload);
	await handleStatusCommand(context, peer(), {
		type: "status_query",
		requestId: "req-1",
	});
	const page = sent[0];
	if (!page) throw new Error("no frame was sent");
	expect(page.type).toBe("status_page");
	return page;
}

describe("handleStatusCommand facet forwarding", () => {
	it("forwards the counts the hub computed, unchanged", async () => {
		const page = await pageFor({
			updates: [],
			total: 51,
			tagFacets: [
				{ tag: "fix", count: 51 },
				{ tag: "feat", count: 36 },
			],
		});

		// The numbers the chip row and the results counter render. If this hop
		// rounded, clamped, or recomputed them, the chip would stop matching
		// what clicking it returns.
		expect(page.total).toBe(51);
		expect(page.tagFacets).toEqual([
			{ tag: "fix", count: 51 },
			{ tag: "feat", count: 36 },
		]);
	});

	it("omits the counts rather than inventing zeros", async () => {
		// A query that did not ask for facets gets none, and the view has to be
		// able to tell that from "nothing matches".
		const page = await pageFor({ updates: [] });
		expect("total" in page).toBe(false);
		expect("tagFacets" in page).toBe(false);
	});

	it("keeps a genuine zero", async () => {
		const page = await pageFor({ updates: [], total: 0, tagFacets: [] });
		expect(page.total).toBe(0);
		expect(page.tagFacets).toEqual([]);
	});

	it("drops junk facets without dropping the page", async () => {
		const page = await pageFor({
			updates: [],
			total: 2,
			tagFacets: [
				{ tag: "fix", count: 2 },
				{ tag: "", count: 9 },
				{ tag: "feat", count: Number.NaN },
				"nonsense",
				null,
			],
		});

		// Exactly the entries the view's own guard accepts. Forwarding one it
		// would reject costs the whole frame, not one chip.
		expect(page.tagFacets).toEqual([{ tag: "fix", count: 2 }]);
		expect(page.total).toBe(2);
	});

	it("drops a non-finite total rather than rendering NaN", async () => {
		const page = await pageFor({ updates: [], total: Number.NaN });
		expect("total" in page).toBe(false);
	});

	it("passes includeFacets through to the hub command", async () => {
		const { context } = ctx({ updates: [] });
		await handleStatusCommand(context, peer(), {
			type: "status_query",
			requestId: "req-1",
			includeFacets: true,
			tags: ["fix"],
			limit: 50,
		});

		expect(context.uiClient?.command).toHaveBeenCalledWith("status.query", {
			includeFacets: true,
			tags: ["fix"],
			limit: 50,
		});
	});
});
