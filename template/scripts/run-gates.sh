#!/usr/bin/env bash
#
# hstack gate runner — the verifier's machine hands, and the thing
# {{TODO-SCRIPT: hstack/scripts/run-gates.sh}} stood in for.
#
#   hstack/scripts/run-gates.sh --change <change-id>
#   hstack/scripts/run-gates.sh --change <id> --suite unit --suite lint
#   hstack/scripts/run-gates.sh --list
#   hstack/scripts/run-gates.sh --change <id> --json
#
# It reads the canonical commands declared in hstack/context/ci-cd.md, runs
# every one of them, captures combined stdout/stderr to the pointer file the
# verification artifact references, and emits an observed-test-count PER SUITE
# so V-05 ("a suite that executed zero tests cannot be recorded as pass") is a
# measurement rather than a paragraph of parsing instructions in a prompt.
#
# Exit codes:
#   0  every suite ran, exited 0, and every test suite observed > 0 tests
#   1  a suite failed, or a test suite observed zero tests (V-05)
#   2  usage / environment error (no ci-cd.md, no canonical-commands block)
#
# Dependency-free by construction: POSIX tools only, no jq, no node. The
# consuming repo has no node_modules for hstack — same constraint that made
# validate-spec.mjs plain ESM (ADR-0001).

set -uo pipefail

# ---------------------------------------------------------------------------
# 1. Argument parsing
# ---------------------------------------------------------------------------

CHANGE_ID=""
OUT=""
ROOT=""
JSON=0
LIST=0
SUITES_REQUESTED=""

usage() {
  cat <<'EOF'
hstack run-gates — run the canonical test / lint / typecheck suites

  hstack/scripts/run-gates.sh [options]

Options
  --change ID     change-spec id; the pointer file defaults to
                  hstack/specs/changes/<ID>/test-output.txt
  --out PATH      pointer file path (overrides --change)
  --suite NAME    run only this suite; repeatable
  --list          print the parsed canonical commands and exit
  --json          emit the per-suite summary as JSON on stdout
  --root DIR      repo root to resolve hstack/ from (default: search upward)
  -h, --help      this text

Exit codes: 0 all green with a non-zero test count per test suite,
1 a suite failed or observed zero tests (V-05), 2 usage / environment error.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --change) CHANGE_ID="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --suite) SUITES_REQUESTED="$SUITES_REQUESTED ${2:-}"; shift 2 ;;
    --root) ROOT="${2:-}"; shift 2 ;;
    --json) JSON=1; shift ;;
    --list) LIST=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "run-gates: unknown option $1" >&2; usage >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# 2. Locate the hstack tree
# ---------------------------------------------------------------------------

find_hstack_root() {
  dir="${1:-$PWD}"
  dir=$(cd "$dir" 2>/dev/null && pwd) || return 1
  while :; do
    if [ -f "$dir/hstack/KERNEL.md" ] || [ -f "$dir/hstack/CLAUDE.md" ] || [ -f "$dir/hstack/config.yaml" ]; then
      printf '%s\n' "$dir"
      return 0
    fi
    parent=$(dirname "$dir")
    [ "$parent" = "$dir" ] && return 1
    dir="$parent"
  done
}

REPO_ROOT=$(find_hstack_root "${ROOT:-$PWD}") || {
  echo "run-gates: no hstack/ tree found (looked for hstack/KERNEL.md upward from ${ROOT:-$PWD}). Pass --root <repo>." >&2
  exit 2
}
HSTACK="$REPO_ROOT/hstack"
CI_CD="$HSTACK/context/ci-cd.md"

[ -f "$CI_CD" ] || {
  echo "run-gates: $CI_CD not found. The canonical commands live there; run \`/hstack:configure --interview ci-cd\` first." >&2
  exit 2
}

# ---------------------------------------------------------------------------
# 3. Parse the canonical commands
# ---------------------------------------------------------------------------
#
# ci-cd.md declares them in a fenced block with the info string `hstack-gates`,
# one `suite: command` pair per line. The fence is the contract: everything
# else in ci-cd.md is prose written for humans, and a runner that guessed at
# prose would produce a confident wrong answer about what the repo's tests are.

CANONICAL=$(awk '
  /^```[[:space:]]*hstack-gates[[:space:]]*$/ { inblock=1; next }
  inblock && /^```/ { inblock=0; next }
  inblock {
    line=$0
    sub(/#.*$/, "", line)                                  # trailing comment
    if (line ~ /^[[:space:]]*$/) next
    idx = index(line, ":")
    if (idx == 0) next
    key = substr(line, 1, idx-1)
    val = substr(line, idx+1)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
    if (val == "" || val == "none" || val == "null") next  # declared absent
    printf "%s\t%s\n", key, val
  }
' "$CI_CD")

if [ -z "$CANONICAL" ]; then
  echo "run-gates: no \`hstack-gates\` fenced block in hstack/context/ci-cd.md." >&2
  echo "           Declare the canonical commands there — see hstack/templates/ci-cd.md § Canonical Commands." >&2
  exit 2
fi

# Suites that are evidence of behaviour, and therefore subject to V-05. Lint
# and typecheck are exempt: both produce a diagnostic count whose floor is
# naturally zero on a clean repo, so zero is not a signal of a skipped run.
is_test_suite() {
  case "$1" in
    unit|integration|e2e) return 0 ;;
    *) return 1 ;;
  esac
}

wanted() {
  [ -z "$SUITES_REQUESTED" ] && return 0
  for s in $SUITES_REQUESTED; do [ "$s" = "$1" ] && return 0; done
  return 1
}

if [ "$LIST" -eq 1 ]; then
  echo "hstack run-gates — canonical commands from hstack/context/ci-cd.md"
  echo ""
  printf '%s\n' "$CANONICAL" | while IFS="$(printf '\t')" read -r suite cmd; do
    printf '  %-12s %s\n' "$suite" "$cmd"
  done
  exit 0
fi

# ---------------------------------------------------------------------------
# 4. Pointer file
# ---------------------------------------------------------------------------

if [ -z "$OUT" ]; then
  if [ -n "$CHANGE_ID" ]; then
    OUT="$HSTACK/specs/changes/$CHANGE_ID/test-output.txt"
    [ -d "$HSTACK/specs/changes/$CHANGE_ID" ] || {
      echo "run-gates: no change folder at hstack/specs/changes/$CHANGE_ID/" >&2
      exit 2
    }
  else
    OUT="$REPO_ROOT/hstack-gates-output.txt"
  fi
fi
mkdir -p "$(dirname "$OUT")" || exit 2
: > "$OUT" || { echo "run-gates: cannot write $OUT" >&2; exit 2; }

{
  echo "hstack run-gates"
  echo "repo:   $REPO_ROOT"
  echo "source: hstack/context/ci-cd.md"
  echo "====================================================================="
} >> "$OUT"

# ---------------------------------------------------------------------------
# 5. Observed-test-count extraction
# ---------------------------------------------------------------------------
#
# One awk pass per suite over that suite's captured output. The runners hstack
# meets in practice all print a summary line; the point is not to understand
# every runner, it is to answer one question honestly: did this suite execute
# anything? When no known pattern matches, the answer is "unknown" — and
# unknown is treated as zero, because a count nobody could read is not evidence.
#
# "Executed" is passed + failed, NOT total. A run that collected fifteen tests
# and skipped all fifteen executed nothing, and V-05 exists precisely for that
# case: `Tests: 15 skipped, 15 total` is a non-zero total with zero assertions.
#
#   Jest / Vitest   Tests:  12 passed, 3 skipped, 15 total   |  No tests found
#   Mocha           12 passing / 3 pending / 1 failing
#   Playwright      12 passed (4.2s) / 1 failed / 3 skipped
#   pytest          collected 15 items  |  12 passed, 3 skipped  |  no tests ran
#   go test         ok  pkg  0.4s   |  testing: warning: no tests to run

count_tests() {
  # $1 = file holding this suite's output
  awk '
    function num(s) { return s + 0 }
    # --- explicit zero-collection statements, strongest signal ----------------
    /[Nn]o tests found/          { zero=1 }
    /collected 0 items/          { zero=1; seen=1 }
    /no tests ran/               { zero=1; seen=1 }
    /no tests to run/            { zero=1 }
    /^[[:space:]]*Test Files[[:space:]]+no tests/ { zero=1 }

    # --- Jest / Vitest summary ----------------------------------------------
    /^[[:space:]]*Tests:?[[:space:]]/ {
      seen=1
      line=$0
      if (match(line, /[0-9]+ passed/))  { s=substr(line, RSTART, RLENGTH); passed=num(s) }
      if (match(line, /[0-9]+ failed/))  { s=substr(line, RSTART, RLENGTH); failed=num(s) }
      if (match(line, /[0-9]+ skipped/)) { s=substr(line, RSTART, RLENGTH); skipped=num(s) }
      if (match(line, /[0-9]+ todo/))    { s=substr(line, RSTART, RLENGTH); skipped+=num(s) }
      if (match(line, /[0-9]+ total/))   { s=substr(line, RSTART, RLENGTH); total=num(s) }
    }

    # --- pytest short summary ------------------------------------------------
    /=+ .*(passed|failed|error|skipped).* =+/ {
      seen=1
      line=$0
      if (match(line, /[0-9]+ passed/))  { s=substr(line, RSTART, RLENGTH); passed=num(s) }
      if (match(line, /[0-9]+ failed/))  { s=substr(line, RSTART, RLENGTH); failed=num(s) }
      if (match(line, /[0-9]+ error/))   { s=substr(line, RSTART, RLENGTH); failed+=num(s) }
      if (match(line, /[0-9]+ skipped/)) { s=substr(line, RSTART, RLENGTH); skipped=num(s) }
    }
    /collected [0-9]+ item/ {
      seen=1
      if (match($0, /collected [0-9]+/)) { s=substr($0, RSTART+10, RLENGTH-10); collected=num(s) }
    }

    # --- Mocha ---------------------------------------------------------------
    /^[[:space:]]*[0-9]+ passing/ { seen=1; if (match($0, /[0-9]+/)) { passed=num(substr($0, RSTART, RLENGTH)) } }
    /^[[:space:]]*[0-9]+ pending/ { seen=1; if (match($0, /[0-9]+/)) { skipped=num(substr($0, RSTART, RLENGTH)) } }
    /^[[:space:]]*[0-9]+ failing/ { seen=1; if (match($0, /[0-9]+/)) { failed=num(substr($0, RSTART, RLENGTH)) } }

    # --- Playwright ("12 passed (4.2s)") and bare runner tallies -------------
    # No \b here: POSIX awk reads it as a backspace, not a word boundary.
    /^[[:space:]]*[0-9]+ (passed|failed|skipped|flaky)([^a-z]|$)/ {
      seen=1
      line=$0
      if (match(line, /[0-9]+ passed/))  { s=substr(line, RSTART, RLENGTH); passed=num(s) }
      if (match(line, /[0-9]+ failed/))  { s=substr(line, RSTART, RLENGTH); failed=num(s) }
      if (match(line, /[0-9]+ skipped/)) { s=substr(line, RSTART, RLENGTH); skipped=num(s) }
      if (match(line, /[0-9]+ flaky/))   { s=substr(line, RSTART, RLENGTH); passed+=num(s) }
    }

    END {
      if (total == 0) total = passed + failed + skipped
      if (total == 0 && collected > 0) { total = collected }
      if (zero) { total = 0; passed = 0; failed = 0 }
      executed = passed + failed
      # `known` says whether any pattern matched at all. An unreadable summary
      # is reported as unknown and treated as zero downstream — a count nobody
      # could read is not evidence that tests ran.
      known = (seen || zero) ? 1 : 0
      printf "%d %d %d %d %d %d\n", passed+0, failed+0, skipped+0, total+0, executed+0, known
    }
  ' "$1"
}

# ---------------------------------------------------------------------------
# 6. Run
# ---------------------------------------------------------------------------

TMPDIR_RUN=$(mktemp -d "${TMPDIR:-/tmp}/hstack-run-gates.XXXXXX") || exit 2
trap 'rm -rf "$TMPDIR_RUN"' EXIT

SUMMARY="$TMPDIR_RUN/summary"
: > "$SUMMARY"
OVERALL=0
RAN_ANY=0

while IFS="$(printf '\t')" read -r suite cmd; do
  [ -n "$suite" ] || continue
  wanted "$suite" || continue
  RAN_ANY=1

  suite_out="$TMPDIR_RUN/$suite.out"
  {
    echo ""
    echo "--- suite: $suite ------------------------------------------------"
    echo "\$ $cmd"
  } >> "$OUT"

  # stdin from /dev/null, not inherited: the loop below is fed by a heredoc of
  # the canonical commands, and a suite that reads stdin (an interactive watch
  # mode, a prompt) would otherwise eat the remaining suites.
  ( cd "$REPO_ROOT" && eval "$cmd" ) > "$suite_out" 2>&1 < /dev/null
  code=$?
  cat "$suite_out" >> "$OUT"

  if is_test_suite "$suite"; then
    read -r passed failed skipped total executed known <<EOF
$(count_tests "$suite_out")
EOF
  else
    passed=0; failed=0; skipped=0; total=0; executed=0; known=1
  fi

  # V-05: zero executed tests is `not-run`, never `pass`. "Zero failures" is
  # not evidence of correctness when there were zero assertions to fail.
  if [ "$code" -ne 0 ]; then
    verdict="fail"
    reason="command exited $code"
    OVERALL=1
  elif is_test_suite "$suite" && [ "$executed" -eq 0 ]; then
    verdict="not-run"
    if [ "$known" -eq 0 ]; then
      reason="no test count could be read from the runner's output (unrecognised summary format)"
    elif [ "$skipped" -gt 0 ]; then
      reason="the runner reported zero executed tests — $skipped skipped of $total collected (all-skipped, or a filter that collapsed the set)"
    else
      reason="the runner reported zero executed tests (env-gated, empty-collection, or filter-collapse)"
    fi
    OVERALL=1
  else
    verdict="pass"
    reason=""
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$suite" "$cmd" "$code" "$verdict" "$passed" "$failed" "$skipped" "$total" "$executed" "$reason" >> "$SUMMARY"

  {
    echo "--- suite: $suite → $verdict (exit $code, $executed of $total test(s) executed)"
  } >> "$OUT"
done <<EOF
$CANONICAL
EOF

if [ "$RAN_ANY" -eq 0 ]; then
  echo "run-gates: no suite matched --suite${SUITES_REQUESTED}" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# 7. Report
# ---------------------------------------------------------------------------

REL_OUT="${OUT#"$REPO_ROOT"/}"

if [ "$JSON" -eq 1 ]; then
  printf '{\n'
  printf '  "ok": %s,\n' "$([ "$OVERALL" -eq 0 ] && echo true || echo false)"
  printf '  "test-output": "%s",\n' "$REL_OUT"
  printf '  "suites": [\n'
  first=1
  while IFS="$(printf '\t')" read -r suite cmd code verdict passed failed skipped total executed reason; do
    [ "$first" -eq 1 ] || printf ',\n'
    first=0
    esc_cmd=$(printf '%s' "$cmd" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_reason=$(printf '%s' "$reason" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '    {"suite": "%s", "command": "%s", "exit": %s, "verdict": "%s", "observed": {"passed": %s, "failed": %s, "skipped": %s, "total": %s, "executed": %s}, "reason": "%s"}' \
      "$suite" "$esc_cmd" "$code" "$verdict" "$passed" "$failed" "$skipped" "$total" "$executed" "$esc_reason"
  done < "$SUMMARY"
  printf '\n  ]\n}\n'
else
  echo ""
  echo "hstack run-gates — $REPO_ROOT"
  echo ""
  printf '  %-12s %-9s %-6s %s\n' "suite" "verdict" "exit" "observed (passed/failed/skipped/total)"
  while IFS="$(printf '\t')" read -r suite cmd code verdict passed failed skipped total executed reason; do
    printf '  %-12s %-9s %-6s %s/%s/%s/%s\n' "$suite" "$verdict" "$code" "$passed" "$failed" "$skipped" "$total"
    [ -n "$reason" ] && printf '               %s\n' "$reason"
  done < "$SUMMARY"
  echo ""
  echo "  captured output: $REL_OUT"
  echo "  → verification.artifacts.test-output: $REL_OUT"
  echo ""
  if [ "$OVERALL" -eq 0 ]; then
    echo "run-gates: all suites green with a non-zero executed-test count."
  else
    echo "run-gates: at least one suite failed or executed zero tests (V-05). status: passed is blocked."
  fi
fi

exit "$OVERALL"
