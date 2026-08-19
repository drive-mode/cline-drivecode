# BACKLOG · work-selection render

**What this is.** A human-readable **view** over [claims-registry.yaml](claims-registry.yaml) plus the decision records, built per [PLAN-backlog-reconciliation.md](PLAN-backlog-reconciliation.md) Stage 1 and permitted by [ADR-0026](../adr/ADR-0026-evidence-backed-done.md) ("`BACKLOG.md` may render it later and must not replace it").

**What this is not.** A status source. The registry is the only source of delivery truth ([AGENT-RUNBOOK](AGENT-RUNBOOK.md)). Every status word here traces to a `claim:<id>`, an ADR, or a linked plan — if this file and the registry disagree, **the registry wins and this file is stale**.

**Baseline.** Reconciled against `main` `8448d8d59` on 2026-08-19. The
golden-path sequence is ordered by
[portfolio-now](../initiatives/portfolio-now/); claim status in the registry
remains authoritative.

**Status vocabulary.** `verified shipped` · `active partial` · `planned` · `decision-gated` · `candidate patch review` · `reference/historical` — defined in [PLAN-backlog-reconciliation.md](PLAN-backlog-reconciliation.md#status-vocabulary).

---

## Owner decisions settled 2026-08-07

Recorded here as the delivery consequence; the binding records are the linked ADRs and initiative files.

| # | Decision | Outcome | Consequence for this backlog |
|---|---|---|---|
| 1 | ADR-0016 path H — hosted consumer runtime | **Opened as a real fork.** Hosted single-writer room service on the same Drive wire; multi-human rooms stay a non-goal | The binding `DEC-mobile-consumer-owner` and ADR-0016 amendment are on main. The work is decomposed into GP1 trusted host, GP3 managed chat, and GP6 remote call in [portfolio-now](../initiatives/portfolio-now/). Cline-default freemium with BYOK secondary is the settled posture; implementation economics stay account-service-owned. |
| 2 | Voice backend for the beta | **`browser-speechSynthesis` floor now**; Kokoro-82M slices land after, behind the same `TtsPort`, with no change to the default-off `tts.enabled` posture | Beta is unblocked with zero voice build work. [drive-audio](../initiatives/drive-audio/overview.md) slices 1–7 stay queued as product work, not beta blockers |
| 3 | ux-quality #1 — [research/22](../research/22-default-posture.md) as shipping defaults | **Accepted, with one variance: add an opt-in spend cap.** Always-visible spend stays the headline; the user may set a cap explicitly and is warned before it fires | Adds the spend-cap row below. Fork depth 1 and the earcon split are accepted as written |
| 4 | ux-quality #5 / mobile PWA | **Committed to the roadmap now.** Minimal scope: manifest, icons, standalone, mic policy — no offline hub | PWA leaves YAGNI; stays sequenced behind landscape + Safari STT |
| 5 | ux-quality #3 — operator panel placement | **In-call drawer/overlay.** Must not compete with stage vertical budget | Constrains the operator-panel row below; no new top-level nav destination |
| 6 | ux-quality #4 — hosted preview honesty | **Quiet persistent marker now, upgraded when real.** Once path H puts live agents behind the same URL, the chip must distinguish fixture from live | Adds an acceptance condition to the hosted-funnel row |
| 7 | ux-quality #6 — wow slice (`walkthrough.animation` / S9) | **Held until core-loop gates are green** | S9 stays out of ux-quality phases 0–4; it remains available as independent renderer work |

Already closed elsewhere, not re-opened: ux-quality #2 (narrow call IA — locked to collapsible rail) and ux-quality #7 (packaging posture — answered by [ADR-0016](../adr/ADR-0016-distribution-and-positioning.md) Route B).

---

## A · Decision-gated

Not engineering tasks. Per [ADR-0000](../adr/ADR-0000-status-board.md), an unresolved choice gets a decision record, not an assignee.

| ID | Decision needed | Why now | Owner role | Source |
|---|---|---|---|---|
| DG-0021 | Accept credential onboarding (device-code first) | Gates the beta's credentialed-call path. **Its three secret-hygiene fixes should not wait on the ADR** — see SEC-HYGIENE below | SE lead | [ADR-0021](../adr/ADR-0021-drive-credential-onboarding.md) |
| DG-0022 | Accept agent economics surface | `.driveagent/agent.yaml` already declares `providerId`/`modelId` and compiles them; they dead-end at a read-only handler. Two agents in one room cannot run different models | SE lead | [ADR-0022](../adr/ADR-0022-agent-economics.md) |
| DG-0023 | Amend spawn-governance body | The ADR describes a pre-fix codebase: Finding 2 ("unbounded generations") was fixed by `c8d2e53` (#146). [ADR-0027](../adr/ADR-0027-role-tiers.md) clause 4 asks its owner to amend | ADR owner | [ADR-0023](../adr/ADR-0023-agent-spawn-governance.md) |
| DG-0024 | Accept drive-web runtime contract | Blocks the ux-quality browser-host work; the transport is one branch in one file | SE lead | [ADR-0024](../adr/ADR-0024-drive-web-runtime.md) |
| DG-0027 | Accept role tiers | Explicitly guarded: no third tier until AUTH-D1 wires `capPreset` into `call_seat` | SE lead | [ADR-0027](../adr/ADR-0027-role-tiers.md) |
| DG-0028 | Accept ADLC control plane | Frames the [adlc-drive-factory](../initiatives/adlc-drive-factory/) phases below | PM | [ADR-0028](../adr/ADR-0028-adlc-control-plane.md) |
| DG-0020 | Accept session delivery CI/CD | Hold + rewind, coalesced projection, `run_expensive` wiring. No product path yet | SE lead | [ADR-0020](../adr/ADR-0020-session-delivery-cicd.md) |
| DG-BETA | Beta support path | GitHub issues on the fork vs something managed. Named as a beta-open blocker | Harrison | [MVP-beta](MVP-beta.md), [ops/beta-support](../ops/beta-support.md) |
| DG-0017 | Narration-bound cues | Deferred, not open — sits behind S9, which decision 7 above holds | — | [ADR-0017](../adr/ADR-0017-narration-bound-presentation-cues.md) |

---

## B · Active partial — claim-backed

Foundations exist; a bounded acceptance condition does not. Each row names one claim; advance the claim, not this table.

| ID | Work | Class | Acceptance boundary | Claim |
|---|---|---|---|---|
| AUTH-D1 | Wire `capPreset` into `call_seat` | active partial | A child seat cannot exceed its parent's ceiling, proved by a test that fails when the min-rule is bypassed | [ADR-0025](../adr/ADR-0025-enforced-authority.md), [enforced-authority](../initiatives/enforced-authority/) |
| AUTH-F1 | ADR-0025 Finding 1 residual rows | active partial | `effectivePreset`→policy, `presetIntent`, DriveRun isolation, gate classes, receipt identity each reach a path that can refuse | [ADR-0025](../adr/ADR-0025-enforced-authority.md) |
| GATES-UI | Gate lifecycle: expiry, denial, recovery presentation | active partial | A gate request resolves, expires, and denies observably through the room feed card; hub projection covers all three | `claim:drv-gates-feed` |
| PACK-LIB | RosterPack library + editor | active partial | A pack can be inspected and edited, not only added | `claim:drv-roster-pack-library`, `claim:drv-roster-pack` |
| RECRUIT-ADD | General Add → Recruit entry point | active partial | Recruit is reachable outside the stall path | `claim:drv-recruit`, `claim:drv-recruit-stall` |
| INTEROP-HOST | Thicken ADR-0019 Kanban/hub host adapters | active partial | Managed execution through the interop wire, not board sync | [ADR-0019](../adr/ADR-0019-driveplan-kanban-interop-wire.md) |
| SAT-RESID | Task-satisfaction residuals | active partial | Detailed queue stays in [REMAINING-task-satisfaction.md](REMAINING-task-satisfaction.md) — one row here by design, per the reconciliation plan | `claim:drv-task-metrics` et al |
| GOLDEN-CONTRACT | Cross-repository lifecycle and Agent Title convergence | active partial | Cline, harness, and writer agree; connected mobile conformance remains | `claim:drv-golden-path-contract` |
| GOLDEN-CHAT | Target-aware managed chat runtime | active partial | Real catalog/output/approval primitives exist, but the remote consumer contract is incomplete | `claim:drv-managed-chat` |
| GOLDEN-RESUME | Durable leave, restart, and resume | active partial | Resume from a cursor without event gaps or duplicates across host/client restart | `claim:drv-return-loop` |
| GOLDEN-CONFORMANCE | Deterministic cross-repository golden-path scenario | active partial | One `drive-dev` evidence bundle covers auth, targets, chat, reconnect, failures, and cleanup | `claim:drv-cross-repo-conformance` |
| PRESENTER-NATIVE | Native Presenter and signed Director projection | active partial | Standalone iOS uses live exclusive grants and fetches the host descriptor | `claim:drv-presenter-native` |

---

## C · Planned product work

Direction exists; `main` has no product implementation evidence for the named boundary.

### C1 · Connected golden path

The canonical dependency and evidence sequence is
[portfolio-now](../initiatives/portfolio-now/). The previous `NOW-*` fixture is
historical UI evidence; it is not the current delivery board.

| ID | Work | Depends on | Acceptance boundary | Claim |
|---|---|---|---|---|
| GP1 | Authenticated host discovery and pairing | Protocol foundation | Secure credential lifecycle and workspace authority survive reconnect | `claim:drv-host-trust` |
| GP2 | Opaque target registry | GP1 | Host resolves access posture without leaking unnecessary raw paths | `claim:drv-target-resolution` |
| GP4 | Standalone iOS managed-chat binding | GP3 managed chat | Target-aware assistant events and truthful failure states replace seeded state | `claim:drv-ios-managed-chat` |
| GP6 | Host-authoritative remote call | GP4, durable resume | Preset/configurator joins the real room and restores its lifecycle | `claim:drv-remote-call-binding` |
| GP9 | Production release services | Cross-repo conformance | Account/deletion, consent, analytics, accessibility, privacy, and reviewer backend agree | `claim:drv-release-services` |

### C2 · UX quality

Nine phases in [ux-quality](../initiatives/ux-quality/README.md), 0→7 recommended, 8 now committed. Owner decisions are settled above, so implementation is unblocked.

| ID | Phase | Acceptance boundary |
|---|---|---|
| UXQ-0 | Subtract lying UX | No-hub `/drive` shows an honest blocked state within one viewport; no infinite "Checking…" |
| UXQ-1 | Layout contract | Stage ≥ 320px at 1280×640, both themes, feed open — measured, not eyeballed |
| UXQ-2 | Responsive call shell | Residual only: Roster\|Feed tabs inside the rail; measure at 360×640 |
| UXQ-3 | Defaults that teach | Per decision 3: TTS first-call prompt, earcon split, spend + context in the existing strip row |
| UXQ-3b | Opt-in spend cap | **Decision 3 variance.** User-set cap, warned before it fires, and today's silent `CLINE_MAX_SESSION_COST` abort no longer aborts without warning |
| UXQ-4 | Dead air + control | Per decision 5: operator panel is an in-call drawer/overlay. One worker stoppable without ending the call |
| UXQ-5 | A11y + brand floor | Smallest text ≥ 4.5:1; `--dim` fixed in `index.css`; sticky CC |
| UXQ-6 | Facet progressive disclosure | Catalog `listDefs` phase filter drives visible sections; no second settings bag |
| UXQ-7 | Hosted preview funnel | Per decision 6: quiet marker now, and a fixture-vs-live distinction before path H puts real agents behind the URL |

### C3 · ADLC factory

[adlc-drive-factory](../initiatives/adlc-drive-factory/) — phase 2 landed; 3–7 open. Gated on DG-0028.

| ID | Phase | Boundary |
|---|---|---|
| ADLC-3 | First-call TTS enable (B2) | Same prompt UXQ-3 needs — sequence them together |
| ADLC-4 | Voice facets via `drive_config_put` | Facet writes obey lane rules |
| ADLC-5 | Status→Drive stall offer bridge | `critical` / `failed` surfaces a stall offer |
| ADLC-6 | Traces as product | Session evidence drill |
| ADLC-7 | Receipt ship atom | Run + receipt bound on complete |

### C4 · Demo badge honesty

[ship-remaining-planned.md](ship-remaining-planned.md) — six features, four waves. Wave 4 (Agents/Teams) is gated on AUTH-D1 shipping real enforcement, not a schema field.

Two rows are explicitly **build-or-delete**: the Artifacts page and Tasks-as-a-page were cut from the MVP for a reason that still holds. Retiring the beat is a legitimate way to reach all-shipped.

S9 (`walkthrough.animation`) is held per decision 7 — it is unblocked technically (the schema ships at `sdk/packages/shared/src/drive/director.ts:9`, `:175`) but sequenced after core-loop gates.

### C5 · Multi-device

[multi-device/BACKLOG.md](../initiatives/multi-device/BACKLOG.md) owns device
parity. The standalone `drive-ios` repository is the native source of truth;
the in-tree app is a legacy fixture. One row stays here by design.

### C6 · Status dependency map

[status-dependency-graph](../initiatives/status-dependency-graph/) — spatial
viewport, Fit/density, Plans rail, task detail, artifact annotations, keyboard
path, neutral GP0–GP9 model, and scoped host read ship. The only implementation
row is the lifecycle-neutral `/tasks` adapter; demo data remains explicit and
historical.

---

## D · Hygiene and infrastructure

| ID | Work | Why now |
|---|---|---|
| SEC-HYGIENE | Three secret-hygiene fixes named in ADR-0021 | The provider catalog broadcasts plaintext API keys (`local-provider-service.ts:709`), the desktop-command OAuth reply returns a raw token (`desktop-commands.ts:194`), and Drive reports ready when unconfigured (`driveVoiceUi.ts:89`). **This is a public fork.** These should not wait on DG-0021 |
| REG-EVIDENCE | Name evidence paths for claims that already shipped | Six claims are `active_partial` only because no evidence path was named — the code landed in #80. Registry hygiene, not build work |
| REG-COVERAGE | Mint claims for the C-section rows | Planned rows currently link source docs instead of claims. Add claims as each row is picked up, so the registry stays the SoT |
| BACKLOG-GEN | Generate this file from the registry | Hand-written renders drift — the exact failure [PLAN-backlog-reconciliation.md](PLAN-backlog-reconciliation.md) Stage 4 warns about. A generator wired into `check:drivecode-docs` makes drift impossible |
| KANBAN-SUNSET | Retire or re-point DriveKanban | The workspace board (`~/.cline/kanban/workspaces/cline-drivecode/`) holds 51 cards seeded from the historical TASK-GRAPH and contradicts this backlog. **Do not re-run `scripts/seed-drive-kanban.mjs`** — it still seeds the historic graph. Either retire the board or re-point the seed at the registry |

---

## Candidate patch review

The historical #216/#217 work is already represented on current main; there is
no candidate patch queue here. New work must advance a claim and cite its
backlog disposition in the PR.

---

## Maintenance rule

Per [PLAN-backlog-reconciliation.md](PLAN-backlog-reconciliation.md) Stage 4: every Drive PR states a backlog disposition — create, advance, block, close, or explicitly "no backlog effect". When a capability lands, the claim advances in the same change. Compare this file against `main` periodically; never count unchecked boxes in feature files.
