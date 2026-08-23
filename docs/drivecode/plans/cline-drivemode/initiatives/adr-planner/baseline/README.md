# Prompt-only baseline

**Status:** captured and validated; owner-adjudicated scoring pending
**Baseline id:** `prompt-only-m0.1`
**Date:** 2026-08-14
**Model:** `gpt-5.6-terra`
**Reasoning:** `medium`
**Service tier:** `priority`
**Runs:** three fresh isolated runs per case

## Frozen inputs

| Input | SHA-256 |
|---|---|
| [prompt.md](prompt.md) | `cbf5194086b3afcd08d13f5a94546fd84b2b0c7b8556795a97108a94e92af9b8` |
| [DEV-01](cases/DEV-01.md) | `4bcfd219cf05228038eb77606e1fbb88f389ecb9e963ebd18371f10b18d56f08` |
| [DEV-02](cases/DEV-02.md) | `0cdd37ebfd835fb8a8224ebb94c11838e38528684f5af7c904de8d1bdc25d525` |
| [DEV-03](cases/DEV-03.md) | `a1aa29ba3b8c1be32bfaae6ab692b4f898ea5416623ac3fed9b1049e3852a0d7` |
| [DEV-04](cases/DEV-04.md) | `1705ec20472998d14a5bcac6fbecdd218d3e201ddd81667063a5ef287a0ca7c9` |

## Isolation controls

- Each run starts in a new agent thread with no parent context.
- The runner receives only the frozen prompt body and one case brief.
- The runner cannot read repository files or use tools.
- No concern catalog, examples, reviewer labels, proposed gold, or earlier run
  is in the runner context.
- All runs use the same explicit model and reasoning setting.
- Raw output is preserved before normalization or scoring.

## Run registry

| Case | Run | Agent id | Raw output | Parse |
|---|---:|---|---|---|
| DEV-01 | 1 | `01a0018f-937f-7bf2-a853-c468cc225e35` | [JSON](runs/DEV-01-run-1.json) | valid JSON; one invalid enum used three times |
| DEV-01 | 2 | `01a00191-003f-7933-8184-65e23abd3762` | [JSON](runs/DEV-01-run-2.json) | valid |
| DEV-01 | 3 | `01a00192-7aec-7b12-84dd-bbc4a31f1618` | [JSON](runs/DEV-01-run-3.json) | valid |
| DEV-02 | 1 | `01a0018f-939e-7a33-9cbd-a126e585f900` | [JSON](runs/DEV-02-run-1.json) | valid |
| DEV-02 | 2 | `01a00191-005f-70a2-b0af-df9e8fe3d90e` | [JSON](runs/DEV-02-run-2.json) | valid |
| DEV-02 | 3 | `01a00192-7b0d-70f0-b3ca-1a2394638abc` | [JSON](runs/DEV-02-run-3.json) | valid |
| DEV-03 | 1 | `01a0018f-93be-79f3-8e51-8bd8ab0118a5` | [JSON](runs/DEV-03-run-1.json) | valid |
| DEV-03 | 2 | `01a00191-008e-74f0-9888-8b4c83c0df44` | [JSON](runs/DEV-03-run-2.json) | valid |
| DEV-03 | 3 | `01a00192-7b3e-73f0-bc62-68e019c9108a` | [JSON](runs/DEV-03-run-3.json) | valid |
| DEV-04 | 1 | `01a0018f-93f0-7a83-81b8-2d124b9b2fec` | [JSON](runs/DEV-04-run-1.json) | valid |
| DEV-04 | 2 | `01a00191-00b3-7a93-abe7-a31da904915c` | [JSON](runs/DEV-04-run-2.json) | valid |
| DEV-04 | 3 | `01a00192-7b67-7c20-b573-e64e69c9939b` | [JSON](runs/DEV-04-run-3.json) | valid |

## Results

- [Run manifest](run-manifest.json) records the model controls and input/output
  hashes.
- [Analysis method](analysis-method.md) defines structural validation and
  normalization without silently repairing raw evidence.
- [Normalization map](normalization.json) records the proposed semantic
  matching used for stability analysis.
- [Results](results.md) reports structural behavior, semantic stability,
  systematic omissions, classification variance, and derived requirements.

Gold-relative precision, recall, routing, and dependency scores remain
provisional until the benchmark owner accepts or changes the concern split and
match map in the labeling pilot.

## Reproduction

1. Verify prompt and case hashes.
2. Start a fresh model session for each run with no prior context.
3. Send the prompt body followed by `CASE BRIEF:` and the case body.
4. Preserve the response bytes before repair.
5. Validate JSON, then normalize concern semantics without seeing another run.
6. Calculate stability before comparing with proposed gold.
