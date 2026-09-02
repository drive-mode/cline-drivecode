/**
 * Small time formatters for Drive directory surfaces. Kept pure (a `now`
 * can be injected) so cards can be tested without faking the clock.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** `just now`, `3m ago`, `2h ago`, `4d ago`; empty string for bad input. */
export function relativeTimeLabel(
	iso: string | null | undefined,
	now: number = Date.now(),
): string {
	if (!iso) {
		return "";
	}
	const timestamp = Date.parse(iso);
	if (!Number.isFinite(timestamp)) {
		return "";
	}
	const diff = now - timestamp;
	if (diff < MINUTE_MS) {
		return "just now";
	}
	if (diff < HOUR_MS) {
		return `${Math.floor(diff / MINUTE_MS)}m ago`;
	}
	if (diff < DAY_MS) {
		return `${Math.floor(diff / HOUR_MS)}h ago`;
	}
	return `${Math.floor(diff / DAY_MS)}d ago`;
}

/** Locale date + time, or the raw input when it does not parse. */
export function absoluteTimeLabel(
	iso: string | null | undefined,
	locale?: string,
): string {
	if (!iso) {
		return "—";
	}
	const timestamp = Date.parse(iso);
	if (!Number.isFinite(timestamp)) {
		return iso;
	}
	return new Date(timestamp).toLocaleString(locale, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}
