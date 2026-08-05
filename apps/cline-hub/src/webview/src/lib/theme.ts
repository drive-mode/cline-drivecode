import { readStoredValue, writeStoredValue } from "./safe-storage";

export const HUB_THEME_STORAGE_KEY = "cline-hub-theme";

export type HubTheme = "light" | "dark";

export function readStoredHubTheme(): HubTheme | null {
	const stored = readStoredValue(HUB_THEME_STORAGE_KEY);
	return stored === "light" || stored === "dark" ? stored : null;
}

/**
 * Resolve the ambient theme without touching the DOM — VS Code kind wins;
 * otherwise honor `prefers-color-scheme` (browser / static preview).
 */
export function resolveSystemHubTheme(
	vscodeThemeKind: string | undefined,
	prefersDark: boolean,
): HubTheme {
	if (
		vscodeThemeKind === "vscode-dark" ||
		vscodeThemeKind === "vscode-high-contrast"
	) {
		return "dark";
	}
	if (vscodeThemeKind === "vscode-light") {
		return "light";
	}
	return prefersDark ? "dark" : "light";
}

export function readSystemHubTheme(): HubTheme {
	return resolveSystemHubTheme(
		document.body.dataset.vscodeThemeKind,
		window.matchMedia("(prefers-color-scheme: dark)").matches,
	);
}

export function applyHubTheme(theme: HubTheme): HubTheme {
	document.documentElement.classList.toggle("dark", theme === "dark");
	document.documentElement.dataset.clineHubTheme = theme;
	return theme;
}

export function syncHubTheme(): HubTheme {
	return applyHubTheme(readStoredHubTheme() ?? readSystemHubTheme());
}

export function setStoredHubTheme(theme: HubTheme): HubTheme {
	writeStoredValue(HUB_THEME_STORAGE_KEY, theme);
	return applyHubTheme(theme);
}
