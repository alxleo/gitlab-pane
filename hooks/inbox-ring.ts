// Where an arrow key puts the pane's focus ring on the inbox. The engine keeps the ring and draws it; this only says which
// of the inbox's buttons is next, on plain data, so the arrows walk the cards one at a time instead of every button.
import { shortHash } from './identity.ts'

import type { InboxItem } from '../types'

/** The most cards an open rule draws; the rest are counted under `+N more`. */
export const ITEMS_SHOWN = 30

/** What the ring needs of a card: its MR's key, and whether it has events to open. */
export type RingCard = { key: string; activity: readonly Pick<InboxItem['activity'][number], 'kind'>[] }

/** A card's buttons: its title, which opens it; ✓; and ▴ less at the foot of an open one. */
export function cardButtons(key: string): { open: string; seen: string; less: string } {
  const id = shortHash(key)
  return { open: `inbox-open-${id}`, seen: `inbox-seen-${id}`, less: `inbox-less-${id}` }
}

/** The buttons under the cards of a rule. */
export function footerButtons(rule: string): { discuss: string; seen: string } {
  return { discuss: `inbox-discuss-${rule}`, seen: `inbox-seen-rule-${rule}` }
}

/** Where the ring stops on a card: its title, or its ✓ when it has nothing to open. */
const stopOf = (card: RingCard): string => (card.activity.length > 0 ? cardButtons(card.key).open : cardButtons(card.key).seen)

/**
 * The button an arrow moves the ring to, from the button `at` holding it now (`''`: none), over the open rule's cards:
 * the next card's stop down (`by` 1) or the previous one's up (`by` -1). From above the cards down lands on the first;
 * from the footer up lands on the last. `null` leaves the arrow to the engine, which scrolls: past either end, and up
 * from above the cards.
 */
export function ringStep(cards: readonly RingCard[], rule: string, at: string, by: 1 | -1): string | null {
  const shown = cards.slice(0, ITEMS_SHOWN)
  const holding = shown.findIndex(card => Object.values(cardButtons(card.key)).includes(at))
  const isBelow = Object.values(footerButtons(rule)).includes(at)
  const target = holding >= 0 ? holding + by : isBelow ? (by === -1 ? shown.length - 1 : -1) : by === 1 ? 0 : -1
  const card = shown[target]
  return card === undefined ? null : stopOf(card)
}
