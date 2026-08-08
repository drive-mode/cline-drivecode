# ADR-0035 · Late-join and return catch-up

**Status:** Proposed (2026-08-08)  
**Owner:** Drivecode SE lead  
**Constrained by:** [ADR-0013](ADR-0013-state-partition.md) (seq / snapshot),
[ADR-0029](ADR-0029-room-hotpath-redesign.md) (delta + snapshot on gap),
[DEC-open-product-forks](../decisions/DEC-open-product-forks.md) (one factual
“since you left” line), [DRV-LEAVE-END](../features/DRV-LEAVE-END.md).

## Context

Wire catch-up exists (snapshot on join / reconnect gap; deltas thereafter).
Product still lacks a single contract for **what the human sees** after leave
or late join — agents invent LLM narratives or dump the whole transcript.

## Decision

1. **Wire first.** Late join / reconnect uses full `room.snapshot` (or
   checkpoint + tail) then `room.delta`; clients never invent missing seq.
2. **One factual catch-up line** when history is thin enough to summarize from
   stage / now-next / bank cursor — no LLM narrative required for MVP
   (DEC-open-product-forks). Owner surface: leave/end + return (DRV-LEAVE-END).
3. **When history is rich,** prefer stage + Show present state over replaying
   the full transcript into the feed; audit streams remain on demand
   (ADR-0014).
4. **Privacy.** Catch-up copy uses structured facts (task titles, stage sharer,
   gate waiting) — not raw utterances or audio.
5. **Same semantics on every device** that shows return
   ([DEC-multi-device-parity](../decisions/DEC-multi-device-parity.md)); chrome
   may differ.

## Non-goals

- Auto-generated multi-paragraph session memoirs.
- Phone-home of leave/return analytics (ADR-0015).

## Open

1. Exact copy owner / string table (product).
2. Whether catch-up is a hub-projected field on snapshot or client-derived only.

## Alternatives rejected

- LLM “what you missed” essay on every rejoin.
- Replaying full `roomTranscript` into the composer feed.
