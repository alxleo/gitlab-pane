// Small hand-written decoders for what the outside tools print: each takes `unknown` and gives a typed value or throws
// with a message the pane can show. No library, since a mod's npm packages cannot be relied on at runtime.
import { Failure } from './failure.ts'
import type { RawResponse } from './gitlab-documents.ts'

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** JSON text as `unknown`: `JSON.parse` answers `any`, which would pass for any type it is put into. */
export const parseJson = (json: string): unknown => JSON.parse(json)

/** Not null or undefined, for an optional value tested without a loose truthiness check (`0` and `''` are values). */
export const isSome = <T>(value: T | null | undefined) => value !== null && value !== undefined

/** A string with something in it; null, undefined and the empty string are none. */
export const isFilled = (value: string | null | undefined): value is string => typeof value === 'string' && value !== ''

/** A string, or empty for anything else. */
export const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A string, or null for anything else and for the empty string. */
export const textOrNull = (value: unknown): string | null => {
  const found = text(value)
  return found === '' ? null : found
}

/** The string values of an object, by key; anything else gives none. */
export const stringRecord = (value: unknown): Record<string, string> =>
  isRecord(value) ? Object.fromEntries(Object.entries(value).filter((pair): pair is [string, string] => typeof pair[1] === 'string')) : {}

/** The objects in a list; anything else in it, or a non-list, gives none. */
export const records = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : [])

/** A field of an object, or nothing when it is not one. */
export const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined)

/**
 * GitLab's GraphQL answer: an object with `data` (an object or null) and perhaps `errors`. What is inside `data` is
 * read where it is used, by gitlab.ts, which owns the documents.
 */
export function decodeGraphql<Data>(raw: unknown): RawResponse<Data> {
  if (!isRecord(raw)) {
    throw new Failure('bad-answer', 'GitLab answered something other than an object')
  }
  const { data } = raw
  if (data !== undefined && data !== null && !isRecord(data)) {
    throw new Failure('bad-answer', 'GitLab answered data that is not an object')
  }
  const errors = records(raw.errors).map(error => ({ message: text(error.message) }))
  // The one cast at the GraphQL boundary: GitLab validated this answer against the document and the schema the types
  // were generated from, so `data` has the shape of `Data`, nulls where the schema allows them.
  return { data: data === undefined ? null : (data as Data | null), ...(errors.length > 0 ? { errors } : {}) }
}
