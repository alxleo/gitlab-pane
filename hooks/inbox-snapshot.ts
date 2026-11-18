// The inbox snapshot as it travels: read back from the plugin store, where the reader's leader keeps it for the other
// sessions, and carried over a read in which a host did not answer. Plain data, so a test needs no engine.
import { field, isRecord, records, text, textOrNull } from './decode.ts'
import { keptLanded } from './landed.ts'

import type { FailureKind, InboxHost, InboxKind, InboxMr, InboxSignal, InboxSnapshot } from '../types'

const KINDS: Record<InboxKind, true> = {
  changes_requested: true,
  unapproved: true,
  approved: true,
  review: true,
  comment: true,
  mentioned: true,
  review_requested: true,
  pushed: true,
  merged: true,
  build_failed: true,
  unmergeable: true,
}

const FAILURES: Record<FailureKind, true> = {
  'not-installed': true,
  'no-token': true,
  unauthorized: true,
  network: true,
  timeout: true,
  'bad-answer': true,
  server: true,
  failed: true,
  unknown: true,
}

const isInboxKind = (kind: string): kind is InboxKind => Object.hasOwn(KINDS, kind)
const isFailureKind = (kind: string): kind is FailureKind => Object.hasOwn(FAILURES, kind)

/** A snapshot with nothing in it, as before the first read. */
export const NO_SNAPSHOT: InboxSnapshot = { at: 0, hosts: {}, mrs: [], landed: [] }

function signalOf(raw: Record<string, unknown>): InboxSignal[] {
  const kind = text(raw.kind)
  return isInboxKind(kind) && typeof raw.at === 'number' ? [{ kind, actor: text(raw.actor), at: raw.at, note: textOrNull(raw.note), excerpt: text(raw.excerpt) }] : []
}

function mrOf(raw: Record<string, unknown>): InboxMr[] {
  const host = text(raw.host)
  const path = text(raw.path)
  return host !== '' && path !== '' && typeof raw.iid === 'number'
    ? [
        {
          host,
          path,
          iid: raw.iid,
          title: text(raw.title),
          url: text(raw.url),
          author: text(raw.author),
          authorName: text(raw.authorName),
          isMine: raw.isMine === true,
          state: text(raw.state),
          isDraft: raw.isDraft === true,
          inQueue: raw.inQueue === true,
          isFollowed: raw.isFollowed === true,
          cutoff: typeof raw.cutoff === 'number' ? raw.cutoff : null,
          signals: records(raw.signals).flatMap(signalOf),
        },
      ]
    : []
}

function hostOf(raw: unknown): InboxHost {
  const failure = field(raw, 'failure')
  const kind = text(field(failure, 'kind'))
  return {
    user: textOrNull(field(raw, 'user')),
    failure: isRecord(failure) ? { kind: isFailureKind(kind) ? kind : 'unknown', message: text(failure.message) } : null,
  }
}

/**
 * The snapshot a store value holds, or null for anything else: a value from an older version of the mod is read again, not
 * trusted. One written before merged MRs were kept has none, which reads as none merged until its leader reads again.
 */
export function readSnapshot(raw: unknown): InboxSnapshot | null {
  const hosts = field(raw, 'hosts')
  const at = field(raw, 'at')
  const mrs = field(raw, 'mrs')
  if (typeof at !== 'number' || !isRecord(hosts) || !Array.isArray(mrs)) {
    return null
  }
  return {
    at,
    hosts: Object.fromEntries(Object.entries(hosts).map(([host, one]) => [host, hostOf(one)])),
    mrs: records(mrs).flatMap(mrOf),
    landed: keptLanded(field(raw, 'landed')),
  }
}

/**
 * `fresh`, except that a host that did not answer at all keeps what it last said: its user and its MRs from `previous`,
 * with the new failure. A host that answered in part is fresh: its failure is in its entry, the documents that came are used.
 */
export function carryOver(previous: InboxSnapshot, fresh: InboxSnapshot): InboxSnapshot {
  const silent = Object.entries(fresh.hosts).filter(([host, one]) => one.user === null && one.failure !== null && previous.hosts[host] !== undefined)
  if (silent.length === 0) {
    return fresh
  }
  const names = new Set(silent.map(([host]) => host))
  return {
    at: fresh.at,
    hosts: Object.fromEntries(Object.entries(fresh.hosts).map(([host, one]) => [host, names.has(host) ? { user: previous.hosts[host]?.user ?? null, failure: one.failure } : one])),
    mrs: [...fresh.mrs, ...previous.mrs.filter(mr => names.has(mr.host))],
    // The leader's `publish` keeps the merged MRs of a host whose own document failed (`knownLanded`), a silent one's included.
    landed: fresh.landed,
  }
}

/** Why the last read fell short, in a line: each failing host's words, with the host before them when there are several. */
export function problemOf(snapshot: InboxSnapshot): string | null {
  const failing = Object.entries(snapshot.hosts).flatMap(([host, one]) => (one.failure === null ? [] : [{ host, message: one.failure.message }]))
  const several = Object.keys(snapshot.hosts).length > 1
  return failing.length === 0 ? null : failing.map(one => (several ? `${one.host}: ${one.message}` : one.message)).join('; ')
}
