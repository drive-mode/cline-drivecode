/**
 * Layered Cline Drive mark — wheel + head as separate groups for motion.
 *
 * Static nav still uses `DriveMarkIcon` (single path, tiny). Use this when you
 * need loading spin (wheel turns, head stays) or blind-spot peek (head tips).
 *
 * When to use which motion (event vs location): docs/drivecode/design/brand/DRIVE-MARK.md
 *
 * Geometry: generated from the official `assets/drive/source.png`; see
 * `assets/drive/cline-drive-mark-layers.svg`.
 */

import { DRIVE_MARK_HEAD_PATH, DRIVE_MARK_WHEEL_PATH } from "./drive-mark";

export type DriveMarkMotionKind = "idle" | "loading" | "peek" | "drive";

export function DriveMarkMotion({
	className,
	motion = "idle",
	title,
}: {
	className?: string;
	motion?: DriveMarkMotionKind;
	/** Accessible name when the mark is meaningful alone */
	title?: string;
}) {
	return (
		<svg
			aria-hidden={title ? undefined : true}
			aria-label={title}
			className={
				className ? `drive-mark-motion ${className}` : "drive-mark-motion"
			}
			data-motion={motion}
			fill="currentColor"
			role={title ? "img" : undefined}
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
		>
			{title ? <title>{title}</title> : null}
			<g className="dm-wheel">
				<path d={DRIVE_MARK_WHEEL_PATH} fillRule="evenodd" />
			</g>
			<g className="dm-head">
				<path d={DRIVE_MARK_HEAD_PATH} fillRule="evenodd" />
			</g>
		</svg>
	);
}
