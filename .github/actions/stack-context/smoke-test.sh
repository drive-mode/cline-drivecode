#!/usr/bin/env bash
# Smoke-test stack-context resolution logic (mirrors the composite action).
set -euo pipefail

resolve() {
  local STACK_JSON="${1:-null}"
  local PR_BASE_REF="${2:-main}"

  local is_stacked=false
  local stack_number= stack_size= stack_position= stack_base_ref=
  local is_lowest_unmerged=false is_top=false run_expensive=true

  if [ -n "${STACK_JSON}" ] && [ "${STACK_JSON}" != "null" ]; then
    is_stacked=true
    stack_number=$(printf '%s' "$STACK_JSON" | jq -r '.number // empty')
    stack_size=$(printf '%s' "$STACK_JSON" | jq -r '.size // empty')
    stack_position=$(printf '%s' "$STACK_JSON" | jq -r '.position // empty')
    stack_base_ref=$(printf '%s' "$STACK_JSON" | jq -r '.base.ref // empty')

    if [ -n "$stack_base_ref" ] && [ "$stack_base_ref" = "${PR_BASE_REF:-}" ]; then
      is_lowest_unmerged=true
    fi
    if [ -n "$stack_position" ] && [ -n "$stack_size" ] && [ "$stack_position" = "$stack_size" ]; then
      is_top=true
    fi
    if [ "$is_lowest_unmerged" = true ] || [ "$is_top" = true ]; then
      run_expensive=true
    else
      run_expensive=false
    fi
  fi

  printf '%s' "${is_stacked}|${is_lowest_unmerged}|${is_top}|${run_expensive}|${stack_position}|${stack_size}"
}

assert_eq() {
  local got="$1" want="$2" label="$3"
  if [ "$got" != "$want" ]; then
    echo "FAIL: ${label}: got=${got} want=${want}" >&2
    exit 1
  fi
  echo "ok: ${label}"
}

# Standalone
assert_eq "$(resolve null main)" "false|false|false|true||" "standalone"

# Lowest unmerged (position 1, base == main)
lowest='{"number":3,"size":3,"position":1,"base":{"ref":"main","sha":"abc"}}'
assert_eq "$(resolve "$lowest" main)" "true|true|false|true|1|3" "lowest-unmerged"

# Mid-stack (base is previous branch)
mid='{"number":3,"size":3,"position":2,"base":{"ref":"main","sha":"abc"}}'
assert_eq "$(resolve "$mid" feat/layer-1)" "true|false|false|false|2|3" "mid-stack"

# Top of stack
top='{"number":3,"size":3,"position":3,"base":{"ref":"main","sha":"abc"}}'
assert_eq "$(resolve "$top" feat/layer-2)" "true|false|true|true|3|3" "top-of-stack"

# Single-PR stack (both lowest and top)
one='{"number":9,"size":1,"position":1,"base":{"ref":"main","sha":"abc"}}'
assert_eq "$(resolve "$one" main)" "true|true|true|true|1|1" "singleton-stack"

echo "All stack-context smoke checks passed."
