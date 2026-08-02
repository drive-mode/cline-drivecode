# ADR-0021 · Drive credential onboarding

**Status:** Proposed (2026-08-02)
**Owner:** Drivecode SE lead
**Supersedes:** nothing. **Constrained by:** [ADR-0010](ADR-0010-provider-harness-byok.md)
(provider harness / BYOK), [ADR-0009](ADR-0009-runtime-topology-local-cloud.md)
(runtime topology and egress), [ADR-0016](ADR-0016-distribution-and-positioning.md)
(public self-hosted beta).
**Blocks:** the MVP beta's credentialed-call gate
([MVP-beta.md](../delivery/MVP-beta.md)).

## Context

The beta is **public and self-hosted**: a tester clones the fork and runs it.
The one thing they cannot do today is make a real call, because nothing in the
product asks them for a credential.

**What actually happens on a fresh clone, traced end to end.** No saved
settings means `loadProviders` marks nothing enabled and sends `providers: []`
(`apps/cline-hub/src/server/providers.ts:57-67`). `Chat.tsx:974-993` resolves
the provider to `""`. Sending anyway reaches
`sdk/packages/llms/src/providers/registry.ts:256` and fails with
`Unknown provider ""`, surfaced as an error bubble. So it is an honest failure
rather than a hang — but an **unactionable** one: the message names an empty
string, and nothing routes the tester to Settings.

**Drive is worse than unconfigured — it is wrongly confident.**
`apps/cline-hub/src/webview/src/drive/voice/driveVoiceUi.ts:89` substitutes a
default for an empty provider id:

```ts
providerId: input.providerId || "anthropic"
```

so `resolveDriveVoiceTopology` returns `ok` and Drive believes it has a cloud
LLM when it has no credential at all. `assertTopologyLegal` only compares
egress classes, so ADR-0010's fail-closed posture (`ADR-0010:31`) never fires
for *unconfigured*. Drive will happily open a call it cannot complete.

### What already exists

The plumbing is mostly built, which is why this is an onboarding decision
rather than an infrastructure one.

| Piece | Where | State |
|---|---|---|
| Durable credential store | `ProviderSettingsManager`, `~/.cline/data/settings/providers.json` | Shipped. Hub holds one (`server/deps.ts:31`). Atomic tmp+rename; `0600` — **no-op on Windows** |
| Provider wire frames | `saveProviderSettings` / `runProviderOAuthLogin` / `loadProviderCatalog` | Shipped (`webview-protocol.ts:265-272`, dispatched `server.ts:255-259`) |
| Provider + key UI | `components/views/settings/provider-list-view.tsx:273,314,497` | Shipped, but reachable only from Settings |
| Turn-time key injection | `local-runtime-host.ts:333-353` | Shipped. **Keys never cross the webview socket on the send path** |
| CLI onboarding (OAuth + device code) | `apps/cli/src/tui/views/onboarding/auth.ts:26,79` | Shipped — CLI only |
| Hub-webview onboarding | — | **Absent** |

**Only four OAuth handlers exist** — `cline`, `cline-pass`, `oca`,
`openai-codex` (`provider-auth-registry.ts:243-273`); everything else is
API-key only. Of those, **only `cline` uses device auth**
(`auth/cline.ts:523-530`). `oca` and `openai-codex` bind a loopback redirect
server *on the daemon host* (`auth/oca.ts:360`, `codex.ts:307`), so for a
tester whose browser is not on the daemon machine, those flows open the wrong
computer's browser.

Device auth is also **currently impossible through the hub**:
`local-provider-service.ts:945` hardcodes
`onPrompt: async (prompt) => prompt.defaultValue ?? ""`, so a device-code
prompt silently resolves to the empty string.

### Secret-hygiene defects found while researching this

Independent of onboarding, and present on `main`:

1. **The provider catalog broadcasts plaintext API keys.**
   `local-provider-service.ts:709` sets `apiKey: resolveVisibleApiKey(...)` —
   the raw key — and `providers.ts:105-110` sends that to every connected peer.
   Two lines below it, `oauthAccessTokenPresent` is reduced to a **boolean**;
   the asymmetry shows the intent was already understood.
2. **Two front doors, opposite hygiene.** The websocket reply returns
   `accessTokenPresent: boolean` (`providers.ts:149-155`); the desktop-command
   reply returns the **raw token** (`desktop-commands.ts:194-197`).
3. **Transport is not guaranteed private.** Default bind is `127.0.0.1`
   (`options.ts:22`), but `HOST=0.0.0.0` is supported, `roomSecret` travels in
   the **URL query string** (`browser-auth.ts:121`), and `publicUrl` defaults
   to plain `http://` (`options.ts:63`).

Bounded by default; serious the moment a tester tunnels the hub.

## Decision

**1. Credentials live in Cline's provider settings. Drive never stores, proxies
or reads a key.**

ADR-0010 already binds this: the LLM is not a Drive provider slot (`:19`), and
secrets are forbidden in Drive facet JSON (`:23`, schema-enforced at
`shared/src/drive/providers.ts:51-61`, asserted by
`driveFacetsStore.test.ts:50`). Drive facets keep owning STT/TTS ids only.
Drive consumes a **readiness boolean**, never a secret.

**2. Device-code sign-in is the primary path; BYOK is the secondary.**

"Sign in with Cline" needs no pasted key, no loopback port, and works when the
browser and the daemon are on different machines — the only flow of the four
that survives the remote case. Testers who prefer their own Anthropic/OpenAI
key use the existing provider UI, promoted to first-run.

**3. The device code reaches the tester by forwarding `onPrompt`, and only ever
carries the code and verification URL.**

`createOAuthClientCallbacks` already exposes `onPrompt` and `onServerListening`
(`auth/client.ts:29`, documented for exactly this remote-host case at `:9-18`).
The hub must forward them to the webview instead of stubbing them. The new
frames carry a user code and a verification URL — **never a token**. The reply
stays `accessTokenPresent: boolean`.

**4. Drive gets an honest readiness gate.**

Remove the `|| "anthropic"` substitution. An unconfigured LLM must resolve to a
distinct not-ready state that blocks the call with a route to fix it, rather
than resolving `ok`. This extends ADR-0010's fail-closed posture from *illegal*
to *absent*.

**5. The three hygiene defects are fixed as a prerequisite, not a follow-up.**

The catalog carries `apiKeyPresent: boolean` matching the OAuth field beside
it; the desktop-command OAuth reply stops returning a raw token. We are about
to make credentials a first-class flow — doing that on top of a wire that
broadcasts keys is the wrong order.

## Consequences

- A tester reaches a working call without a text editor, and without us
  handling their key in the webview.
- Drive stops claiming readiness it does not have — this will surface as *more*
  visible failures on unconfigured machines, which is the point.
- Removing `apiKey` from the catalog payload is a **breaking change for any
  consumer that reads it**. `provider-list-view.tsx:42-43` echoes it back on
  save and must move to a write-only field.
- Windows stores credentials with no file permissions (`chmodSync` is a no-op,
  `provider-settings-manager.ts:84`). This ADR does not fix that; it must be
  stated plainly in [reference/privacy.md](../../../reference/privacy.md).
- Device auth adds a dependency on Cline accounts for the easiest path. BYOK
  remains fully supported, so this is a default, not a lock-in.

## Alternatives rejected

- **Paste a key into a Drive settings field.** Violates ADR-0010 `:23`
  outright, and puts a secret on the socket for no benefit over the existing
  provider UI.
- **A Drive-specific credential store.** Two stores that disagree, plus a
  second thing to leak. ADR-0010 exists to prevent exactly this.
- **Loopback OAuth (`oca` / `openai-codex`) as the primary path.** Opens a
  browser on the daemon host; wrong for any tester not sitting at that machine,
  which is the case the self-hosted beta has to survive.
- **Environment variables only** (`CLINE_PROVIDER` + key). Works, and stays
  supported for CI, but "edit your shell profile" is not a first-run
  experience.

## Open

- Whether first-run onboarding **blocks** the hub or is a dismissible banner.
  Recommendation: dismissible, because the demo route
  (`/drive?demoShareScreen=1`) is credential-free and is what a tester should
  be able to reach with no account at all.
- Whether to detect loopback Ollama and suggest the Local profile —
  ADR-0010 `:28` specifies it and **no detection code exists**. Out of scope
  here; worth its own slice.
