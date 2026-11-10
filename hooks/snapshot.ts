// What the sessions share through the plugin's store, as plain data: the snapshot the leader writes after each read and the
// followers adopt, and the pins every session publishes under a key of its own. The store is one JSON file all sessions
// rewrite whole (capped at 4 MiB), so the snapshot holds slim cards only (slim.ts) and changes its `version` only when
// something a session draws changed. This file decides and checks; shared.ts reads and writes the store.
import { isRecord } from './decode.ts'
import { isEqual } from './equal.ts'
import { hostStatuses } from './hosts.ts'
import type { HostRead } from './hosts.ts'
import { tailOf } from './job-tail.ts'
import { foreign } from './model-text.ts'
import { pinKey } from './mr-url.ts'
import { isSettled } from './status.ts'
import type { Failures } from './wake.ts'

import type { FailureKind, HostStatus, MrCard, Pinned } from '../types'

/** The shape of the snapshot; a snapshot of another is ignored, as the store keeps whatever any version of the mod wrote. */
const FORMAT = 4
export const SNAPSHOT_KEY = 'snapshot'
/** A session's pins are under `pins:<session id>`. */
export const PINS_PREFIX = 'pins:'
/** A counter a session raises to ask the leader for a read now. */
export const REFRESH_KEY = 'refresh'

/** How often a session says it is alive and what it pinned: each beat rewrites the store, so it is a minute. */
export const PINS_BEAT_MS = 60_000
/** Pins of a session silent this long are dropped: three beats missed. */
export const PINS_EXPIRY_MS = 180_000

/**
 * A poll that finds nothing new redraws no pane, so the footer's "updated 3m ago" would only be as true as the last
 * change. `fetchedAt` moves, and with it the version, at least this often: the age on the footer is never more than this
 * long behind, and a quiet pane is drawn again once in these five minutes and not at every poll.
 */
export const FOOTER_MS = 300_000

/** The leader reads this often while a pinned pipeline runs, and otherwise... */
export const MOVING_EVERY_MS = 30_000
/** ...this often. Each read is a delta, so a read costs GitLab a small query for the changes and one for the verdicts. */
export const QUIET_EVERY_MS = 60_000
/** After failures it backs off from QUIET_EVERY_MS doubling, to this. */
export const BACKOFF_MAX_MS = 600_000
/** The inbox is read, by the leader, no more often than this, and a session that draws what the leader shared looks at its marks as often. */
export const INBOX_EVERY_MS = 60_000
/** A session that draws no pane but raised an MR looks at it this often, so its wakes still fire. */
export const WAKE_ONLY_EVERY_MS = 300_000

/** Where a host's next read starts, and when its last whole read was. */
export type Cursor = { after: string; fullAt: number }

/** Why a failed job failed, as the leader fetched and cleaned it: GitLab's message, and the end of the log, one line to an entry. */
export type SharedFailure = { reason: string | null; tail: string[] }

/** A failure of a source only the leader works for, as it tells the others. */
type SharedProblem = { message: string; kind: FailureKind }

/** What the leader last read, as every session draws it. */
export type Snapshot = {
  format: typeof FORMAT
  /** Changes when something a session draws changed; a follower adopts a snapshot whose version it has not seen. */
  version: string
  by: string
  /** When any host last answered, to the footer's minute. */
  fetchedAt: number | null
  /** When the leader last tried, which paces the next read whoever leads. */
  attemptedAt: number
  error: string | null
  hosts: Record<string, HostStatus>
  kept: number
  cursors: Record<string, Cursor>
  /** Keys of the pinned MRs the last read asked for, so a pin added since is read at once. */
  pinned: string[]
  /** Keys of the cards the last read had to ask for one by one (pinned MRs the authored list lacks). */
  extras: string[]
  /** Why the failed jobs of a raised MR's failed pipeline failed, by pipeline number then job number: fetched once, by the leader, for every session's wakes. */
  failures: Record<string, Record<string, SharedFailure>>
  /** What the leader's own reads last failed with, so a session that reads nothing can say why its pane is empty. */
  problems: Record<string, SharedProblem>
  /** Slim cards, open ones and the pinned ones that closed; each session decides from them what is news for its own pins. */
  rows: MrCard[]
}

/** One session's pins and when it last said so, as stored under its own key. */
export type PinsRecord = { session: string; at: number; pins: Pinned[] }

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')

/**
 * Whether a stored value is a card as far as the pane reads one. The fields the code dereferences are checked; the rest
 * is trusted to the snapshot's `format`, which changes whenever the card's shape does.
 */
function isCard(value: unknown): value is MrCard {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.url === 'string' &&
    typeof value.host === 'string' &&
    typeof value.path === 'string' &&
    typeof value.project === 'string' &&
    typeof value.iid === 'number' &&
    typeof value.title === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.isOpen === 'boolean' &&
    typeof value.lead === 'string' &&
    isRecord(value.repo) &&
    isRecord(value.branch) &&
    isStrings(value.changesRequestedBy) &&
    isStrings(value.approvers) &&
    Array.isArray(value.reviewers) &&
    Array.isArray(value.people) &&
    Array.isArray(value.openThreads) &&
    isRecord(value.threadsLeft) &&
    (value.pipeline === undefined ||
      (isRecord(value.pipeline) && Array.isArray(value.pipeline.stages) && Array.isArray(value.pipeline.failed) && typeof value.pipeline.moreFailed === 'number'))
  )
}

function isHostStatuses(value: unknown): value is Record<string, HostStatus> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      status => isRecord(status) && (status.fetchedAt === null || typeof status.fetchedAt === 'number') && (status.error === null || typeof status.error === 'string')
    )
  )
}

function isCursors(value: unknown): value is Record<string, Cursor> {
  return isRecord(value) && Object.values(value).every(cursor => isRecord(cursor) && typeof cursor.after === 'string' && typeof cursor.fullAt === 'number')
}

/** The snapshot a stored value is, or null for anything else. */
export function readSnapshot(value: unknown): Snapshot | null {
  if (
    !isRecord(value) ||
    value.format !== FORMAT ||
    typeof value.version !== 'string' ||
    typeof value.by !== 'string' ||
    !(value.fetchedAt === null || typeof value.fetchedAt === 'number') ||
    typeof value.attemptedAt !== 'number' ||
    !(value.error === null || typeof value.error === 'string') ||
    !isHostStatuses(value.hosts) ||
    typeof value.kept !== 'number' ||
    !isCursors(value.cursors) ||
    !isStrings(value.pinned) ||
    !isStrings(value.extras) ||
    !isRecord(value.failures) ||
    !isRecord(value.problems) ||
    !Array.isArray(value.rows) ||
    !value.rows.every(isCard)
  ) {
    return null
  }
  const { version, by, fetchedAt, attemptedAt, error, hosts, kept, cursors, pinned, extras, rows, failures, problems } = value
  return {
    format: FORMAT,
    version,
    by,
    fetchedAt,
    attemptedAt,
    error,
    hosts,
    kept,
    cursors,
    pinned,
    extras,
    rows,
    failures: sharedFailures(failures),
    problems: sharedProblems(problems),
  }
}

const isPin = (value: unknown): value is Pinned =>
  isRecord(value) &&
  typeof value.url === 'string' &&
  typeof value.host === 'string' &&
  typeof value.path === 'string' &&
  typeof value.iid === 'number' &&
  (value.origin === undefined || value.origin === 'raised' || value.origin === 'watched')

/** The pins a stored value holds, or null for anything else. */
export function readPinsRecord(value: unknown): PinsRecord | null {
  if (!isRecord(value) || typeof value.session !== 'string' || typeof value.at !== 'number' || !Array.isArray(value.pins) || !value.pins.every(isPin)) {
    return null
  }
  return { session: value.session, at: value.at, pins: value.pins }
}

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')

/** The failures a stored value holds; whatever is not an entry is left out. */
function sharedFailures(value: Record<string, unknown>): Snapshot['failures'] {
  return Object.fromEntries(
    Object.entries(value).map(([pipeline, jobs]) => [
      pipeline,
      Object.fromEntries(
        Object.entries(isRecord(jobs) ? jobs : {}).flatMap(([job, one]): [string, SharedFailure][] =>
          isRecord(one) && (one.reason === null || typeof one.reason === 'string') && isStringList(one.tail) ? [[job, { reason: one.reason, tail: one.tail }]] : []
        )
      ),
    ])
  )
}

const FAILURE_KINDS: Record<FailureKind, true> = {
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
const isFailureKind = (kind: unknown): kind is FailureKind => typeof kind === 'string' && Object.hasOwn(FAILURE_KINDS, kind)

/** The problems a stored value holds; whatever is not one is left out. */
function sharedProblems(value: Record<string, unknown>): Snapshot['problems'] {
  return Object.fromEntries(
    Object.entries(value).flatMap(([source, one]): [string, SharedProblem][] =>
      isRecord(one) && typeof one.message === 'string' && isFailureKind(one.kind) ? [[source, { message: one.message, kind: one.kind }]] : []
    )
  )
}

/** What the leader fetched of a failed pipeline, as it travels: one entry per job, the lines already cleaned. */
export const toShared = (failures: Failures): Record<string, SharedFailure> =>
  Object.fromEntries([...failures].map(([job, one]) => [String(job), { reason: one.reason, tail: [...one.tail] }]))

/**
 * A pipeline's failures from the snapshot, for a wake. Every line goes through the cleaning again on the way out, so the
 * store, which any process of the user can write, cannot put into a wake what `foreign` and `tailOf` would not let through.
 */
export const failuresFrom = (shared: Readonly<Record<string, SharedFailure>> | undefined): Failures =>
  new Map(
    Object.entries(shared ?? {}).flatMap(([job, one]) =>
      Number.isInteger(Number(job)) ? [[Number(job), { reason: one.reason !== null ? foreign(one.reason) : null, tail: tailOf(one.tail.join('\n')) }] as const] : []
    )
  )

/** Whether a stored record still stands for its session. A beat stamped ahead of this clock is no proof of life, as for the lease. */
export const isAlive = (record: PinsRecord, now: number): boolean => Math.abs(now - record.at) < PINS_EXPIRY_MS

/**
 * Every pin to read: this session's own, then those of the other sessions still alive, one for each MR. An MR any session
 * raised stays raised in the union (a pin with no origin counts as raised), whoever else only watches it, because the leader
 * fetches why its pipeline failed for the raised ones; each session still wakes from its own pins alone.
 */
export function unionPins(own: readonly Pinned[], others: readonly PinsRecord[], now: number): Pinned[] {
  const all = [...own, ...others.filter(record => isAlive(record, now)).flatMap(record => record.pins)]
  return all
    .filter((pin, i) => all.findIndex(each => pinKey(each) === pinKey(pin)) === i)
    .map(pin => all.find(each => pinKey(each) === pinKey(pin) && each.origin !== 'watched') ?? pin)
}

/** Whether the pins a session stored say what it holds now and are fresh enough to need no beat. */
export function isPublished(stored: PinsRecord | null, pins: readonly Pinned[], now: number): boolean {
  return stored !== null && now - stored.at < PINS_BEAT_MS && isEqual(stored.pins, pins)
}

/** The cards of a session's own pins that a snapshot neither read nor asked for: drawn as they were, so a new pin does not blink out. */
export function waitingRows(snapshot: Snapshot, pinned: readonly Pinned[], held: readonly MrCard[]): MrCard[] {
  const own = new Set(pinned.map(pinKey))
  const read = new Set(snapshot.rows.map(row => row.key))
  return held.filter(row => own.has(row.key) && !read.has(row.key) && !snapshot.pinned.includes(row.key))
}

/** Whether a pinned MR's pipeline is still going, which is what makes the leader read more often. */
export const isMoving = (rows: readonly MrCard[], pinned: readonly Pinned[]): boolean => {
  const keys = new Set(pinned.map(pinKey))
  return rows.some(row => keys.has(row.key) && row.isOpen && row.pipeline !== undefined && !isSettled(row.pipeline.status))
}

/** How long the leader waits between reads: shorter while a pinned pipeline runs, longer after failures. */
export const pollEvery = (failures: number, moving: boolean): number =>
  failures > 0 ? Math.min(BACKOFF_MAX_MS, QUIET_EVERY_MS * 2 ** failures) : moving ? MOVING_EVERY_MS : QUIET_EVERY_MS

const fullAts = (snapshot: Snapshot): Record<string, number> => Object.fromEntries(Object.entries(snapshot.cursors).map(([host, cursor]) => [host, cursor.fullAt]))

/**
 * Whether a snapshot is worth a rewrite of the store, which is a rewrite of every other key with it. The version says
 * something a session draws changed; the pins asked for, the cards read one by one and the time of each whole read are what
 * the next leader needs to carry on. When a read found only that the moment passed (the time it was made, where the next
 * delta starts), the store keeps the older snapshot: the next delta just starts a little earlier.
 */
export const needsSave = (previous: Snapshot | null, next: Snapshot): boolean =>
  previous === null ||
  previous.version !== next.version ||
  !isEqual(previous.pinned, next.pinned) ||
  !isEqual(previous.extras, next.extras) ||
  !isEqual(fullAts(previous), fullAts(next))

/** What a read found, before it becomes a snapshot. */
export type ReadResult = {
  rows: MrCard[]
  outcomes: HostRead[]
  error: string | null
  kept: number
  cursors: Record<string, Cursor>
  pinned: string[]
  extras: string[]
  failures: Snapshot['failures']
  problems: Snapshot['problems']
}

const errorsOf = (hosts: Readonly<Record<string, HostStatus>>): Record<string, string | null> =>
  Object.fromEntries(Object.entries(hosts).map(([host, status]) => [host, status.error]))

/**
 * The snapshot after a read. Its version, and the times the footer counts from, move only when a session would draw
 * something different, or the footer's minute turned: a read that found nothing new rewrites the store's bookkeeping
 * and no session adopts it.
 */
export function nextSnapshot(previous: Snapshot | null, read: ReadResult, me: string, now: number): Snapshot {
  const hosts = hostStatuses(previous?.hosts ?? {}, read.outcomes, now)
  const bookkeeping = {
    format: FORMAT,
    by: me,
    attemptedAt: now,
    error: read.error,
    kept: read.kept,
    cursors: read.cursors,
    pinned: read.pinned,
    extras: read.extras,
    rows: read.rows,
    failures: read.failures,
    problems: read.problems,
  } as const
  if (
    previous !== null &&
    previous.error === read.error &&
    previous.kept === read.kept &&
    isEqual(previous.failures, read.failures) &&
    isEqual(previous.problems, read.problems) &&
    isEqual(previous.rows, read.rows) &&
    isEqual(errorsOf(previous.hosts), errorsOf(hosts)) &&
    now - (previous.fetchedAt ?? -Infinity) < FOOTER_MS
  ) {
    return { ...bookkeeping, version: previous.version, fetchedAt: previous.fetchedAt, hosts: previous.hosts }
  }
  const answered = read.outcomes.some(outcome => outcome.error === null)
  return { ...bookkeeping, version: `${now}-${me}`, fetchedAt: answered ? now : (previous?.fetchedAt ?? null), hosts }
}
