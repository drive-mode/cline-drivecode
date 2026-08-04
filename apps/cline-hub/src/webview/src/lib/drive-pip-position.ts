/**
 * Session-scoped PiP strip position (PRD PIP-06).
 *
 * Lives in sessionStorage so a drag does not survive a full reload unless a
 * durable facet is added later. Per-room so one call's placement does not
 * move the next call's companion.
 */

export const DRIVE_PIP_POSITION_STORAGE_KEY = "cline.drive.pip.position.v1";

export type DrivePipPosition = { left: number; top: number };

export type DrivePipPositionStorage = Record<string, DrivePipPosition>;

export type DrivePipSize = { width: number; height: number };
export type DrivePipViewport = { width: number; height: number };

const MARGIN = 16;

export function parseDrivePipPositionStorage(
	raw: string | null,
): DrivePipPositionStorage {
	if (!raw) {
		return {};
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		const out: DrivePipPositionStorage = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (
				key.trim().length > 0 &&
				value &&
				typeof value === "object" &&
				!Array.isArray(value) &&
				typeof (value as DrivePipPosition).left === "number" &&
				typeof (value as DrivePipPosition).top === "number" &&
				Number.isFinite((value as DrivePipPosition).left) &&
				Number.isFinite((value as DrivePipPosition).top)
			) {
				out[key] = {
					left: (value as DrivePipPosition).left,
					top: (value as DrivePipPosition).top,
				};
			}
		}
		return out;
	} catch {
		return {};
	}
}

function readSession(): DrivePipPositionStorage {
	if (typeof window === "undefined") {
		return {};
	}
	try {
		return parseDrivePipPositionStorage(
			window.sessionStorage.getItem(DRIVE_PIP_POSITION_STORAGE_KEY),
		);
	} catch {
		return {};
	}
}

function writeSession(next: DrivePipPositionStorage): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.sessionStorage.setItem(
			DRIVE_PIP_POSITION_STORAGE_KEY,
			JSON.stringify(next),
		);
	} catch {
		// Session-only preference; drop writes when storage is blocked.
	}
}

export function readDrivePipPosition(roomId: string): DrivePipPosition | null {
	return readSession()[roomId] ?? null;
}

export function writeDrivePipPosition(
	roomId: string,
	position: DrivePipPosition,
): void {
	writeSession({ ...readSession(), [roomId]: position });
}

/** Bottom-right default — same visual as `bottom-4 right-4`. */
export function defaultPipPosition(
	viewport: DrivePipViewport,
	size: DrivePipSize,
): DrivePipPosition {
	return clampPipPosition(
		{
			left: viewport.width - size.width - MARGIN,
			top: viewport.height - size.height - MARGIN,
		},
		viewport,
		size,
	);
}

/** Keep the card fully inside the hub webview bounds. */
export function clampPipPosition(
	position: DrivePipPosition,
	viewport: DrivePipViewport,
	size: DrivePipSize,
): DrivePipPosition {
	const maxLeft = Math.max(0, viewport.width - size.width);
	const maxTop = Math.max(0, viewport.height - size.height);
	return {
		left: Math.min(maxLeft, Math.max(0, position.left)),
		top: Math.min(maxTop, Math.max(0, position.top)),
	};
}
