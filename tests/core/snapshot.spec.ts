import { expect, test } from 'vitest'
import fc from 'fast-check'

import { toCard } from '../../hooks/gitlab.ts'
import { INBOX_EVERY_MS, isInboxDue, keptCards, keptCardsByKey } from '../../hooks/snapshot.ts'
import { HOST, NOW, rawMr } from '../fixtures.ts'

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
