# Drive iOS · full fixture demo

Native click-through of the consumer loop. **Fixtures only** — no hub wire.
Visual direction: [`mobile-drive-ios.html`](../../docs/drivecode/design/wireframes/mobile-drive-ios.html).
Presenter HTML twin: [`mobile-drive-ios-demo.html`](../../docs/drivecode/design/wireframes/mobile-drive-ios-demo.html).

## Run (Mac)

```bash
open apps/drive-ios/Drive.xcodeproj
# Drive scheme → Simulator or device → ⌘R
```

## Script (smoke the loop)

1. **Open** — Preview chip visible · brand **Cline Drive** · *Watch a live call*
2. **Call** — Spotlight + activity · **Hold to talk** toggles Listening · ✋ raise-hand banner (finishing → paused) · CC toggles captions · **…** / Review opens approval
3. **Approval** — Deny stays on call · Allow dismisses sheet
4. **Leave** — returns Home with *Room keeps running · rejoin anytime*
5. **Home** — Live hero Join · **Browse** → Tasks / Status / Artifacts / Rooms · tap-to-render diagram on Artifacts/Status · **You** → Settings
6. **Settings** — Appearance / Voice / Trust toggles · back to Home
7. Open path alternate: *Continue with Apple* → Home without jumping straight to call

## Honesty

`DemoSession.previewChipLabel` matches hub `PREVIEW_CHIP_LABEL` (`Preview · demo call`).
Leave copy matches hub `LEAVE_KEEP_RUNNING_LINE`.

## Presenter without Xcode

Serve the HTML twin from any machine:

```bash
cd docs/drivecode/design/wireframes
python3 -m http.server 8765
# → http://127.0.0.1:8765/mobile-drive-ios-demo.html
# Keys: →/Space next · P autoplay · L/D theme · H hold
```
