// Small hand-written decoders for what the outside tools print: each takes `unknown` and gives a typed value or throws
// with a message the pane can show. No library, since a mod's npm packages cannot be relied on at runtime.
import type { RawResponse } from './gitlab'

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A string, or empty for anything else. */
export const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The objects in a list; anything else in it, or a non-list, gives none. */
export const records = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : [])

/** A field of an object, or nothing when it is not one. */
export const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined)

/**
 * `glab api graphql`'s answer: an object with `data` (an object or null) and perhaps `errors`. What is inside `data`
 * is read where it is used, by gitlab.ts, which owns the queries.
 */
export function decodeGraphql(raw: unknown): RawResponse {
  if (!isRecord(raw)) {
    throw new Error('glab answered something other than an object')
  }
  const { data } = raw
  if (data !== undefined && data !== null && !isRecord(data)) {
    throw new Error('glab answered data that is not an object')
  }
  const errors = records(raw.errors).map(error => ({ message: text(error.message) }))
  // The one cast: `data` is checked to be an object, and its nodes are checked as they are read.
  return { data: data === undefined ? null : (data as NonNullable<RawResponse['data']> | null), ...(errors.length > 0 ? { errors } : {}) }
}
