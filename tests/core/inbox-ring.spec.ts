import { expect, test } from 'vitest'
import fc from 'fast-check'

import { ITEMS_SHOWN, arrowSteps, cardButtons, footerButtons, handOver, ringAfterSeen, ringStep } from '../../hooks/inbox-ring.ts'
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

test('arrows pressed faster than the pane answers move the ring as many cards, and stop at the last one', () => {
  expect(ringStep(cards, RULE, '', 2)).toBe(title(2))
  expect(ringStep(cards, RULE, title(1), 5)).toBe(title(3))
  expect(ringStep(cards, RULE, title(3), -2)).toBe(title(1))
  expect(ringStep(cards, RULE, title(3), 2)).toBeNull()
})

test('a card the drawing left out is not stepped onto: the ring stops at the last card drawn', () => {
  const drawn = [cards[0], cards[1]].flatMap(one => (one === undefined ? [] : [one]))
  expect(ringStep(drawn, RULE, title(2), 1)).toBeNull()
  expect(ringStep(drawn, RULE, footerButtons(RULE).seen, -1)).toBe(title(2))
})

const scroll = (by: number, over: Partial<Parameters<typeof arrowSteps>[0]> = {}) => arrowSteps({ isPerson: true, hasPointer: false, by, bodyRows: 20, isInboxList: true, ...over })

test("only the person's scroll keys move the ring, and only on the inbox's list: the wheel, the mod's own scrolls, page keys, Mine and an MR's page scroll", () => {
  expect(scroll(1)).toBe(1)
  expect(scroll(-1)).toBe(-1)
  // Two arrows the engine summed while the hook was busy.
  expect(scroll(3)).toBe(3)
  expect(scroll(1, { hasPointer: true })).toBe(0)
  expect(scroll(1, { isPerson: false })).toBe(0)
  expect(scroll(20)).toBe(0)
  expect(scroll(-20)).toBe(0)
  expect(scroll(0)).toBe(0)
  expect(scroll(1, { isInboxList: false })).toBe(0)
  // In a window one row tall a page key is a row too: an arrow still.
  expect(scroll(1, { bodyRows: 1 })).toBe(1)
})

test('✓ on the card holding the ring hands it to the card below, or above when it was the last', () => {
  expect(ringAfterSeen(cards, RULE, cards[0]?.key ?? '')).toBe(title(2))
  expect(ringAfterSeen(cards, RULE, cards[2]?.key ?? '')).toBe(title(2))
  expect(ringAfterSeen([card(1)], RULE, card(1).key)).toBeNull()
  expect(ringAfterSeen(cards, RULE, 'gitlab.com/g/p!99')).toBeNull()
})

test('after ✓ the ring waits for a drawing without the card, and stays put when the person moved it meanwhile', () => {
  const before = cards.map(one => one.key)
  const after = [cards[1]?.key ?? '', cards[2]?.key ?? '']
  const pressed = { at: tick(1), ringNow: tick(1), before, drawn: before, marked: after, isTimeUp: false }
  // A drawing that started before the mark still shows the card: the ring would land on it and slip a card.
  expect(handOver(pressed)).toBe('wait')
  expect(handOver({ ...pressed, drawn: after })).toBe('move')
  // In the review queue a card marked seen stays, lower down: the order changing is the drawing to wait for.
  expect(handOver({ ...pressed, drawn: [before[1] ?? '', before[0] ?? '', before[2] ?? ''] })).toBe('move')
  // A mark that leaves every card in its place, as in the review queue, has no drawing to wait for: nothing can slip.
  expect(handOver({ ...pressed, marked: before })).toBe('move')
  // One whose drawing never comes waits only so long.
  expect(handOver({ ...pressed, isTimeUp: true })).toBe('move')
  expect(handOver({ ...pressed, ringNow: title(3), drawn: after })).toBe('leave')
  expect(handOver({ ...pressed, ringNow: title(3), isTimeUp: true })).toBe('leave')
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
