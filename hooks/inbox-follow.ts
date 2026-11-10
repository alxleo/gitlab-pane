// The `inboxFollow` setting: people and projects whose MRs the Following rule lists. Plain data, so a test needs no engine.
import { isFilled } from './decode.ts'

import type { InboxFollow } from '../types'

/** The most entries followed: each costs one small query per host a minute. */
const FOLLOW_MOST = 10

const USER = /^@([\w.-]+)$/u
const PROJECT = /^[\w.-]+(?:\/[\w.-]+)+$/u

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : typeof value === 'string' ? [value] : [])

/**
 * The setting as entries: a list, or one comma-separated string; `@user` and `group/project`, without repeats, in the
 * order given. Anything else is left out, and so is everything past the tenth.
 */
export function parseFollow(setting: unknown): InboxFollow[] {
  const entries = strings(setting)
    .flatMap(entry => entry.split(','))
    .map(entry => entry.trim())
    .filter(isFilled)
  const follows = entries.flatMap((entry): InboxFollow[] => {
    const user = USER.exec(entry)?.[1]
    return user !== undefined ? [{ kind: 'user', name: user }] : PROJECT.test(entry) ? [{ kind: 'project', name: entry }] : []
  })
  const unique = new Map(follows.map(follow => [`${follow.kind}:${follow.name}`, follow]))
  return [...unique.values()].slice(0, FOLLOW_MOST)
}
