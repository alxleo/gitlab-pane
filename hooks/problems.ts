// What `/gitlab` says about background failures: the last one per source, as plain data the atom in failures.ts holds.
import type { Problems, ProblemSource } from '../types'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** `all` with `error` as the source's last, replacing an older one in the same place. */
export const withProblem = (all: Problems, source: ProblemSource, error: unknown, at: number): Problems => ({
  ...all,
  [source]: { message: messageOf(error), at },
})

/** `all` without the source: it worked, so whatever it last failed with is no longer true. */
export const withoutProblem = (all: Problems, source: ProblemSource): Problems =>
  Object.fromEntries(Object.entries(all).filter(([name]) => name !== source))

/** One line per source that last failed, oldest source first, as `jira: acli is not installed (12:03:04 UTC)`. */
export const problemLines = (all: Problems): string[] =>
  Object.entries(all).map(([source, { message, at }]) => `${source}: ${message} (${new Date(at).toISOString().slice(11, 19)} UTC)`)
