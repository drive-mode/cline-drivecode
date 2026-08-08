#!/usr/bin/env python
"""Tests for guard-pr-merge.py. Run: python .claude/hooks/guard-pr-merge.test.py

No network: the gh layer is stubbed. Exits non-zero on the first failure.
"""

import importlib.util
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location(
    "guard", os.path.join(HERE, "guard-pr-merge.py")
)

failures = []


def load():
    module = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(module)
    module.shutil.which = lambda _name: "/usr/bin/gh"
    return module


def run(module, command):
    """Feed one Bash payload through the hook; return (exit_code, stderr)."""
    real_stdin, real_stderr = sys.stdin, sys.stderr
    sys.stdin = io.StringIO(json.dumps({"tool_input": {"command": command}}))
    captured = io.StringIO()
    sys.stderr = captured
    try:
        code = module.main()
    finally:
        sys.stdin, sys.stderr = real_stdin, real_stderr
    return code, captured.getvalue()


def check(name, actual, expected):
    if actual == expected:
        print("  ok   %s" % name)
    else:
        print("  FAIL %s -- expected %r, got %r" % (name, expected, actual))
        failures.append(name)


def with_child(module):
    def stub(args):
        if args[1] == "view":
            return {"number": 219, "headRefName": "feat/parent", "baseRefName": "main"}
        return [{"number": 221, "title": "child work"}]

    module.gh_json = stub


def without_child(module):
    def stub(args):
        if args[1] == "view":
            return {"number": 219, "headRefName": "feat/parent", "baseRefName": "main"}
        return []

    module.gh_json = stub


print("guard-pr-merge tests")

# Commands the guard must ignore entirely.
m = load()
m.gh_json = lambda args: sys.exit("gh must not be called for non-merge commands")
for label, cmd in [
    ("plain git", "git status"),
    ("gh stack merge is not gh pr merge", "gh stack merge --yes --squash"),
    ("gh pr list", "gh pr list --state open"),
    ("gh pr view", "gh pr view 12 --json number"),
]:
    code, _ = run(m, cmd)
    check(label, code, 0)

# Malformed / partial payloads must never raise.
m = load()
for label, payload in [
    ("non-json stdin", "not json"),
    ("empty object", "{}"),
    ("null tool_input", '{"tool_input": null}'),
    ("non-string command", '{"tool_input": {"command": 5}}'),
]:
    real = sys.stdin
    sys.stdin = io.StringIO(payload)
    try:
        check(label, m.main(), 0)
    finally:
        sys.stdin = real

# Positive: a dependent PR exists -> block, and name the fix.
m = load()
with_child(m)
code, err = run(m, "gh pr merge 219 --squash --delete-branch")
check("blocks merge with a dependent", code, 2)
check("names the child PR", "#221" in err, True)
check("prints the retarget command", "gh pr edit 221 --base main" in err, True)
check("offers the stack path", "gh stack merge" in err, True)
check("stays ascii", err.encode("ascii", "strict") is not None, True)

# Same, without an explicit PR number (gh resolves the current branch).
m = load()
with_child(m)
code, _ = run(m, "gh pr merge --squash")
check("blocks bare merge too", code, 2)

# Negative: no dependents -> allow.
m = load()
without_child(m)
code, _ = run(m, "gh pr merge 219 --squash --delete-branch")
check("allows merge with no dependents", code, 0)

# Fail-open: gh unavailable or erroring must not wedge merges.
m = load()
m.gh_json = lambda args: None
code, _ = run(m, "gh pr merge 219 --squash")
check("fails open when gh errors", code, 0)

m = load()
m.shutil.which = lambda _name: None
code, err = run(m, "gh pr merge 219 --squash")
check("fails open when gh missing", code, 0)
check("warns when gh missing", "not on PATH" in err, True)

if failures:
    print("\n%d test(s) failed" % len(failures))
    sys.exit(1)
print("\nall tests passed")
