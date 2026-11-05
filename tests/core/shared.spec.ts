import { expect, test } from 'vitest'
import fc from 'fast-check'

import { NOW, HOST, heavyMr, pipe, project, rawMr } from '../fixtures.ts'
import { parseJson } from '../../hooks/decode.ts'
import { failedCount, threadCount } from '../../hooks/format.ts'
import { cardFacts } from '../../hooks/row-facts.ts'
import { toCard } from '../../hooks/gitlab.ts'
import { cursorAfter, FULL_EVERY_MS, mergeReads, movingRows, OVERLAP_MS, scopeFor } from '../../hooks/incremental.ts'
import { slimCard, withDetail } from '../../hooks/slim.ts'
import {
  FOOTER_MS,
  isAlive,
  isMoving,
  isPublished,
  MOVING_EVERY_MS,
  nextSnapshot,
  PINS_BEAT_MS,
  PINS_EXPIRY_MS,
  pollEvery,
  QUIET_EVERY_MS,
  readPinsRecord,
  readSnapshot,
  unionPins,
} from '../../hooks/snapshot.ts'
import type { ReadResult } from '../../hooks/snapshot.ts'
import { pinnedQuery } from '../../hooks/gitlab-documents.ts'
import { pinKey } from '../../hooks/mr-url.ts'

import type { MergeStatus, MrCard, Pinned } from '../../types'

const pin = (iid: number, origin?: 'raised' | 'watched'): Pinned => ({
  url: `https://gitlab.com/g/p/-/merge_requests/${iid}`,
  host: HOST,
  path: 'g/p',
  iid,
  ...(origin !== undefined ? { origin } : {}),
})

const heavy = (iid: number): MrCard => toCard(HOST, heavyMr(iid))

/** The most characters the snapshot of fifty such MRs may take: about a sixth of the store. */
const SNAPSHOT_BUDGET = 270_000

const read = (rows: MrCard[], over: Partial<ReadResult> = {}): ReadResult => ({
  rows,
  outcomes: [{ host: HOST, error: null }],
  error: null,
  kept: 0,
  cursors: {},
  pinned: [],
  extras: [],
  failures: {},
  problems: {},
  ...over,
})

test('fifty heavy MRs share a snapshot well under the store, and a slim card says what a full one does on a row', () => {
  const full = Array.from({ length: 50 }, (_, i) => heavy(2000 + i))
  const slim = full.map(slimCard)
  const snapshot = nextSnapshot(null, read(slim), 'a', NOW)
  // The store is one file of 4 MiB every session rewrites whole; the same cards whole would take most of it.
  const size = JSON.stringify(snapshot).length
  expect(size).toBeLessThan(SNAPSHOT_BUDGET)
  expect(JSON.stringify(full).length).toBeGreaterThan(size * 5)
  expect(readSnapshot(parseJson(JSON.stringify(snapshot)))).toEqual(snapshot)
  // What a row, a hover card and a wake say is the same from the slim card.
  const [one] = full
  const [shared] = slim
  if (one === undefined || shared === undefined) {
    throw new Error('no card')
  }
  const whole = cardFacts(one, {})
  const quick = cardFacts(shared, {})
  expect({ ...quick, detail: null, threads: [], loose: [], people: [] }).toEqual({ ...whole, detail: null, threads: [], loose: [], people: [] })
  // The first threads stay, and the rest are counted: the row says the same of how many there are.
  expect(quick.threads.map(note => note.excerpt)).toEqual(whole.threads.slice(0, quick.threads.length).map(note => note.excerpt))
  expect(threadCount(shared)).toBe(threadCount(one))
  if (shared.pipeline === undefined || one.pipeline === undefined) {
    throw new Error('no pipeline')
  }
  expect(failedCount(shared.pipeline)).toBe(failedCount(one.pipeline))
  expect(quick.people.map(person => [person.standing, person.noteCount, person.notes[0]?.excerpt])).toEqual(
    whole.people.map(person => [person.standing, person.noteCount, person.notes[0]?.excerpt])
  )
})

test('an opened card has its description and threads put back, unless it changed since they were read', () => {
  const whole = heavy(1)
  const shared = slimCard(whole)
  expect(shared.description).toBe('')
  expect(withDetail(shared, whole).description).toBe(whole.description)
  expect(withDetail(shared, whole).openThreads).toEqual(whole.openThreads)
  expect(withDetail(shared, whole).people.map(person => person.notes)).toEqual(whole.people.map(person => person.notes))
  expect(withDetail(shared, { ...whole, updatedAt: '2026-10-24T00:00:00Z' })).toBe(shared)
  expect(withDetail(shared, undefined)).toBe(shared)
})

test('a snapshot changes its version only when something a session draws changed, or the footer is five minutes old', () => {
  const rows = [slimCard(heavy(1))]
  const first = nextSnapshot(null, read(rows), 'a', NOW)
  const quiet = nextSnapshot(first, read(rows, { cursors: { [HOST]: { after: 'x', fullAt: NOW } } }), 'b', NOW + 60_000)
  expect(quiet.version).toBe(first.version)
  expect([quiet.fetchedAt, quiet.attemptedAt, quiet.by]).toEqual([first.fetchedAt, NOW + 60_000, 'b'])
  const changed = nextSnapshot(quiet, read(rows.map(row => ({ ...row, title: 'other' }))), 'a', NOW + 120_000)
  expect(changed.version).not.toBe(first.version)
  const failed = nextSnapshot(quiet, read(rows, { outcomes: [{ host: HOST, error: 'down' }], error: 'down' }), 'a', NOW + 120_000)
  expect([failed.version === first.version, failed.fetchedAt, failed.hosts[HOST]]).toEqual([false, first.fetchedAt, { fetchedAt: first.fetchedAt, error: 'down' }])
  expect(nextSnapshot(first, read(rows), 'a', NOW + FOOTER_MS).version).not.toBe(first.version)
  expect(readSnapshot({ ...first, format: 0 })).toBeNull()
  expect(readSnapshot({ ...first, rows: [{ key: 'x' }] })).toBeNull()
  expect(readSnapshot(null)).toBeNull()
})

test("every session's pins are published under its key, kept while it beats and dropped when it goes silent", () => {
  const record = { session: 'b', at: NOW, pins: [pin(2, 'watched'), pin(1)] }
  expect(readPinsRecord(parseJson(JSON.stringify(record)))).toEqual(record)
  expect(readPinsRecord({ ...record, pins: [{ url: 1 }] })).toBeNull()
  expect(unionPins([pin(1, 'raised')], [record], NOW + 1_000).map(pinKey)).toEqual(['gitlab.com/g/p!1', 'gitlab.com/g/p!2'])
  expect(unionPins([pin(1)], [record], NOW + PINS_EXPIRY_MS).map(pinKey)).toEqual(['gitlab.com/g/p!1'])
  // One session raised an MR that another only watches: the union has it raised, whichever session is asked.
  const raisedElsewhere = { session: 'a', at: NOW, pins: [pin(5, 'raised')] }
  expect(unionPins([pin(5, 'watched')], [raisedElsewhere], NOW).map(one => one.origin)).toEqual(['raised'])
  expect(unionPins([pin(5, 'raised')], [{ ...raisedElsewhere, pins: [pin(5, 'watched')] }], NOW).map(one => one.origin)).toEqual(['raised'])
  expect(unionPins([pin(5, 'watched')], [{ ...raisedElsewhere, pins: [pin(5, 'watched')] }], NOW).map(one => one.origin)).toEqual(['watched'])
  expect(isAlive(record, NOW + PINS_EXPIRY_MS - 1)).toBe(true)
  expect(isAlive({ ...record, at: NOW + PINS_EXPIRY_MS }, NOW)).toBe(false)
  expect(isPublished(record, record.pins, NOW + PINS_BEAT_MS - 1)).toBe(true)
  expect(isPublished(record, record.pins, NOW + PINS_BEAT_MS)).toBe(false)
  expect(isPublished(record, [pin(3)], NOW)).toBe(false)
  expect(isPublished(null, [], NOW)).toBe(false)
  expect(PINS_EXPIRY_MS).toBeGreaterThanOrEqual(3 * PINS_BEAT_MS)
})

test('the leader reads faster while a pinned pipeline runs and backs off after failures', () => {
  const running = toCard(HOST, rawMr(1, { headPipeline: pipe('RUNNING') }))
  const settled = toCard(HOST, rawMr(2, { headPipeline: pipe('SUCCESS') }))
  expect(isMoving([running, settled], [pin(1)])).toBe(true)
  expect(isMoving([running, settled], [pin(2)])).toBe(false)
  expect(isMoving([running], [])).toBe(false)
  expect([pollEvery(0, true), pollEvery(0, false), pollEvery(1, true), pollEvery(2, false), pollEvery(9, false)]).toEqual([
    MOVING_EVERY_MS,
    QUIET_EVERY_MS,
    120_000,
    240_000,
    600_000,
  ])
})

test('between whole reads a host is asked only for what changed since, and a whole read comes round every five minutes', () => {
  const cursor = cursorAfter({ kind: 'open' }, NOW, undefined)
  expect(cursor).toEqual({ after: new Date(NOW - OVERLAP_MS).toISOString(), fullAt: NOW })
  expect(scopeFor(undefined, NOW, false)).toEqual({ kind: 'open' })
  expect(scopeFor(cursor, NOW + 60_000, false)).toEqual({ kind: 'since', after: cursor.after })
  expect(scopeFor(cursor, NOW + 60_000, true)).toEqual({ kind: 'open' })
  expect(scopeFor(cursor, NOW + FULL_EVERY_MS, false)).toEqual({ kind: 'open' })
  // A delta moves where the next one starts and leaves the time of the last whole read alone.
  expect(cursorAfter({ kind: 'since', after: cursor.after }, NOW + 60_000, cursor)).toEqual({ after: new Date(NOW + 60_000 - OVERLAP_MS).toISOString(), fullAt: NOW })
})

test('a delta replaces the cards that changed, drops the merged unless pinned, keeps verdicts, and a whole read forgets what it lacks', () => {
  const card = (iid: number, over: Partial<MrCard> = {}): MrCard => ({ ...toCard(HOST, rawMr(iid)), ...over })
  const passing = [{ id: 'CI_MUST_PASS', status: 'success' as const }]
  const conflict = [{ id: 'CONFLICT', status: 'failed' as const }]
  const base = [card(1, { mergeStatus: passing }), card(2, { mergeStatus: passing }), card(3, { mergeStatus: passing }), card(4, { isOpen: false })]
  const delta = mergeReads({
    scope: 'since',
    base,
    fetched: [card(2, { title: 'newer' }), card(3, { isOpen: false }), card(5)],
    singles: [],
    pinned: new Set(['gitlab.com/g/p!3']),
    verdicts: new Map([['gitlab.com/g/p!5', conflict]]),
  })
  const byIid = Object.fromEntries(delta.map(row => [row.iid, [row.title, row.isOpen, row.mergeStatus]]))
  // 4 closed and nobody pins it any more; 3 closed but pinned stays, so each session can unpin it, with no verdict; 1 and 2 keep theirs.
  expect(byIid).toEqual({
    1: ['fix: [ABC-1] thing 1', true, passing],
    2: ['newer', true, passing],
    3: ['fix: [ABC-1] thing 3', false, null],
    5: ['fix: [ABC-1] thing 5', true, conflict],
  })
  const whole = mergeReads({ scope: 'open', base, fetched: [card(2)], singles: [], pinned: new Set(), verdicts: null })
  expect(whole.map(row => row.iid)).toEqual([2])
  expect(whole[0]?.mergeStatus).toBeNull()
  expect(movingRows([toCard(HOST, rawMr(1, { headPipeline: pipe('RUNNING') })), toCard(HOST, rawMr(2))]).map(row => row.iid)).toEqual([1])
})

test('a pinned MR is asked for by its path and number, one query each, and a project of its own host', () => {
  expect(pinnedQuery({ ...pin(7), path: 'g/q' }, { hasMergeVerdict: true, hasReviewStates: true, hasTodoEntity: true }).variables).toEqual({ path: 'g/q', iid: '7' })
  expect(project('g/q').fullPath).toBe('g/q')
})

// ---- properties -------------------------------------------------------------------------------------------------------

/** An MR of the world GitLab holds: changing it bumps its version and its update time. */
type World = Map<number, { version: number; isOpen: boolean; updatedAt: number }>

const MINUTE = 60_000
const worldCard = (iid: number, mr: { version: number; isOpen: boolean; updatedAt: number }): MrCard => ({
  ...toCard(HOST, rawMr(iid)),
  title: `version ${mr.version}`,
  isOpen: mr.isOpen,
  updatedAt: new Date(mr.updatedAt).toISOString(),
})

/** GitLab's verdicts, which it gives for open MRs only. */
const verdictsOf = (world: World): Map<string, MergeStatus> =>
  new Map(
    [...world].filter(([, mr]) => mr.isOpen).map(([iid, mr]) => [`gitlab.com/g/p!${iid}`, [{ id: 'CI_MUST_PASS', status: (iid + mr.version) % 2 === 0 ? 'success' : 'failed' }]])
  )

const rowsOf = (rows: readonly MrCard[]) => [...rows].sort((a, b) => a.key.localeCompare(b.key))

/** The rows a read leaves: a whole one, or a delta over the rows `base` of the read before. The pinned MRs the authored list lacks are read one by one. */
const readWorld = (world: World, pinned: ReadonlySet<number>, scope: 'open' | 'since', base: readonly MrCard[], after: string): MrCard[] => {
  const cards = [...world].map(([iid, mr]) => worldCard(iid, mr))
  return mergeReads({
    scope,
    base,
    fetched: scope === 'open' ? cards.filter(card => card.isOpen) : cards.filter(card => card.updatedAt > after),
    singles: cards.filter(card => !card.isOpen && pinned.has(card.iid)),
    pinned: new Set([...pinned].map(iid => `gitlab.com/g/p!${iid}`)),
    verdicts: verdictsOf(world),
  })
}

const worldArb = fc.dictionary(fc.integer({ min: 1, max: 8 }).map(String), fc.record({ version: fc.integer({ min: 0, max: 3 }), isOpen: fc.boolean() }), { maxKeys: 8 })
const changesArb = fc.dictionary(fc.integer({ min: 1, max: 10 }).map(String), fc.record({ isOpen: fc.boolean(), at: fc.integer({ min: 1, max: 59 }) }), { maxKeys: 10 })
const pinsArb = fc.uniqueArray(fc.integer({ min: 1, max: 10 }), { maxLength: 4 })

test('a delta read on a whole read is the whole read made fresh, for any MRs that changed, closed or appeared since', () => {
  fc.assert(
    fc.property(worldArb, changesArb, pinsArb, pinsArb, (initial, changes, earlier, later) => {
      const before: World = new Map(Object.entries(initial).map(([iid, mr]) => [Number(iid), { ...mr, updatedAt: NOW - 60 * MINUTE }]))
      const now: World = new Map(before)
      for (const [iid, change] of Object.entries(changes)) {
        // Whatever GitLab changes about an MR it stamps: a new version, a state, a time after the read before it.
        now.set(Number(iid), { version: (before.get(Number(iid))?.version ?? 0) + 1, isOpen: change.isOpen, updatedAt: NOW + change.at * MINUTE })
      }
      const whole = readWorld(before, new Set(earlier), 'open', [], '')
      const { after } = cursorAfter({ kind: 'open' }, NOW, undefined)
      const delta = readWorld(now, new Set(later), 'since', whole, after)
      expect(rowsOf(delta)).toEqual(rowsOf(readWorld(now, new Set(later), 'open', [], '')))
    })
  )
})
