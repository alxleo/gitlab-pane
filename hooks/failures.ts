import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isEqual } from './equal'
import { problemLines, withoutProblem, withoutTime, withProblem } from './problems'

import type { Problems, ProblemSource } from '../types'

// Where background failures go instead of vanishing: the last one per source, for `/gitlab` to list.
const problemsAtom = atom({ plugin: 'gitlab-ci', key: 'problems' } as const, {})

/**
 * Keeps `error` as the source's last, replacing an older one. An optional tool that is not installed is kept too, as
 * `not-installed`, which `/gitlab` leaves out and the Inbox tab and a ticket show as unavailable.
 */
export async function record($: EngineInterface, source: ProblemSource, error: unknown): Promise<void> {
  const at = await $.clock.now()
  const known = await read($, problemsAtom)
  const next = withProblem(known, source, error, at)
  // The same failure again says the same: the time it last failed at is not worth redrawing the pane for.
  if (!isEqual(withoutTime(known[source]), withoutTime(next[source]))) {
    await update($, problemsAtom, () => next)
  }
}

/** The source worked: whatever it last failed with is no longer true. */
export async function clear($: EngineInterface, source: ProblemSource): Promise<void> {
  if (source in (await read($, problemsAtom))) {
    await update($, problemsAtom, all => withoutProblem(all, source))
  }
}

/** What the pane draws its first-run lines from; reading it here makes the pane redraw when a source fails or recovers. */
export function drawnProblems($: EngineInterface): Promise<Problems> {
  return read($, problemsAtom)
}

/** A mod loading starts with no failures, as it starts with nothing else the pane says about itself. */
export async function forgetProblems($: EngineInterface): Promise<void> {
  await update($, problemsAtom, () => ({}))
}

/** A `.catch` handler that records for `source`. */
export function reported($: EngineInterface, source: ProblemSource): (error: unknown) => Promise<void> {
  return error => record($, source, error)
}

/**
 * Runs work nobody awaits, so a session ending mid-call leaves no unhandled rejection; a failure goes to `/gitlab`. The
 * `pane` source has no reader of its own to clear it, so work for it that succeeds clears the last failure.
 */
export function quietly($: EngineInterface, work: Promise<unknown>, source: ProblemSource = 'pane'): void {
  work
    .then(() => (source === 'pane' ? clear($, source) : undefined))
    .catch(reported($, source))
    .catch(() => undefined)
}

/** One line per source that last failed. */
export async function problems($: EngineInterface): Promise<string[]> {
  return problemLines(await read($, problemsAtom))
}
