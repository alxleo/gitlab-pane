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

/** A scroll the engine asks of the pane, as the ring reads it; and whether the inbox's list is what the pane shows. */
export type RingScroll = { isPerson: boolean; hasPointer: boolean; by: number; bodyRows: number; isInboxList: boolean }

/**
 * How many cards a scroll moves the ring, signed, or 0 to leave it a scroll. Only the person's scroll keys count, never
 * the wheel (it has a pointer) or a plugin's scroll, and only the arrows among them: an arrow is a row, and arrows
 * pressed while the pane was still answering arrive summed, while a page key is the window's rows and Home or End more.
 */
export function arrowSteps(scroll: RingScroll): number {
  const rows = Math.abs(scroll.by)
  const isArrow = rows === 1 || (rows > 0 && rows < scroll.bodyRows)
  return scroll.isPerson && !scroll.hasPointer && scroll.isInboxList && isArrow ? scroll.by : 0
}

/** One card on from `at`, `by` 1 or -1, as `ringStep` says. */
function oneStep(shown: readonly RingCard[], rule: string, at: string, by: 1 | -1): string | null {
  const holding = shown.findIndex(card => Object.values(cardButtons(card.key)).includes(at))
  const isBelow = Object.values(footerButtons(rule)).includes(at)
  const target = holding >= 0 ? holding + by : isBelow ? (by === -1 ? shown.length - 1 : -1) : by === 1 ? 0 : -1
  const card = shown[target]
  return card === undefined ? null : stopOf(card)
}

/**
 * The button arrows move the ring to, from the button `at` holding it now (`''`: none), over the cards the open rule
 * drew: `steps` cards on, down when positive, up when negative, stopping at the last there is. From above the cards
 * down lands on the first; from the footer up lands on the last. `null` leaves the arrows to the engine, which scrolls:
 * past either end, and up from above the cards.
 */
export function ringStep(cards: readonly RingCard[], rule: string, at: string, steps: number): string | null {
  const shown = cards.slice(0, ITEMS_SHOWN)
  const by = steps > 0 ? 1 : -1
  let landed: string | null = null
  for (let left = Math.abs(steps); left > 0; left -= 1) {
    const next = oneStep(shown, rule, landed ?? at, by)
    if (next === null) {
      break
    }
    landed = next
  }
  return landed
}

/**
 * Where the ring goes once the card `key` is marked seen, so the next card is ready for Enter or ✓: the card below,
 * or above when it was the last; `null` when it was the only one or is not drawn.
 */
export function ringAfterSeen(cards: readonly RingCard[], rule: string, key: string): string | null {
  const shown = cards.slice(0, ITEMS_SHOWN)
  const at = cardButtons(key).seen
  return shown.some(card => card.key === key) ? (oneStep(shown, rule, at, 1) ?? oneStep(shown, rule, at, -1)) : null
}
