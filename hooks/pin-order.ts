// Dragging this session's pins into an order of the person's own, as plain data: what the strip draws, where a drag puts
// a line, what the strip sends when one ends, and how the pins take that order. The strip (`pin-strip.tsx`) and the hook
// that keeps the order (`register.tsx`) share it.

/** The `key` of the strip's `Client`, which its posts name. */
export const PIN_STRIP = 'pin-order'

/** One line of the strip: the pin's key, and its reference and title. */
export type PinLine = { key: string; label: string }

/** What the strip is handed, and what it sends back once a drag ends: its lines, top to bottom. */
export type PinStripProps = { lines: PinLine[] }

/** A drag under way: the line picked up, and the place it would drop into. */
export type Drag = { from: number; over: number }

/** The line under a row of the strip: above the first is the first, below the last is the last. */
export const lineAt = (y: number, count: number): number => Math.max(0, Math.min(Math.floor(y), count - 1))

/** The list with the item at `from` taken out and put back at `to`. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const item = list[from]
  if (item === undefined || from === to) {
    return [...list]
  }
  const rest = list.filter((_, i) => i !== from)
  return [...rest.slice(0, to), item, ...rest.slice(to)]
}

const isLine = (line: unknown): line is PinLine =>
  typeof line === 'object' && line !== null && 'key' in line && 'label' in line && typeof line.key === 'string' && typeof line.label === 'string'

/** Whether what a strip sent is its lines. It came from code, not the person, so it is checked before it is used. */
export const isStripProps = (data: unknown): data is PinStripProps =>
  typeof data === 'object' && data !== null && 'lines' in data && Array.isArray(data.lines) && data.lines.every(isLine)

/**
 * The list with the items `order` names in that order, in the places those items held. Every other item keeps its place,
 * and a key the list does not hold, or one named twice, changes nothing; so a pin added while a drag was under way stays.
 */
export function reordered<T>(list: readonly T[], order: readonly string[], keyOf: (item: T) => string): T[] {
  const named = new Set(order.filter(key => list.some(item => keyOf(item) === key)))
  const queue = [...named].flatMap(key => list.filter(item => keyOf(item) === key))
  const fill = queue.values()
  return list.map(item => (named.has(keyOf(item)) ? (fill.next().value ?? item) : item))
}
