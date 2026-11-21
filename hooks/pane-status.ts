// What the pane's header and footer say of the last read: how old the cards are, and what went wrong with it or what it left out.
// Pure, on plain data.
import { ago, plural } from './format.ts'

import type { PollState } from '../types'

/** A line of the header or footer, and whether it is a warning. */
export type PaneLine = { text: string; isWarning: boolean }

const updatedLine = (age: string): string => (age === 'now' ? 'updated just now' : `updated ${age} ago`)

/** Beside the tabs, quietly: how old the cards are, or that a first read is out; a warning while a host's last read failed. */
export function statusOf(poll: PollState, now: number): PaneLine {
  const hasStale = poll.error !== null || Object.values(poll.hosts).some(status => status.error !== null)
  // Nothing read yet and nothing failed: a read is out, whether this session's or the leader's.
  const age = poll.fetchedAt !== null ? updatedLine(ago(new Date(poll.fetchedAt).toISOString(), now)) : hasStale ? '' : 'reading GitLab…'
  return { text: age, isWarning: hasStale }
}

/** At the foot: only what went wrong with the last read, or what it left out. */
export function footerOf(poll: PollState, now: number): PaneLine {
  const age = (at: number | null): string | null => (at !== null ? ago(new Date(at).toISOString(), now) : null)
  // A read that kept no status per host (nothing yet to say of any) speaks of GitLab as one.
  const statuses = Object.entries(Object.keys(poll.hosts).length > 0 ? poll.hosts : { '': { fetchedAt: poll.fetchedAt, error: poll.error } })
  const stale = statuses.filter(([, status]) => status.error !== null)
  const fresh = statuses.filter(([, status]) => status.error === null && status.fetchedAt !== null)
  const named = (host: string, text: string) => (statuses.length > 1 ? `${host}: ${text}` : text)
  const keptNote = (poll.kept ?? 0) > 0 ? `${plural(poll.kept ?? 0, 'MR')} kept from the last read` : ''
  const failed = stale.map(([host, status]) => {
    const old = age(status.fetchedAt)
    return `${named(host, status.error ?? '')}${old !== null ? `; showing ${old} old data` : ''}`
  })
  // With several hosts a stale one is told with the age of its own data, and the fresh ones beside it.
  const beside = statuses.length > 1 && fresh.length > 0 ? ` · ${fresh.map(([host, status]) => `${host} ${updatedLine(age(status.fetchedAt) ?? 'now')}`).join(', ')}` : ''
  // How old the cards are is said beside the tabs; down here only what went wrong, or what the read left out.
  const text = stale.length > 0 ? `GitLab read failed: ${failed.join('; ')}${beside}` : keptNote
  return { text, isWarning: stale.length > 0 }
}
