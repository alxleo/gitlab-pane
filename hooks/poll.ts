import type { EngineInterface } from 'claude-code'

import { forgetGone, readWake } from './choices'
import {
  changeReads,
  pinMr,
  readAnnounced,
  readHosts,
  readPinned as readPins,
  readPoll,
  readReads,
  readRole,
  readRows,
  setAnnounced,
  setPoll,
  setReading,
  setRole,
  setRows,
  unpinKeys,
} from './data'
import { refreshDetails } from './detail'
import { Failure, together } from './failure'
import { clear, quietly, readLeaderProblems, record, setReportedProblems } from './failures'
import { serialised } from './in-flight'
import { leaseTick } from './lease-store'
import { ago } from './format'
import { describe } from './wake'
import { parseMrUrl, pinKey } from './mr-url'
import { dotted, EMPTY, foreign, line, lines, URL_ROOM, type ModelLine } from './model-text'
import { isPaneDrawn, openPane } from './panes'
import { readGitLab, readRaised, readSingle } from './read-gitlab'
import type { HostAsk } from './read-gitlab'
import { readFailures } from './job-failures'
import { TAIL_JOBS } from './job-tail'
import { reconcile } from './reconcile'
import { afterRead, loadShared, readJira } from './side-reads'
import { askForRefresh, loadSnapshot, pinsToRead, publishPins, readRefreshes, saveSnapshot } from './shared'
import { followInbox, leadInbox, sharedInboxAt } from './inbox'
import { FOOTER_MS, INBOX_EVERY_MS, isMoving, needsSave, nextSnapshot, pollEvery, WAKE_ONLY_EVERY_MS, waitingRows } from './snapshot'
import { failuresFrom, toShared } from './snapshot'
import type { Cursor, ReadResult, Snapshot } from './snapshot'
import type { FailureReader } from './reconcile'

import type { MrCard, Pinned, PollState } from '../types'

// Who reads GitLab, and what each session does with what was read. The lease (lease.ts) elects one leader among the
// sessions that draw the pane; it alone reads GitLab, and writes what it read as a snapshot (snapshot.ts) in the store. The
// other sessions that draw the pane adopt each new snapshot and read nothing. A session that draws nothing but raised an MR
// reads that MR alone, slowly, so its wakes still fire. Every session, whichever it is, decides its own wakes: from the
// cards it was given, its own pins and what it announced already.

/** The only way text reaches the model unasked: lines built by model-text.ts, so a foreign value cannot arrive raw. */
function wake($: EngineInterface, news: readonly ModelLine[]) {
  return $.prompt.submit({ text: lines(news) })
}

/** An MR this session raised wakes it; one it only watches does not. A pin kept from before this was recorded wakes, as every pin then did. */
const isRaised = (one: Pinned): boolean => one.origin !== 'watched'

/**
 * What a session does with cards it was given: toasts and wakes for its own pins' news, the open cards for the pane, the
 * pins that ended. `cards` are open ones and the pinned ones that closed. Gives the open cards.
 */
async function applyCards($: EngineInterface, cards: readonly MrCard[], now: number, failures: FailureReader): Promise<MrCard[]> {
  const [pinned, announced] = await Promise.all([readPins($), readAnnounced($)])
  const reconciled = await reconcile({ pinned, rows: cards, announced, now, failures })
  reconciled.toasts.forEach(text => $.ui.toast(text))
  const open = reconciled.rows
  const isShown = (key: string) => open.some(row => row.key === key)
  await setRows($, open)
  // An MR read whole that has merged leaves its page, so the title and the list come back with it.
  if (await forgetGone($, isShown)) {
    quietly($, openPane($))
  }
  await setAnnounced($, reconciled.announced)
  if (reconciled.unpinned.length > 0) {
    await unpinKeys($, reconciled.unpinned)
  }
  if (reconciled.wakes.length > 0 && (await readWake($))) {
    quietly($, wake($, reconciled.wakes))
  }
  quietly($, refreshDetails($))
  return open
}

/** What the footer says of a snapshot. */
const pollOf = (snapshot: Snapshot): PollState => ({
  fetchedAt: snapshot.fetchedAt,
  error: snapshot.error,
  hosts: snapshot.hosts,
  ...(snapshot.kept > 0 ? { kept: snapshot.kept } : {}),
})

/**
 * Draws from a snapshot: its cards, with those of this session's own pins that the leader has not yet read left as they were,
 * so an MR just pinned does not blink out; the footer; the pictures and run times the leader kept. Beside the cards, a
 * session that draws also reads Jira's view of the tickets itself, as that is not GitLab.
 */
async function adopt($: EngineInterface, snapshot: Snapshot, isLeader = false): Promise<void> {
  const [pinned, held, reads, now] = await Promise.all([readPins($), readRows($), readReads($), $.clock.now()])
  const waiting = waitingRows(snapshot, pinned, held)
  // The leader keeps the pictures and run times itself, but loads those an earlier leader left when it first draws.
  if (!isLeader || reads.adopted === '') {
    await loadShared($)
  }
  await setPoll($, pollOf(snapshot))
  // The reasons its failed jobs failed were fetched once, by the leader, and come with the snapshot: this session fetches none.
  const open = await applyCards($, [...snapshot.rows, ...waiting], now, async card => failuresFrom(snapshot.failures[String(card.pipeline?.id ?? 0)]))
  await setReportedProblems($, isLeader ? {} : snapshot.problems, snapshot.fetchedAt ?? snapshot.attemptedAt)
  await changeReads($, state => ({ ...state, adopted: snapshot.version }))
  quietly($, readJira($, open, now), 'jira')
}

/**
 * Draws the store's snapshot while this session's first read is out, so the pane starts from the last cards, not from none.
 * Only drawn: data that old makes no toast, wake or unpin, and the read's own snapshot is adopted whole when it lands.
 */
async function preview($: EngineInterface, snapshot: Snapshot): Promise<void> {
  const [pinned, held] = await Promise.all([readPins($), readRows($), loadShared($)])
  await setPoll($, pollOf(snapshot))
  await setRows($, [...snapshot.rows.filter(row => row.isOpen), ...waitingRows(snapshot, pinned, held)])
}

/** Puts a snapshot in the store for the other sessions. A store that cannot take it does not stop this session drawing it. */
async function share($: EngineInterface, snapshot: Snapshot): Promise<void> {
  try {
    await saveSnapshot($, snapshot)
    await clear($, 'store')
  } catch (error) {
    await record($, 'store', error)
  }
}

/**
 * Why the failed jobs of every raised MR's failed pipeline failed: fetched here, once for each pipeline, whichever session
 * raised the MR, and carried in the snapshot for every session's wake. A pipeline that is no longer any card's is forgotten.
 */
async function reasonsFor($: EngineInterface, rows: readonly MrCard[], pins: readonly Pinned[], known: Snapshot['failures']): Promise<Snapshot['failures']> {
  const raised = new Set(pins.filter(isRaised).map(pinKey))
  const pipelines = new Set(rows.flatMap(row => (row.pipeline !== undefined ? [String(row.pipeline.id)] : [])))
  const kept = Object.fromEntries(Object.entries(known).filter(([id]) => pipelines.has(id)))
  const wanted = rows.flatMap(row =>
    raised.has(row.key) && row.isOpen && row.pipeline !== undefined && row.pipeline.failed.length > 0 && !(String(row.pipeline.id) in kept) ? [{ row, pipeline: row.pipeline }] : []
  )
  const fetched = await Promise.all(
    wanted.map(async ({ row, pipeline }) => [String(pipeline.id), toShared(await readFailures($, row, pipeline.failed.slice(0, TAIL_JOBS)))] as const)
  )
  return { ...kept, ...Object.fromEntries(fetched) }
}

/** The leader's one read of the inbox, when it is due (the pace, or a person asked for a read): shared in the store, and drawn here. */
async function inboxPass($: EngineInterface, hosts: readonly string[], isDue: boolean, at: number): Promise<void> {
  if (isDue) {
    await changeReads($, state => ({ ...state, inboxAt: at }))
    await leadInbox($, hosts)
  }
}

/** What the leader read: one snapshot from every host's answer, for it and for the sessions that follow. */
async function lead($: EngineInterface, previous: Snapshot | null, pins: readonly Pinned[], isFresh: boolean, isInboxDue: boolean): Promise<void> {
  const [hosts, me, startedAt] = await Promise.all([readHosts($), $.session.id(), $.clock.now()])
  // Marked before the read, so a read that goes wrong is tried again at the pace, not at the next tick.
  await changeReads($, state => ({ ...state, attemptedAt: startedAt }))
  await clear($, 'gitlab')
  const base = previous?.rows ?? []
  const extras = new Set(previous?.extras ?? [])
  const inputs = hosts.map(
    (host): HostAsk => ({
      host,
      base: base.filter(row => row.host === host),
      pinned: pins.filter(one => one.host === host),
      extras,
      cursor: previous?.cursors[host],
      isFresh,
      now: startedAt,
    })
  )
  const [reads] = await Promise.all([readGitLab($, inputs), inboxPass($, hosts, isInboxDue, startedAt)])
  // With several hosts, each failure says whose it is.
  const labelled = (host: string, one: Failure) => new Failure(one.kind, hosts.length > 1 ? `${host}: ${one.message}` : one.message)
  const failures = reads.flatMap(read => ('failure' in read ? [labelled(read.host, read.failure)] : []))
  const answers = reads.flatMap(read => ('answer' in read ? [{ host: read.host, ...read.answer }] : []))
  const notes = answers.flatMap(answer => answer.notes.map(note => labelled(answer.host, note)))
  const outcomes = reads.map(read => ({ host: read.host, error: 'failure' in read ? read.failure.message : null }))
  const now = await $.clock.now()
  if (answers.length === 0) {
    const all = together(failures)
    await record($, 'gitlab', all)
    await changeReads($, state => ({ ...state, failures: state.failures + 1 }))
    const failed = nextSnapshot(
      previous,
      {
        rows: base,
        outcomes,
        error: all.message,
        kept: previous?.kept ?? 0,
        cursors: previous?.cursors ?? {},
        pinned: pins.map(pinKey),
        extras: [...extras],
        failures: previous?.failures ?? {},
        problems: await readLeaderProblems($),
      },
      me,
      now
    )
    await share($, failed)
    await adopt($, failed, true)
    return
  }
  const fresh = answers.flatMap(answer => answer.rows)
  // A read GitLab partly timed out, or a host that failed, keeps the cards it left out as last seen, so none vanishes or
  // closes for a poll.
  const behind = new Set([
    ...reads.flatMap(read => ('failure' in read ? [read.host] : [])),
    ...answers.filter(answer => answer.lost > 0 && answer.scope === 'open').map(answer => answer.host),
  ])
  const kept = behind.size > 0 ? base.filter(row => behind.has(row.host) && !fresh.some(each => each.key === row.key)) : []
  const lostInDelta = answers.filter(answer => answer.scope === 'since').reduce((sum, answer) => sum + answer.lost, 0)
  if (failures.length + notes.length > 0) {
    await record($, 'gitlab', together([...failures, ...notes]))
  }
  const answeredCursors = Object.fromEntries(answers.map((answer): [string, Cursor] => [answer.host, answer.cursor]))
  const rows = [...fresh, ...kept]
  const result: ReadResult = {
    rows,
    outcomes,
    error: failures.length > 0 ? together(failures).message : null,
    kept: kept.length + lostInDelta,
    cursors: { ...Object.fromEntries(Object.entries(previous?.cursors ?? {}).filter(([host]) => hosts.includes(host))), ...answeredCursors },
    pinned: pins.map(pinKey),
    extras: [...answers.flatMap(answer => answer.extras), ...[...extras].filter(key => reads.some(read => 'failure' in read && key.startsWith(`${read.host}/`)))],
    failures: await reasonsFor($, rows, pins, previous?.failures ?? {}),
    problems: await readLeaderProblems($),
  }
  const snapshot = nextSnapshot(previous, result, me, now)
  if (needsSave(previous, snapshot)) {
    await share($, snapshot)
  }
  await changeReads($, state => ({ ...state, failures: 0 }))
  if (snapshot.version !== (await readReads($)).adopted) {
    await adopt($, snapshot, true)
  } else {
    quietly($, refreshDetails($))
  }
  afterRead(
    $,
    snapshot.rows.filter(row => row.isOpen),
    now
  )
}

/** The leader's turn: reads when a read is due (the pace, a new pin, a request), else draws what is in the store. */
async function leadTick($: EngineInterface, own: readonly Pinned[]): Promise<void> {
  const [snapshot, reads, now, asked] = await Promise.all([loadSnapshot($), readReads($), $.clock.now(), readRefreshes($)])
  const pins = await pinsToRead($, own)
  const last = Math.max(snapshot?.attemptedAt ?? 0, reads.attemptedAt ?? 0)
  const isAsked = asked > reads.refreshed
  // A pin the last read did not ask for, and that no card of it holds: an MR just raised, or someone else's just watched.
  const isNewPin = snapshot !== null && pins.some(one => !snapshot.pinned.includes(pinKey(one)) && !snapshot.rows.some(row => row.key === pinKey(one)))
  const isDue = snapshot === null || isAsked || isNewPin || now - last >= pollEvery(reads.failures, isMoving(snapshot.rows, pins))
  const isInboxDue = isAsked || reads.inboxAt === null || now - reads.inboxAt >= INBOX_EVERY_MS
  if (isDue) {
    await changeReads($, state => ({ ...state, refreshed: asked }))
    const isFirst = reads.adopted === ''
    // ↻ only for a read someone waits on (the first, one asked for, one over stale cards): each write redraws the whole pane.
    await setReading($, isFirst || isAsked || snapshot === null || now - (snapshot.fetchedAt ?? 0) >= 2 * FOOTER_MS)
    if (snapshot !== null && isFirst) {
      await preview($, snapshot)
    }
    try {
      await lead($, snapshot, pins, isAsked, isInboxDue)
    } finally {
      await setReading($, false)
    }
    return
  }
  if (snapshot.version !== reads.adopted) {
    await adopt($, snapshot, true)
  } else {
    quietly($, refreshDetails($))
  }
  await inboxPass($, await readHosts($), isInboxDue, now)
}

/**
 * A follower's turn: draws the snapshot when it has a version it has not drawn, and the leader's inbox when that changed or
 * a minute has passed, which is how often it looks at the marks (a mark is kept in the store by whichever session it was made in).
 */
async function followTick($: EngineInterface): Promise<void> {
  const [snapshot, reads, shared, now] = await Promise.all([loadSnapshot($), readReads($), sharedInboxAt($), $.clock.now()])
  if (snapshot !== null && snapshot.version !== reads.adopted) {
    await adopt($, snapshot)
  }
  if (shared !== null && (shared !== reads.inboxSeen || now - (reads.inboxAt ?? 0) >= INBOX_EVERY_MS)) {
    const seen = await followInbox($)
    await changeReads($, state => ({ ...state, inboxAt: now, inboxSeen: seen }))
  }
}

/** The turn of a session that draws no pane but raised an MR: those MRs alone, slowly. */
async function watchTick($: EngineInterface, own: readonly Pinned[]): Promise<void> {
  const [reads, now] = await Promise.all([readReads($), $.clock.now()])
  if (reads.attemptedAt !== null && now - reads.attemptedAt < Math.max(WAKE_ONLY_EVERY_MS, pollEvery(reads.failures, false))) {
    return
  }
  await changeReads($, state => ({ ...state, attemptedAt: now }))
  const { cards, failures } = await readRaised($, own.filter(isRaised))
  if (failures.length > 0) {
    await record($, 'gitlab', together(failures))
  } else {
    await clear($, 'gitlab')
  }
  await changeReads($, state => ({ ...state, failures: failures.length > 0 ? state.failures + 1 : 0 }))
  await applyCards($, cards, now, (card, jobs) => readFailures($, card, jobs))
}

/**
 * The tick, every couple of seconds, in every session: says whether this session's pane is drawn, takes part in the
 * election, tells the other sessions what it pinned, and does what its role is.
 */
async function stepOnce($: EngineInterface): Promise<void> {
  const own = await readPins($)
  const tick = await leaseTick($, { isDrawing: await isPaneDrawn($), raisedPins: own.filter(isRaised).length })
  await setRole($, tick.role)
  if (tick.problem !== null) {
    await record($, 'store', tick.problem)
  } else {
    await clear($, 'store')
  }
  await publishPins($, own)
  switch (tick.role) {
    case 'leader':
      return leadTick($, own)
    case 'follower':
      return followTick($)
    case 'wake-only':
      return watchTick($, own)
    case 'idle':
      return undefined
  }
}

/** One tick at a time; a tick arriving mid-tick gets the next one. */
export function step($: EngineInterface): Promise<void> {
  return serialised('step', () => stepOnce($))
}

/** Asks for a read now: the leader reads at its next turn, which this runs at once. */
export async function refresh($: EngineInterface): Promise<void> {
  await askForRefresh($)
  await step($)
}

/** Pins an MR to this session and answers what it looks like now, saying so when that is stale. */
export async function pin($: EngineInterface, url: string, origin: 'raised' | 'watched'): Promise<ModelLine> {
  const hosts = await readHosts($)
  const parsed = parseMrUrl(url, hosts)
  if (parsed === null) {
    throw new Error(`Not a merge request URL on ${hosts.join(', ')}: ${url}`)
  }
  await pinMr($, parsed, origin)
  await publishPins($, await readPins($))
  await step($)
  // The leader's read has it; a session that only draws, or draws nothing, asks GitLab for this one MR itself.
  let unread: Failure | null = null
  let card: MrCard | null = null
  if ((await readRole($)) !== 'leader') {
    try {
      card = await readSingle($, parsed)
    } catch (error) {
      unread = error instanceof Failure ? error : new Failure('unknown', String(error))
    }
  }
  // What this session knows of the MR now, seen for the first time: its news from here on is news.
  const known = (await readRows($)).filter(row => row.key !== card?.key)
  await applyCards($, card !== null ? [...known, card] : known, await $.clock.now(), (one, jobs) => readFailures($, one, jobs))
  const [rows, poll, now] = await Promise.all([readRows($), readPoll($), $.clock.now()])
  const row = rows.find(one => one.key === pinKey(parsed))
  // Only the MR's own host is told of: another host failing says nothing of this answer.
  const status = poll.hosts[parsed.host]
  const error = unread?.message ?? status?.error ?? null
  const age = unread === null && status?.fetchedAt != null ? line`; this is ${ago(new Date(status.fetchedAt).toISOString(), now)} old` : EMPTY
  const stale = error !== null ? line`GitLab could not be read (${foreign(error, URL_ROOM)})${age}` : EMPTY
  if (row !== undefined) {
    return dotted([describe(row, now), stale])
  }
  return line`Pinned !${parsed.iid}; ${stale.length > 0 ? stale : line`GitLab did not return it.`}`
}
