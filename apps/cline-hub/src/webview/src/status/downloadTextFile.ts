/**
 * Browser helper: opt-in download of a shipped digest Markdown file.
 * Local-only — no network egress.
 */

export function downloadTextFile(filename: string, contents: string): void {
	const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = "noopener";
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}
