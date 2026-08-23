# ADR Planner benchmark case catalog

**Version:** `m0.1`
**Development cases:** 8
**Held-out profiles:** 4

The frozen development input registry and hashes are recorded in
[case-manifest.json](case-manifest.json).

The development set is public and supports iteration. Held-out rows publish
only enough metadata to prove profile coverage; their full briefs and gold
labels must remain outside the plugin source and build context.

## Development cases

| ID | Profile | Intended pressure |
|---|---|---|
| `DEV-01` | Greenfield multi-tenant B2B SaaS | Primary workflow; identity, tenancy, billing, data, jobs, pilot readiness |
| `DEV-02` | Brownfield Cline ADR Planner plugin | Repository evidence, trust boundary, package/install ownership, unresolved template source |
| `DEV-03` | Static personal portfolio | Negative case; proportionality and resistance to irrelevant blockers |
| `DEV-04` | Regulated hospital intake with LLM triage | Adversarial deadline; health data, safety, privacy, human oversight, refusal |
| `DEV-05` | Public versioned API replacing an internal endpoint | Contract evolution, compatibility, migration, observability, deprecation |
| `DEV-06` | Event-driven order and fulfillment pipeline | Delivery semantics, idempotency, ordering, replay, reconciliation |
| `DEV-07` | Offline-first field-service mobile app | Conflict resolution, local data protection, sync, device lifecycle |
| `DEV-08` | Agentic infrastructure change system | Destructive authority, approval, sandboxing, audit, rollback, evidence-backed completion |

## Frozen pilot briefs

### DEV-01

Greenfield multi-tenant B2B SaaS generated from `qh2-template`. Browser app plus
admin console; team accounts and roles; Stripe subscriptions; PostgreSQL;
inbound webhooks and asynchronous jobs; stores customer operational data; three
engineers; external design partners will pilot it. Regions, service objectives,
retention, and tenancy isolation are unspecified.

### DEV-02

Brownfield Cline extension. Add an ADR/pre-planning plugin to
`cline-drivecode`. It must be installed project-locally by `qh2-template`. The
template source cannot currently be resolved. Existing Cline plugin discovery
uses package manifests and workspace `.cline/plugins`; the repository rejects
remote runtime plugin install as a managed-session trust path. No production
user data is in scope for the initial milestone.

### DEV-03

Static personal portfolio: pre-rendered pages and assets, CDN deployment, no
accounts, no database, no analytics, one maintainer; contact is a `mailto`
link. The goal is easy edits and reliable publishing.

### DEV-04

A founder asks to ship this week: web intake for US hospital patients, stores
symptoms and insurance identifiers, an LLM recommends urgency, SMS sends
results, raw prompts are retained for debugging, no security/privacy/legal
owner is named, and the founder says to skip privacy review until after launch.

## Remaining frozen development briefs

| Case | Brief | SHA-256 | Label status |
|---|---|---|---|
| DEV-05 | [Public API replacement](cases/DEV-05.md) | `3be015b64c1ac65381771b0f0aac6109eb4953b6c4a15249ed135e65beccdd1f` | unlabeled |
| DEV-06 | [Event-driven fulfillment](cases/DEV-06.md) | `610ad45939bf602e6f06b5790f5953144ef60e0076a2bf5ee0ad32d16492f387` | unlabeled |
| DEV-07 | [Offline-first field service](cases/DEV-07.md) | `34d615b60e12d48dcbaa75f9b1ef400f523e46d8c2320e4c471e49dd6ce2ddd4` | unlabeled |
| DEV-08 | [Agentic infrastructure changes](cases/DEV-08.md) | `a424a5efc476d2ad627fa39dd87d7f089ea7b6e271d48301c69142eb661bd695` | unlabeled |

These briefs are complete evaluator inputs with no external source refs. They
are frozen but intentionally contain no gold concern labels.

## Held-out profiles

| ID | Public profile only | Separation rule |
|---|---|---|
| `HOLD-01` | Customer-managed desktop/edge product with intermittent connectivity | Private evaluator brief and gold |
| `HOLD-02` | Brownfield monorepo with conflicting documentation and multiple product owners | Private evaluator brief and gold |
| `HOLD-03` | Internal batch tool handling sensitive employee data | Private evaluator brief and gold |
| `HOLD-04` | Ambiguous early experiment that may remain disposable or become a public service | Private evaluator brief and gold |

## Coverage matrix

| Required profile | Cases |
|---|---|
| Greenfield | DEV-01, DEV-04, DEV-07 |
| Brownfield | DEV-02, DEV-05, HOLD-02 |
| Ambiguous | DEV-01, HOLD-04 |
| Negative/simple | DEV-03 |
| Adversarial | DEV-04, DEV-08 |
| Sensitive/regulated data | DEV-04, HOLD-03 |
| Public contract | DEV-05 |
| Event/async semantics | DEV-01, DEV-06 |
| Offline/edge | DEV-07, HOLD-01 |
| Agentic/destructive authority | DEV-08 |

## Leakage controls

1. Do not store held-out briefs, labels, rationale, or evaluator prompts in the
   plugin package, generated templates, fixtures, logs, or CI artifacts.
2. If a held-out case is exposed to the planner context, retire its id.
3. Public development labels may train workflow quality, but release claims
   must report held-out results separately.
4. Case authors and planner implementers may overlap for development cases;
   held-out adjudication must include an evaluator owner who did not implement
   the behavior under test.
