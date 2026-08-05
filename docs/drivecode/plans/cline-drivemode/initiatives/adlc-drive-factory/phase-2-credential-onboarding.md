# Phase 2 · Credential onboarding

Back to [overview](overview.md). Implements defaults-delivery **B3** under
[ADR-0021](../../adr/ADR-0021-drive-credential-onboarding.md).

**Status:** landed on branch (`CredentialOnboardingBanner` on Drive home;
dismiss via safe-storage; CTAs → Settings Providers / `?demoShareScreen=1`).

## Goal

A fresh clone can reach either a credentialed call or the dismissible demo route
without an unactionable `Unknown provider ""` dead end.

## Changes

- Hub webview: dismissible first-run banner when no provider is configured.
- Banner routes to Settings provider UI or `?demoShareScreen=1`.
- Keep the ADR-0021 readiness gate fail-closed (`unconfigured` stays illegal for a live LLM turn).
- Do not invent a new hub command for BYOK in this phase. Reuse webview provider frames.

## Data structures

Reuse existing provider catalog frames. No new `HubCommandName`.

## Verification

**Static.** `bun -F @cline/cline-hub test` covering the banner visibility matrix
(configured / unconfigured / dismissed).

**Runtime.** control-ui: cold userdata → open dashboard Drive → see banner →
Dismiss → demo route still works; Save key path reaches Settings.
