# drive-product-demo · Initiative index

**Status:** shipped artifact, actively maintained — the demo is the **product
spec** for Drive-mode UI work
**Canvas:** [drive-product-demo.html](../../../../design/canvases/drive-product-demo.html)
**Consumed by:** [delivery/MVP-beta.md](../../delivery/MVP-beta.md) — the MVP
build-out treats this canvas as the design source of truth

A self-contained 47-beat scene-player that reenacts a real Drive session: the
user reports a bug by voice, takes the Spotlight to point at it, and the agent
diagnoses, fixes, and ships it on its shared VS Code screen. It runs from
`file://` with no network access and no credentials.

## Why it is a plan artifact, not just a demo

Every beat carries a **maturity chip** — `SHIPPED` means the behaviour exists
in the product today, `PLANNED` means design intent. Those chips were audited
for honesty during the 2026-08-01 review wave, so the canvas doubles as a
build backlog: a `PLANNED` beat is a real work item, and the MVP track cites
them as such.

The canvas also carries its own regression battery. `verify.js` (same
directory) steps every beat in both themes and asserts, among other things,
that the demo's **self-referential claims stay true** — the code it shows on
screen, the line numbers it cites, and the check counts it prints are all
compared against reality, so an edit cannot silently make the demo lie.

## What it demonstrates

| Area | Beats |
|---|---|
| Join, addressing, roster | act 0–1 |
| Spotlight as the agent's VS Code screen | act 2–4 |
| Director artifacts — plan, data-flow diagram, walkthrough, capture, animation | act 3–4 |
| Steering mid-flight (typed and dictated) | act 4 |
| Multi-agent handoff of the shared screen | act 5 |
| Status Hub lenses | act 6 |
| Leave / rejoin / handoff packet | act 7–8 |
| Approval gates and PR hand-off | act 9 |
| Durable rooms, and the page as a live explorable surface | act 10 |

## Maintenance

Tooling lives with the canvases and is registry-driven
([canvases.schema.md](../../../../design/canvases/canvases.schema.md)):

```bash
bun verify.js                                     # regression battery
bun record-canvas.mjs --canvas drive-product-demo # hero GIF (cut declared by beat id)
bun build-artifact.mjs --canvas drive-product-demo # single-file distribution
```

Narration is pre-rendered audio, so **narration text is verbatim-locked** to
the clips — changing a spoken line means regenerating its clip. See the voice
manifest at `docs/drivecode/assets/demos/voice/README.md`.

## Related

- [spotlight-screen-share](../spotlight-screen-share/) — the initiative that
  ships the Spotlight this canvas prototypes (slices S1–S9)
- [drive-audio](../drive-audio/) — the voice layer the canvas demonstrates
- [ADR-0017](../../adr/ADR-0017-narration-bound-presentation-cues.md) —
  narration-bound presentation cues, generalised from this canvas's
  implementation
