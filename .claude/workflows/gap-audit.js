export const meta = {
  name: 'gap-audit',
  description: 'Find where this repo claims a capability it does not have, verify adversarially, and emit work that blocks',
  whenToUse:
    'Run after a batch of merges, before a release, or when deciding what to build next. Answers "where does stated capability exceed real functionality" and returns a ranked, verified, actionable list — not a report. Pass {since: "<git-ref>"} to audit only what changed.',
  phases: [
    { title: 'Scope', detail: 'what changed, and which surfaces it touched' },
    { title: 'Audit', detail: 'one agent per defect lens over that surface' },
    { title: 'Verify', detail: 'adversarially refute every candidate; default to refuted' },
    { title: 'Triage', detail: 'dedupe, rank, and name the blocking artifact for each' },
  ],
}

/*
 * WHY THIS EXISTS
 *
 * ADR-0025: a declared limit with no enforcement-path consumer is a defect
 * class. This workflow applies that lens to the product, repeatably.
 *
 * It is itself subject to the same rule. A run that ends in a document is a
 * declared control with no enforcement consumer — the exact thing it looks
 * for. So every confirmed finding must carry a `blocks` field naming the
 * artifact that would stop the defect recurring: a failing test, a CI gate, a
 * type that makes it unrepresentable. A finding whose only remedy is "someone
 * should remember" is downgraded, because that remedy has already failed.
 *
 * The five lenses are not generic code review. Each is a defect class this
 * repo has actually shipped, and each is cheap to look for once named.
 */

const LENSES = {
  'declared-not-enforced': `A type, schema field, config key, or constant expresses a LIMIT (a ceiling, a permission, an isolation mode, a claim, a budget) and NOTHING reads it on a path that can refuse an action.
Method: find the declaration, then grep every reference. Test-only references do not count. A value that reaches a UI label but never a refusal does not count.
Known shape: \`effectivePreset\` is computed, capped by a correct lattice, unit-tested, and had zero non-test consumers for months.`,

  'measured-not-used': `A quantity is computed, parsed, or received from an external system and NOTHING acts on it. Displaying it to a human does not count as acting on it.
Method: find where the number is produced, then follow it. Does any branch, threshold, or decision read it?
Known shape: real \`inputTokens\` come back on every model response, are parsed, and are rendered in the status bar — while every budget decision runs off an uncalibrated \`CHARS_PER_TOKEN = 3\` estimate that is never compared against them.`,

  'guarded-not-reachable': `A guard, assertion, or validation exists and is CORRECT, but the code path that would invoke it is never taken — usually because a precondition it depends on is never satisfied.
Method: find guards that early-return or no-op on a missing input, then check whether anything ever supplies that input.
Known shape: \`assertCompletionReceipt\` correctly refuses to archive without verifier evidence, and returns immediately when no \`DriveRun\` is bound — and nothing in the repo persists a \`DriveRun\`, so it has never once run.`,

  'tested-not-used-path': `A test suite covers a configuration or code path that PRODUCTION DOES NOT USE, while the path production does use is untested. The suite is green and proves nothing.
Method: for each test, find the flag/mode/fixture it sets, then find the non-test callers. Do they pass the same value?
Known shape: both \`drive.wave.run\` tests pass \`syncComplete: true\`, which skips the execution block entirely; the only non-test caller hardcodes \`false\`. The untested branch reported success for work it never ran.`,

  'claimed-not-shipped': `Documentation, a README, a status board, or a code comment asserts present-tense behaviour the code does not have.
Method: treat every present-tense factual claim as a hypothesis and check it. Aspirational and clearly-labelled-future statements are NOT findings. Wording preferences are NOT findings.
Known shape: a reference doc described the room plane as an ephemeral Map that a hub restart ends, while a durable append-only log and a fold-on-rehydrate path had shipped.`,
}

const CANDIDATES = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'the declared/measured/guarded thing, by name' },
          file: { type: 'string' },
          line: { type: 'number' },
          gap: { type: 'string', description: 'what is claimed vs what is true' },
          evidence: { type: 'string', description: 'source path:line that proves it' },
          blastRadius: {
            type: 'string',
            enum: ['security', 'correctness', 'cost', 'clarity'],
          },
        },
        required: ['subject', 'file', 'gap', 'evidence', 'blastRadius'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    why: { type: 'string' },
    blocks: {
      type: 'string',
      description:
        'If real: the artifact that would stop this recurring — a specific failing test, CI gate, or type change. "Document it" or "remember to" is not an answer.',
    },
    effort: { type: 'string', enum: ['one-line', 'contained', 'design-needed'] },
  },
  required: ['refuted', 'why'],
}

const since = (args && args.since) || 'HEAD~20'
const lensKeys = (args && args.lenses) || Object.keys(LENSES)
const verifyTop = (args && args.verifyTop) || 2

phase('Scope')

const scope = await agent(
  `In this repo, summarise what changed since \`${since}\`.\n` +
    `Run: git log --oneline ${since}..HEAD  and  git diff --stat ${since}..HEAD\n\n` +
    `Return a compact brief naming: the packages and directories touched, any exported type or schema that changed, any new config key or feature flag, and any doc that was edited. ` +
    `This scopes an audit, so bias toward listing surfaces rather than describing commits. Under 300 words.`,
  { label: 'scope', phase: 'Scope' },
)

log(`scope established against ${since}`)

phase('Audit')

const results = await pipeline(
  lensKeys,
  (lens) =>
    agent(
      `You are auditing a repo for ONE defect class. Do not report generic code smells, style, or design opinions — only this class.\n\n` +
        `## The lens: ${lens}\n${LENSES[lens]}\n\n` +
        `## Where to look\n${scope}\n\n` +
        `Prioritise surfaces named above, but follow the lens wherever it leads — a gap introduced last month is as real as one introduced yesterday.\n\n` +
        `Report at most 6 findings, most consequential first. For each you must be able to point at the specific line that proves the gap. If you cannot prove it, do not report it. Returning zero findings is a valid and useful result.`,
      { label: `lens:${lens}`, phase: 'Audit', schema: CANDIDATES },
    ),
  (res, lens) => {
    const found = res?.findings ?? []
    log(`${lens}: ${found.length} candidates`)
    if (found.length === 0) return []
    if (found.length > verifyTop) {
      log(`${lens}: verifying top ${verifyTop} of ${found.length} — ${found.length - verifyTop} not carried forward`)
    }
    return parallel(
      found.slice(0, verifyTop).map((f) => () =>
        agent(
          `Try to REFUTE this claimed defect. Default to refuted=true when uncertain.\n\n` +
            `A false finding that reaches a PR is more expensive than a missed one: it burns reviewer trust and, in docs, corrupts a claim that was correct. Refute if the code actually does the thing, if the cited evidence does not say what the auditor claims, if the "gap" is aspirational or clearly-labelled future work, or if it is a wording preference.\n\n` +
            `Lens: ${lens}\nSubject: ${f.subject}\nAt: ${f.file}${f.line ? ':' + f.line : ''}\nClaimed gap: ${f.gap}\nAuditor's evidence: ${f.evidence}\n\n` +
            `Open the files yourself. Do not reason from the summary above.\n\n` +
            `If it survives, set refuted=false and fill \`blocks\`: name the concrete artifact that would stop this recurring — a specific test with its assertion, a CI check, or a type change that makes the defect unrepresentable. "Add documentation" and "be careful in review" are not valid answers; if that is genuinely the only remedy, say so in \`why\` and still set \`blocks\` to the closest mechanical check available.`,
          { label: `refute:${f.subject}`.slice(0, 48), phase: 'Verify', schema: VERDICT },
        ).then((v) => ({ ...f, lens, verdict: v })),
      ),
    )
  },
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter((f) => f.verdict && f.verdict.refuted === false)
const refutedCount = all.length - confirmed.length

log(`${all.length} verified, ${confirmed.length} confirmed, ${refutedCount} refuted`)

if (confirmed.length === 0) {
  return {
    since,
    confirmed: [],
    refutedCount,
    note: 'No gaps survived verification. Either the surface is clean or the lenses need widening — check the refutation reasons before concluding the former.',
  }
}

phase('Triage')

const ranked = await agent(
  `Here are verified gaps between what this repo claims and what it does. Produce an execution order.\n\n` +
    JSON.stringify(
      confirmed.map((f) => ({
        lens: f.lens,
        subject: f.subject,
        at: `${f.file}${f.line ? ':' + f.line : ''}`,
        gap: f.gap,
        blastRadius: f.blastRadius,
        blocks: f.verdict.blocks,
        effort: f.verdict.effort,
      })),
      null,
      1,
    ) +
    `\n\nRank them. Weight by: is it live-wrong now versus merely absent (live-wrong first); blast radius (security > correctness > cost > clarity); and whether fixing it also prevents a class rather than an instance — a change that makes the defect unrepresentable outranks several one-line fixes.\n\n` +
    `Then answer three things plainly:\n` +
    `1. Which ONE item, done first, most reduces the chance the rest recur? Name it and say why.\n` +
    `2. Which items share a root cause and should land as one change rather than several?\n` +
    `3. What did this audit NOT look at that a reader might wrongly assume it covered?\n\n` +
    `Be concrete and short. This output is read before work starts, not filed.`,
  { label: 'triage', phase: 'Triage' },
)

return {
  since,
  confirmedCount: confirmed.length,
  refutedCount,
  refutationRate: `${Math.round((refutedCount / Math.max(1, all.length)) * 100)}%`,
  triage: ranked,
  confirmed: confirmed.map((f) => ({
    lens: f.lens,
    subject: f.subject,
    at: `${f.file}${f.line ? ':' + f.line : ''}`,
    gap: f.gap,
    evidence: f.evidence,
    blastRadius: f.blastRadius,
    blocks: f.verdict.blocks,
    effort: f.verdict.effort,
  })),
}
