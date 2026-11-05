import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { problemLines, withoutProblem, withProblem } from './problems'

import type { ProblemSource } from '../types'

// Where background failures go instead of vanishing: the last one per source, for `/gitlab` to list.
const problemsAtom = atom({ plugin: 'gitlab-ci', key: 'problems' } as const, {})

/** Keeps `error` as the source's last, replacing an older one. */
export async function record($: EngineInterface, source: ProblemSource, error: unknown): Promise<void> {
  const at = await $.clock.now()
  await update($, problemsAtom, all => withProblem(all, source, error, at))
}

/** The source worked: whatever it last failed with is no longer true. */
export async function clear($: EngineInterface, source: ProblemSource): Promise<void> {
  await update($, problemsAtom, all => withoutProblem(all, source))
}

/** A mod loading starts with no failures, as it starts with nothing else the pane says about itself. */
export async function forgetProblems($: EngineInterface): Promise<void> {
  await update($, problemsAtom, () => ({}))
}

/** A `.catch` handler that records for `source`. */
export function reported($: EngineInterface, source: ProblemSource): (error: unknown) => Promise<void> {
  return error => record($, source, error)
}

/** Runs work nobody awaits, so a session ending mid-call leaves no unhandled rejection; a failure goes to `/gitlab`. */
export function quietly($: EngineInterface, work: Promise<unknown>, source: ProblemSource = 'pane'): void {
  work.catch(reported($, source)).catch(() => undefined)
}

/** One line per source that last failed. */
export async function problems($: EngineInterface): Promise<string[]> {
  return problemLines(await read($, problemsAtom))
}
