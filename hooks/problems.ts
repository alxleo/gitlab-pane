// What `/gitlab` says about background failures: the last one per source, as plain data the atom in failures.ts holds.
import { kindOf } from './failure.ts'

import type { FailureKind, Problems, ProblemSource } from '../types'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** `all` with `error` as the source's last, replacing an older one in the same place. */
export const withProblem = (all: Problems, source: ProblemSource, error: unknown, at: number): Problems => ({
  ...all,
  [source]: { message: messageOf(error), kind: kindOf(error), at },
})

/**
 * Whether a failure only says that an optional tool is not installed. acli is not needed for the pane to work, so its
 * absence is not a failure to list in `/gitlab`: a ticket says it where it matters.
 */
export const isAbsentOptional = (source: string, kind: FailureKind): boolean => source === 'jira' && kind === 'not-installed'

/** `all` without the source: it worked, so whatever it last failed with is no longer true. */
export const withoutProblem = (all: Problems, source: ProblemSource): Problems =>
  Object.fromEntries(Object.entries(all).filter(([name]) => name !== source))

/** One line per source that last failed, oldest source first, as `jira: acli is not installed (12:03:04 UTC)`. */
export const problemLines = (all: Problems): string[] =>
  Object.entries(all)
    // An optional tool that is absent is said where it matters, not here.
    .filter(([source, { kind }]) => !isAbsentOptional(source, kind))
    .map(([source, { message, at }]) => `${source}: ${message} (${new Date(at).toISOString().slice(11, 19)} UTC)`)

/** A problem without the time it was last seen at, to tell whether it is the same failure again. */
export function withoutTime(problem: Problems[ProblemSource]): Omit<NonNullable<Problems[ProblemSource]>, 'at'> | undefined {
  if (problem === undefined) {
    return undefined
  }
  const { at: _, ...rest } = problem
  return rest
}
