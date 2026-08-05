# Workflows

Multi-agent workflows invocable by name. Run one with the `Workflow` tool:
`Workflow({ name: "gap-audit" })`, optionally with `args`.

| Workflow | Answers | Run it when |
|---|---|---|
| [`gap-audit`](gap-audit.js) | Where does stated capability exceed real functionality? | After a batch of merges, before a release, or when deciding what to build next |

## gap-audit

Applies [ADR-0025](../../docs/drivecode/plans/cline-drivemode/adr/ADR-0025-enforced-authority.md)'s
rule — *a declared limit with no enforcement-path consumer is a defect class* —
to the product, repeatably.

```
Workflow({ name: "gap-audit" })                                  # last 20 commits
Workflow({ name: "gap-audit", args: { since: "v1.4.0" } })       # since a tag
Workflow({ name: "gap-audit", args: { lenses: ["declared-not-enforced"] } })
Workflow({ name: "gap-audit", args: { since: "main~5", verifyTop: 4 } })
```

**Args.** `since` (default `HEAD~20`) scopes the audit to a git range, so
repeat runs do not keep re-finding the same things. `lenses` narrows to one or
more defect classes. `verifyTop` (default 2) sets how many candidates per lens
get adversarially verified — raise it when you want depth over breadth.

### The five lenses

Each is a defect class this repo has actually shipped. That is the point: they
are cheap to look for *once named*, and expensive to notice otherwise.

| Lens | The shape |
|---|---|
| `declared-not-enforced` | A limit is expressed and nothing reads it on a path that can refuse. `effectivePreset` — correct lattice, unit-tested, zero non-test consumers. |
| `measured-not-used` | A quantity is computed and nothing acts on it. Real token counts arrive every response, are displayed, and never reach the estimator that drives every budget decision. |
| `guarded-not-reachable` | A correct guard whose precondition is never satisfied. `assertCompletionReceipt` no-ops without a bound `DriveRun`, and nothing persists one. |
| `tested-not-used-path` | The suite covers a configuration production doesn't use. Both wave tests pass `syncComplete: true`; the only real caller passes `false`. |
| `claimed-not-shipped` | Docs assert present-tense behaviour the code lacks. |

### Two design rules worth keeping

**Verification is the load-bearing phase, not a formality.** Every candidate
goes to an independent agent asked to *refute* it, defaulting to refuted when
uncertain. On the run that produced this workflow, 10 of 34 candidates were
refuted — a false correction pushed into a doc whose argument is "check this
yourself" costs more than a missed one. Watch `refutationRate` in the output: a
very low rate usually means the verifiers are rubber-stamping, not that the
audit was unusually good. Judging that means reading `refuted`, which carries
every rejected candidate with the verifier's reasoning — a rate on its own is
not evidence of anything.

**Every confirmed finding carries `blocks`.** That field names the artifact
which would stop the defect recurring — a specific failing test, a CI gate, a
type change that makes it unrepresentable. "Document it" and "remember to check"
are rejected, because a workflow that terminates in a report is itself a
declared control with no enforcement consumer: the exact defect it exists to
find. If a run ends without anything landing, the run did nothing.

### Reading the output

`triage` answers three questions directly: which single item most reduces the
chance the rest recur, which findings share a root cause and should land as one
change, and **what the audit did not look at** — the last one matters most,
because a green run invites the assumption that it covered everything.

`confirmed` and `refuted` are both present on every run, so a consumer never
has to branch on the shape. A run with nothing confirmed returns no `triage` —
there is nothing to order — and distinguishes the two ways that happens: no
candidate survived verification (read `refuted`), versus no candidate was ever
raised (a result about scope, not a clean bill of health).
