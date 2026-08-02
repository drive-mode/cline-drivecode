# Beta support path

Back to [MVP-beta](../delivery/MVP-beta.md) phase 5.
Open question in [ADR-0000](../adr/ADR-0000-status-board.md): *"Beta support
path — GitHub issues on the fork vs something more managed. Owner: Harrison."*

**Status: proposed default, not decided.** This documents the cheapest thing
that works so the beta is not blocked on the decision. Swapping it later costs
one issue template and a README line.

## The default

Bug reports and questions go to **GitHub issues on `hhalperin/cline-drivecode`**,
using the [Drive beta report](../../../../../.github/ISSUE_TEMPLATE/drive-beta-report.yml)
template. No Discord, no email, no forum.

Why this and not something managed: the beta is self-hosted, so every report
is about a checkout the reporter controls and can paste diagnostics from. An
issue thread holds the preflight output, the repro and the fix in one place.
A managed channel adds a triage surface before there is enough volume to
justify one.

## What we ask a reporter for

The template collects the three things that make a Drive report actionable:

1. `bun run cli doctor preflight` output — settles toolchain, build and port
   questions before anyone reads the prose.
2. Which surface — hub Drive tab, the call, Spotlight, voice, Status Hub, CLI.
3. Provider and model, because a stalled call is usually a provider problem.

Reporters are told not to paste API keys, and reminded that captions and audio
are not recorded, so there is no transcript to attach.

## Not upstream

This fork does not send changes to `cline/cline`, and a Drive bug is not an
upstream bug. Nothing in the beta docs should route a Drive report there.

**Loose end for the owner.** `.github/ISSUE_TEMPLATE/config.yml` is still
upstream's: `blank_issues_enabled: false`, with contact links pointing at
Cline's discussions and Discord. A tester opening "New issue" therefore sees
two upstream destinations next to the Drive template. Leaving it is defensible
(they are real Cline communities and this is a Cline fork) but it does read as
an upstream path. Changing it is a one-line decision and is deliberately not
made here.

## Response expectations

One maintainer, best effort, no SLA. Say so plainly rather than implying a
support desk.

## Open for the owner

| Question | Default taken here |
|---|---|
| Issues on the fork, or something managed? | Issues on the fork |
| Keep upstream Cline contact links in `config.yml`? | Kept, flagged above |
| Enable Discussions for questions vs bugs? | Not enabled; questions use the same template |
