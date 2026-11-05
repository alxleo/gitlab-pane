// Where background failures go instead of vanishing: the last one per source, in memory, for `/gitlab` to list. A reload
// starts it empty, as it does the rest of what `/gitlab` says about the pane.

export type Source = 'gitlab' | 'jira' | 'usual' | 'avatars' | 'inbox' | 'pane'

const last = new Map<Source, { message: string; at: number }>()

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Keeps `error` as the source's last, replacing an older one. */
export function record(source: Source, error: unknown, at = Date.now()): void {
  last.set(source, { message: messageOf(error), at })
}

/** The source worked: whatever it last failed with is no longer true. */
export function clear(source: Source): void {
  last.delete(source)
}

/** A `.catch` handler that records for `source`. */
export const reported =
  (source: Source) =>
  (error: unknown): void =>
    record(source, error)

/** One line per source that last failed, oldest source first, as `jira: acli is not installed (12:03:04 UTC)`. */
export const problems = (): string[] =>
  [...last].map(([source, { message, at }]) => `${source}: ${message} (${new Date(at).toISOString().slice(11, 19)} UTC)`)
