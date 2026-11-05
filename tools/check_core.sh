#!/usr/bin/env bash
# Run by .claude/settings.json after an agent edits a file. When the file is in the core (tsconfig.core.json's "include"),
# runs the core's tsc and eslint and hands what they say back to the agent: exit 2 with the findings on stderr, which
# Claude Code shows the model. Silent, exit 0, for any other file or a clean one.
#
# It reuses the tools pre-commit installed for the tsc-core and eslint hooks, so it downloads nothing. Until the
# clone has run `pre-commit run --all-files` once they do not exist, and it says so instead of checking.
set -u
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 0

# The edited file, relative to the repo, if the tsconfig lists it; nothing otherwise.
file=$(node -e '
  const fs = require("node:fs"), path = require("node:path")
  let s = ""
  process.stdin.on("data", d => (s += d)).on("end", () => {
    try {
      const edited = path.relative(process.cwd(), JSON.parse(s).tool_input.file_path)
      const core = JSON.parse(fs.readFileSync("tsconfig.core.json", "utf8").replace(/^\s*\/\/.*$/gm, "")).include
      if (core.includes(edited) && !edited.endsWith(".d.ts")) console.log(edited)
    } catch {}
  })
')
[ -n "$file" ] || exit 0

# The newest pre-commit environment that has `$1` installed and, if `$2` is given, whose typescript starts with that version.
env_with() {
  local dir
  for dir in $(ls -dt "${PRE_COMMIT_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/pre-commit}"/repo*/node_env-* 2>/dev/null); do
    [ -e "$dir/lib/node_modules/$1" ] || continue
    [ -z "${2:-}" ] || grep -q "\"version\": \"$2" "$dir/lib/node_modules/typescript/package.json" 2>/dev/null || continue
    echo "$dir"
    return
  done
}
tsc_env=$(env_with typescript 7.)
lint_env=$(env_with typescript-eslint)

if [ -z "$tsc_env" ] || [ -z "$lint_env" ]; then
  echo "tools/check_core.sh: pre-commit has not installed the tsc-core and eslint hooks, so nothing was checked. Run: pre-commit run --all-files" >&2
  exit 0
fi

out=$(
  "$tsc_env/bin/tsc" -p tsconfig.core.json 2>&1
  NODE_PATH="$lint_env/lib/node_modules" "$lint_env/bin/eslint" --max-warnings 0 "$file" 2>&1
)
if [ -n "$out" ]; then
  printf 'The core checks (tsc -p tsconfig.core.json, eslint) found problems after your edit of %s:\n%s\n' "$file" "$out" >&2
  exit 2
fi
exit 0
