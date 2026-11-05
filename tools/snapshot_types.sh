#!/bin/sh
# Copies the engine types Claude Code wrote into .claude-plugin/types/ to types/engine/, with the version they came
# from in types/engine/VERSION, so the full type-check (tsconfig.json) has types that are committed and not generated.
# Run it from a clone a signed-in Claude Code session has loaded the mod from, then commit types/engine/.
set -eu
cd "$(dirname "$0")/.."

from=.claude-plugin/types
to=types/engine

if [ ! -f "$from/tsconfig.json" ]; then
  echo "$from/tsconfig.json is missing: start a signed-in Claude Code session with claude --plugin-dir . from this clone first (see CONTRIBUTING.md)." >&2
  exit 1
fi

rm -rf "$to"
cp -R "$from" "$to"
claude --version > "$to/VERSION"

pinned=$(sed -n 's/^ *CLAUDE_CODE_VERSION: "\(.*\)"$/\1/p' .github/workflows/check.yml)
echo "Copied $from to $to from $(cat "$to/VERSION")."
case "$(cat "$to/VERSION")" in
  "$pinned "*) ;;
  *) echo "CI pins Claude Code $pinned in .github/workflows/check.yml; the snapshot should come from the same version." >&2 ;;
esac
