import { expect, test } from 'vitest'

import { INBOX_FOUND_SHOWN, foundList, matchesOf } from '../../hooks/found-model.ts'
import { toCard } from '../../hooks/gitlab.ts'
import { cardKey } from '../../hooks/hosts.ts'
import { queryOf } from '../../hooks/search.ts'
import type { Query } from '../../hooks/search.ts'
import { HOST, NOW, rawMr } from '../fixtures.ts'

import type { InboxMr, Landed, MrCard } from '../../types'

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

test('the inbox lists the few that match best, the inbox tab holding the rest', () => {
  const many = Array.from({ length: INBOX_FOUND_SHOWN + 3 }, (_, i) => inboxOf(100 + i, `Retry ${i}`))
  expect(matchesOf(query('retry'), held({ inbox: many })).inbox).toHaveLength(INBOX_FOUND_SHOWN)
  expect(matchesOf(query('!107'), held({ inbox: many })).inbox.map(row => row.mr.text)).toEqual(['🔀 !107 Retry 7'])
})

test('merged MRs come in the order the search ranks them, not when they merged', () => {
  const landed = [landedOf(19, 'fix: Retry 9 times', NOW - 60_000), landedOf(9, 'fix: [AB-9] Retry', NOW - 7_200_000)]
  // Its own number ranks !9 above !19, though !19 merged later.
  expect(matchesOf(query('retry 9'), held({ landed })).merged.map(row => row.key)).toEqual([cardKey(HOST, 'g/p', 9), cardKey(HOST, 'g/p', 19)])
  // Merged rows with nothing to rank them apart are newest first, as the merged section has them.
  expect(matchesOf(query('retry'), held({ landed })).merged.map(row => row.key)).toEqual([cardKey(HOST, 'g/p', 19), cardKey(HOST, 'g/p', 9)])
})

test('the list counts all it found, cards, merged and inbox, and says when it found nothing', () => {
  const found = matchesOf(query('retry'), held({ cards: [toCard(HOST, rawMr(5, { title: 'Retry' }))], landed: [landedOf(6, 'Retry')], inbox: [inboxOf(7, 'Retry')] }))
  expect(foundList(found, cards => cards.map(card => card.iid))).toEqual({ heading: 'Found · 3', isEmpty: false, rows: [5], merged: found.merged, inbox: found.inbox })
  expect(foundList(matchesOf(query('zebra'), held({})), () => [])).toMatchObject({ heading: 'Found · 0', isEmpty: true })
})
