#!/usr/bin/env python
"""PreToolUse guard: refuse `gh pr merge` on a PR that other open PRs stack on.

Why this exists (2026-08-08). Merging a parent PR with `gh pr merge
--delete-branch` deletes the branch its children use as their base. GitHub then
**auto-closes** every child, and a closed PR whose base branch no longer exists
can be neither reopened nor retargeted -- the work has to be rebased onto a new
base and reopened under a new number. That happened twice in one afternoon
(#221 and #222). The stacked-pull-requests skill already forbids `gh pr merge`
for stacks; nothing enforced it, so this hook does.

Contract: PreToolUse hooks read a JSON payload on stdin and block with exit 2,
with stderr shown to the agent. Any other exit code allows the call.

Failure policy is deliberately asymmetric:
  * block (exit 2) only on a *positive* finding -- children were listed
  * allow (exit 0) with a warning when gh is missing, times out, or errors
A guard that wedges every merge the moment gh rate-limits is worse than the gap
it closes.

Output stays ASCII: the Windows console codec (cp1252) raises on box-drawing
and arrows.
"""

import json
import re
import shutil
import subprocess
import sys

GH_TIMEOUT_S = 15

# `gh pr merge`, tolerating flags between words. `gh stack merge` must NOT match,
# which the explicit `pr` token guarantees. This can over-match a `gh pr merge`
# written inside a quoted string; blocking a mention is an acceptable trade for a
# guard this cheap to satisfy.
MERGE_RE = re.compile(r"\bgh\s+pr\s+merge\b")

# First bare token after `merge` that looks like a PR number or URL. Absent for
# `gh pr merge` on the current branch, which gh resolves itself.
TOKEN_RE = re.compile(r"\bgh\s+pr\s+merge\s+((?:https?://\S+)|\d+)")


def warn(message):
    sys.stderr.write("guard-pr-merge: %s\n" % message)


def gh_json(args):
    """Run gh and parse stdout as JSON. Returns None on any failure."""
    try:
        proc = subprocess.run(
            ["gh"] + args,
            capture_output=True,
            text=True,
            timeout=GH_TIMEOUT_S,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        warn("gh call failed (%s); allowing merge unchecked" % type(exc).__name__)
        return None
    if proc.returncode != 0:
        warn("gh exited %d; allowing merge unchecked" % proc.returncode)
        return None
    try:
        return json.loads(proc.stdout)
    except ValueError:
        warn("gh returned non-JSON; allowing merge unchecked")
        return None


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return 0

    # Defensive: the Bash tool carries the command at tool_input.command. Assumed
    # field paths have been a recurring source of silent hook bugs, so every step
    # degrades to "" rather than raising.
    tool_input = payload.get("tool_input") or {}
    command = tool_input.get("command") or ""
    if not isinstance(command, str) or not MERGE_RE.search(command):
        return 0

    if shutil.which("gh") is None:
        warn("gh not on PATH; allowing merge unchecked")
        return 0

    token_match = TOKEN_RE.search(command)
    view_args = ["pr", "view"]
    if token_match:
        view_args.append(token_match.group(1))
    view_args += ["--json", "number,headRefName,baseRefName"]

    target = gh_json(view_args)
    if not target:
        return 0

    head = target.get("headRefName")
    number = target.get("number")
    base = target.get("baseRefName") or "main"
    if not head:
        warn("could not resolve the PR head branch; allowing merge unchecked")
        return 0

    children = gh_json(
        ["pr", "list", "--state", "open", "--base", head, "--json", "number,title"]
    )
    if children is None:
        return 0
    if not children:
        return 0

    lines = [
        "",
        "BLOCKED: PR #%s is the base of %d open pull request(s)."
        % (number, len(children)),
    ]
    for child in children:
        lines.append(
            "  - #%s %s" % (child.get("number"), (child.get("title") or "")[:70])
        )
    lines += [
        "",
        "Merging it with `gh pr merge` deletes branch '%s', which GitHub uses" % head,
        "as those PRs' base. They will be auto-closed, and a closed PR whose base",
        "branch is gone cannot be reopened or retargeted -- it has to be rebased",
        "and reopened under a new number. This cost us #221 and #222 on 2026-08-08.",
        "",
        "Do one of these instead:",
        "  1. Retarget each child first, then merge:",
    ]
    for child in children:
        lines.append(
            "       gh pr edit %s --base %s" % (child.get("number"), base)
        )
    lines += [
        "  2. If this is a real stack, merge bottom-up as one unit:",
        "       gh stack merge --yes --squash",
        "",
        "See .agents/skills/stacked-pull-requests/SKILL.md and the",
        "'Agent merge authority' section of AGENTS.md.",
        "",
    ]
    sys.stderr.write("\n".join(lines))
    return 2


if __name__ == "__main__":
    sys.exit(main())
