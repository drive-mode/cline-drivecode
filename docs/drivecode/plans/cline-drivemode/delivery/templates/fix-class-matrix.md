# Fix-class matrix template

Use before the first `fix` PR for a bug class (ADR-0026). Copy into the claim's
`acs` notes or attach in the PR. Every cell that applies needs an evidence
command that fails if the class regresses.

## Claim

- `claim:<id>`:
- Bug class (one sentence):
- Surfaces touched (hub / CLI / sdk / docs):

## Matrix

| Dimension | Cell | In scope? | Evidence command | Result |
|-----------|------|-----------|------------------|--------|
| Host | hub webview | | | |
| Host | CLI / TUI | | | |
| Host | VS Code | | | |
| Package | `@cline/shared` | | | |
| Package | `@cline/drive` | | | |
| Package | `@cline/core` | | | |
| Path | happy path | | | |
| Path | reconnect / resume | | | |
| Path | empty / missing input | | | |
| Authority | parent policy / approval | | | |
| Authority | child / spawn / teammate | | | |

Mark out-of-scope cells `N/A` with a one-line reason. Do not mark Done on the
claim until every in-scope cell is green.

## Done checklist

- [ ] Matrix filled before first fix commit
- [ ] Claim registry updated (`status` / `acs` / evidence `path` + `command`)
- [ ] Cold-start cites use `claim:<id>` (HANDOFF / product README when touched)
- [ ] `bun run check:drivecode-docs` green
