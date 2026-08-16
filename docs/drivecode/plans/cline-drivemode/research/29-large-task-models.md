# 29 · Large Task Models — next-action prediction as a training objective

**Status.** Research — conceptual groundwork and prior-art survey. No decision
authority. Product truth is [ADR-0036](../adr/ADR-0036-next-action-triad.md);
harness boundary is [09-next-task-proposer](../../drivecode-sdk/delivery/09-next-task-proposer.md).  
**Related.** [16-task-as-unit-models](16-task-as-unit-models.md) (the thesis this
extends), [21-operator-experience](21-operator-experience.md) (the gap it
serves), [15-task-satisfaction-observability](15-task-satisfaction-observability.md).

## Thesis

[16](16-task-as-unit-models.md) argued that Drive's unit of measurement should be
the task, not the token, and left a learned proposer as optional research. This
note takes the next step and asks what such a proposer would actually be trained
on.

The claim: **language modeling worked because text is abundant and
self-labeling — the next word is its own label. Actions are self-labeling too.**
Whatever the operator did next is the ground truth. What is missing is not an
objective or an architecture; it is a recorder. [PRD 11](../prd/prd-magic-hotkey.md)
is that recorder.

The recording format is the whole trick, and it is where this diverges from the
literature: not screen video, but a **structured event stream**. Events are the
tokens; the event log is the corpus. Concretely, the objective is next-event
prediction one abstraction above next-token:

```text
context = events[t-k .. t] + rolling_summary(events[.. t-k])
output  = P(action | context),  action = (verb, args), verb in whitelist + do_nothing
```

## The part that is actually novel

Nearly all published action-model work is **goal-conditioned**: a human states a
goal and the model emits steps. It answers "how do I do X?"

What [PRD 11](../prd/prd-magic-hotkey.md) records is **goal-free**: no
instruction, no prompt, infer intent from ambient context alone. It answers "what
were you about to do?" That is closer to next-token pretraining than to
instruction following, and it is the underexplored quadrant. It is also the
quadrant a single product can occupy, because it needs no benchmark harness — the
operator's next press is the label.

## Prior art

Useful as validation and as a parts bin. All of it is goal-conditioned, and
nearly all of it is pixel-based.

| Work | What it is | What is worth taking |
|---|---|---|
| OpenCUA | Open recipe plus a dataset for computer-use agents; tooling that records human desktop trajectories | The closest existing "train your own" playbook, and its trajectory-recorder design |
| UI-R1 | RL with rule-based rewards to improve action prediction in small GUI models | Evidence that small models plus small datasets plus RL work for action prediction |
| GUI-R1 | R1-style vision-language-action model for GUI agents | Reward design for action correctness |
| TongUI | GUI trajectories mined at internet scale from web tutorials | Cheap trajectory augmentation if this ever generalizes past one operator |
| OSWorld | The benchmark computer-use agents are graded on | Eval discipline, and a reality check on how hard full autonomy still is |
| GUI Agents: A Survey | Map of the field | Citations and vocabulary |

Adjacent by name: Rabbit's LAM, Microsoft's Large Action Model work, Salesforce's
xLAM for function calling, and the frontier computer-use agents. The ancestor is
Interlisp's DWIM, which is fifty years old and had the interaction right before
anyone could build the model.

**Positioning.** Pixel models exist largely because researchers cannot instrument
software they do not own. This product instruments itself, so it gets symbolic
events instead of screenshots — better data at a fraction of the cost, over a
comically smaller vocabulary. That is precisely why it is tractable here and not
a research program.

## Three shapes, ascending in cost

- **A. Prompted planner, no training.** A capable model plus a good context view
  plus structured output is already a working next-action predictor. This is what
  [PRD 11](../prd/prd-magic-hotkey.md) ships, and it is simultaneously the
  teacher for anything later.
- **B. Fine-tuned small model.** LoRA over a small open model, trained on
  structured-event context. With a closed vocabulary this is closer to
  classification than generation, which is why a small model suffices. This is
  the only shape this note actually targets.
- **C. Full vision-language action model.** Screenshots in, coordinates out — the
  OpenCUA shape. Out of scope, and named here only so shape B is not designed in
  a way that forecloses it.

Shape B is a *small* task model. The name is aspirational until the loop is
measured.

## Why the third button matters

The interesting property of [PRD 11](../prd/prd-magic-hotkey.md) is that three
keys produce five distinguishable label strengths at no extra cost to the
operator:

| Signal | Meaning | Training use |
|---|---|---|
| DO, not reverted | Strongly correct | Positive example |
| DO, then UNDO | Strongly wrong, and it cost an execution | Rejected, heavyweight |
| SKIP | Explicitly wrong, zero execution cost | Rejected, cheap and abundant |
| SKIP then DO | Ranking *within one candidate set* | Preference pair, same state |
| No response | Ambiguous — busy, away, or content | Calibration only |

The fourth row is the valuable one. Because a skip chain resolves inside a single
candidate set, the chosen and rejected candidates share a context exactly, which
is the shape preference tuning wants and is normally expensive to obtain. Before
SKIP existed, rejection was unattributable silence.

Put plainly: **SKIP is a preference labeler the operator drives on purpose, and
UNDO is one they drive by accident.**

## Constraints this note does not get to relax

Everything above is subordinate to decisions already made elsewhere. Restated so
this note cannot be read as permission:

- **Privacy is not negotiable for training convenience.**
  [ADR-0004](../adr/ADR-0004-gated-learn-privacy.md) governs the corpus: ids,
  hashes, paths, verb names, and outcomes — never prose, file contents, or
  utterances. [16](16-task-as-unit-models.md) already lists "retention creep for
  training data" as a named risk with "local rollups; gated evidence; no
  utterance store" as the mitigation. That mitigation binds here.
- **Passive observation is rejected**
  ([ADR-0036](../adr/ADR-0036-next-action-triad.md) decision 10). It is the
  highest-volume signal in the literature and the reason this whole design is one
  bad decision away from a keylogger. Excluding it costs an order of magnitude of
  data and is correct anyway.
- **A learned proposer only ever proposes.** 09 rule 3 puts any scorer
  out-of-process or host-side; rule 1 keeps the bank cursor deterministic. A
  student model never becomes the cursor and never holds a tier its teacher did
  not.
- **No training run is a product surface.** Nothing here implies a shipped
  trainer, a hosted corpus, or a second runtime.

## Staged plan

Stages are keyed to [PRD 11](../prd/prd-magic-hotkey.md) milestones, not
calendar.

| Stage | Gate | What happens | Exit |
|---|---|---|---|
| 0 | M0 | Prompted planner is the teacher. Offers and presses accumulate as `predict.*` events. Distillation is a side effect of use | Corpus grows during ordinary work |
| 1 | after M3 | Supervised fine-tune on (context window, accepted action) pairs, emitted in the same structured shape the planner returns | Student top-1 within a stated margin of teacher on replay |
| 2 | after stage 1 | Preference tuning from skip chains (primary) and undo pairs (secondary) | Kept-rate flat or better in a silent shadow comparison |
| 3 | optional | Rule-based RL, only if stages 1 and 2 plateau and the result still justifies the cost | Publishable either way |

Throughout stage 1 onward, a student may predict silently alongside the teacher
on every context view. That is free comparison data at no risk, since nothing the
student proposes reaches the gate.

## Eval

- **Replay accuracy.** Held-out log segments, top-1 and top-3 against what the
  operator actually did. This is the honest benchmark.
- **Calibration.** Among candidates offered at a given confidence, is the kept
  fraction close to it? This matters because the policy gate keys off confidence.
- **Rank quality.** Candidate 1 should absorb most DOs. Deep skip-depth means the
  model knows the right actions and orders them badly, which is a prompting or
  preference-tuning problem rather than a capability gap.
- **Per-verb breakdown.** Localizes where prediction is smart, and which
  playbooks need editing rather than which model needs retraining.
- **Graduation.** A student replaces the teacher for speculation only when replay
  accuracy is within a stated margin, local latency beats the teacher, and
  kept-rate does not regress in shadow. Even then it proposes; the gate still
  disposes.

## Honest doubts

- **Goal-free context may not carry enough signal.** Operators multitask, and
  sometimes there is no predictable next action. Mitigations: `do_nothing` as a
  first-class prediction, a confidence floor, and measuring rather than assuming.
- **A personal model is not a product.** It overfits to one operator. For
  autocomplete of one's own habits that is a feature; shipping it to others means
  many flywheels and serious privacy engineering. The near-term job is to prove
  the loop, not the market.
- **Vocabulary granularity is the real design decision.** Semantic verbs in the
  tens keep this small, event-shaped, and trainable by one person. Keystroke or
  coordinate actions rebuild OpenCUA. Stay semantic until forced otherwise.
- **The event ontology is the same decision, input-side.** Too coarse loses
  intent; too fine is noise with a privacy bill. Start narrow and let skip
  statistics reveal where the log lacks resolution.
- **Kept-rate is the only truth.** "Next best action" is unfalsifiable. Ship the
  metric, not the philosophy.

## Sources

- OpenCUA — open foundations for computer-use agents: https://github.com/xlang-ai/OpenCUA
- UI-R1 — RL for GUI action prediction: https://github.com/lll6gg/UI-R1 · https://huggingface.co/papers/2503.21620
- GUI-R1 — R1-style vision-language-action model: https://openreview.net/forum?id=pZQvv5C7WL
- TongUI — trajectories mined from web tutorials: https://github.com/TongUI-agent/TongUI-agent
- OSWorld benchmark: https://benchmarkingagents.com/osworld/
- GUI Agents: A Survey: https://arxiv.org/html/2412.13501v2

## References

- [ADR-0036](../adr/ADR-0036-next-action-triad.md), [PRD 11](../prd/prd-magic-hotkey.md)
- [16-task-as-unit-models](16-task-as-unit-models.md), [21-operator-experience](21-operator-experience.md)
- [09-next-task-proposer](../../drivecode-sdk/delivery/09-next-task-proposer.md)
- [ADR-0004](../adr/ADR-0004-gated-learn-privacy.md), [ADR-0015](../adr/ADR-0015-task-session-observability.md)
