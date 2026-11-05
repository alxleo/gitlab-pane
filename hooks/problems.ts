// What `/gitlab` says about background failures: the last one per source, as plain data the atom in failures.ts holds.
import type { FailureKind, Problems, ProblemSource } from '../types'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const KINDS: Record<FailureKind, true> = {
  'not-installed': true,
  'no-token': true,
  unauthorized: true,
  network: true,
  timeout: true,
  'bad-answer': true,
  server: true,
}

const isKind = (value: unknown): value is FailureKind => typeof value === 'string' && value in KINDS

/** What kind of failure `error` is: the kind it carries, or not-installed for an optional tool that is absent; otherwise unknown. */
function kindOf(source: ProblemSource, error: unknown): FailureKind | undefined {
  if (isAbsentOptional(source, error)) {
    return 'not-installed'
  }
  return typeof error === 'object' && error !== null && 'kind' in error && isKind(error.kind) ? error.kind : undefined
}

/** `all` with `error` as the source's last, replacing an older one in the same place. */
export const withProblem = (all: Problems, source: ProblemSource, error: unknown, at: number): Problems => {
  const kind = kindOf(source, error)
  return { ...all, [source]: { message: messageOf(error), at, ...(kind !== undefined ? { kind } : {}) } }
}

/**
 * Whether `error` only says that an optional tool is not installed. mr-inbox and acli are not needed for the pane to work,
 * so their absence is not a failure to list in `/gitlab`: the Inbox tab and a ticket say it where it matters.
 */
export function isAbsentOptional(source: ProblemSource, error: unknown): boolean {
  return (source === 'inbox' || source === 'jira') && /^\S+ is not installed$/.test(messageOf(error))
}

/** `all` without the source: it worked, so whatever it last failed with is no longer true. */
export const withoutProblem = (all: Problems, source: ProblemSource): Problems =>
  Object.fromEntries(Object.entries(all).filter(([name]) => name !== source))

/** One line per source that last failed, oldest source first, as `jira: acli is not installed (12:03:04 UTC)`. */
export const problemLines = (all: Problems): string[] =>
  Object.entries(all)
    // An optional tool that is absent is said where it matters, not here.
    .filter(([source, { kind }]) => !((source === 'inbox' || source === 'jira') && kind === 'not-installed'))
    .map(([source, { message, at }]) => `${source}: ${message} (${new Date(at).toISOString().slice(11, 19)} UTC)`)

/** A problem without the time it was last seen at, to tell whether it is the same failure again. */
export function withoutTime(problem: Problems[ProblemSource]): Omit<NonNullable<Problems[ProblemSource]>, 'at'> | undefined {
  if (problem === undefined) {
    return undefined
  }
  const { at: _, ...rest } = problem
  return rest
}
