# Testing · ADLC drive factory

Back to [overview](overview.md).

## Static (every phase that touches code)

```bash
bun run build:sdk   # after shared/drive/core edits
bun run check:drivecode-docs
bun -F @cline/drive test
bun -F @cline/shared test
bun -F @cline/core test:unit
bun -F @cline/cline-hub test
```

Narrower filters are named per phase. Prefer the phase filter while iterating;
run the full set before opening the PR.

## Runtime surfaces

| Phase | Surface | Skill |
|---|---|---|
| 1 | docs gate only | — |
| 2–4 | hub dashboard Drive / Settings | **control-ui** |
| 5 | Drive call + Status publish helper | **control-ui** |
| 6 | `/analytics` sessions lens | **control-ui** |
| 7 | PlanEditor complete with bound run | **control-ui** |

CLI doctor remains useful for rollup dump (`cline doctor session-rollups`) but
does not replace hub UI proof for phases 2–7.

## Stack order for PRs

Ship one phase per PR when files allow. Phase 3 then 4 may stack as a voice
pair. Phase 5 must not merge without the interrogate note in the PR body.
Phase 7 may stack on driveplan-agent-runtime if receipt helpers move.
