/**
 * Local-only text export helpers for Drive surfaces: clipboard with a
 * fallback for contexts without the async clipboard API, and a Blob download
 * for "save as file". Nothing here leaves the device.
 */

export type ClipboardWriter = {
	writeText(text: string): Promise<void>;
};

/**
 * Copy text to the clipboard. Prefers the async API; falls back to a hidden
 * textarea + `execCommand("copy")` (still what the Tauri WebKit view offers
 * on some platforms). Resolves `false` when neither path worked so the UI
 * can say so instead of claiming a copy that never happened.
 */
export async function copyTextToClipboard(
	text: string,
	clipboard: ClipboardWriter | null | undefined = typeof navigator ===
	"undefined"
		? null
		: navigator.clipboard,
): Promise<boolean> {
	if (clipboard && typeof clipboard.writeText === "function") {
		try {
			await clipboard.writeText(text);
			return true;
		} catch {
			// Fall through to the legacy path.
		}
	}
	return copyViaExecCommand(text);
}

function copyViaExecCommand(text: string): boolean {
	if (typeof document === "undefined") {
		return false;
	}
	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "");
	textarea.setAttribute("aria-hidden", "true");
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	textarea.style.pointerEvents = "none";
	document.body.appendChild(textarea);
	textarea.select();
	let copied = false;
	try {
		copied = document.execCommand("copy");
	} catch {
		copied = false;
	} finally {
		textarea.remove();
	}
	return copied;
}

export type TextFileDownload = {
	filename: string;
	contents: string;
	mimeType?: string;
};

/**
 * Offer a text file via a Blob URL. Returns `false` where the platform has
 * no object-URL support so the caller can fall back to the clipboard copy.
 */
export function downloadTextFile({
	filename,
	contents,
	mimeType = "text/markdown;charset=utf-8",
}: TextFileDownload): boolean {
	if (
		typeof document === "undefined" ||
		typeof URL === "undefined" ||
		typeof URL.createObjectURL !== "function"
	) {
		return false;
	}
	try {
		const blob = new Blob([contents], { type: mimeType });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = filename;
		anchor.rel = "noopener";
		anchor.style.display = "none";
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		// Revoke on the next tick so the click has dereferenced the URL.
		setTimeout(() => URL.revokeObjectURL(url), 0);
		return true;
	} catch {
		return false;
	}
}
