import { useEffect, useRef } from "react";
import {
	type DriveTranscriptLine,
	formatDriveTranscriptClock,
} from "./driveTranscript";

/** Sub-pixel rounding slack when deciding "is the reader at the bottom". */
const FOLLOW_SLACK_PX = 4;

/**
 * CC transcript — the demo canvas's `.transcript` panel (`.cc-head` /
 * `.cc-lines` / `.cc-empty`), rendered under the call strip.
 *
 * Scrollback, not subtitle: the Spotlight frame already shows the current
 * line, so this panel is deliberately not a live region — announcing every
 * line twice is worse than not announcing it here at all.
 *
 * The buffer it renders is React state that dies with the call. The chip says
 * so out loud, because a captions panel that quietly kept a record would be
 * the exact thing DRV-PRIVACY forbids.
 */
export function DriveTranscriptPanel({
	lines,
}: {
	lines: readonly DriveTranscriptLine[];
}) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	/**
	 * Whether to follow the newest line. Recorded on scroll rather than
	 * measured on append, because by the time the effect runs the new line has
	 * already grown `scrollHeight` and the reader looks scrolled-up either way.
	 */
	const followRef = useRef(true);
	useEffect(() => {
		const node = scrollRef.current;
		// Reading back means scrolling up; being yanked to the bottom mid-line
		// would defeat the panel for the person it exists for.
		if (!node || lines.length === 0 || !followRef.current) {
			return;
		}
		node.scrollTop = node.scrollHeight;
	}, [lines]);

	return (
		<section
			aria-label="Live captions"
			className="border-b bg-muted/20"
			data-slot="drive-transcript"
		>
			<div className="flex items-center gap-2 border-b px-4 py-2">
				<h3 className="text-xs font-semibold">Transcript</h3>
				<span className="ml-auto rounded-full border border-emerald-600/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
					ephemeral · privacy-strict
				</span>
			</div>
			<div
				className="max-h-40 overflow-y-auto px-4 py-3"
				data-testid="drive-transcript-lines"
				onScroll={(event) => {
					const node = event.currentTarget;
					followRef.current =
						node.scrollHeight - node.clientHeight - node.scrollTop <
						FOLLOW_SLACK_PX;
				}}
				ref={scrollRef}
			>
				{lines.length === 0 ? (
					<p className="py-4 text-center text-xs text-muted-foreground">
						Nothing said yet — captions appear as the call talks.
					</p>
				) : (
					<ol className="space-y-2">
						{lines.map((line) => (
							<li
								className="grid grid-cols-[38px_1fr] gap-2 text-xs text-muted-foreground"
								key={line.seq}
							>
								<span className="font-mono text-[10px] leading-5 tabular-nums">
									{formatDriveTranscriptClock(line.atMs)}
								</span>
								<span>
									<b className="font-semibold text-foreground">{line.who}</b> —{" "}
									{line.text}
								</span>
							</li>
						))}
					</ol>
				)}
			</div>
		</section>
	);
}
