# ADR-0017: Narration-bound presentation cues

## Status

Proposed — schema extension to `ScriptBeatSchema`; no wire rename, additive and
optional. Decision owner: Harrison.

## Metadata

- Date: 2026-08-01
- Deciders: Harrison (owner); drafted from the demo canvas reference implementation
- Related: ADR-0013 (state partition), [spotlight-screen-share](../initiatives/spotlight-screen-share/overview.md) (S2/S6/S9), [drive-audio](../initiatives/drive-audio/overview.md) (narrator, dead-air), [DRV-NARRATION](../features/DRV-NARRATION.md), [DRV-TTS](../features/DRV-TTS.md)

## Context

`ScriptBeatSchema` (`sdk/packages/shared/src/drive/director.ts:89-103`) can say
a line and hold the beat until the line finishes (`advance: "auto_after_say"`).
It cannot express **when, inside that line, something on screen should change.**
A beat is therefore all-or-nothing: everything the beat introduces appears the
instant the beat starts, while the agent is still describing it.

The demo canvas hit this concretely and fixed it. Before the fix, the test
result and its chime landed a full second before the agent said "There we go —
green"; the before/after bug animation gave away its punchline three times
before the sentence that explains it; three set-piece animations were still
running on durations hand-tuned for retired audio, so their phases drifted
1–2 seconds away from the sentences they illustrate. The cause was structural,
not cosmetic: **presentation had no clock tied to narration.**

The canvas now runs one: a *SayClock* per spoken beat (measured audio duration;
`words × 350ms` when muted; `chars × 90ms` for synthesized fallback), against
which cues fire at authored fractions of the line. This is a general capability
that the product needs for the same reason the demo needed it — the Spotlight
presents artifacts while an agent narrates, and S9's `walkthrough.animation`
renderer is meaningless without it.

## Decision

Extend `ScriptBeatSchema` with an optional, narration-relative cue list, and a
matching optional binding for timed artifact media.

```ts
export const ScriptCueSchema = z.object({
  at: z.number().min(0).max(1),        // fraction of the spoken line
  kind: z.enum(["reveal", "emphasize", "chime", "advance_step"]),
  targetRef: z.string().min(1).optional(), // artifact-relative ref, NOT a DOM selector
  chime: ChimeKindSchema.optional(),
}).strict();

// ScriptBeatSchema gains:
//   cues: z.array(ScriptCueSchema).default([]),
//   bindTimeline: z.boolean().default(false),  // artifact's own timeline spans the line
```

Load-bearing properties:

1. **Fractions, not milliseconds.** Authoring survives re-recording, voice
   changes, speed changes, and per-user TTS rate. The canvas proved the failure
   mode of absolute timings: regenerating narration at a different speed
   silently broke every animation aligned to the old durations.
2. **Refs, not selectors.** A cue names something *in the artifact's own model*
   (`"row-2"`, `"panel.after"`); each renderer maps refs to its own elements.
   The wire never carries DOM knowledge, so TUI and webview can honor the same
   cue sheet differently — the TUI can reveal a line of text where the webview
   animates a panel.
3. **Degrades in every mode.** Muted and synthesized narration produce a
   SayClock from estimated duration, so cues still land proportionally. A
   client that ignores `cues` entirely renders the beat's end state — which is
   exactly today's behavior, making adoption non-breaking.
4. **End state is always reachable.** Scrub, pause, late join, and reduced
   motion apply all cues immediately rather than replaying them. Presentation
   timing must never gate access to information.
5. **`bindTimeline` retimes, it does not redesign.** An artifact declaring its
   own timeline (an animation, a stepped walkthrough) has that timeline scaled
   to the spoken line so its first pass is the narrated pass, then loops
   ambiently if it is sticky-held.

The hub stays the single writer; cues are authored on the script the director
already owns and broadcast in the same `AgentMediaBag` payload. No new events,
no new op names, no timing negotiation between clients — every client derives
its own clock from the audio it is playing.

## Consequences

**Good.** Presentation gains the vocabulary it was missing, in a form that is
optional and additive. S9 (`walkthrough.animation`) becomes buildable as
specified rather than as "an animation that plays whenever." The drive-audio
narrator slice and the dead-air slice share one clock abstraction. Non-visual
clients get a meaningful contract instead of ignoring an animation payload.

**Costs.** Authoring cue sheets is real work per scripted beat, and fractions
are hand-tuned by watching; the canvas's cue sheet took a full pass of
frame-at-fraction review to settle. Renderers must maintain a ref→element map.
A cue that names a ref the artifact does not contain is a silent no-op; the
canvas's battery catches this by sweeping every cue target, and the product
should validate refs against artifact contents at enqueue time.

**Risk accepted.** Timer drift over long lines is not corrected mid-line
(re-syncing against `audio.currentTime` is possible but unnecessary at the
≤12s line lengths the narration style produces).

## Alternatives considered

- **Split every cue into its own beat.** Uses only today's schema, but beats
  are the unit of *what is being said*; splitting a sentence into four beats to
  time four reveals destroys the narration and multiplies audio segments.
- **Absolute millisecond offsets.** Simpler to implement, rejected for the
  re-recording fragility the canvas demonstrated firsthand.
- **Renderer-side heuristics** (reveal on keyword match in the transcript).
  No authoring burden, but unpredictable and untestable; the director's intent
  should be explicit.
- **Leave it demo-only.** The demo would keep a capability the product cannot
  express, and every future demo would re-implement it.

## Reference implementation

`docs/drivecode/design/canvases/drive-product-demo.html` — `SyncCue` module,
`Voice.active()`, the `sync` / `sayBind` beat fields, and `bindSayDuration`.
`verify.js` covers the behavior: cue-target resolution across all beats,
before/after sampling during voiced playback, end state on scrub, and the
muted-clock path. Treat the canvas as the executable spec when building S9.

## References

- `sdk/packages/shared/src/drive/director.ts:89-114` — `ScriptBeatSchema`, `DirectorScriptSchema`
- [spotlight-screen-share/overview.md](../initiatives/spotlight-screen-share/overview.md) — S9 renderer, Addendum
- [drive-audio/overview.md](../initiatives/drive-audio/overview.md) — narrator + dead-air slices
- [ADR-0016](ADR-0016-distribution-and-positioning.md) — protocol-as-asset argument this strengthens
