/**
 * Drives the visible pointer and the real input together.
 *
 * Every method here does two things at the same coordinates: it moves the
 * overlay from `pointer.js`, and it dispatches genuine Playwright input. The
 * overlay is a readout of input that actually happened — it never stands in for
 * an interaction that did not.
 *
 * Coordinates are always in the top-level viewport, which is also what
 * `locator.boundingBox()` returns for a locator inside an iframe. That is what
 * lets the same driver press a tab inside the phone frame and a nav link on the
 * hub page.
 */

import { readFileSync } from "node:fs";

const OVERLAY = readFileSync(new URL("./pointer.js", import.meta.url), "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Pointer {
	constructor(page) {
		this.page = page;
		this.x = 0;
		this.y = 0;
	}

	/** Inject the overlay into a page the demo does not own (the hub). */
	static async inject(page) {
		await page.addInitScript({ content: OVERLAY });
	}

	/** Inject into an already-loaded page. */
	async install() {
		await this.page.evaluate(OVERLAY).catch(() => {});
	}

	async mode(kind) {
		await this.page
			.evaluate((k) => window.__demoPointer?.mode(k), kind)
			.catch(() => {});
	}

	/** Glide to a point, moving the real mouse with it. */
	async moveTo(x, y, { kind = "mouse", settle = 480 } = {}) {
		await this.page
			.evaluate(
				([px, py, k]) => window.__demoPointer?.moveTo(px, py, k),
				[x, y, kind],
			)
			.catch(() => {});
		await this.page.mouse.move(x, y, { steps: 8 });
		this.x = x;
		this.y = y;
		if (settle) await sleep(settle);
	}

	/** Move, show the press, then actually click there. */
	async click(x, y, { kind = "mouse", settle = 700 } = {}) {
		await this.moveTo(x, y, { kind });
		await this.page
			.evaluate(() => window.__demoPointer?.press())
			.catch(() => {});
		await sleep(120);
		await this.page.mouse.click(x, y);
		if (settle) await sleep(settle);
	}

	/** Press the centre of a locator — works inside an iframe. */
	async clickLocator(locator, opts = {}) {
		const box = await locator.boundingBox();
		if (!box) return false;
		await this.click(box.x + box.width / 2, box.y + box.height / 2, opts);
		return true;
	}

	/**
	 * A real horizontal drag, drawn as a trail. Used for the phone's
	 * swipe-between-surfaces gesture, so the recording shows the gesture rather
	 * than a panel that changes for no visible reason.
	 */
	async swipe(fromX, fromY, toX, toY, { steps = 18, settle = 900 } = {}) {
		await this.moveTo(fromX, fromY, { kind: "touch", settle: 260 });
		await this.page.mouse.down();
		await this.page
			.evaluate(() => window.__demoPointer?.press())
			.catch(() => {});

		const path = [[fromX, fromY]];
		for (let i = 1; i <= steps; i++) {
			const t = i / steps;
			// Ease-out, so the drag decelerates the way a finger does.
			const eased = 1 - (1 - t) * (1 - t);
			const px = Math.round(fromX + (toX - fromX) * eased);
			const py = Math.round(fromY + (toY - fromY) * eased);
			path.push([px, py]);
			await this.page.mouse.move(px, py);
			await this.page
				.evaluate(([qx, qy]) => window.__demoPointer?.jumpTo(qx, qy), [px, py])
				.catch(() => {});
			await sleep(14);
		}

		await this.page.mouse.up();
		await this.page
			.evaluate((pts) => window.__demoPointer?.trail(pts), path)
			.catch(() => {});
		this.x = toX;
		this.y = toY;
		if (settle) await sleep(settle);
	}

	async hide() {
		await this.page
			.evaluate(() => window.__demoPointer?.hide())
			.catch(() => {});
	}
}
