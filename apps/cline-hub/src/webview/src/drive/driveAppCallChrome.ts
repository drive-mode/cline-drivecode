/**
 * Consumer (`?app=1`) call chrome helpers — strip, leave, Preview chip, interrupt.
 * Pure so vitest can cover without DOM.
 */

export const APP_STRIP_CONTROLS = ["mic", "hand", "captions", "leave"] as const;

export type AppStripControl = (typeof APP_STRIP_CONTROLS)[number];

/** Visible strip label — not "End". */
export const LEAVE_STRIP_LABEL = "Leave";

/** Lobby / toast line after leave (F07 / light F14). */
export const LEAVE_KEEP_RUNNING_LINE = "Room keeps running · rejoin anytime";

/** sessionStorage key for one-shot leave banner on lobby remount. */
export const LEAVE_NOTE_STORAGE_KEY = "cline.drive.leaveNote";

/** Shared Preview honesty contract (F08 / B05) — match iOS OpenView. */
export const PREVIEW_CHIP_LABEL = "Preview · demo call";

/** Raise-hand finishing banner hint (F06). */
export const INTERRUPT_HARD_CANCEL_HINT =
	"Lower hand to resume · hard cancel stays one tap away";

/**
 * After a hold that temp-unmuted, always remute via toggle — do not trust
 * React `muted` props that may lag the optimistic unmute.
 */
export function muteRestoreAfterHold(input: {
	unmutedByHold: boolean;
}): "mute" | "noop" {
	return input.unmutedByHold ? "mute" : "noop";
}

/** When credential-free / fixture / demo query must show the Preview chip. */
export function shouldShowPreviewChip(input: {
	demoRoom?: boolean;
	demoQuery?: boolean;
	unconfigured?: boolean;
}): boolean {
	return Boolean(input.demoRoom || input.demoQuery || input.unconfigured);
}

export function writeLeaveKeepRunningNote(
	storage: Pick<Storage, "setItem"> = sessionStorage,
): void {
	storage.setItem(LEAVE_NOTE_STORAGE_KEY, "1");
}

export function consumeLeaveKeepRunningNote(
	storage: Pick<Storage, "getItem" | "removeItem"> = sessionStorage,
): string | null {
	if (storage.getItem(LEAVE_NOTE_STORAGE_KEY) !== "1") {
		return null;
	}
	storage.removeItem(LEAVE_NOTE_STORAGE_KEY);
	return LEAVE_KEEP_RUNNING_LINE;
}

// `import.meta.main` is a Bun runtime property; the webview tsconfig does not
// declare it, so read it through a cast rather than widening ImportMeta.
if ((import.meta as { main?: boolean }).main) {
	console.assert(
		APP_STRIP_CONTROLS.length === 4 && APP_STRIP_CONTROLS[0] === "mic",
		"app strip stays four reach targets",
	);
	console.assert(
		muteRestoreAfterHold({ unmutedByHold: true }) === "mute",
		"restore mute after hold unmute",
	);
	console.assert(
		shouldShowPreviewChip({ unconfigured: true }) &&
			PREVIEW_CHIP_LABEL.includes("Preview"),
		"preview chip when unconfigured",
	);
	const mem = new Map<string, string>();
	const storage = {
		getItem: (k: string) => mem.get(k) ?? null,
		setItem: (k: string, v: string) => {
			mem.set(k, v);
		},
		removeItem: (k: string) => {
			mem.delete(k);
		},
	};
	writeLeaveKeepRunningNote(storage);
	console.assert(
		consumeLeaveKeepRunningNote(storage) === LEAVE_KEEP_RUNNING_LINE,
		"leave note consumes once",
	);
	console.assert(
		consumeLeaveKeepRunningNote(storage) === null,
		"leave note empty after consume",
	);
}
