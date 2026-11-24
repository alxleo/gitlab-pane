import { expect, test } from 'vitest'
import fc from 'fast-check'

import { toCard } from '../hooks/mr-card'
import { INBOX_EVERY_MS, isInboxDue, isPassDue, keptCards, keptCardsByKey } from '../hooks/snapshot'
import { HOST, NOW, rawMr } from '../tests/fixtures'

test('cards an older version kept, without what GitLab says of merging, are left out of what the session draws', () => {
  const card = toCard(HOST, rawMr(12))
  const older = Object.fromEntries(Object.entries(toCard(HOST, rawMr(13))).filter(([field]) => field !== 'merging'))
  expect(keptCards([card, older]).map(kept => kept.iid)).toEqual([12])
  expect(Object.keys(keptCardsByKey({ [card.key]: card, older }))).toEqual([card.key])
  // A card whose merge verdict was not read keeps its null.
  expect(keptCards([{ ...card, merging: null }])).toHaveLength(1)
})

test('the inbox is read first at once, then no more than once a minute, unless a person asks', () => {
  expect(isInboxDue(null, NOW, false)).toBe(true)
  expect(isInboxDue(NOW, NOW + INBOX_EVERY_MS - 1, false)).toBe(false)
  expect(isInboxDue(NOW, NOW + INBOX_EVERY_MS, false)).toBe(true)
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 10 * INBOX_EVERY_MS }), since => {
      expect(isInboxDue(NOW, NOW + since, true)).toBe(true)
      expect(isInboxDue(NOW, NOW + since, false)).toBe(since >= INBOX_EVERY_MS)
    })
  )
})

test('a pass over some keys is made first at once, then at its pace, or as soon as a key the last pass did not ask appears', () => {
  const EVERY = 30 * 60_000
  const last = { at: NOW, asked: ['a', 'b'] }
  expect(isPassDue(['a'], { at: null, asked: [] }, EVERY, NOW)).toBe(true)
  expect(isPassDue([], { at: null, asked: [] }, EVERY, NOW)).toBe(false)
  // A key the pass asked counts as read, whatever came of it: it waits for the next pass.
  expect(isPassDue(['a', 'b'], last, EVERY, NOW + EVERY - 1)).toBe(false)
  expect(isPassDue(['b'], last, EVERY, NOW + 1)).toBe(false)
  expect(isPassDue(['a', 'b'], last, EVERY, NOW + EVERY)).toBe(true)
  expect(isPassDue(['a', 'c'], last, EVERY, NOW + 1)).toBe(true)
  // A pass an older version kept names no key, so the first read after the update makes one.
  expect(isPassDue(['a'], { at: NOW, asked: undefined }, EVERY, NOW + 1)).toBe(true)
  fc.assert(
    fc.property(fc.uniqueArray(fc.string(), { minLength: 1, maxLength: 5 }), fc.integer({ min: 0, max: 3 * EVERY }), (keys, since) => {
      expect(isPassDue(keys, { at: NOW, asked: keys }, EVERY, NOW + since)).toBe(since >= EVERY)
    })
  )
})
