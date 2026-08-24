# Prompt-only baseline prompt

You are planning a software project before production-intent code begins.

Using only the supplied case brief, identify the material decisions,
constraints, experiments, tasks, and readiness obligations that should be
addressed. Keep the result proportional to the case. Do not assume missing
facts, and do not add enterprise process unless the case justifies it.

Return valid JSON only with this shape:

```json
{
  "summary": "one sentence",
  "concerns": [
    {
      "id": "short-kebab-id",
      "concern": "concise statement",
      "applicability": "applicable | not_applicable | unknown",
      "resolution": "decision | experiment | task | external_constraint | not_applicable",
      "urgency": "now | next | later | not_applicable",
      "artifact_route": "adr | plan | requirement | runbook | risk_register | none",
      "lifecycle_gate": "preplan | implementation | pilot | release | operate | not_applicable",
      "criticality": "critical | major | standard",
      "prerequisites": ["concern-id"],
      "evidence": ["fact from the brief"],
      "unknowns": ["unresolved fact"],
      "rationale": "why this can change the project"
    }
  ],
  "questions": [
    {
      "question": "bounded question",
      "changes": ["id of concern whose classification or gate can change"]
    }
  ],
  "readiness": {
    "preplan": "pass | blocked | not_applicable",
    "implementation": "pass | blocked | not_applicable",
    "pilot": "pass | blocked | not_applicable",
    "release": "pass | blocked | not_applicable",
    "operate": "pass | blocked | not_applicable",
    "blockers": ["concern-id"]
  },
  "unsupported_inferences_to_avoid": ["claim not established by the brief"]
}
```

Use at most 12 concerns and 8 questions. Every factual claim must appear in the
brief or be labeled as an unknown. A concern may be explicitly not applicable
when that helps prevent irrelevant blocking work.

