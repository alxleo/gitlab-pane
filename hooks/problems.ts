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

/** The sources only the session that reads GitLab works for: what it tells the others, who read nothing and so could say nothing. */
const LEADER_SOURCES: readonly ProblemSource[] = ['gitlab', 'moves', 'usual', 'avatars']

/** What the leader has last failed with, without the times, to put in the snapshot. */
export const leaderProblems = (all: Problems): Record<string, { message: string; kind: FailureKind }> =>
  Object.fromEntries(LEADER_SOURCES.flatMap(source => (all[source] !== undefined ? [[source, { message: all[source].message, kind: all[source].kind }]] : [])))

/** The leader's problems as this session's list of them, stamped with when the leader last read. */
export const reportedProblems = (shared: Readonly<Record<string, { message: string; kind: FailureKind }>>, at: number): Problems =>
  Object.fromEntries(LEADER_SOURCES.flatMap(source => (shared[source] !== undefined ? [[source, { ...shared[source], at }]] : [])))

/** `all` without the source: it worked, so whatever it last failed with is no longer true. */
export const withoutProblem = (all: Problems, source: ProblemSource): Problems => Object.fromEntries(Object.entries(all).filter(([name]) => name !== source))

/** One line per source that last failed, oldest source first, as `jira: acli is not installed (12:03:04 UTC)`. */
export const problemLines = (all: Problems, note = ''): string[] =>
  Object.entries(all)
    // An optional tool that is absent is said where it matters, not here.
    .filter(([source, { kind }]) => !isAbsentOptional(source, kind))
    .map(([source, { message, at }]) => `${source}: ${message} (${new Date(at).toISOString().slice(11, 19)} UTC${note})`)

/** A problem without the time it was last seen at, to tell whether it is the same failure again. */
export function withoutTime(problem: Problems[ProblemSource]): Omit<NonNullable<Problems[ProblemSource]>, 'at'> | undefined {
  if (problem === undefined) {
    return undefined
  }
  const { at: _, ...rest } = problem
  return rest
}
