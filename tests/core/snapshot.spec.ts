import { expect, test } from 'vitest'
import fc from 'fast-check'

import { INBOX_EVERY_MS, isInboxDue } from '../../hooks/snapshot.ts'
import { NOW } from '../fixtures.ts'

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
