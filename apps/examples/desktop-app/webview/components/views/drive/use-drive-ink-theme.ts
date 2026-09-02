"use client";

/**
 * The active host theme as the ink resolver's input.
 *
 * `applyHubTheme` toggles `.dark` on the root element, so the class is the
 * signal — watched rather than read once, because a theme flip has to
 * re-resolve every agent's ink or half the directory ends up unreadable.
 */

import { type DriveInkTheme, driveInkTheme } from "@cline/drive";
import { useSyncExternalStore } from "react";

type ThemeMode = "light" | "dark";

function readMode(): ThemeMode {
	if (typeof document === "undefined") {
		return "dark";
	}
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function serverMode(): ThemeMode {
	return "dark";
}

function subscribe(listener: () => void): () => void {
	if (
		typeof document === "undefined" ||
		typeof MutationObserver === "undefined"
	) {
		return () => {};
	}
	const observer = new MutationObserver(listener);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});
	return () => observer.disconnect();
}

export function useDriveInkTheme(): DriveInkTheme {
	const mode = useSyncExternalStore(subscribe, readMode, serverMode);
	return driveInkTheme(mode);
}
