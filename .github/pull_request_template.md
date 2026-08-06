<!--
Thank you for contributing to Cline!

⚠️ Important: Before submitting this PR, please ensure you have:
- For feature requests: Created a discussion in our Feature Requests discussions board https://github.com/cline/cline/discussions/categories/feature-requests and received approval from core maintainers before implementation
- For all changes: Link the associated issue/discussion in the "Related Issue" section below

Limited exceptions:
Small bug fixes, typo corrections, minor wording improvements, or simple type fixes that don't change functionality may be submitted directly without prior discussion.

Why this requirement?
We deeply appreciate all community contributions - they are essential to Cline's success! To ensure the best use of everyone's time and maintain project direction, we use our Feature Requests discussions board to gauge community interest and validate feature ideas before implementation begins. This helps us focus development efforts on features that will benefit the most users.
-->

### Related Issue

<!-- Replace XXXX with the issue number that this PR addresses -->
**Issue:** #XXXX

### Description

<!-- 
Help reviewers understand your changes by making this PR readable and well-organized:

- What problem does this PR solve?
- Why were these changes introduced and what purpose do they serve?
- For larger changes, provide context about your approach and reasoning

Small PRs may need minimal description, but larger changes benefit from explaining where you're coming from. Much of this context can be in the linked issue above, so feel free to reference it rather than repeating everything here.
-->

### Test Procedure

<!-- 
Please walk us through your testing approach and thought process. This helps reviewers understand that you've thoroughly considered the impact of your changes:

- How did you test this change?
- What could potentially break and how did you verify it doesn't?
- What existing functionality might be affected and how did you check it still works?
- Why are you confident this is ready for merge?

We're not looking for exhaustive documentation - just evidence that you've thought through the implications of your changes and tested accordingly.
-->

**Done claim (ADR-0026)** — required:

- `claim:<id>`: … *(or `no-claim-effect` with one-line reason)*
- Status delta: … *(e.g. `active_partial` → same / → `verified_shipped`)*
- Evidence command(s) run: …

**Fix-class matrix** — required when Type of Change includes Bug fix:

- [ ] Matrix filled (`docs/drivecode/plans/cline-drivemode/delivery/templates/fix-class-matrix.md`) **or** N/A with reason: …

### Type of Change

<!-- Put an 'x' in all boxes that apply -->

-   [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
-   [ ] ✨ New feature (non-breaking change which adds functionality)
-   [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
-   [ ] ♻️ Refactor Changes
-   [ ] 💅 Cosmetic Changes
-   [ ] 📚 Documentation update
-   [ ] 🏃 Workflow Changes
-   [ ] 🖼️ UI / UX change (visual, layout, interaction, or copy in a user-facing surface)

### CI overrides (usually leave blank)

Path filters already choose Drive / VS Code / SDK / docs suites from the files you touched.
Only check these if you need a suite paths will miss, or a fuller e2e matrix.
A bot syncs checked boxes to `ci/*` labels; see `docs/drivecode/CI.md`.
Checked boxes that path filters already cover are **not** re-run by the override companion.

-   [ ] `ci/drive` — force Drive Mode gate (hub + drive kernel + demo + CLI)
-   [ ] `ci/vscode` — force VS Code unit/integration (Ubuntu on PRs; Windows on main / force call)
-   [ ] `ci/e2e` — force Playwright e2e (ubuntu)
-   [ ] `ci/e2e-full` — force e2e on ubuntu + windows + macos
-   [ ] `ci/sdk` — force SDK / CLI test suite (Ubuntu on PRs; Windows on main / force call)
-   [ ] `ci/docs` — force docs link check

JetBrains integration: comment `/test-jetbrains` (maintainers only).

### Pre-flight Checklist

<!-- Put an 'x' in all boxes that apply -->

-   [ ] Changes are limited to a single feature, bugfix or chore (split larger changes into separate PRs)
-   [ ] Tests are passing (`bun test`) and code is formatted and linted (`bun run format && bun run lint`)
-   [ ] I have reviewed [contributor guidelines](https://github.com/cline/cline/blob/main/CONTRIBUTING.md)
-   [ ] **Visual evidence is in this PR body** (not only linked elsewhere): screenshots, diagrams, interactive demos, and/or video when the change is visual, architectural, or demoable — see section below

### Screenshots / Diagrams / Demos (in this PR body)

<!--
Put visual evidence IN THE DRAFT PR BODY below — reviewers should not need to
check out the branch or hunt through commits to see what changed.

REQUIRED when any of these apply:
- UI / UX changes (webview, Hub / Drive, desktop, CLI TUI chrome, settings, empty states, dialogs)
- New or updated diagrams (architecture, sequence, Mermaid, canvases)
- Interactive demos / wireframes / presenter click-throughs (HTML demos, Storybook, etc.)
- Brand / logo / motion / design-token visual changes

Also preferred (not skipped lightly) for docs PRs whose main deliverable is a
demo, wireframe, or diagram — embed a still + link the runnable file.

Not required for pure backend, SDK-only, or CI/workflow changes with no visible
or diagrammable surface.

How to attach:
1. Embed images/videos directly in this section (markdown / HTML, or drag-and-drop
   into the GitHub PR description). Do not rely on “see branch” alone.
2. For interactive demos, include at least one screenshot (or short recording) in
   the body AND a repo-relative path / how-to-open line for the live file.
3. For diagrams, paste the rendered image or Mermaid source in the body.
4. Caption each asset so a reviewer knows what to look for.
-->

**Does this PR need visual evidence in the body?**

-   [ ] No — no UI, diagram, or demo surface; skip the media below
-   [ ] Yes — complete the checklist and embed media **in this PR body**

**Visual evidence checklist** (required if Yes):

-   [ ] Screenshot(s) and/or diagram(s) embedded below *(or N/A with reason)*
-   [ ] Interactive demo: still frame in body + path / open instructions *(or N/A)*
-   [ ] Video for multi-step / interactive flows *(or N/A)*
-   [ ] Before / after for visual regressions *(or N/A for net-new)*
-   [ ] Each asset has a one-line caption

#### Screenshots / diagrams

<!-- Embed stills and diagrams here (not only links). Write N/A if not applicable. -->

#### Interactive demo

<!--
Embed a representative screenshot of the demo, then link the runnable file with
open instructions (e.g. open docs/.../foo-demo.html in a browser). Write N/A if
this PR has no interactive demo.
-->

#### Video / walkthrough

<!-- Embed a screen recording for multi-step flows, autoplay demos, or state changes. Write N/A if not applicable. -->

### Additional Notes

<!-- Add any additional notes for reviewers -->
