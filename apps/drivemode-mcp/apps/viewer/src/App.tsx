import { useEffect, useMemo, useRef, useState } from "react";

type Participant = {
	id: string;
	kind: "human" | "agent";
	displayName: string;
	role: string;
	status: string;
};

type StageCard = {
	id: string;
	category: string;
	title: string;
	summary?: string;
	packId?: string;
	updatedAt: string;
};

type RoomSnapshot = {
	roomId: string;
	driveActive: boolean;
	subMode: string;
	participants: Participant[];
	stage: {
		sharer: { kind: string; participantId: string } | null;
		cards: StageCard[];
	};
	raisedHandByParticipantId: Record<string, boolean>;
};

type FeedItem = {
	seq: number;
	at: string;
	actorId?: string;
	text: string;
	kind: "message" | "narration";
};

type SnapshotResponse = {
	seq: number;
	logId?: string;
	room: RoomSnapshot;
	activePackId: string;
	conversationFeed: FeedItem[];
};

type SseEntry = {
	seq: number;
	event: {
		type: string;
		track?: string;
		text?: string;
		at?: string;
		actorId?: string;
	};
};

type SsePayload = {
	type: string;
	logId?: string;
	snapshot?: RoomSnapshot;
	backlog?: SseEntry[];
	entry?: SseEntry;
};

/**
 * Fold log entries into the feed. Delivery is at-least-once — a reconnect's
 * hello backlog can overlap entries the live stream already delivered — so
 * the fold is idempotent: seq identifies an entry, and one already folded is
 * skipped, not appended twice.
 */
function foldFeed(prev: FeedItem[], entries: SseEntry[]): FeedItem[] {
	const seen = new Set(prev.map((item) => item.seq));
	const additions = entries
		.filter(
			(entry) =>
				(entry.event.type === "conversation.message" ||
					entry.event.type === "conversation.narration") &&
				!seen.has(entry.seq),
		)
		.map((entry) => ({
			seq: entry.seq,
			at: entry.event.at ?? new Date().toISOString(),
			actorId: entry.event.actorId,
			text: entry.event.text ?? "",
			kind:
				entry.event.type === "conversation.narration"
					? ("narration" as const)
					: ("message" as const),
		}));
	return additions.length ? [...prev, ...additions] : prev;
}

function defaultWriterUrl(): string {
	if (typeof window === "undefined") {
		return "http://127.0.0.1:8787";
	}
	return (
		new URLSearchParams(window.location.search).get("writer") ??
		localStorage.getItem("drivemode.writerUrl") ??
		"http://127.0.0.1:8787"
	);
}

export function App() {
	const [writerUrl, setWriterUrl] = useState(defaultWriterUrl);
	const [connected, setConnected] = useState(false);
	const [seq, setSeq] = useState(0);
	const [room, setRoom] = useState<RoomSnapshot | null>(null);
	const [packId, setPackId] = useState("coding");
	const [feed, setFeed] = useState<FeedItem[]>([]);
	const [spotlightKey, setSpotlightKey] = useState(0);
	const [error, setError] = useState<string | null>(null);
	// Bumped when the writer's logId changes mid-stream: an in-memory writer
	// that restarted is a *different* log whose seqs restart at 1, so folding
	// its events onto state from the previous one would splice two histories.
	// The bump tears the whole connection down and rebuilds from /snapshot.
	const [connectNonce, setConnectNonce] = useState(0);
	const logIdRef = useRef<string | null>(null);

	const humanId = useMemo(() => {
		const human = room?.participants.find((p) => p.kind === "human");
		return human?.id ?? "drive:human";
	}, [room]);

	const raised = Boolean(room?.raisedHandByParticipantId[humanId]);

	useEffect(() => {
		localStorage.setItem("drivemode.writerUrl", writerUrl);
	}, [writerUrl]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: connectNonce is a reconnect trigger, bumped when the writer's logId changes mid-stream
	useEffect(() => {
		let es: EventSource | null = null;
		let cancelled = false;
		const base = writerUrl.replace(/\/$/, "");

		async function connect() {
			setError(null);
			setConnected(false);
			try {
				const snapRes = await fetch(`${base}/snapshot`);
				if (!snapRes.ok) {
					throw new Error(`snapshot ${snapRes.status}`);
				}
				const snap = (await snapRes.json()) as SnapshotResponse;
				if (cancelled) {
					return;
				}
				logIdRef.current = snap.logId ?? null;
				setRoom(snap.room);
				setSeq(snap.seq);
				setPackId(snap.activePackId);
				setFeed(snap.conversationFeed ?? []);
				setConnected(true);

				es = new EventSource(`${base}/events?since=${snap.seq}`);
				es.onmessage = (msg) => {
					// EventSource reconnects on its own. A message arriving is
					// proof the stream is healthy again, so clear the error the
					// previous drop left on screen — otherwise a recovered
					// viewer keeps claiming it is disconnected.
					setConnected(true);
					setError(null);
					const payload = JSON.parse(msg.data) as SsePayload;
					if (payload.type === "hello" && payload.snapshot) {
						if (
							payload.logId &&
							logIdRef.current &&
							payload.logId !== logIdRef.current
						) {
							setConnectNonce((n) => n + 1);
							return;
						}
						logIdRef.current = payload.logId ?? logIdRef.current;
						setRoom(payload.snapshot);
						// On a reconnect, entries missed during the outage arrive
						// only in this backlog — the live stream resumes after it.
						setFeed((prev) => foldFeed(prev, payload.backlog ?? []));
						return;
					}
					if (payload.type === "event" && payload.snapshot && payload.entry) {
						setRoom(payload.snapshot);
						setSeq(payload.entry.seq);
						if (payload.entry.event.track === "work") {
							setSpotlightKey((k) => k + 1);
						}
						const entry = payload.entry;
						setFeed((prev) => foldFeed(prev, [entry]));
					}
				};
				es.onerror = () => {
					setConnected(false);
					setError("SSE disconnected — check writer URL");
				};
			} catch (err) {
				if (!cancelled) {
					setConnected(false);
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		}

		void connect();
		return () => {
			cancelled = true;
			es?.close();
		};
	}, [writerUrl, connectNonce]);

	async function raiseHand() {
		await fetch(`${writerUrl.replace(/\/$/, "")}/api/raise-hand`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ participantId: humanId, raised: !raised }),
		});
	}

	const primary = room?.stage.cards.at(-1) ?? null;
	const sharer = room?.participants.find(
		(p) => p.id === room.stage.sharer?.participantId,
	);

	return (
		<div className="shell">
			<header className="top">
				<div className="brand">
					<span className="mark" aria-hidden />
					<div>
						<h1>Drive Mode</h1>
						<p>Live stage · presence, spotlight, interrupt</p>
					</div>
				</div>
				<div className="meta">
					<span className={connected ? "pill ok" : "pill bad"}>
						{connected ? "in call" : "offline"}
					</span>
					<span className="pill">seq {seq}</span>
					<span className="pill">{packId}</span>
					<span className="pill">{room?.subMode ?? "—"}</span>
				</div>
			</header>

			<section className="connect">
				<label>
					Writer URL
					<input
						value={writerUrl}
						onChange={(e) => setWriterUrl(e.target.value.trim())}
						placeholder="http://127.0.0.1:…"
					/>
				</label>
				{error ? <p className="err">{error}</p> : null}
			</section>

			<main className="stage">
				<aside className="roster">
					<h2>Roster</h2>
					<ul>
						{(room?.participants ?? []).map((p) => (
							<li
								key={p.id}
								className={`seat ${p.kind}`}
								style={{ animation: "joinIn 420ms ease both" }}
							>
								<span className="dot" data-kind={p.kind} />
								<div>
									<strong>{p.displayName}</strong>
									<small>
										{p.kind} · {p.role} · {p.status}
									</small>
								</div>
								{room?.raisedHandByParticipantId[p.id] ? (
									<span className="hand-flag" title="hand raised" />
								) : null}
							</li>
						))}
						{(room?.participants.length ?? 0) === 0 ? (
							<li className="empty">Waiting for room_join…</li>
						) : null}
					</ul>
				</aside>

				<section
					className="spotlight"
					key={spotlightKey}
					style={{ animation: "spotlightSwap 500ms ease both" }}
				>
					<div className="spotlight-head">
						<h2>Spotlight</h2>
						<p>
							{sharer ? `${sharer.displayName} is sharing` : "No sharer yet"}
						</p>
					</div>
					{primary ? (
						<article className="card" data-category={primary.category}>
							<span className="cat">{primary.category}</span>
							<h3>{primary.title}</h3>
							{primary.summary ? <p>{primary.summary}</p> : null}
							{primary.packId ? <small>pack · {primary.packId}</small> : null}
						</article>
					) : (
						<article className="card empty-card">
							<h3>Stage is quiet</h3>
							<p>Agents publish with stage_publish_work.</p>
						</article>
					)}
					<button
						type="button"
						className={raised ? "raise on" : "raise"}
						onClick={() => void raiseHand()}
						style={
							raised ? { animation: "handPulse 1.4s ease infinite" } : undefined
						}
					>
						{raised ? "Lower hand" : "Raise hand"}
					</button>
				</section>

				<aside className="feed">
					<h2>Feed</h2>
					<ul>
						{[...feed].reverse().map((item) => (
							<li key={`${item.seq}-${item.kind}`}>
								<small>
									#{item.seq} · {item.kind}
								</small>
								<p>{item.text}</p>
							</li>
						))}
						{feed.length === 0 ? (
							<li className="empty">No narration yet</li>
						) : null}
					</ul>
				</aside>
			</main>
		</div>
	);
}
