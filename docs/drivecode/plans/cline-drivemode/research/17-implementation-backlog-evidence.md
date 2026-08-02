# Evidence ledger — Drive implementation and backlog audit

**Parent:** [implementation and backlog reconciliation](17-implementation-backlog-audit.md)<br>
**Baseline:** `main` at `391d0d4ecfc17f093ed84e930316516ba352f94f`<br>
**Audit boundary:** locally available local branches, locally available `origin/*` refs, current worktree, Drive documentation, mainline source, and scoped test execution. No fetch was performed.

## Method and status rule

| Evidence type | How it was used | What it cannot prove alone |
|---|---|---|
| Mainline source and focused tests | Proof of an implemented capability | Full end-to-end product acceptance or future product desirability |
| Current-state docs (`SYSTEMS-ANALYSIS`, `HANDOFF`, `REMAINING`) | Product intent and known residuals | That every old plan checklist was updated |
| Plan/initiative docs | Scope and acceptance intent | Current implementation status when they conflict with code/current-state docs |
| Git path-level comparison | Whether an unmerged ref contains changes absent from `main` | That an unmerged change is correct or should be promoted |
| Dirty/untracked collateral | In-flight design/documentation intent | Shipped product behavior |

`git branch --no-merged main` was used only as an initial inventory. For every relevant Drive ref, the audit also compared first-parent landing history, changed paths, and current-file signatures because squash/replay merges make ancestry misleading.

## Mainline implementation evidence

| Capability | Mainline evidence | Focused verification | Reconciled status |
|---|---|---|---|
| Status schema and durable store | `sdk/packages/shared/src/status/status.ts:14`; `sdk/packages/core/src/status/store/sqlite-status-store.ts:143` (`publish()` supersedes prior state and assigns sequence around lines 175–240) | `bun -F @cline/core test:unit -- src/status/store/sqlite-status-store.test.ts src/hub/server/handlers/status-handlers.test.ts` — 37/37 passed | Verified shipped |
| Status reporting and hub fan-out | `sdk/packages/core/src/extensions/tools/executors/report-status.ts:39`; default definition at `extensions/tools/definitions.ts:970`; hub command/event dispatch at `hub/server/handlers/status-handlers.ts:63` | Same 37/37 suite covers publish, broadcast, notification, board, summary, and team snapshots | Verified shipped |
| Browser Status Hub | `apps/cline-hub/src/webview/src/components/views/status-view.tsx:1` and mode union at lines 61–65; tabs around lines 424–443 | Source shows Board, Changelog, Dependency map, and Sessions with paging/filter/live-update code | Verified shipped |
| Dependency model | `sdk/packages/shared/src/status/dependency-map.ts:27` | `bun -F @cline/shared test -- src/status/dependency-map.test.ts` — 2/2 passed | Verified shipped model |
| Dependency-map renderer | `apps/cline-hub/src/webview/src/components/views/dependency-map.tsx:8` | Native task buttons, keyboard navigation, selection detail, live region, and integrity alerts are implemented | Verified shipped card-grid baseline |
| Live team snapshot port | `sdk/packages/core/src/hub/server/handlers/status-handlers.ts:145`; browser adapter `apps/cline-hub/src/webview/src/status/hub-status-teams-source.ts:30` | The source reads live runtimes only; it does not create a second task store | Verified shipped, live-only scope |
| Demo boundary | Hub composition `apps/cline-hub/src/webview/src/App.tsx:1190`; CLI composition `apps/cli/src/tui/root.tsx:643`; query parsing `apps/drivecode-demo/src/hub-query.ts:31` | Production Status view does not import fixture data | Verified shipped isolation |
| CLI Status Hub | `apps/cli/src/tui/status/hub-status-snapshot-source.ts:32`; `apps/cli/src/tui/views/status-view.tsx:20` | Board and Dependency map have real hub-backed paths | Shipped but intentionally narrower than browser |
| Drive kernel, harness, and room services | Public surface `sdk/packages/drive/src/index.ts:1`; room handlers `sdk/packages/core/src/hub/server/handlers/drive-room-handlers.ts`; browser client `apps/cline-hub/src/webview/src/drive/` | See room/bank test caveat below | Verified code, room test verdict pending rebuilt SDK dist |
| Task/session satisfaction spine | Current implementation inventory `docs/drivecode/plans/cline-drivemode/delivery/REMAINING-task-satisfaction.md:76-193` | `bun -F @cline/drive test -- src/sessionRollup.test.ts src/stallClassifier.test.ts src/planImprove.test.ts src/harness.test.ts src/bankStore.test.ts src/driveLoop.test.ts` — 46/46 passed | Core slices verified shipped; residuals remain |
| Default browser Drive home | `apps/cline-hub/src/webview/src/components/views/drive-view.tsx:1`, including `DRIVE_DEFAULT_ROOM_ID` around lines 29 and 360 | One pairing-room preview, summary, and Join/Return flow exist | Shipped as a default-room home; not multi-room IA |
| CLI Drive control | `apps/cli/src/tui/contexts/session-context.tsx:218`; TUI status bar/component paths | State is a local toggle; no `call_join` code path exists in the TUI source | Confirmed parity gap |
| Room durability | `sdk/packages/core/src/hub/collaboration/room.ts:47-67` uses in-memory maps | Product reference at `docs/drivecode/README.md:291` agrees with the code | Explicit non-durable limitation |

## Confirmed active implementation gaps

| Gap | Evidence on current `main` | What a truthful backlog item should say |
|---|---|---|
| Spatial Dependency map / Plans rail | Current grid is explicitly distinguished from a spatial graph in `docs/drivecode/README.md:207,353-369`; initiative `initiatives/status-dependency-graph/` is active | Build the graph viewport, fit/density behavior, Plans rail, artifact edges, and accessibility without replacing the tested dependency model |
| Dependency-map request resilience | `hub-status-teams-source.ts:31` settles only on matching reply; `status-view.tsx:208` has no rejected/timeout recovery | Ensure malformed/missing replies resolve visibly and add timeout/error coverage; `origin/cursor/teams-load-promise-settlement-4f70` is a candidate fix |
| Historical task graphs | `status.tasks_snapshot` projects active in-memory team runtimes only | Do not promise historical Plans data until a persisted/sourced task model and semantics are decided |
| Room restart and reconnect UX | `room.ts` is in-memory; `docs/drivecode/HANDOFF.md:96-104` names reconnect as open | Define hub restart, `room_not_found`, snapshot retry, and user-visible recovery acceptance |
| CLI parity | TUI Drive is a local toggle; `docs/drivecode/README.md:372` explicitly says it does not call `call_join` | Decide the parity bar, then wire actual room commands and narrow the surface deliberately |
| General Recruit/Add and pack library | Hub add/remove and `RecruitStallPicker.tsx` exist, but `docs/drivecode/README.md:365` says Add and library UI do not | Implement or narrow Add → Recruit, discovery, library, and editing flow |
| Privacy retention presentation | `privacy.debugRetention` exists as a live facet, while `REMAINING-task-satisfaction.md:188-194` says visible indicator/raised caps/durable `privacy.retention` are open | Make retention state visible, wire elevated caps, and decide durable scope |
| Satisfaction product/gov residuals | `REMAINING-task-satisfaction.md:180-186,203-207,237-259,314-331` | Split small work items for host compile, learn queue, feed narration, W1 redirect/Now, stage freeze UI, and open policy choices |
| Gates | `HANDOFF.md:98-104`, `SYSTEMS-ANALYSIS.md:279-284`, and `DRV-GATES.md:64-74` show taxonomy without product feed completion | Add approval feed presentation, user actions, expiry/ownership policy, and acceptance coverage |

## Initiative and plan disposition

| Plan / initiative | Audited status | Action |
|---|---|---|
| `show-backlog-director` | Reference: slices 1–7 and S are on `main` | Keep as implementation record; do not reopen as baseline backlog |
| `task-satisfaction-observability` | Active only for residuals; slices 1–3 and W4 landed | Keep `REMAINING-task-satisfaction.md` as canonical residual queue |
| `session-satisfaction-moments` | Active only for residuals; core moments landed | Keep open items narrow and reconcile the PlanReentry/End-CTA wording |
| `task-bank-drive-loop` | Reference, partial on `main` | Convert phase 2/4/5/8 deltas into named active tasks |
| `status-dependency-graph` | Active, UX locked | Keep as a planned visual upgrade to the shipped grid |
| `spotlight-screen-share` | Planned; S1–S9 unstarted | Keep as a future UI initiative, not a claim of pixel sharing |
| `drive-audio` | Planned; engine decision/demo clips only | Keep product audio slices unstarted and off-by-default posture explicit |
| `share-and-router` | Reference; split content is partly delivered and partly future | Do not collapse it into the completed Show backlog; separate future router/share work |
| `drive-product-demo` worktree docs | In-flight collateral around a canvas already tracked on `main` | Reclassify as `reference` unless the underlying product work starts; do not use its static maturity labels as implementation proof |
| `TASK-GRAPH.md` | Historical roadmap with stale future-state gates | Re-baseline or mark reference before agents use it for task selection |
| DRV feature checklists | 149 unchecked boxes across 46 files, often contradicting current-state sources | Reconcile delivered checkboxes and add uniform status metadata before treating them as the backlog |

## Branch coverage ledger

### Genuine unmerged Drive / Status candidates

| Ref(s) | Delta absent from `main` | Triage recommendation |
|---|---|---|
| `feat/canvas-platform`, `origin/feat/canvas-platform` | Two commits at audit end; canvas registry/recorder, `canvases.json`, build changes, proposed ADR-0017 | Review from current ref tip; the ref advanced during audit, so do not pin a decision to an earlier SHA |
| `feat/demo-v4`; `origin/feat/demo-v4`; `batch-v1..v3`; `batch-u1..u3` | One 40-file v4 demo stack. Local `feat/demo-v4` is behind the origin/batch tip. Includes v4 script/voice/GIF, interactive VS Code mock, and takeover choreography | Choose one canonical tip; merge only as a coherent demo release |
| `origin/cursor/stale-feed-agent-message-6960` | Corrected v4 feed agent text | Fold into v4 stack |
| `origin/cursor/stale-preview-override-9efb` | Resets VS Code mock preview before artifact display | Fold into v4 stack |
| `origin/cursor/late-hover-dwell-fraction-703c` | Advances immediately when dwell target already passed | Fold into v4 stack |
| `origin/cursor/debug-presentation-issues-beee` | Unclips debug bar and aligns debug status line | Evaluate as an isolated demo correction |
| `origin/cursor/human-mp3s-playback-wiring-b057` | Human speech mapping/autoplay path | Evaluate as an isolated demo correction |
| `origin/cursor/stt-chunking-and-cancellation-8414` | Late-metadata/cancel STT pacing fix | Evaluate with the demo-audio scope |
| `origin/cursor/muted-voice-sequence-timing-e789` | Muted voice clip timing correction | Evaluate as a demo correction |
| `origin/cursor/voice-recorder-concurrency-812c` | Prevents voice-recorder take races | Evaluate as a demo tool correction |
| `origin/cursor/teams-load-promise-settlement-4f70` | Non-array team response settles as `[]` instead of hanging a load | Candidate small production resilience fix |
| `codex/drive-working-loop`, `feat/mermaid-show-validation` | Same tip; 48 touched paths, room preview/join-retry/Mermaid validation; 26 paths still differ from late mainline | Rebase and extract behavior-by-behavior; no wholesale merge |
| `feat/gate-feed-stage-seq` | Most content represented by #65; remaining potential ordering difference advances `roomSeqRef` after accepted update | Treat as one stale-event ordering review item |
| `orch/share-screen-canvas/live-demo` | Likely outstanding no-credential share-screen demo route | Make a product/visual decision first; branch is old and merge-shaped |

### Patch/replay landed historical refs

| Ref group | Landing evidence | Backlog disposition |
|---|---|---|
| `feature/status-dependency-map` | `71a9e6ecf` | Delivered; do not reopen |
| `feature/adaptive-performance-guardrails` | `df222dfec` (#32) | Delivered; non-Drive backlog not needed here |
| `feat/drive-state-partition` | `f32fc88ed` (#35) | Delivered |
| `feat/chat-fork-lifecycle` | `93da4c034` | Delivered |
| `cursor/chat-optimistic-state-sync-3912` | `66e2bca83` (#38) | Delivered |
| `feature-docs-cleanup`, `docs/remove-drivecode-writing`, `docs/drive-state-rebaseline` | `7d0ce5a17`, `20127261b` (#48), `0dfab1f5d` | Historical documentation work |
| `fix/roster-fieldset-a11y`, `cursor/drive-mvp-blockers-*`, `cursor/drive-harness-remaining-*`, `cursor/drive-byok-harness-*` | #42/#46/#58 and `40b795f5f` | Delivered room/harness work |
| `feat/demo-motion`, `origin/feat/demo-motion` | `e7092872a` (#94); changed paths match | Delivered base demo-motion wave |
| `fix/webview-message-validation`, `fix/webview-gateway-remaining`, `fix/hub-dim-contrast` | #95, #96, #97 | Delivered security/accessibility fixes |
| `chore/demo-artifact-build`, `origin/chore/demo-artifact-build` | #98 / `391d0d4ec`; tree-equivalent | Delivered |
| `claude/agent-host-protocol-ui-demo-*`, `claude/cline-sdk-broken-links-*`, `relink`, CLI test/build refs | Main landing series described in the branch audit | Historical / out of scope |

### Ref hygiene

- `batch-z*`, `batch-w*`, and many `worktree-agent-*` refs are intermediate demo-motion tips; `batch-v*`, `batch-u*`, and v4 worktree refs are intermediate v4 tips. They are not independent work items.
- Temporary worktrees were present during the audit. Do not prune/delete these refs until their owning worktree and user intent are confirmed.
- AI SDK U4, generic CI, and workflow-triage refs remain unmerged by reachability but do not belong in the Drive/Status backlog.

## Current worktree evidence

The following pre-existed before the audit and were deliberately left untouched:

| State | Path(s) | Audit interpretation |
|---|---|---|
| Modified | `docs/drivecode/design/README.md`, `docs/drivecode/design/wireframes/DEMO.md`, `docs/drivecode/plans/cline-drivemode/README.md`, `docs/drivecode/plans/cline-drivemode/initiatives/README.md` | Index/pointer work for demo collateral; not product implementation |
| Untracked | `docs/drivecode/design/canvases/drivemode-explainer.html` | Design collateral; needs an explicit owner/status if kept |
| Untracked | `docs/drivecode/plans/cline-drivemode/initiatives/drive-product-demo/` | Initiative/docs around an already tracked mainline demo canvas; should be reference, not an active product implementation claim |
| Untracked | `.cursor/` | Not assessed as Drive product work |

The uncommitted script labels “Open Drive tab (rooms list)” as shipped. This conflicts with the current single-default-room implementation in `drive-view.tsx`; retain the beat only if it is reworded to match that product surface.

## Test execution and caveat

| Command | Result | Interpretation |
|---|---|---|
| `bun -F @cline/shared test -- src/status/dependency-map.test.ts` | 2/2 passed | Dependency model layers/readiness/warnings verified |
| `bun -F @cline/drive test -- src/sessionRollup.test.ts src/stallClassifier.test.ts src/planImprove.test.ts src/harness.test.ts src/bankStore.test.ts src/driveLoop.test.ts` | 46/46 passed | Task/session satisfaction pure-kernel paths verified |
| `bun -F @cline/core test:unit -- src/status/store/sqlite-status-store.test.ts src/hub/server/handlers/status-handlers.test.ts` | 37/37 passed | Durable status and hub-handler paths verified |
| `bun -F @cline/core test:unit -- src/hub/server/handlers/drive-room-handlers.test.ts src/hub/server/handlers/drive-bank-handlers.test.ts` | 51 passed / 14 failed | Not a product verdict yet: Core imports ignored compiled `@cline/drive/dist`, which was stale relative to source. Repository policy requires `bun run build:sdk` before this suite is reliable. Rebuild and rerun before filing regressions. |

The audit did not run `bun run build:sdk` because this was a review request and the working tree already had user-owned changes. Rebuilding would write generated `dist` outputs; it is the correct next verification step only when that write is authorized.
