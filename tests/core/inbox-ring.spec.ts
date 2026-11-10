import { expect, test } from 'vitest'
import fc from 'fast-check'

import { ITEMS_SHOWN, cardButtons, footerButtons, ringStep } from '../../hooks/inbox-ring.ts'
import type { RingCard } from '../../hooks/inbox-ring.ts'

const RULE = 'on-my-mrs'

/** A card of the open rule; one with nothing to open has no title to press. */
const card = (iid: number, canOpen = true): RingCard => ({ key: `gitlab.com/g/p!${iid}`, activity: canOpen ? [{ kind: 'comment' }] : [] })

const cards = [card(1), card(2), card(3)]
const title = (iid: number) => cardButtons(`gitlab.com/g/p!${iid}`).open
const tick = (iid: number) => cardButtons(`gitlab.com/g/p!${iid}`).seen
const less = (iid: number) => cardButtons(`gitlab.com/g/p!${iid}`).less

test('down with the ring on nothing lands on the first card, and up leaves the arrow to scroll', () => {
  expect(ringStep(cards, RULE, '', 1)).toBe(title(1))
  expect(ringStep(cards, RULE, '', -1)).toBeNull()
})

test('the arrows walk the cards by their titles, whichever of its buttons the ring is on', () => {
  expect(ringStep(cards, RULE, title(1), 1)).toBe(title(2))
  expect(ringStep(cards, RULE, tick(2), 1)).toBe(title(3))
  expect(ringStep(cards, RULE, less(2), -1)).toBe(title(1))
  expect(ringStep(cards, RULE, title(3), -1)).toBe(title(2))
})

test('past the first or the last card the arrow scrolls, so the tabs above and the footer below still come into view', () => {
  expect(ringStep(cards, RULE, title(1), -1)).toBeNull()
  expect(ringStep(cards, RULE, title(3), 1)).toBeNull()
})

test('from a button above the cards down lands on the first, and from the footer up lands on the last', () => {
  expect(ringStep(cards, RULE, 'inbox-rule-mentions', 1)).toBe(title(1))
  expect(ringStep(cards, RULE, 'tab-inbox', -1)).toBeNull()
  const { discuss, seen } = footerButtons(RULE)
  expect(ringStep(cards, RULE, discuss, -1)).toBe(title(3))
  expect(ringStep(cards, RULE, seen, -1)).toBe(title(3))
  expect(ringStep(cards, RULE, seen, 1)).toBeNull()
})

test('a card with nothing to open is stopped at on its ✓', () => {
  const quiet = [card(1), card(2, false), card(3)]
  expect(ringStep(quiet, RULE, title(1), 1)).toBe(tick(2))
  expect(ringStep(quiet, RULE, tick(2), 1)).toBe(title(3))
  expect(ringStep(quiet, RULE, title(3), -1)).toBe(tick(2))
})

test('an empty rule leaves every arrow to scroll', () => {
  expect(ringStep([], RULE, '', 1)).toBeNull()
  expect(ringStep([], RULE, footerButtons(RULE).seen, -1)).toBeNull()
})

test('the ring walks only the cards the rule draws, not those counted under +N more', () => {
  const many = Array.from({ length: ITEMS_SHOWN + 5 }, (_, at) => card(at + 1))
  expect(ringStep(many, RULE, title(ITEMS_SHOWN), 1)).toBeNull()
  expect(ringStep(many, RULE, footerButtons(RULE).seen, -1)).toBe(title(ITEMS_SHOWN))
})

test('down then up from any card comes back to it, and every move lands on a card or leaves the arrow to scroll', () => {
  fc.assert(
    fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }), fc.nat(), (opens, pick) => {
      const list = opens.map((canOpen, at) => card(at + 1, canOpen))
      const shown = list.slice(0, ITEMS_SHOWN)
      const stops = shown.map((one, at) => (opens[at] === true ? cardButtons(one.key).open : cardButtons(one.key).seen))
      const from = stops[pick % stops.length] ?? ''
      for (const by of [1, -1] as const) {
        const to = ringStep(list, RULE, from, by)
        expect(to === null || (stops.includes(to) && ringStep(list, RULE, to, by === 1 ? -1 : 1) === from)).toBe(true)
      }
    })
  )
})
