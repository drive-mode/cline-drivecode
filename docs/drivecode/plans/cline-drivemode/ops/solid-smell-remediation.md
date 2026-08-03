# SOLID smell remediation — graphify + ponytail

Scoped notes for the stacked PRs under `refactor/core-leaf-barrel-imports` …
`refactor/core-types-entrypoints`. Baseline graph: `graphify-out/GRAPH_REPORT.md` @ `f94c7c7c`.

## Pass 3b — voice hook (YAGNI skip)

Not extracted. Markers on `useDriveSession.ts`:

- `// ponytail: voice still in hook after policy extract; split when Chat/DriveRoomChrome need independent voice lifecycle`
- `// ponytail: full host-message dispatcher move deferred; trigger when Chat/DriveRoomChrome need independent dispatch`

Upgrade when chrome needs an independent voice lifecycle — not before.
