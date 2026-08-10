/**
 * Ambient "what are my agents doing" state, surfaced outside the window.
 *
 * This is the whole reason to install the desktop app rather than keep a tab
 * open: the user tabs away for twenty minutes while agents work, and the
 * badge, tray and attention signals are what bring them back at the right
 * moment. Policy lives here, behind a `PresenceView` the host adapter
 * implements, so the rules are testable without a display server.
 */

export interface PresenceCounts {
	/** Agent sessions currently working. */
	running: number;
	/** Tasks finished and waiting on a human. */
	readyForReview: number;
}

export interface PresenceView {
	/**
	 * Number shown on the dock/taskbar. Zero clears it.
	 */
	setBadgeCount(count: number): void;
	/**
	 * Bounce the dock / flash the taskbar button. Fired sparingly — this is
	 * the most intrusive signal available.
	 */
	requestAttention(): void;
	/** One-line summary for the tray tooltip and menu. */
	setSummary(summary: string): void;
}

const EMPTY: PresenceCounts = { running: 0, readyForReview: 0 };

function sanitize(value: number): number {
	if (!Number.isFinite(value) || value < 0) return 0;
	return Math.floor(value);
}

/**
 * Human-readable summary of the current state.
 *
 * Exported for tests and reused by the tray, so the tooltip and the menu can
 * never disagree about what is happening.
 */
export function formatPresenceSummary(counts: PresenceCounts): string {
	const parts: string[] = [];
	if (counts.running > 0) {
		parts.push(`${counts.running} running`);
	}
	if (counts.readyForReview > 0) {
		parts.push(`${counts.readyForReview} ready for review`);
	}
	return parts.length > 0 ? parts.join(", ") : "No active tasks";
}

export class PresenceController {
	private counts: PresenceCounts = EMPTY;

	constructor(private readonly view: PresenceView) {}

	getCounts(): PresenceCounts {
		return this.counts;
	}

	update(next: PresenceCounts): void {
		const sanitized: PresenceCounts = {
			running: sanitize(next.running),
			readyForReview: sanitize(next.readyForReview),
		};

		const previous = this.counts;
		this.counts = sanitized;

		// The badge counts only what needs a human. Including running tasks
		// would leave a permanent number on the dock for a user with agents
		// always in flight, which trains them to ignore it.
		this.view.setBadgeCount(sanitized.readyForReview);
		this.view.setSummary(formatPresenceSummary(sanitized));

		// Attention fires on an *increase* only. Re-bouncing on every refresh
		// while a task sits unreviewed would make the dock unusable, and
		// bouncing when a count drops is meaningless.
		if (sanitized.readyForReview > previous.readyForReview) {
			this.view.requestAttention();
		}
	}

	/**
	 * Whether quitting right now would interrupt work.
	 */
	hasWorkInFlight(): boolean {
		return this.counts.running > 0;
	}
}
