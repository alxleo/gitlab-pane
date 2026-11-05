import type { EngineInterface } from 'claude-code'

import { parseJson } from './decode'
import { Failure } from './failure'

import type { FailureKind } from '../types'

/** What a tool gave: its value, or why not in a line the pane can show. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; kind: FailureKind; reason: string }

export type ToolOptions = { timeoutMs: number }

// A login shell finds the tools wherever they are installed; the app's own PATH may not. The user's own shell is used
// when it is bash, zsh or fish at an absolute path that exists (a `$SHELL` left behind by a move is skipped), else zsh
// where there is one (macOS), else sh. fish takes its arguments as `$argv`, the others as `$0 "$@"`.
const SHELL = /^\/.*\/(bash|zsh|fish)$/

async function exists($: EngineInterface, path: string): Promise<boolean> {
  try {
    return await $.fs.exists(path)
  } catch {
    return false
  }
}

async function loginShell($: EngineInterface): Promise<string[]> {
  const own = await $.env.get('SHELL').catch(() => undefined)
  if (own !== undefined && SHELL.test(own) && (await exists($, own))) {
    return [own, '-lc', own.endsWith('/fish') ? 'exec $argv' : 'exec "$0" "$@"']
  }
  return (await exists($, '/bin/zsh')) ? ['/bin/zsh', '-lc', 'exec "$0" "$@"'] : ['/bin/sh', '-lc', 'exec "$0" "$@"']
}

/** The argv that runs `tool` with `args` through the login shell; the shell fills `$0` with the tool's name. */
async function toolArgv($: EngineInterface, tool: string, args: readonly string[]): Promise<string[]> {
  return [...(await loginShell($)), tool, ...args]
}

const lastLine = (stderr: string): string => stderr.trim().split('\n').pop() ?? ''

type Ran = { exitCode: number; stdout: string; stderr: string }

async function once($: EngineInterface, tool: string, args: readonly string[], timeoutMs: number): Promise<Ran> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(await toolArgv($, tool, args), { timeoutMs })
    return { exitCode, stdout, stderr }
  } catch (error) {
    return { exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
}

/** `text`, or `fallback` where it is empty. */
const orElse = (text: string, fallback: string): string => (text !== '' ? text : fallback)

/** Why a run that did not exit 0 failed: 127 is the shell saying it found no such tool. */
const failure = (tool: string, run: Ran): { ok: false; kind: FailureKind; reason: string } =>
  run.exitCode === 127
    ? { ok: false, kind: 'not-installed', reason: `${tool} is not installed` }
    : { ok: false, kind: 'failed', reason: orElse(lastLine(run.stderr), `${tool} exited ${run.exitCode}`) }

/** An outcome's failure as an error that carries its kind, for `record` and a throw. */
export const failureOf = (outcome: { kind: FailureKind; reason: string }): Failure => new Failure(outcome.kind, outcome.reason)

/** Runs a tool and gives its standard output; a non-zero exit is the reason. */
export async function runText(
  $: EngineInterface,
  tool: string,
  args: readonly string[],
  options: ToolOptions
): Promise<Outcome<string>> {
  const run = await once($, tool, args, options.timeoutMs)
  return run.exitCode === 0 ? { ok: true, value: run.stdout } : failure(tool, run)
}

/** Runs a tool that prints JSON and decodes it; a failed run, unreadable output or one `decode` throws on is the reason. */
export async function runJson<T>(
  $: EngineInterface,
  tool: string,
  args: readonly string[],
  decode: (raw: unknown) => T,
  options: ToolOptions
): Promise<Outcome<T>> {
  const run = await once($, tool, args, options.timeoutMs)
  if (run.exitCode !== 0) {
    return failure(tool, run)
  }
  let raw: unknown
  try {
    raw = parseJson(run.stdout)
  } catch {
    return { ok: false, kind: 'bad-answer', reason: orElse(lastLine(run.stderr), `${tool} printed no JSON`) }
  }
  try {
    return { ok: true, value: decode(raw) }
  } catch (error) {
    return { ok: false, kind: 'bad-answer', reason: error instanceof Error ? error.message : String(error) }
  }
}
