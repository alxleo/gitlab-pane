import { expect, test } from 'vitest'

import { INBOX_FOUND_SHOWN, foundList, matchesOf } from '../hooks/found-model'
import { cardKey } from '../hooks/hosts'
import { toCard } from '../hooks/mr-card'
import { queryOf } from '../hooks/search'
import type { Query } from '../hooks/search'
import { HOST, NOW, SELF_MANAGED, rawMr } from '../tests/fixtures'

import type { InboxMr, Landed, MrCard } from '../types'

const query = (text: string): Query => queryOf(text) ?? { words: [] }

const landedOf = (iid: number, title: string, mergedAt = NOW - 3_600_000): Landed => ({
  host: HOST,
  path: 'g/p',
  iid,
  title,
  url: `https://${HOST}/g/p/-/merge_requests/${iid}`,
  mergedAt,
  targetBranch: 'main',
  sha: 'a'.repeat(40),
  build: null,
  checkedAt: NOW,
  hasFailed: false,
})

const inboxOf = (iid: number, title: string, over: Partial<InboxMr> = {}): InboxMr => ({
  host: HOST,
  path: 'g/shop',
  iid,
  title,
  url: `https://${HOST}/g/shop/-/merge_requests/${iid}`,
  author: 'sam',
  authorName: 'Sam Lee',
  isMine: false,
  state: 'opened',
  isDraft: false,
  inQueue: false,
  isFollowed: false,
  cutoff: null,
  signals: [],
  ...over,
})

const held = (over: { cards?: MrCard[]; landed?: Landed[]; inbox?: InboxMr[] }) => ({ cards: [], landed: [], inbox: [], now: NOW, ...over })

test('an inbox MR is one link, then its repo, who wrote it and what became of it once it is not open', () => {
  const { inbox } = matchesOf(query('queue'), held({ inbox: [inboxOf(71, 'fix: Retry the queue'), inboxOf(72, 'Queue metrics', { state: 'merged', authorName: '' })] }))
  expect(inbox.map(row => [row.mr.text, row.about])).toEqual([
    ['🔀 !71 Retry the queue', 'shop · Sam Lee'],
    ['🔀 !72 Queue metrics', 'shop · sam · merged'],
  ])
  expect(inbox[0]?.key).toBe(cardKey(HOST, 'g/shop', 71))
})

test('an MR the search shows as a card or a merged row is not listed again from the inbox, nor twice from it', () => {
  const card = toCard(HOST, rawMr(5, { title: 'fix: Retry five' }))
  const own = { ...inboxOf(5, 'fix: Retry five'), path: 'g/p', isMine: true }
  const merged = { ...inboxOf(6, 'fix: Retry six'), path: 'g/p', isMine: true, state: 'merged' }
  const twice = inboxOf(7, 'Retry seven')
  const found = matchesOf(query('retry'), held({ cards: [card], landed: [landedOf(6, 'fix: Retry six')], inbox: [own, merged, twice, twice] }))
  expect(found.cards.map(each => each.key)).toEqual([card.key])
  expect(found.merged.map(row => row.key)).toEqual([cardKey(HOST, 'g/p', 6)])
  expect(found.inbox.map(row => row.key)).toEqual([cardKey(HOST, 'g/shop', 7)])
})

test('the inbox lists the few that match best, counts the rest and says the inbox tab holds them', () => {
  const many = Array.from({ length: INBOX_FOUND_SHOWN + 3 }, (_, i) => inboxOf(100 + i, `Retry ${i}`))
  const matches = matchesOf(query('retry'), held({ inbox: many }))
  expect(matches.inbox).toHaveLength(INBOX_FOUND_SHOWN)
  expect(foundList(matches, () => [])).toMatchObject({ heading: `Found · ${INBOX_FOUND_SHOWN + 3}`, inboxMore: '+3 more in the Inbox tab', mergedMore: null })
  expect(matchesOf(query('!107'), held({ inbox: many })).inbox.map(row => row.mr.text)).toEqual(['🔀 !107 Retry 7'])
})

test('merged matches past the five shown are counted and said', () => {
  const two = (host: string, iids: number[]) => iids.map(iid => ({ ...landedOf(iid, `Retry ${iid}`), host }))
  const matches = matchesOf(query('retry'), held({ landed: [...two(HOST, [1, 2, 3, 4, 5]), ...two(SELF_MANAGED, [6, 7])] }))
  expect(foundList(matches, () => [])).toMatchObject({ heading: 'Found · 7', mergedMore: '+2 more merged', inboxMore: null })
})

test('merged MRs come in the order the search ranks them, not when they merged', () => {
  const landed = [landedOf(19, 'fix: Retry 9 times', NOW - 60_000), landedOf(9, 'fix: [AB-9] Retry', NOW - 7_200_000)]
  // Its own number ranks !9 above !19, though !19 merged later.
  expect(matchesOf(query('retry 9'), held({ landed })).merged.map(row => row.key)).toEqual([cardKey(HOST, 'g/p', 9), cardKey(HOST, 'g/p', 19)])
  // Merged rows with nothing to rank them apart are newest first, as the merged section has them.
  expect(matchesOf(query('retry'), held({ landed })).merged.map(row => row.key)).toEqual([cardKey(HOST, 'g/p', 19), cardKey(HOST, 'g/p', 9)])
})

test('of the merged MRs the pane holds, five from each host, a search keeps the five that match best, not the five newest', () => {
  // What the inbox's read keeps: the newest five merged on each host within three days, and what a failing host left, older.
  const newer = [101, 102, 103, 104, 105].map(iid => landedOf(iid, `fix: 9 ${iid}`, NOW - 60_000))
  const exact = { ...landedOf(9, 'fix: nine', NOW - 40 * 3_600_000), host: SELF_MANAGED }
  const old = { ...landedOf(99, 'fix: nine again', NOW - 4 * 86_400_000), host: SELF_MANAGED }
  const keys = matchesOf(query('9'), held({ landed: [...newer, exact, old] })).merged.map(row => row.key)
  expect(keys).toHaveLength(5)
  expect(keys[0]).toBe(cardKey(SELF_MANAGED, 'g/p', 9))
  expect(keys).not.toContain(cardKey(SELF_MANAGED, 'g/p', 99))
})

test('of merged MRs that match as well, from two hosts, the newest are kept and come first', () => {
  const older = [1, 2, 3, 4, 5].map(iid => landedOf(iid, `Retry ${iid}`, NOW - (75 - iid * 10) * 3_600_000))
  const newest = [6, 7].map(iid => ({ ...landedOf(iid, `Retry ${iid}`, NOW - (iid - 5) * 60_000), host: SELF_MANAGED }))
  const keys = matchesOf(query('retry'), held({ landed: [...older, ...newest] })).merged.map(row => row.key)
  expect(keys).toEqual([cardKey(SELF_MANAGED, 'g/p', 6), cardKey(SELF_MANAGED, 'g/p', 7), cardKey(HOST, 'g/p', 5), cardKey(HOST, 'g/p', 4), cardKey(HOST, 'g/p', 3)])
})

test('a merged MR still listed as a card takes none of the five merged places', () => {
  const card = toCard(HOST, rawMr(10, { title: 'Retry ten' }))
  const landed = [landedOf(10, 'Retry ten', NOW - 60_000), ...[1, 2, 3, 4, 5].map(iid => landedOf(iid, `Retry ${iid}`, NOW - iid * 3_600_000))]
  expect(matchesOf(query('retry'), held({ cards: [card], landed })).merged.map(row => row.key)).toEqual([1, 2, 3, 4, 5].map(iid => cardKey(HOST, 'g/p', iid)))
})

test('an open MR is found by its author and its branch', () => {
  const card = toCard(HOST, rawMr(5, { title: 'Other', author: { username: 'maya.ortiz' }, sourceBranch: 'feature/abc-180-totals' }))
  expect(matchesOf(query('maya'), held({ cards: [card] })).cards.map(each => each.iid)).toEqual([5])
  expect(matchesOf(query('abc180'), held({ cards: [card] })).cards.map(each => each.iid)).toEqual([5])
})

test('an inbox MR is found by its author’s name and its repo, a merged one by its repo', () => {
  const inbox = [inboxOf(71, 'fix: Retry the queue')]
  expect(matchesOf(query('lee'), held({ inbox })).inbox.map(row => row.key)).toEqual([cardKey(HOST, 'g/shop', 71)])
  expect(matchesOf(query('shop queue'), held({ inbox })).inbox.map(row => row.key)).toEqual([cardKey(HOST, 'g/shop', 71)])
  expect(matchesOf(query('g/p'), held({ landed: [landedOf(6, 'Other')] })).merged.map(row => row.key)).toEqual([cardKey(HOST, 'g/p', 6)])
})

test('the list counts all it found, cards, merged and inbox, and says when it found nothing', () => {
  const found = matchesOf(query('retry'), held({ cards: [toCard(HOST, rawMr(5, { title: 'Retry' }))], landed: [landedOf(6, 'Retry')], inbox: [inboxOf(7, 'Retry')] }))
  expect(foundList(found, cards => cards.map(card => card.iid))).toEqual({
    heading: 'Found · 3',
    isEmpty: false,
    rows: [5],
    merged: found.merged,
    mergedMore: null,
    inbox: found.inbox,
    inboxMore: null,
  })
  expect(foundList(matchesOf(query('zebra'), held({})), () => [])).toMatchObject({ heading: 'Found · 0', isEmpty: true })
})
