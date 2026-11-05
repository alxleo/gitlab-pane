import type { EngineInterface } from 'claude-code'

/** What a tool gave: its value, or why not in a line the pane can show. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string }

export type ToolOptions = {
  timeoutMs: number
  /** Asked of stderr after a failed run; true runs the tool once more, to ride out an error that passes. */
  retryIf?: (stderr: string) => boolean
  /** glab exits non-zero on a partial GraphQL error yet prints the data: a failed run whose output decodes is kept. */
  isPartialOk?: boolean
}

// A login shell finds the tools wherever they are installed; the app's own PATH may not. The user's own shell is used
// when it is bash, zsh or fish at an absolute path, else zsh where there is one (macOS), else sh. The shell reads
// `$SHELL` itself, since the engine offers a hook module no way to read the environment. fish takes its arguments as
// `$argv`, the others as `$0 "$@"`.
const LOGIN = `case "$SHELL" in
/*/bash|/*/zsh) exec "$SHELL" -lc 'exec "$0" "$@"' "$@" ;;
/*/fish) exec "$SHELL" -lc 'exec $argv' "$@" ;;
esac
if [ -x /bin/zsh ]; then exec /bin/zsh -lc 'exec "$0" "$@"' "$@"; fi
exec /bin/sh -lc 'exec "$0" "$@"' "$@"`

/** The argv that runs `tool` with `args` through the login shell; `tools` fills `$0` so the tool's name sits once, at 4. */
export const toolArgv = (tool: string, args: readonly string[]): string[] => ['/bin/sh', '-c', LOGIN, 'tools', tool, ...args]

const lastLine = (stderr: string): string => stderr.trim().split('\n').pop() ?? ''

type Ran = { exitCode: number; stdout: string; stderr: string }

async function once($: EngineInterface, tool: string, args: readonly string[], timeoutMs: number): Promise<Ran> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(toolArgv(tool, args), { timeoutMs })
    return { exitCode, stdout, stderr }
  } catch (error) {
    return { exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
}

async function ran($: EngineInterface, tool: string, args: readonly string[], options: ToolOptions): Promise<Ran> {
  const first = await once($, tool, args, options.timeoutMs)
  return first.exitCode !== 0 && first.exitCode !== 127 && options.retryIf?.(first.stderr)
    ? once($, tool, args, options.timeoutMs)
    : first
}

const failure = (tool: string, run: Ran): string =>
  run.exitCode === 127 ? `${tool} is not installed` : lastLine(run.stderr) || `${tool} exited ${run.exitCode}`

/** Runs a tool and gives its standard output; a non-zero exit is the reason. */
export async function runText(
  $: EngineInterface,
  tool: string,
  args: readonly string[],
  options: ToolOptions
): Promise<Outcome<string>> {
  const run = await ran($, tool, args, options)
  return run.exitCode === 0 ? { ok: true, value: run.stdout } : { ok: false, reason: failure(tool, run) }
}

/** Runs a tool that prints JSON and decodes it; a failed run, unreadable output or one `decode` throws on is the reason. */
export async function runJson<T>(
  $: EngineInterface,
  tool: string,
  args: readonly string[],
  decode: (raw: unknown) => T,
  options: ToolOptions
): Promise<Outcome<T>> {
  const run = await ran($, tool, args, options)
  if (run.exitCode === 127) {
    return { ok: false, reason: failure(tool, run) }
  }
  if (run.exitCode !== 0 && !options.isPartialOk) {
    return { ok: false, reason: failure(tool, run) }
  }
  let raw: unknown
  try {
    raw = JSON.parse(run.stdout)
  } catch {
    return { ok: false, reason: run.exitCode === 0 ? lastLine(run.stderr) || `${tool} printed no JSON` : failure(tool, run) }
  }
  try {
    return { ok: true, value: decode(raw) }
  } catch (error) {
    return { ok: false, reason: run.exitCode === 0 ? (error instanceof Error ? error.message : String(error)) : failure(tool, run) }
  }
}
