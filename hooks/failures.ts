import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isEqual } from './equal'
import { leaderProblems, problemLines, reportedProblems, withoutProblem, withoutTime, withProblem } from './problems'

import type { Problems, ProblemSource } from '../types'

// Where background failures go instead of vanishing: the last one per source, for `/gitlab` to list.
const problemsAtom = atom({ plugin: 'gitlab-pane', key: 'problems' } as const, {})
// What the session that reads GitLab failed with, as it told this one in its snapshot; this session's own are above.
const reportedAtom = atom({ plugin: 'gitlab-pane', key: 'reported' } as const, {})
// The surfaces where the strip that drags the pins failed: the engine draws the pane again, and the strip is left out there.
const stripFaultsAtom = atom({ plugin: 'gitlab-pane', key: 'stripFaults' } as const, [])

/** The strip failed on `surface` (its module did not load, or its code threw): the pane draws the pins there without it. */
export async function markStripFault($: EngineInterface, surface: string): Promise<void> {
  if (!(await read($, stripFaultsAtom)).includes(surface)) {
    await update($, stripFaultsAtom, list => [...list, surface])
  }
}

/** Where the strip failed; reading it here makes the pane redraw without the strip once it has. */
export function drawnStripFaults($: EngineInterface): Promise<string[]> {
  return read($, stripFaultsAtom)
}

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
export async function drawnProblems($: EngineInterface): Promise<Problems> {
  const [own, told] = await Promise.all([read($, problemsAtom), read($, reportedAtom)])
  return { ...told, ...own }
}

/** What this session's own reads failed with, for the leader to tell the others. */
export async function readLeaderProblems($: EngineInterface) {
  return leaderProblems(await read($, problemsAtom))
}

/** What the session that reads GitLab says it failed with; none when this session is that one. */
export async function setReportedProblems($: EngineInterface, shared: Parameters<typeof reportedProblems>[0], at: number): Promise<void> {
  const next = reportedProblems(shared, at)
  if (!isEqual(await read($, reportedAtom), next)) {
    await update($, reportedAtom, () => next)
  }
}

/** A mod loading starts with no failures, as it starts with nothing else the pane says about itself. */
export async function forgetProblems($: EngineInterface): Promise<void> {
  await update($, problemsAtom, () => ({}))
  // A new load may carry a strip that works, so each surface tries it again.
  await update($, stripFaultsAtom, () => [])
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
  const [own, told] = await Promise.all([read($, problemsAtom), read($, reportedAtom)])
  const others = Object.fromEntries(Object.entries(told).filter(([source]) => !(source in own)))
  return [...problemLines(own), ...problemLines(others, ', reported by the session that reads GitLab')]
}
