#!/usr/bin/env bash
# Test cases for pre-push-merged-pr-guard.sh.
#
# We mock `gh` and `git` by prepending a temp dir to PATH that contains
# shims returning canned output. Each test feeds JSON on stdin (matching
# the Bash PreToolUse hook payload) and asserts on exit code + stderr.

set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pre-push-merged-pr-guard.sh"
[ -x "$HOOK" ] || { echo "Hook not executable: $HOOK"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0

# ---- mocks ---------------------------------------------------------------
make_gh_mock() {
  # $1 = state to return for `gh pr list --json state`
  # $2 = PR number to return for `--json number`
  # Empty $1 means no PR found.
  cat > "$TMP/gh" <<EOF
#!/usr/bin/env bash
# Mock gh — returns canned values.
args="\$*"
case "\$args" in
  *--json\ state*) echo "${1:-}" ;;
  *--json\ number*) echo "${2:-}" ;;
  *) echo "" ;;
esac
EOF
  chmod +x "$TMP/gh"
}

make_git_mock() {
  # $1 = branch name to return for `git symbolic-ref --short HEAD`
  cat > "$TMP/git" <<EOF
#!/usr/bin/env bash
case "\$*" in
  "symbolic-ref --short HEAD") echo "${1:-}" ;;
  *) /usr/bin/git "\$@" ;;
esac
EOF
  chmod +x "$TMP/git"
}

# ---- assertion helper ----------------------------------------------------
assert() {
  local name="$1" expected_exit="$2" payload="$3" expected_stderr="${4:-}"
  local stderr_file="$TMP/stderr"
  local actual_exit=0
  echo "$payload" | PATH="$TMP:$PATH" "$HOOK" 2>"$stderr_file" >/dev/null || actual_exit=$?
  local actual_stderr=$(cat "$stderr_file")

  if [ "$actual_exit" -ne "$expected_exit" ]; then
    echo "✗ $name: exit $actual_exit (expected $expected_exit)"
    [ -n "$actual_stderr" ] && echo "  stderr: $actual_stderr"
    FAIL=$((FAIL+1)); return
  fi
  if [ -n "$expected_stderr" ] && ! echo "$actual_stderr" | grep -q "$expected_stderr"; then
    echo "✗ $name: stderr missing '$expected_stderr'"
    echo "  got: $actual_stderr"
    FAIL=$((FAIL+1)); return
  fi
  echo "✓ $name"
  PASS=$((PASS+1))
}

# ---- test cases ----------------------------------------------------------

# 1. Non-git command passes through.
make_gh_mock "MERGED" "947"
make_git_mock "claude/foo"
assert "non-git command (ls) passes" 0 \
  '{"tool_input":{"command":"ls -la"}}'

# 2. git command other than push passes through.
assert "git status passes" 0 \
  '{"tool_input":{"command":"git status"}}'

assert "git commit passes" 0 \
  '{"tool_input":{"command":"git commit -m foo"}}'

# 3. git push on a branch with MERGED PR is BLOCKED.
assert "git push on MERGED PR is blocked" 2 \
  '{"tool_input":{"command":"git push"}}' \
  "is MERGED"

# 4. git push with -u flag on MERGED PR is blocked.
assert "git push -u on MERGED PR is blocked" 2 \
  '{"tool_input":{"command":"git push -u origin claude/foo"}}' \
  "is MERGED"

# 5. git push on CLOSED PR is BLOCKED.
make_gh_mock "CLOSED" "947"
assert "git push on CLOSED PR is blocked" 2 \
  '{"tool_input":{"command":"git push"}}' \
  "is CLOSED"

# 6. git push on OPEN PR passes (normal case).
make_gh_mock "OPEN" "947"
assert "git push on OPEN PR passes" 0 \
  '{"tool_input":{"command":"git push"}}'

# 7. git push on DRAFT PR passes.
make_gh_mock "DRAFT" "947"
assert "git push on DRAFT PR passes" 0 \
  '{"tool_input":{"command":"git push"}}'

# 8. git push with no PR (first push) passes.
make_gh_mock "" ""
assert "git push with no PR (first push) passes" 0 \
  '{"tool_input":{"command":"git push -u origin claude/new-branch"}}'

# 9. git push on main passes (we explicitly allow protected branches).
make_gh_mock "MERGED" "947"
make_git_mock "main"
assert "git push on main passes (protected branch)" 0 \
  '{"tool_input":{"command":"git push"}}'

make_git_mock "master"
assert "git push on master passes (protected branch)" 0 \
  '{"tool_input":{"command":"git push"}}'

# 10. Detached HEAD passes (no branch to check).
make_git_mock ""
assert "detached HEAD passes" 0 \
  '{"tool_input":{"command":"git push"}}'

# 11. Leading "cd X && git push" is detected.
make_git_mock "claude/foo"
make_gh_mock "MERGED" "947"
assert "cd X && git push on MERGED is blocked" 2 \
  '{"tool_input":{"command":"cd /tmp/foo && git push"}}' \
  "is MERGED"

# 12. Heredoc mentioning "git push" in commit body is NOT misdetected as push.
assert "git commit with 'git push' in body is allowed" 0 \
  '{"tool_input":{"command":"git commit -m \"Reminder: dont git push without verifying\""}}'

# 13. Malformed JSON payload passes (don't crash).
assert "malformed JSON payload passes" 0 \
  'not-json-at-all'

# 14. Empty command passes.
assert "empty command passes" 0 \
  '{"tool_input":{"command":""}}'

# 15. `git push --force` on MERGED is blocked (same rule).
make_gh_mock "MERGED" "947"
assert "git push --force on MERGED is blocked" 2 \
  '{"tool_input":{"command":"git push --force"}}' \
  "is MERGED"

# ---- summary -------------------------------------------------------------
echo
echo "PASS: $PASS"
echo "FAIL: $FAIL"
[ $FAIL -eq 0 ]
